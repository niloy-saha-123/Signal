// apps/web/test/components/ChatInterface.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationResult, RefusalResult } from "@signal/shared";

const { streamChatResultMock } = vi.hoisted(() => ({
  streamChatResultMock: vi.fn(),
}));

vi.mock("../../lib/chat-stream", () => ({
  streamChatResult: streamChatResultMock,
}));

import { ChatInterface } from "../../components/ChatInterface";

const citationResult: CitationResult = {
  refused: false,
  answer: "Acme cut Pro tier pricing 20% last week.",
  citations: [
    { claim: "Pro tier now $79/mo", chunk_id: "chunk-1", source: "pricing", similarity_score: 0.9 },
  ],
};

const refusalResult: RefusalResult = {
  refused: true,
  reason: "No grounded evidence for that claim.",
  suggested_query: "What pricing changes has Acme made this month?",
};

describe("ChatInterface", () => {
  beforeEach(() => {
    streamChatResultMock.mockReset();
  });
  afterEach(() => {
    streamChatResultMock.mockReset();
  });

  function typeAndSubmit(query: string) {
    fireEvent.change(screen.getByPlaceholderText("Ask Signal a question…"), {
      target: { value: query },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  }

  it("shows the query and a pending state immediately after submit", async () => {
    streamChatResultMock.mockImplementation(() => new Promise(() => {}));
    render(<ChatInterface competitorIds={["comp-1"]} />);
    typeAndSubmit("What changed?");
    expect(screen.getByText("What changed?")).toBeInTheDocument();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("calls streamChatResult with the query and competitorIds", () => {
    streamChatResultMock.mockImplementation(() => new Promise(() => {}));
    render(<ChatInterface competitorIds={["comp-1", "comp-2"]} />);
    typeAndSubmit("What changed?");
    expect(streamChatResultMock).toHaveBeenCalledWith(
      "What changed?",
      ["comp-1", "comp-2"],
      expect.any(Function),
      expect.any(Function)
    );
  });

  it("renders the answer and a citation chip once onResult fires with a CitationResult", async () => {
    streamChatResultMock.mockImplementation(async (_q, _ids, onResult) => {
      onResult(citationResult);
    });
    render(<ChatInterface competitorIds={["comp-1"]} />);
    typeAndSubmit("What changed?");
    await waitFor(() =>
      expect(screen.getByText("Acme cut Pro tier pricing 20% last week.")).toBeInTheDocument()
    );
    expect(screen.getByText("pricing")).toBeInTheDocument();
  });

  it("renders the reason and suggested query when onResult fires with a RefusalResult", async () => {
    streamChatResultMock.mockImplementation(async (_q, _ids, onResult) => {
      onResult(refusalResult);
    });
    render(<ChatInterface competitorIds={["comp-1"]} />);
    typeAndSubmit("What changed?");
    await waitFor(() =>
      expect(screen.getByText("No grounded evidence for that claim.")).toBeInTheDocument()
    );
    expect(
      screen.getByText("What pricing changes has Acme made this month?")
    ).toBeInTheDocument();
  });

  it("renders the error message when onError fires", async () => {
    streamChatResultMock.mockImplementation(async (_q, _ids, _onResult, onError) => {
      onError("Signal couldn't answer that. Please try again.");
    });
    render(<ChatInterface competitorIds={["comp-1"]} />);
    typeAndSubmit("What changed?");
    await waitFor(() =>
      expect(screen.getByText("Signal couldn't answer that. Please try again.")).toBeInTheDocument()
    );
  });

  it("does not submit an empty query", () => {
    streamChatResultMock.mockImplementation(() => new Promise(() => {}));
    render(<ChatInterface competitorIds={["comp-1"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(streamChatResultMock).not.toHaveBeenCalled();
  });
});
