// apps/web/test/components/ChatInterface.confirm.test.tsx
// Inline HITL confirmation: when the SSE stream emits confirm_required the chat
// renders a confirm/cancel card, and clicking it resumes the thread with the right
// decision.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamChatResultMock, resumeChatThreadMock, createChatThreadMock } = vi.hoisted(() => ({
  streamChatResultMock: vi.fn(),
  resumeChatThreadMock: vi.fn(),
  createChatThreadMock: vi.fn(),
}));

vi.mock("../../lib/chat-stream", () => ({
  streamChatResult: streamChatResultMock,
  resumeChatThread: resumeChatThreadMock,
}));

vi.mock("../../lib/api", () => ({
  listChatThreads: vi.fn().mockResolvedValue([]),
  createChatThread: createChatThreadMock,
  getChatThreadMessages: vi.fn().mockResolvedValue([]),
  deleteChatThread: vi.fn().mockResolvedValue(undefined),
  listChatThreadCheckpoints: vi.fn().mockResolvedValue([]),
  regenerateChatThread: vi.fn().mockResolvedValue({}),
  uploadCompanyDocument: vi.fn().mockResolvedValue({}),
}));

import { ChatInterface } from "../../components/ChatInterface";

// jsdom has no scrollIntoView — the composer scrolls to the newest message on change.
Element.prototype.scrollIntoView = vi.fn();

const MUTATION = {
  tool_name: "create_competitor",
  description: 'Create competitor "Acme" (acme.com) and start discovery?',
  arguments: { name: "Acme", domain: "acme.com" },
};

function emitConfirm() {
  streamChatResultMock.mockImplementation(
    async (_q: string, _ids: string[], _onResult: unknown, _onError: unknown, options: { onConfirmRequired?: (m: typeof MUTATION) => void }) => {
      options.onConfirmRequired?.(MUTATION);
    }
  );
}

describe("ChatInterface — inline mutation confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChatThreadMock.mockResolvedValue({ id: "thread-1", title: null, updated_at: "" });
    emitConfirm();
  });

  it("renders a confirm card when the stream reports confirm_required", async () => {
    render(<ChatInterface competitorIds={["11111111-1111-4111-8111-111111111111"]} showThreads={false} />);

    fireEvent.change(screen.getByPlaceholderText("Ask Signal a question…"), {
      target: { value: "add Acme as a competitor" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(await screen.findByTestId("confirm-card")).toBeInTheDocument();
    expect(screen.getByText(/Signal wants to run this action/)).toBeInTheDocument();
    expect(screen.getByText(MUTATION.description)).toBeInTheDocument();
  });

  it("resumes with approve when Confirm is clicked", async () => {
    resumeChatThreadMock.mockImplementation(
      async (_id: string, _decision: string, onResult: (r: unknown) => void) => {
        onResult({ refused: false, answer: "Created Acme", citations: [] });
      }
    );

    render(<ChatInterface competitorIds={["11111111-1111-4111-8111-111111111111"]} showThreads={false} />);
    fireEvent.change(screen.getByPlaceholderText("Ask Signal a question…"), {
      target: { value: "add Acme" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    await screen.findByTestId("confirm-card");

    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() =>
      expect(resumeChatThreadMock).toHaveBeenCalledWith(
        "thread-1",
        "approve",
        expect.any(Function),
        expect.any(Function),
        expect.any(Object)
      )
    );
  });

  it("resumes with deny when Cancel is clicked", async () => {
    resumeChatThreadMock.mockImplementation(
      async (_id: string, _decision: string, onResult: (r: unknown) => void) => {
        onResult({ refused: false, answer: "Okay, I won't.", citations: [] });
      }
    );

    render(<ChatInterface competitorIds={["11111111-1111-4111-8111-111111111111"]} showThreads={false} />);
    fireEvent.change(screen.getByPlaceholderText("Ask Signal a question…"), {
      target: { value: "add Acme" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    await screen.findByTestId("confirm-card");

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() =>
      expect(resumeChatThreadMock).toHaveBeenCalledWith(
        "thread-1",
        "deny",
        expect.any(Function),
        expect.any(Function),
        expect.any(Object)
      )
    );
  });
});