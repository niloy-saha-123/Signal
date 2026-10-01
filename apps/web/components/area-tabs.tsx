import { Tabs } from "@/components/ui/primitives";

export function SettingsAreaTabs({ active }: { active: "settings" | "activity" }) {
  return (
    <Tabs
      label="Settings views"
      active={active}
      items={[
        { value: "settings", label: "Settings", href: "/settings" },
        { value: "activity", label: "Activity", href: "/activity" },
      ]}
    />
  );
}

export function CompanyAreaTabs({ active }: { active: "profile" | "compare" }) {
  return (
    <Tabs
      label="Company views"
      active={active}
      items={[
        { value: "profile", label: "Profile", href: "/company" },
        { value: "compare", label: "Us vs. them", href: "/company/compare" },
      ]}
    />
  );
}
