// CompetitorDiscoveryAgent — no LLM. Runs once when a competitor is created,
// never on a schedule. Given only `name` and `domain`, discovers subreddits,
// job board tokens, pricing URL, and RSS/changelog feed via pure HTTP
// pattern-matching and fallback probing — no model call required for any
// of it. Triggered by POST /api/competitors, which enqueues this onto the
// 'competitor-discovery' BullMQ queue (see queues/registry.ts) with
// { competitor_id, name, domain } as the job payload.
//
// Discovery strategies per field:
//
//   SUBREDDITS
//     1. GET reddit /search.json?q={name}&type=sr — subreddits named after the company
//     2. GET reddit /search.json?q={name} — mentions across all subreddits, to find
//        where people actually talk about this company (not just its own subreddit)
//     3. Rank candidates from both by mention count, take top 5
//     4. Always include r/SaaS and r/startups as defaults, even if 5 more are found
//
//   GREENHOUSE
//     1. Try boards-api.greenhouse.io/v1/boards/{domain-slug}/jobs
//     2. Try boards-api.greenhouse.io/v1/boards/{name-slug}/jobs
//     3. Try common slug variations (strip .com/.io, strip hyphens)
//     4. A 200 response with a non-empty `jobs` array means that token is real
//
//   LEVER
//     1. Try api.lever.co/v0/postings/{domain-slug}
//     2. Try api.lever.co/v0/postings/{name-slug}
//     3. Same slug-variation pattern as Greenhouse
//
//   PRICING URL
//     1. HEAD request against /pricing, /plans, /price, /pricing-plans, /en/pricing,
//        /en/plans on the domain, in order — first 200 wins
//     2. Fallback: web search "{name} pricing", take the first result whose host
//        matches the competitor's domain
//
//   RSS / CHANGELOG
//     1. Try /blog/rss, /blog/feed, /changelog/rss, /changelog/feed, /feed.xml,
//        /feed, /rss.xml, /rss, /atom.xml on the domain, in order
//     2. Fetch the homepage HTML and parse for
//        <link rel="alternate" type="application/rss+xml">
//     3. First candidate that parses as valid RSS/Atom XML wins
//
//   WEBSITE PAGES
//     1. The homepage, if it answers
//     2. The first of /product, /features, /platform that answers
//     Both are watched for copy changes; positioning lives across several pages.
//
//   COMMUNITY FORUM
//     GET /latest.json on forum., community., discuss. and discourse. subdomains;
//     a JSON body with a topic_list confirms a public Discourse instance.
//
//   NEWSROOM / PRESS FEED
//     /newsroom, /press and /news feed paths, confirmed by parsing as RSS/Atom.
//     Kept distinct from the changelog feed: they say different things.
//
//   GITHUB ORG
//     1. GET api.github.com/orgs/{slug} for each slug variant, then /users/{slug}
//     2. Confirm identity before accepting: the account's `blog` URL must resolve
//        to the competitor's own domain, or its login must equal the domain slug
//        exactly. An unconfirmed match is discarded rather than stored — a wrong
//        org silently poisons every signal, prediction and score downstream, and
//        a null here only costs one collector.
//
// Every attempt (URL tried, outcome) is written as one competitor_discovery_log
// row per field — a 'failed' discovery is diagnosable and manually fixable from
// that log, not a silent gap. On completion, the agent updates the competitors
// row with whatever it found, sets discovery_status = 'complete' (or 'failed'
// if every field came up empty), and stamps discovered_at.
//
// Output shape: CompetitorDiscoveryResult — discovered field values plus one
// DiscoveryLog entry (packages/shared/src/signals.ts) per field attempted.
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import type { CompetitorDiscoveryResult, DiscoveryLog } from "@signal/shared";
import { withRetry } from "../../lib/retry";
import { logger } from "../../lib/logger";
import {
  NON_PUBLIC_ADDRESS_MESSAGE,
  isPublicHostname,
  safeFetch,
  type SafeFetchInit,
  type SafeFetchResult,
} from "../../lib/safe-fetch";

