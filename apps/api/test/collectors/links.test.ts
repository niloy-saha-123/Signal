import { describe, it, expect } from "vitest";
import { extractLinks } from "@/collectors/links";

const HTML = `<html><head>
<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">
<link rel="alternate" type="application/atom+xml" href="https://kestrel.dev/changelog.atom">
</head><body>
<a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">yt</a>
<a href="https://www.youtube.com/@kestrel">yt handle</a>
<a href="https://bsky.app/profile/kestrel.dev">bsky</a>
<a rel="me" href="https://hachyderm.io/@kestrel">masto</a>
<a rel="me" href="https://medium.com/@kestrel">medium</a>
<a href="https://medium.com/kestrel-eng">medium pub</a>
<a href="https://kestrel.hashnode.dev/">hashnode</a>
<a href="https://dev.to/kestrel">devto</a>
<a href="https://stackoverflow.com/questions/tagged/kestrel-sdk">so</a>
<a href="javascript:alert(1)">x</a>
</body></html>`;

describe("extractLinks", () => {
  it("finds feeds and accounts", () => {
    expect(extractLinks(HTML, "https://kestrel.dev/")).toEqual({
      blog_feeds: [
        "https://kestrel.dev/blog/rss.xml",
        "https://kestrel.dev/changelog.atom",
        "https://medium.com/feed/@kestrel",
        "https://medium.com/feed/kestrel-eng",
        "https://kestrel.hashnode.dev/rss.xml",
        "https://dev.to/feed/kestrel",
      ],
      social_feeds: [
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv",
        "https://hachyderm.io/@kestrel.rss",
      ],
      bluesky_handle: "kestrel.dev",
      stackoverflow_tag: "kestrel-sdk",
    });
  });

  it("survives a malformed tag escape and ignores reserved/non-Mastodon paths", () => {
    const html = `<a href="https://stackoverflow.com/questions/tagged/%E0%A4%A">x</a>
<a href="https://medium.com/about">m</a><a href="https://dev.to/t">d</a>
<a rel="me" href="https://instagram.com/@kestrel">i</a>
<a href="https://bsky.app/profile/Kestrel.Dev">b</a>`;
    expect(extractLinks(html, "https://kestrel.dev/")).toEqual({
      blog_feeds: [],
      social_feeds: [],
      bluesky_handle: "kestrel.dev",
      stackoverflow_tag: null,
    });
  });

  it("returns empty for an empty page", () => {
    expect(extractLinks("", "https://kestrel.dev/")).toEqual({
      blog_feeds: [],
      social_feeds: [],
      bluesky_handle: null,
      stackoverflow_tag: null,
    });
  });

  it("skips comment feeds", () => {
    const html = `<link rel="alternate" type="application/rss+xml" title="Kestrel &raquo; Feed" href="/feed/">
<link rel="alternate" type="application/rss+xml" title="Kestrel &raquo; Comments Feed" href="/feed/x/">
<link rel="alternate" type="application/rss+xml" title="Post" href="/comments/feed/">
<link rel="alternate" type="application/rss+xml" title="Post" href="/2026/hello/comment">`;
    expect(extractLinks(html, "https://kestrel.dev/").blog_feeds).toEqual(["https://kestrel.dev/feed/"]);
  });

  it("maps Medium subdomains to their own feed and checks reserved segments case-insensitively", () => {
    const html = `<a href="https://kestrel.medium.com/some-post">sub</a>
<a href="https://www.medium.com/@Kestrel">www</a>
<a href="https://medium.com/About">reserved</a><a href="https://dev.to/Search">reserved</a>`;
    expect(extractLinks(html, "https://kestrel.dev/").blog_feeds).toEqual([
      "https://kestrel.medium.com/feed",
      "https://medium.com/feed/@Kestrel",
    ]);
  });

  it("takes the first of several Stack Overflow tags, keeping an encoded plus", () => {
    expect(extractLinks(`<a href="https://stackoverflow.com/questions/tagged/kestrel+postgres">s</a>`, "https://kestrel.dev/").stackoverflow_tag).toBe("kestrel");
    expect(extractLinks(`<a href="https://stackoverflow.com/questions/tagged/kestrel%20postgres">s</a>`, "https://kestrel.dev/").stackoverflow_tag).toBe("kestrel");
    expect(extractLinks(`<a href="https://stackoverflow.com/questions/tagged/c%2b%2b">s</a>`, "https://kestrel.dev/").stackoverflow_tag).toBe("c++");
  });

  it("upgrades http links to https", () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="http://kestrel.dev/rss.xml">`;
    expect(extractLinks(html, "http://kestrel.dev/").blog_feeds).toEqual(["https://kestrel.dev/rss.xml"]);
  });
});
