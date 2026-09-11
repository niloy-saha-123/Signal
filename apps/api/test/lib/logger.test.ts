import { describe, it, expect } from "vitest";
import { logger, withCorrelation } from "@/lib/logger";

describe("logger", () => {
  it("exports a base logger with standard log methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("withCorrelation returns a child logger that includes job_id and run_id in its default metadata", () => {
    const child = withCorrelation("job-123", "run-456");
    expect(child.defaultMeta).toMatchObject({ job_id: "job-123", run_id: "run-456" });
  });
});