type FieldName = DiscoveryLog["field_name"];

const TIMEOUT_MS = 15_000;
// Hard wall-clock bound on one discovery run. A domain that DNS-resolves but
// blackholes connections would otherwise pin a worker slot for minutes across
// the serial pricing/ATS loops; registry.ts's lockDuration is sized off this.
const RUN_DEADLINE_MS = 45_000;
// Every probe body is attacker-influenced (the competitor picks the endpoint,
// and a redirect can move it again) — cap what cheerio/xml2js are handed.
const MAX_BODY_BYTES = 2_000_000;
const RETRY = { maxAttempts: 2 } as const;
const FIELD_ORDER: FieldName[] = [
  "subreddits",
  "greenhouse",
  "lever",
  "pricing_url",
  "rss_url",
  "github_org",
  "website_urls",
  "discourse_url",
  "postings_rss",
];

const PRICING_PATHS = ["/pricing", "/plans", "/price", "/pricing-plans", "/en/pricing", "/en/plans"];
const RSS_PATHS = [
  "/blog/rss",
  "/blog/feed",
  "/changelog/rss",
  "/changelog/feed",
  "/feed.xml",
  "/feed",
  "/rss.xml",
  "/rss",
  "/atom.xml",
];

const parser = new Parser({ timeout: TIMEOUT_MS });

// --- helpers ---------------------------------------------------------------

function truncate(s: string, n = 500): string {
  return s.length > n ? s.slice(0, n) : s;
}

function errText(err: unknown, runSignal?: AbortSignal): string {
  if (runSignal?.aborted) {
    const reason: unknown = runSignal.reason;
    return reason instanceof Error && reason.name === "TimeoutError"
      ? "run deadline exceeded"
      : "discovery run cancelled";
  }
  return truncate(err instanceof Error ? err.message : String(err));
}

export function normalizeDomain(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.includes("://") && !/^https?:\/\//i.test(value)) return "";

  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    // A competitor domain is a host, never a URL with credentials or a custom
    // port. Reject these instead of silently normalizing them into a probe URL.
    if (parsed.username || parsed.password || parsed.port) return "";
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  } catch {
    return "";
  }
}

function nameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function domainSlug(domain: string): string {
  const parts = domain.split(".");
  return (parts.length > 1 ? parts.slice(0, -1) : parts).join("-");
}

