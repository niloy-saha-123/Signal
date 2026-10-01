import { Tabs } from "@/components/ui/primitives";

// The feed and alerts are one area with two views.
export function EvidenceAreaTabs({ active }: { active: "feed" | "alerts" }) {
  return (
    <Tabs
      label="Evidence views"
      active={active}
      items={[
        { value: "feed", label: "Feed", href: "/intel" },
        { value: "alerts", label: "Alerts", href: "/alerts" },
      ]}
    />
  );
}
