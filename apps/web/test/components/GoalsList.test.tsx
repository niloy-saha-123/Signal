// apps/web/test/components/GoalsList.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listCompanyGoalsMock,
  createCompanyGoalMock,
  updateCompanyGoalMock,
  deleteCompanyGoalMock,
} = vi.hoisted(() => ({
  listCompanyGoalsMock: vi.fn(),
  createCompanyGoalMock: vi.fn(),
  updateCompanyGoalMock: vi.fn(),
  deleteCompanyGoalMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  listCompanyGoals: listCompanyGoalsMock,
  createCompanyGoal: createCompanyGoalMock,
  updateCompanyGoal: updateCompanyGoalMock,
  deleteCompanyGoal: deleteCompanyGoalMock,
}));

import { GoalsList } from "../../components/GoalsList";

const GOAL = {
  id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "00000000-0000-4000-8000-000000000000",
  content: "Expand to SMB",
  created_by: "user" as const,
  status: "active" as const,
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T00:00:00Z",
};

describe("GoalsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCompanyGoalsMock.mockResolvedValue([GOAL]);
    createCompanyGoalMock.mockResolvedValue(GOAL);
    updateCompanyGoalMock.mockResolvedValue(GOAL);
    deleteCompanyGoalMock.mockResolvedValue(undefined);
  });

  it("lists active goals from the API", async () => {
    render(<GoalsList />);
    expect(await screen.findByText("Expand to SMB")).toBeInTheDocument();
    expect(listCompanyGoalsMock).toHaveBeenCalled();
  });

  it("creates a goal and refreshes the list", async () => {
    render(<GoalsList />);
    await screen.findByText("Expand to SMB");

    fireEvent.change(screen.getByPlaceholderText("Add a goal or plan…"), {
      target: { value: "Launch an API platform" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(createCompanyGoalMock).toHaveBeenCalledWith("Launch an API platform")
    );
  });

  it("archives a goal via updateCompanyGoal", async () => {
    render(<GoalsList />);
    await screen.findByText("Expand to SMB");

    fireEvent.click(screen.getByLabelText("Archive goal"));

    await waitFor(() =>
      expect(updateCompanyGoalMock).toHaveBeenCalledWith(GOAL.id, { status: "archived" })
    );
  });

  it("enters edit mode and saves a new content", async () => {
    render(<GoalsList />);
    await screen.findByText("Expand to SMB");

    fireEvent.click(screen.getByLabelText("Edit goal"));
    const input = screen.getByDisplayValue("Expand to SMB");
    fireEvent.change(input, { target: { value: "Expand to SMB and mid-market" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(updateCompanyGoalMock).toHaveBeenCalledWith(GOAL.id, {
        content: "Expand to SMB and mid-market",
      })
    );
  });

  it("shows an empty-state message when there are no goals", async () => {
    listCompanyGoalsMock.mockResolvedValue([]);
    render(<GoalsList />);
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
  });
});