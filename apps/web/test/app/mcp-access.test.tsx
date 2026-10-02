import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, createMock, revokeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  listApiTokens: listMock,
  createApiToken: createMock,
  revokeApiToken: revokeMock,
  MCP_URL: "https://api.example.com/mcp",
}));

import { McpAccess, snippets } from "../../app/(app)/settings/mcp-access";

const existing = {
  id: "t1",
  name: "Laptop",
  prefix: "sig_abcdefgh",
  last_used_at: null,
  revoked_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

describe("McpAccess", () => {
  beforeEach(() => {
    listMock.mockResolvedValue([existing, { ...existing, id: "t2", name: "Old", revoked_at: "2026-10-01T00:00:00Z" }]);
  });
  afterEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    revokeMock.mockReset();
  });

  it("lists only active tokens, without any secret", async () => {
    render(<McpAccess />);
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(screen.getByText(/never used/)).toBeInTheDocument();
  });

  it("creates a token and reveals it once with client snippets", async () => {
    createMock.mockResolvedValue({ ...existing, id: "t3", name: "Cursor", token: "sig_SECRET123" });
    render(<McpAccess />);
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: " Cursor " } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("sig_SECRET123")).toBeInTheDocument();
    expect(createMock).toHaveBeenCalledWith("Cursor");
    expect(screen.getByText(/claude mcp add --transport http signal https:\/\/api.example.com\/mcp/)).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("sig_SECRET123")).not.toBeInTheDocument();
  });

  it("explains the token cap on 409", async () => {
    createMock.mockRejectedValue(Object.assign(new Error("x"), { status: 409 }));
    render(<McpAccess />);
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum number of active tokens/);
  });

  it("revokes only after a confirm step", async () => {
    revokeMock.mockResolvedValue(undefined);
    render(<McpAccess />);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    expect(revokeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
  });

  it("snippets embed the token and URL as valid JSON where JSON is expected", () => {
    const [, cursor, desktop] = snippets("sig_X");
    expect(JSON.parse(cursor.code).mcpServers.signal).toEqual({
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer sig_X" },
    });
    expect(JSON.parse(desktop.code).mcpServers.signal.args).toContain("Authorization: Bearer sig_X");
  });
});
