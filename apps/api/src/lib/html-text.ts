// Cheerio HTML → visible text. Same strip pattern as the changelog collector
// (script/style/nav/footer/header out; prefer article/main/.content).
import * as cheerio from "cheerio";

export function extractHtmlText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, object, embed").remove();
  return $("article, main, .content").first().text().trim() || $("body").text().trim();
}
