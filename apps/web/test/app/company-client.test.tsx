import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Competitor } from "../../lib/api";

const { saveProfileMock, getGoalMock, saveGoalMock, toastMock } = vi.hoisted(() => ({
  saveProfileMock: vi.fn(),
  getGoalMock: vi.fn(),
  saveGoalMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    saveCompanyProfile: saveProfileMock,
    getSignalGoal: getGoalMock,
    saveSignalGoal: saveGoalMock,
    uploadCompanyDocument: vi.fn(),
  };
});
vi.mock("@/components/ui/toast", () => ({ toast: toastMock }));
vi.mock("@/components/GoalsList", () => ({ GoalsList: () => <div data-testid="goals-list" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CompanyClient } from "../../app/(app)/company/company-client";

const competitor = { id: "11111111-1111-4111-8111-000000000001", name: "Acme" } as Competitor;

describe("CompanyClient", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps goals and plans on the company page", () => {
    getGoalMock.mockResolvedValue({ goal: null });
    render(<CompanyClient profile={null} competitors={[competitor]} documents={[]} />);
    expect(screen.getByTestId("goals-list")).toBeInTheDocument();
  });

  it("makes primary competitors real, keyboard-reachable checkboxes", () => {
    getGoalMock.mockResolvedValue({ goal: null });
    render(<CompanyClient profile={null} competitors={[competitor]} documents={[]} />);
    const box = screen.getByRole("checkbox", { name: "Acme" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it("saves the profile and confirms with a toast", async () => {
    getGoalMock.mockResolvedValue({ goal: null });
    saveProfileMock.mockResolvedValue({});
    render(<CompanyClient profile={null} competitors={[competitor]} documents={[]} />);
    fireEvent.change(screen.getByLabelText("What you sell"), { target: { value: "Forecasting for PMs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(saveProfileMock).toHaveBeenCalled());
    expect(saveProfileMock.mock.calls[0][0].product_description).toBe("Forecasting for PMs");
    expect(toastMock).toHaveBeenCalledWith("Company profile saved.", "success");
  });

  it("explains an empty document library", () => {
    getGoalMock.mockResolvedValue({ goal: null });
    render(<CompanyClient profile={null} competitors={[]} documents={[]} />);
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
  });
});