// Ordered, de-duped slug candidates. `domain` is null when it was not a usable
// host — name-based variants still run (they never touch the domain).
export function slugVariants(domain: string | null, name: string): string[] {
  const d = domain ? domainSlug(domain) : "";
  const n = nameSlug(name);
  const out: string[] = [];
  for (const v of [d, n, d.replace(/-/g, ""), n.replace(/-/g, "")]) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// Every outbound probe goes through safeFetch: the host is resolved and checked
// against the private/reserved ranges before connecting, each redirect hop is
// re-validated, and the body is size-capped.
// Single attempt on purpose: a clean 404 or a "not a feed" parse is the expected
// outcome for most probes, so retrying only doubles outbound volume against the
// run deadline. Retry is kept where it can actually help — see redditSearch.
function probe(
  url: string,
  runSignal: AbortSignal,
  init: SafeFetchInit = {}
): Promise<SafeFetchResult> {
  return safeFetch(url, {
    signal: AbortSignal.any([runSignal, AbortSignal.timeout(TIMEOUT_MS)]),
    maxBytes: MAX_BODY_BYTES,
    ...init,
  });
}

function isOk(res: SafeFetchResult): boolean {
  return res.status >= 200 && res.status < 300;
}

interface StrategyOutcome<T> {
  value: T;
  log: DiscoveryLog;
}

function invalidDomainLog(field: FieldName): DiscoveryLog {
  return {
    field_name: field,
    attempted_urls: [],
    discovered_value: null,
    status: "error",
    error_message: "invalid or non-public domain",
  };
}

// --- SUBREDDITS -----------------------------------------------------------

interface RedditSearch {
  data?: { children?: Array<{ data?: { display_name?: unknown; subreddit?: unknown } }> };
}

async function redditSearch(url: string, runSignal: AbortSignal): Promise<RedditSearch> {
  const ua = process.env.REDDIT_USER_AGENT ?? "Signal/1.0";
  // Retry only what a retry can fix: a thrown network error/timeout, or a 5xx.
  // A resolved 4xx is reddit's answer, not a blip.
  const res = await withRetry(async () => {
    const attempt = await probe(url, runSignal, { headers: { "User-Agent": ua } });
    if (attempt.status >= 500) throw new Error(`reddit ${url} returned ${attempt.status}`);
    return attempt;
  }, RETRY);
  if (!isOk(res)) throw new Error(`reddit ${url} returned ${res.status}`);
  return (await res.json()) as RedditSearch;
}

async function discoverSubreddits(
  name: string,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string[]>> {
  const q = encodeURIComponent(name);
  const srUrl = `https://www.reddit.com/search.json?q=${q}&type=sr&limit=25`;
  const postsUrl = `https://www.reddit.com/search.json?q=${q}&limit=100`;
  const attempted: string[] = [];
  try {
    attempted.push(srUrl);
    const byName = await redditSearch(srUrl, runSignal);
    attempted.push(postsUrl);
    const byMention = await redditSearch(postsUrl, runSignal);

    const score = new Map<string, number>();
    const bump = (v: unknown) => {
      if (typeof v === "string" && v) score.set(v, (score.get(v) ?? 0) + 1);
    };
    for (const c of byName.data?.children ?? []) bump(c.data?.display_name);
    for (const c of byMention.data?.children ?? []) bump(c.data?.subreddit);

    const ranked = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n]) => n);

    // Plan deviation 5: always append these two, stored bare (no `r/` prefix —
    // collectors/reddit.ts reads them bare).
    const final: string[] = [];
    for (const s of [...ranked, "SaaS", "startups"]) {
      if (!final.includes(s)) final.push(s);
    }

    return {
      value: final,
      log: {
        field_name: "subreddits",
        attempted_urls: attempted,
        discovered_value: final.join(","),
        status: "found",
        error_message: null,
      },
    };
  } catch (err) {
    return {
      value: [],
      log: {
        field_name: "subreddits",
        attempted_urls: attempted,
        discovered_value: null,
        status: "error",
        error_message: errText(err, runSignal),
      },
    };
  }
}

// --- GREENHOUSE / LEVER -------------------------------------------------------

async function discoverAts(
  field: "greenhouse" | "lever",
  domain: string | null,
  name: string,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  const attempted: string[] = [];
  try {
    for (const slug of slugVariants(domain, name)) {
      const url =
        field === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`
          : `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
      attempted.push(url);
      const res = await probe(url, runSignal);
      if (res.status !== 200) continue;
      const body = (await res.json()) as unknown;
      const hit =
        field === "greenhouse"
          ? Array.isArray((body as { jobs?: unknown }).jobs) &&
            (body as { jobs: unknown[] }).jobs.length > 0
          : Array.isArray(body) && body.length > 0;
      if (hit) {
        return {
          value: slug,
          log: {
            field_name: field,
            attempted_urls: attempted,
            discovered_value: slug,
            status: "found",
            error_message: null,
          },
        };
      }
    }
    return {
      value: null,
      log: {
        field_name: field,
        attempted_urls: attempted,
        discovered_value: null,
        status: "not_found",
        error_message: null,
      },
    };
  } catch (err) {
    return {
      value: null,
      log: {
        field_name: field,
        attempted_urls: attempted,
        discovered_value: null,
        status: "error",
        error_message: errText(err, runSignal),
      },
    };
  }
}

// --- PRICING URL -----------------------------------------------------------

