import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BattlecardGenerator, type BattlecardResult } from "../../components/BattlecardGenerator";

const result: BattlecardResult = {
  title: "Acme battlecard",
  sections: [
    { heading: "Positioning", content: "Acme leads with price, we lead with support." },
  ],
};

describe("BattlecardGenerator", () => {
  it("shows a loading state immediately on mount", () => {
    render(
      <BattlecardGenerator competitorId="comp-1" onGenerate={() => new Promise(() => {})} />
    );
    expect(screen.getByText("Generating battlecard…")).toBeInTheDocument();
  });

  it("renders the result once onGenerate resolves", async () => {
    const onGenerate = vi.fn().mockResolvedValue(result);
    render(<BattlecardGenerator competitorId="comp-1" onGenerate={onGenerate} />);
    await waitFor(() => expect(screen.getByText("Acme battlecard")).toBeInTheDocument());
    expect(onGenerate).toHaveBeenCalledWith("comp-1");
    expect(
      screen.getByText("Acme leads with price, we lead with support.")
    ).toBeInTheDocument();
  });

  it("shows an error message when onGenerate rejects", async () => {
    const onGenerate = vi.fn().mockRejectedValue(new Error("Battlecard service unavailable"));
    render(<BattlecardGenerator competitorId="comp-1" onGenerate={onGenerate} />);
    await waitFor(() =>
      expect(screen.getByText("Battlecard service unavailable")).toBeInTheDocument()
    );
  });
});
