import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnalysisGraphState } from "../../graph/state";

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { vulnerabilityDetectorNode } from "./vulnerability-detector";
import { synthesisNode } from "./synthesis";

// Minimal state for testing
const createMinimalState = (): typeof AnalysisGraphState.State => ({
  competitor_id: "test-competitor",
  run_id: "test-run",
  has_pricing_diff: false,
  hiring_intent: null,
  sentiment_clusters: null,
  pricing_change: null,
  patterns: null,
  vulnerability: null,
  signal_score: null,
  decision: null,
});

// intentAnalyzerNode (Task 2), sentimentClustererNode (Task 3), changeDetectorNode
// (Task 4), and patternDetectorNode (Task 5) are no longer placeholders — they have their
// own real-behavior coverage in ./intent-analyzer.test.ts, ./sentiment-clusterer.test.ts,
// ./change-detector.test.ts, and ./pattern-detector.test.ts respectively, and are excluded
// from this table.
const placeholderNodes = [
  {
    name: "vulnerabilityDetectorNode",
    fn: vulnerabilityDetectorNode,
    logMessage: "vulnerabilityDetectorNode: not yet implemented (Part 10) — returning no-op update",
  },
  {
    name: "synthesisNode",
    fn: synthesisNode,
    logMessage: "synthesisNode: not yet implemented (Part 10) — returning no-op update",
  },
];

describe("agents/analysis — placeholder nodes (Part 10 stubs)", () => {
  beforeEach(() => {
    loggerWarnMock.mockClear();
  });

  it.each(placeholderNodes)(
    "$name returns empty update and logs warning",
    async ({ fn, logMessage, name }) => {
      const state = createMinimalState() as typeof AnalysisGraphState.State;
      const result = await fn(state);

      // Verify return value is empty
      expect(result).toEqual({});

      // Verify logger.warn was called with expected message
      expect(loggerWarnMock).toHaveBeenCalledWith(logMessage, {
        competitor_id: "test-competitor",
      });
      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    }
  );
});
