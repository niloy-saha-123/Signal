import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { analyzeMock, toastMock } = vi.hoisted(() => ({ analyzeMock: vi.fn(), toastMock: vi.fn() }));
vi.mock("../../lib/api", () => ({ analyzeCompetitor: analyzeMock }));
vi.mock("../../components/ui/toast", () => ({ toast: toastMock }));

import { AnalyzeButton } from "../../components/AnalyzeButton";

describe("AnalyzeButton", () => {
  afterEach(() => vi.clearAllMocks());

  it("queues an analysis and confirms with a toast", async () => {
    analyzeMock.mockResolvedValue({ run_id: "r1", status: "running" });
    render(<AnalyzeButton competitorId="comp-1" name="Acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Analyzing Acme"), "success"));
    expect(analyzeMock).toHaveBeenCalledWith("comp-1");
    expect(screen.getByRole("button", { name: "Analyze now" })).toBeEnabled();
  });

  it("reports a failure instead of pretending it worked", async () => {
    analyzeMock.mockRejectedValue(new Error("boom"));
    render(<AnalyzeButton competitorId="comp-1" name="Acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("Couldn't start"), "error"));
  });
});