async function discoverPricing(
  domain: string | null,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  if (!domain) return { value: null, log: invalidDomainLog("pricing_url") };
  const attempted: string[] = [];
  try {
    for (const path of PRICING_PATHS) {
      const url = `https://${domain}${path}`;
      attempted.push(url);
      let res = await probe(url, runSignal, { method: "HEAD" });
      // Ruling: some servers reject HEAD — fall back to GET on the same path.
      if (res.status === 405 || res.status === 501) {
        res = await probe(url, runSignal, { method: "GET" });
      }
      if (isOk(res)) {
        return {
          value: res.url,
          log: {
            field_name: "pricing_url",
            attempted_urls: attempted,
            discovered_value: res.url,
            status: "found",
            error_message: null,
          },
        };
      }
    }
    return {
      value: null,
      log: {
        field_name: "pricing_url",
        attempted_urls: attempted,
        discovered_value: null,
        status: "not_found",
        error_message: null,
      },
    };
  } catch (err) {
    return {
      value: null,
      log: {
        field_name: "pricing_url",
        attempted_urls: attempted,
        discovered_value: null,
        status: "error",
        error_message: errText(err, runSignal),
      },
    };
  }
}

// --- RSS / CHANGELOG --------------------------------------------------------

// rss-parser's own parseURL follows Location with no host check on any hop and
// reads an unbounded body — fetch the candidate ourselves and hand the parser
// text it can only parse.
async function parsesAsFeed(url: string, runSignal: AbortSignal): Promise<boolean> {
  try {
    const res = await probe(url, runSignal);
    if (!isOk(res)) return false;
    const feed = await parser.parseString(await res.text());
    return Boolean(feed) && Array.isArray(feed.items);
  } catch {
    return false;
  }
}

async function discoverRss(
  domain: string | null,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  if (!domain) return { value: null, log: invalidDomainLog("rss_url") };
  const attempted: string[] = [];
  const found = (url: string): StrategyOutcome<string | null> => ({
    value: url,
    log: {
      field_name: "rss_url",
      attempted_urls: attempted,
      discovered_value: url,
      status: "found",
      error_message: null,
    },
  });
  try {
    // The candidates have a fixed priority order, but probing them serially
    // could multiply a 15s network timeout by all nine paths. Start the bounded
    // set together, then choose the first valid URL in the documented order.
    const feedUrls = RSS_PATHS.map((path) => `https://${domain}${path}`);
    attempted.push(...feedUrls);
    const feedMatches = await Promise.all(feedUrls.map((url) => parsesAsFeed(url, runSignal)));
    const firstMatch = feedMatches.findIndex(Boolean);
    if (firstMatch >= 0) return found(feedUrls[firstMatch]);

    // Fallback: scrape the homepage for a declared feed link.
    const homeUrl = `https://${domain}/`;
    attempted.push(homeUrl);
    const res = await probe(homeUrl, runSignal);
    const $ = cheerio.load(await res.text());
    const href = $(
      'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]'
    )
      .first()
      .attr("href");
    if (href) {
      // parsesAsFeed re-runs the full safeFetch guard on this attacker-supplied
      // href, so no separate URL check is needed here.
      const resolved = URL.parse(href, `https://${domain}`)?.toString();
      if (resolved) {
        attempted.push(resolved);
        if (await parsesAsFeed(resolved, runSignal)) return found(resolved);
      }
    }

    return {
      value: null,
      log: {
        field_name: "rss_url",
        attempted_urls: attempted,
        discovered_value: null,
        status: "not_found",
        error_message: null,
      },
    };
  } catch (err) {
    return {
      value: null,
      log: {
        field_name: "rss_url",
        attempted_urls: attempted,
        discovered_value: null,
        status: "error",
        error_message: errText(err, runSignal),
      },
    };
  }
}

// --- WEBSITE / COMMUNITY / NEWSROOM ------------------------------------------

const PRODUCT_PAGE_PATHS = ["/product", "/features", "/platform"];
const FORUM_SUBDOMAINS = ["forum", "community", "discuss", "discourse"];
const POSTINGS_PATHS = [
  "/newsroom/rss",
  "/newsroom/feed",
  "/newsroom/rss.xml",
  "/press/rss",
  "/press/feed",
  "/news/rss",
  "/news/feed",
  "/news/rss.xml",
];

