import { Tabs } from "@/components/ui/primitives";

// Watching and Candidates are one area with two views.
export function CompetitorAreaTabs({ active }: { active: "watching" | "candidates" }) {
  return (
    <Tabs
      label="Competitor views"
      active={active}
      items={[
        { value: "watching", label: "Watching", href: "/board" },
        { value: "candidates", label: "Candidates", href: "/discovery" },
      ]}
    />
  );
}

export function weeklyChange(delta: number | null): string {
  const rounded = delta === null ? 0 : Math.round(delta);
  if (rounded === 0) return "Steady this week";
  return rounded > 0 ? `Up ${rounded} this week` : `Down ${Math.abs(rounded)} this week`;
}
