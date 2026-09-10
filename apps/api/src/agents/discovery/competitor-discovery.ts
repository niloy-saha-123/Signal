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
import { safeFetch, type SafeFetchInit, type SafeFetchResult } from "../../lib/safe-fetch";

type FieldName = DiscoveryLog["field_name"];

const TIMEOUT_MS = 15_000;
// Every probe body is attacker-influenced (the competitor picks the endpoint,
// and a redirect can move it again) — cap what cheerio/xml2js are handed.
const MAX_BODY_BYTES = 2_000_000;
const RETRY = { maxAttempts: 2 } as const;
const FIELD_ORDER: FieldName[] = ["subreddits", "greenhouse", "lever", "pricing_url", "rss_url"];

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

function errText(err: unknown): string {
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

// Ordered, de-duped slug candidates. `domain` is null when it failed the SSRF
// guard — name-based variants still run (they never touch the domain).
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
function probe(url: string, init: SafeFetchInit = {}): Promise<SafeFetchResult> {
  return withRetry(
    () => safeFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), maxBytes: MAX_BODY_BYTES, ...init }),
    RETRY
  );
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

async function redditSearch(url: string): Promise<RedditSearch> {
  const ua = process.env.REDDIT_USER_AGENT ?? "Signal/1.0";
  const res = await probe(url, { headers: { "User-Agent": ua } });
  if (!isOk(res)) throw new Error(`reddit ${url} returned ${res.status}`);
  return (await res.json()) as RedditSearch;
}

async function discoverSubreddits(name: string): Promise<StrategyOutcome<string[]>> {
  const q = encodeURIComponent(name);
  const srUrl = `https://www.reddit.com/search.json?q=${q}&type=sr&limit=25`;
  const postsUrl = `https://www.reddit.com/search.json?q=${q}&limit=100`;
  const attempted: string[] = [];
  try {
    attempted.push(srUrl);
    const byName = await redditSearch(srUrl);
    attempted.push(postsUrl);
    const byMention = await redditSearch(postsUrl);

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
        error_message: errText(err),
      },
    };
  }
}

// --- GREENHOUSE / LEVER -------------------------------------------------------

async function discoverAts(
  field: "greenhouse" | "lever",
  domain: string | null,
  name: string
): Promise<StrategyOutcome<string | null>> {
  const attempted: string[] = [];
  try {
    for (const slug of slugVariants(domain, name)) {
      const url =
        field === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`
          : `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
      attempted.push(url);
      const res = await probe(url);
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
        error_message: errText(err),
      },
    };
  }
}

// --- PRICING URL -----------------------------------------------------------

async function discoverPricing(domain: string | null): Promise<StrategyOutcome<string | null>> {
  if (!domain) return { value: null, log: invalidDomainLog("pricing_url") };
  const attempted: string[] = [];
  try {
    for (const path of PRICING_PATHS) {
      const url = `https://${domain}${path}`;
      attempted.push(url);
      let res = await probe(url, { method: "HEAD" });
      // Ruling: some servers reject HEAD — fall back to GET on the same path.
      if (res.status === 405 || res.status === 501) {
        res = await probe(url, { method: "GET" });
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
        error_message: errText(err),
      },
    };
  }
}

// --- RSS / CHANGELOG --------------------------------------------------------

// rss-parser's own parseURL follows Location with no host check on any hop and
// reads an unbounded body — fetch the candidate ourselves and hand the parser
// text it can only parse.
async function parsesAsFeed(url: string): Promise<boolean> {
  try {
    const res = await probe(url);
    if (!isOk(res)) return false;
    const feed = await parser.parseString(await res.text());
    return Boolean(feed) && Array.isArray(feed.items);
  } catch {
    return false;
  }
}

async function discoverRss(domain: string | null): Promise<StrategyOutcome<string | null>> {
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
    const feedMatches = await Promise.all(feedUrls.map((url) => parsesAsFeed(url)));
    const firstMatch = feedMatches.findIndex(Boolean);
    if (firstMatch >= 0) return found(feedUrls[firstMatch]);

    // Fallback: scrape the homepage for a declared feed link.
    const homeUrl = `https://${domain}/`;
    attempted.push(homeUrl);
    const res = await probe(homeUrl);
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
        if (await parsesAsFeed(resolved)) return found(resolved);
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
        error_message: errText(err),
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
  };
}): Promise<CompetitorDiscoveryResult> {
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
    tasks.push(discoverSubreddits(input.name).then(record<string[]>((v) => (result.subreddits = v))));
  }
  if (!isSet(ex.greenhouse_token)) {
    tasks.push(
      discoverAts("greenhouse", probeDomain, input.name).then(
        record<string | null>((v) => (result.greenhouse_token = v))
      )
    );
  }
  if (!isSet(ex.lever_token)) {
    tasks.push(
      discoverAts("lever", probeDomain, input.name).then(
        record<string | null>((v) => (result.lever_token = v))
      )
    );
  }
  if (!isSet(ex.pricing_url)) {
    tasks.push(discoverPricing(probeDomain).then(record<string | null>((v) => (result.pricing_url = v))));
  }
  if (!isSet(ex.changelog_rss)) {
    tasks.push(discoverRss(probeDomain).then(record<string | null>((v) => (result.changelog_rss = v))));
  }

  try {
    await Promise.all(tasks);
  } catch (err) {
    // Every strategy already catches its own failures — this is a last-resort
    // guard so discoverCompetitor never throws (Task 4 only expects the DB
    // write to reject).
    logger.error("competitor discovery: unexpected orchestration error", {
      competitor_id: input.competitor_id,
      error: errText(err),
    });
  }

  logs.sort((a, b) => FIELD_ORDER.indexOf(a.field_name) - FIELD_ORDER.indexOf(b.field_name));
  return result;
}
