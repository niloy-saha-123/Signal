import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HiringChart } from "../../components/HiringChart";
import { DIVERGING_COLORS } from "../../lib/chart-colors";

const data = [
  { department: "Engineering", delta: 5 },
  { department: "Sales", delta: -3 },
];

describe("HiringChart", () => {
  it("renders a bar for each department, colored by delta sign", () => {
    const { container } = render(<HiringChart data={data} />);
    // Recharts renders each Cell as a <path> inside a <g class="recharts-bar-rectangle">.
    // If this selector doesn't match after an actual run (Recharts DOM structure can shift
    // slightly by minor version), inspect container.innerHTML and adjust the selector — the
    // assertion's intent (real per-bar fill color, not a snapshot) must stay the same.
    const bars = container.querySelectorAll(".recharts-bar-rectangle path");
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0].getAttribute("fill")).toBe(DIVERGING_COLORS.positive);
    expect(bars[1].getAttribute("fill")).toBe(DIVERGING_COLORS.negative);
  });
});
