import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { AppCommandBar } from "../../app/app-command-bar";

describe("AppCommandBar", () => {
  beforeEach(() => pushMock.mockReset());

  it("navigates to /chat when 'Ask Signal a question' is selected", () => {
    render(<AppCommandBar />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("Ask Signal a question"));
    expect(pushMock).toHaveBeenCalledWith("/chat");
  });

  it("navigates to / when 'Add competitor' is selected", () => {
    render(<AppCommandBar />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("Add competitor"));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("only ships the two commands with a real backend", () => {
    render(<AppCommandBar />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByText("Generate battlecard")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft outreach copy")).not.toBeInTheDocument();
    expect(screen.queryByText("Export weekly brief")).not.toBeInTheDocument();
  });
});
