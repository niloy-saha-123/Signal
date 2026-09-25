import { describe, it, expect } from "vitest";
import { predictionBlocks, alertBlocks, resolutionBlocks } from "@/integrations/slack/blocks";

const PREDICTION = {
  statement: "Acme ships a first-party Postgres adapter",
  competitor_name: "Acme",
  probability: 0.72,
  resolves_at: new Date("2026-12-24T00:00:00.000Z"),
  evidence_count: 9,
  pattern_type: "product_launch" as const,
};

function text(blocks: unknown): string {
  return JSON.stringify(blocks);
}

describe("predictionBlocks", () => {
  it("shows the probability, the resolution date and the evidence count together", () => {
    // These three travel as a unit. A probability with no date is not a
    // prediction, and a prediction with no evidence count hides how thin it is.
    const rendered = text(predictionBlocks(PREDICTION));

    expect(rendered).toContain("72%");
    expect(rendered).toContain("9 signals");
    expect(rendered).toMatch(/Dec 24, 2026/);
  });

  it("never states a forecast as a certainty", () => {
    const rendered = text(predictionBlocks({ ...PREDICTION, probability: 0.95 }));

    expect(rendered).not.toMatch(/\bwill definitely\b|\bguaranteed\b|\bcertain to\b|\bdefinitely will\b/i);
  });

  it("names the competitor so a channel message stands alone", () => {
    // Slack messages get read out of context, days later, by someone who did
    // not open Signal. "They" is useless there.
    const rendered = text(predictionBlocks(PREDICTION));

    expect(rendered).toContain("Acme");
  });

  it("renders a low-confidence forecast as low confidence, not as news", () => {
    const rendered = text(predictionBlocks({ ...PREDICTION, probability: 0.15 }));

    expect(rendered).toContain("15%");
  });

  it("produces valid Block Kit structure", () => {
    const blocks = predictionBlocks(PREDICTION);

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(typeof (block as { type: string }).type).toBe("string");
    }
  });
});

describe("resolutionBlocks", () => {
  it("reports a hit with what actually happened", () => {
    const rendered = text(
      resolutionBlocks({
        statement: "Acme ships a first-party Postgres adapter",
        competitor_name: "Acme",
        probability: 0.72,
        status: "hit",
        resolution_note: "acme/next v15 shipped mentioning postgres.",
        resolution_evidence_urls: ["https://github.com/acme/next/releases/tag/v15.0.0"],
        brier_score: 0.0784,
      })
    );

    expect(rendered).toContain("Hit");
    expect(rendered).toContain("postgres");
    expect(rendered).toContain("72%");
  });

  it("reports a miss just as plainly as a hit", () => {
    // A ledger that only announces its wins is marketing, not a track record.
    const rendered = text(
      resolutionBlocks({
        statement: "Acme raises prices",
        competitor_name: "Acme",
        probability: 0.8,
        status: "miss",
        resolution_note: "Pricing changes were recorded and none was an increase.",
        resolution_evidence_urls: [],
        brier_score: 0.64,
      })
    );

    expect(rendered).toContain("Miss");
    expect(rendered).toContain("80%");
  });

  it("shows no score for an unresolved window and says why", () => {
    const rendered = text(
      resolutionBlocks({
        statement: "Acme ships something",
        competitor_name: "Acme",
        probability: 0.6,
        status: "unresolved",
        resolution_note: "No releases in the window.",
        resolution_evidence_urls: [],
        brier_score: null,
      })
    );

    expect(rendered).toContain("Unresolved");
    expect(rendered).toContain("No releases in the window.");
    // A null Brier score must not render as 0 — that reads as a perfect call.
    expect(rendered).not.toMatch(/"0"|score.{0,12}0\b/i);
  });
});

describe("alertBlocks", () => {
  it("carries the pattern, confidence and interpretation", () => {
    const rendered = text(
      alertBlocks({
        competitor_name: "Acme",
        pattern: "Upmarket pivot",
        confidence: 0.81,
        interpretation: "SMB segment is being abandoned.",
        recommended_actions: [{ type: "POSITIONING", detail: "Lead with SMB simplicity" }],
      })
    );

    expect(rendered).toContain("Upmarket pivot");
    expect(rendered).toContain("81%");
    expect(rendered).toContain("SMB segment is being abandoned.");
    expect(rendered).toContain("Lead with SMB simplicity");
  });
});