async function answers(url: string, runSignal: AbortSignal): Promise<boolean> {
  try {
    return isOk(await probe(url, runSignal));
  } catch {
    return false;
  }
}

async function isDiscourse(base: string, runSignal: AbortSignal): Promise<boolean> {
  try {
    const res = await probe(`${base}/latest.json`, runSignal, {
      headers: { Accept: "application/json" },
    });
    if (!isOk(res)) return false;
    const body = (await res.json()) as { topic_list?: unknown };
    return typeof body === "object" && body !== null && "topic_list" in body;
  } catch {
    return false;
  }
}

// These three strategies probe paths and subdomains *derived from* the
// competitor's domain. If the apex itself resolves to a non-public address, the
// whole family is refused up front: probing forum.<domain> or <domain>/newsroom
// for a domain already known to point inward is pointless at best, and a
// wildcard-DNS host (169.254.169.254.nip.io) makes every derived name resolve
// inward too. It also keeps these fields reporting "error" exactly like the
// other domain-based strategies, rather than an ambiguous "not_found".
function nonPublicDomainLog(field: FieldName): DiscoveryLog {
  return {
    field_name: field,
    attempted_urls: [],
    discovered_value: null,
    status: "error",
    error_message: NON_PUBLIC_ADDRESS_MESSAGE,
  };
}

function outcome<T>(
  field: FieldName,
  attempted: string[],
  value: T,
  found: boolean
): StrategyOutcome<T> {
  return {
    value,
    log: {
      field_name: field,
      attempted_urls: attempted,
      discovered_value: found ? String(Array.isArray(value) ? value.join(", ") : value) : null,
      status: found ? "found" : "not_found",
      error_message: null,
    },
  };
}

