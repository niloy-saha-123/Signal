import { describe, it, expect } from "vitest";
import { RoadmapLinkCreateSchema, RoadmapLinkUpdateSchema } from "../src/predictions";

describe("roadmap link schemas", () => {
  it("defaults stance to watching and trims the title", () => {
    expect(RoadmapLinkCreateSchema.parse({ title: "  SSO v2 ", url: "https://linear.app/a/issue/ENG-42" })).toEqual({
      title: "SSO v2",
      url: "https://linear.app/a/issue/ENG-42",
      stance: "watching",
    });
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "ftp://x.test/a", "not a url"])(
    "rejects url %s",
    (url) => expect(RoadmapLinkCreateSchema.safeParse({ title: "x", url }).success).toBe(false)
  );
  it("rejects empty or over-long titles, unknown stances and extra keys", () => {
    expect(RoadmapLinkCreateSchema.safeParse({ title: " ", url: "https://x.test" }).success).toBe(false);
    expect(RoadmapLinkCreateSchema.safeParse({ title: "a".repeat(201), url: "https://x.test" }).success).toBe(false);
    expect(RoadmapLinkCreateSchema.safeParse({ title: "x", url: "https://x.test", stance: "ship" }).success).toBe(false);
    expect(RoadmapLinkCreateSchema.safeParse({ title: "x", url: "https://x.test", extra: 1 }).success).toBe(false);
  });
  it("update accepts title or stance, never url, never empty", () => {
    expect(RoadmapLinkUpdateSchema.parse({ stance: "accelerate" })).toEqual({ stance: "accelerate" });
    expect(RoadmapLinkUpdateSchema.safeParse({}).success).toBe(false);
    expect(RoadmapLinkUpdateSchema.safeParse({ url: "https://x.test" }).success).toBe(false);
  });
});
