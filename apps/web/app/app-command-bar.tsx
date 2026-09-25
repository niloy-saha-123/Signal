// apps/web/app/app-command-bar.tsx
// ⌘K palette: ask Signal, or jump to any page in the shared nav model.
"use client";
import { useRouter } from "next/navigation";
import { CommandBar, type Command } from "../components/CommandBar";
import { NAV_ITEMS } from "../lib/nav";

export function AppCommandBar() {
  const router = useRouter();

  const commands: Command[] = [
    { id: "chat", label: "Ask Signal a question", onSelect: () => router.push("/chat") },
    // Discovery holds the manual add form.
    { id: "add-competitor", label: "Add competitor", onSelect: () => router.push("/discovery") },
    ...NAV_ITEMS.map((item) => ({
      id: `go-${item.href}`,
      label: `Go to ${item.label}`,
      onSelect: () => router.push(item.href),
    })),
  ];

  return <CommandBar commands={commands} />;
}