async function discoverWebsite(
  domain: string | null,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string[]>> {
  if (!domain) return { value: [], log: invalidDomainLog("website_urls") };
  if (!(await isPublicHostname(domain))) return { value: [], log: nonPublicDomainLog("website_urls") };
  const home = `https://${domain}/`;
  const product = PRODUCT_PAGE_PATHS.map((path) => `https://${domain}${path}`);
  const attempted = [home, ...product];
  // Probed together: a serial walk would multiply one slow host's timeout.
  const [homeOk, ...productOk] = await Promise.all(
    attempted.map((url) => answers(url, runSignal))
  );
  const pages = [
    ...(homeOk ? [home] : []),
    ...product.filter((_, i) => productOk[i]).slice(0, 1),
  ];
  return outcome("website_urls", attempted, pages, pages.length > 0);
}

async function discoverDiscourse(
  domain: string | null,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  if (!domain) return { value: null, log: invalidDomainLog("discourse_url") };
  if (!(await isPublicHostname(domain))) {
    return { value: null, log: nonPublicDomainLog("discourse_url") };
  }
  const bases = FORUM_SUBDOMAINS.map((sub) => `https://${sub}.${domain}`);
  const attempted = bases.map((base) => `${base}/latest.json`);
  const matches = await Promise.all(bases.map((base) => isDiscourse(base, runSignal)));
  const first = matches.findIndex(Boolean);
  return first >= 0
    ? outcome("discourse_url", attempted, bases[first], true)
    : outcome<string | null>("discourse_url", attempted, null, false);
}

async function discoverPostings(
  domain: string | null,
  changelogFeed: string | null,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  if (!domain) return { value: null, log: invalidDomainLog("postings_rss") };
  if (!(await isPublicHostname(domain))) {
    return { value: null, log: nonPublicDomainLog("postings_rss") };
  }
  const urls = POSTINGS_PATHS.map((path) => `https://${domain}${path}`).filter(
    // Never record the changelog feed a second time under another name.
    (url) => url !== changelogFeed
  );
  const matches = await Promise.all(urls.map((url) => parsesAsFeed(url, runSignal)));
  const first = matches.findIndex(Boolean);
  return first >= 0
    ? outcome("postings_rss", urls, urls[first], true)
    : outcome<string | null>("postings_rss", urls, null, false);
}

// --- GITHUB ORG -----------------------------------------------------------

interface GithubAccount {
  login?: unknown;
  blog?: unknown;
  name?: unknown;
  type?: unknown;
}

// True when the account's stated website is the competitor's own domain.
// Compared on the host with a leading "www." stripped, so
// "https://www.vercel.com/" matches "vercel.com".
function blogMatchesDomain(blog: unknown, domain: string | null): boolean {
  if (!domain || typeof blog !== "string" || !blog.trim()) return false;
  try {
    const host = new URL(blog.includes("://") ? blog : `https://${blog}`).hostname.toLowerCase();
    const normalizedHost = host.replace(/^www\./, "");
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  } catch {
    return false;
  }
}

// Identity confirmation, not just existence. github.com/signal exists and has
// nothing to do with a company called Signal — accepting an unverified slug match
// would attribute another project's releases and pull requests to this competitor
// and corrupt every signal, score and prediction derived from them. Two accepted
// proofs: the account links back to the competitor's domain, or its login is
// exactly the domain slug (github.com/vercel for vercel.com), which is too
// specific to be coincidence.
function isConfirmedAccount(
  account: GithubAccount,
  slug: string,
  domain: string | null
): boolean {
  if (blogMatchesDomain(account.blog, domain)) return true;
  // A bare login match is NOT proof of anything on its own. GitHub handles are
  // first-come-first-served and unrelated to domain ownership, so accepting one
  // would let whoever squats github.com/<company-slug> have their repository
  // activity attributed to this competitor — fabricated evidence flowing
  // straight into the prediction ledger, which is the one thing the ledger
  // exists to prevent.
  //
  // An *organization* whose login is exactly the domain slug is a far higher
  // bar than a personal account: orgs are rarer, harder to squat, and are what
  // a real company account looks like (github.com/vercel for vercel.com). That
  // still stands on its own; a user account does not.
  if (account.type !== "Organization") return false;
  return domain !== null && slug === domainSlug(domain);
}

async function discoverGithubOrg(
  domain: string | null,
  name: string,
  runSignal: AbortSignal
): Promise<StrategyOutcome<string | null>> {
  const attempted: string[] = [];
  // Unauthenticated GitHub allows 60 requests/hour per IP. Discovery runs once
  // per competitor so it can share that budget, but the token is still sent when
  // present so discovery and the collector are not competing for the same quota.
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "signal-competitive-intelligence",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    for (const slug of slugVariants(domain, name)) {
      // Orgs before users: a company account is an org far more often than a
      // user, so this ordering usually costs one request instead of two.
      for (const kind of ["orgs", "users"] as const) {
        const url = `https://api.github.com/${kind}/${encodeURIComponent(slug)}`;
        attempted.push(url);
        const res = await probe(url, runSignal, { headers });
        if (!isOk(res)) continue;

        const account = (await res.json()) as GithubAccount;
        if (typeof account.login !== "string" || !account.login) continue;
        if (!isConfirmedAccount(account, slug, domain)) continue;

        return {
          value: account.login,
          log: {
            field_name: "github_org",
            attempted_urls: attempted,
            discovered_value: account.login,
            status: "found",
            error_message: null,
          },
        };
      }
    }

    return {
      value: null,
      log: {
        field_name: "github_org",
        attempted_urls: attempted,
        discovered_value: null,
        status: "not_found",
        error_message: null,
      },
    };
  } catch (err) {
    return {
      value: null,
      log: {
        field_name: "github_org",
        attempted_urls: attempted,
        discovered_value: null,
        status: "error",
        error_message: errText(err, runSignal),
      },
    };
  }
}

// --- orchestration --------------------------------------------------------

