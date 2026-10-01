// Pure homepage link parser: finds the competitor's own feeds and accounts on
// channels Signal can read for free without logging in.
import * as cheerio from "cheerio";

export interface DiscoveredLinks {
  blog_feeds: string[];
  social_feeds: string[];
  bluesky_handle: string | null;
  stackoverflow_tag: string | null;
}

const MAX_PER_LIST = 10;
const BSKY_HANDLE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const SO_TAG = /^[a-z0-9][a-z0-9.#+-]{0,34}$/;
// Hosts that use /@user paths but are not Mastodon.
const NOT_MASTODON = [
  "medium.com", "youtube.com", "x.com", "twitter.com", "tiktok.com", "threads.net",
  "instagram.com", "linkedin.com", "threads.com", "facebook.com", "github.com",
  "bsky.social", "bsky.app", "tumblr.com",
];
const MEDIUM_RESERVED = new Set(["about", "membership", "plans", "jobs", "m", "tag", "topics", "search", "me", "creators"]);
const DEVTO_RESERVED = new Set(["about", "t", "tags", "top", "search", "settings", "enter", "faq"]);

function resolve(href: string | undefined, base: string): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

function hostIs(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function extractLinks(html: string, pageUrl: string): DiscoveredLinks {
  const $ = cheerio.load(html);
  const blog = new Set<string>();
  const social = new Set<string>();
  let bluesky: string | null = null;
  let soTag: string | null = null;

  $('link[rel~="alternate"]').each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    if (!type.includes("rss") && !type.includes("atom")) return;
    if (/comment/i.test($(el).attr("title") ?? "")) return;
    const url = resolve($(el).attr("href"), pageUrl);
    if (url && !/\/comments?(\/|$)/i.test(url.pathname)) blog.add(url.href);
  });

  $("a[href]").each((_, el) => {
    const url = resolve($(el).attr("href"), pageUrl);
    if (!url) return;
    const path = url.pathname.replace(/\/+$/, "");
    const rel = ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/);

    if (hostIs(url, "youtube.com")) {
      const channel = /^\/channel\/(UC[\w-]{22})$/.exec(path);
      if (channel) social.add(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel[1]}`);
      return;
    }
    if (hostIs(url, "bsky.app")) {
      const handle = /^\/profile\/([^/]+)$/.exec(path)?.[1];
      if (!bluesky && handle && BSKY_HANDLE.test(handle)) bluesky = handle.toLowerCase();
      return;
    }
    if (hostIs(url, "medium.com")) {
      const host = url.hostname.toLowerCase();
      if (host !== "medium.com" && host !== "www.medium.com") {
        blog.add(`https://${host}/feed`);
        return;
      }
      const seg = /^\/(@?[A-Za-z0-9_.-]+)$/.exec(path)?.[1];
      if (seg && !MEDIUM_RESERVED.has(seg.toLowerCase())) blog.add(`https://medium.com/feed/${seg}`);
      return;
    }
    if (url.hostname.toLowerCase().endsWith(".hashnode.dev")) {
      blog.add(`https://${url.hostname.toLowerCase()}/rss.xml`);
      return;
    }
    if (hostIs(url, "dev.to")) {
      const seg = /^\/([A-Za-z0-9_-]+)$/.exec(path)?.[1];
      if (seg && !DEVTO_RESERVED.has(seg.toLowerCase())) blog.add(`https://dev.to/feed/${seg}`);
      return;
    }
    if (hostIs(url, "stackoverflow.com")) {
      // A raw "+" or space joins several tags; an encoded %2B is a literal plus (c++).
      const tag = /^\/questions\/tagged\/([^/]+)$/.exec(path)?.[1]?.split(/\+|%20/i)[0];
      let decoded: string | null = null;
      try {
        decoded = tag ? decodeURIComponent(tag) : null;
      } catch {
        // Malformed escape: skip the tag rather than fail the whole scan.
      }
      if (!soTag && decoded && SO_TAG.test(decoded)) soTag = decoded;
      return;
    }
    if (rel.includes("me") && !NOT_MASTODON.some((d) => hostIs(url, d))) {
      const user = /^\/@([A-Za-z0-9_]{1,30})$/.exec(path)?.[1];
      if (user) social.add(`https://${url.hostname.toLowerCase()}/@${user}.rss`);
    }
  });

  return {
    blog_feeds: [...blog].slice(0, MAX_PER_LIST),
    social_feeds: [...social].slice(0, MAX_PER_LIST),
    bluesky_handle: bluesky,
    stackoverflow_tag: soTag,
  };
}