export async function discoverCompetitor(input: {
  competitor_id: string;
  name: string;
  domain: string;
  existing: {
    subreddits: string[];
    greenhouse_token: string | null;
    lever_token: string | null;
    pricing_url: string | null;
    changelog_rss: string | null;
    github_org: string | null;
    website_urls: string[];
    discourse_url: string | null;
    postings_rss: string | null;
  };
}, opts: { signal?: AbortSignal } = {}): Promise<CompetitorDiscoveryResult> {
  // One deadline for the whole run, threaded into every probe. A strategy still
  // in flight when it fires resolves to an `error` log and the rest of the
  // result still finalizes.
  const runSignal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(RUN_DEADLINE_MS)])
    : AbortSignal.timeout(RUN_DEADLINE_MS);
  // Syntactic only — whether the host is actually safe to reach is decided per
  // call by safeFetch, which resolves it and re-checks every redirect hop.
  const probeDomain = normalizeDomain(input.domain) || null;
  const ex = input.existing;
  const isSet = (v: string | null): v is string => typeof v === "string" && v.length > 0;

  const logs: DiscoveryLog[] = [];
  const result: CompetitorDiscoveryResult = {
    subreddits: ex.subreddits,
    greenhouse_token: ex.greenhouse_token,
    lever_token: ex.lever_token,
    pricing_url: ex.pricing_url,
    changelog_rss: ex.changelog_rss,
    github_org: ex.github_org,
    website_urls: ex.website_urls,
    discourse_url: ex.discourse_url,
    postings_rss: ex.postings_rss,
    logs,
  };

  const record = <T>(assign: (v: T) => void) => (r: StrategyOutcome<T>) => {
    assign(r.value);
    logs.push(r.log);
    logger.info("competitor discovery: field probed", {
      competitor_id: input.competitor_id,
      field: r.log.field_name,
      status: r.log.status,
    });
  };

  const tasks: Promise<void>[] = [];
  // Skip rule (plan deviation 4): a pre-filled field is passed straight through
  // with no probe and no log entry.
  if (ex.subreddits.length === 0) {
    tasks.push(
      discoverSubreddits(input.name, runSignal).then(record<string[]>((v) => (result.subreddits = v)))
    );
  }
  if (!isSet(ex.greenhouse_token)) {
    tasks.push(
      discoverAts("greenhouse", probeDomain, input.name, runSignal).then(
        record<string | null>((v) => (result.greenhouse_token = v))
      )
    );
  }
  if (!isSet(ex.lever_token)) {
    tasks.push(
      discoverAts("lever", probeDomain, input.name, runSignal).then(
        record<string | null>((v) => (result.lever_token = v))
      )
    );
  }
  if (!isSet(ex.pricing_url)) {
    tasks.push(
      discoverPricing(probeDomain, runSignal).then(
        record<string | null>((v) => (result.pricing_url = v))
      )
    );
  }
  if (!isSet(ex.changelog_rss)) {
    tasks.push(
      discoverRss(probeDomain, runSignal).then(
        record<string | null>((v) => (result.changelog_rss = v))
      )
    );
  }
  if (!isSet(ex.github_org)) {
    tasks.push(
      discoverGithubOrg(probeDomain, input.name, runSignal).then(
        record<string | null>((v) => (result.github_org = v))
      )
    );
  }
  if (ex.website_urls.length === 0) {
    tasks.push(
      discoverWebsite(probeDomain, runSignal).then(
        record<string[]>((v) => (result.website_urls = v))
      )
    );
  }
  if (!isSet(ex.discourse_url)) {
    tasks.push(
      discoverDiscourse(probeDomain, runSignal).then(
        record<string | null>((v) => (result.discourse_url = v))
      )
    );
  }
  if (!isSet(ex.postings_rss)) {
    tasks.push(
      discoverPostings(probeDomain, ex.changelog_rss, runSignal).then(
        record<string | null>((v) => (result.postings_rss = v))
      )
    );
  }

  try {
    await Promise.all(tasks);
  } catch (err) {
    // Every strategy already catches its own failures — this is a last-resort
    // guard so discoverCompetitor never throws (Task 4 only expects the DB
    // write to reject).
    logger.error("competitor discovery: unexpected orchestration error", {
      competitor_id: input.competitor_id,
      error: errText(err, runSignal),
    });
  }

  logs.sort((a, b) => FIELD_ORDER.indexOf(a.field_name) - FIELD_ORDER.indexOf(b.field_name));
  return result;
}
