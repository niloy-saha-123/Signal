// apps/web/app/app-command-bar.tsx
// Real command wiring for the ⌘K palette: every primary destination, the two
// actions people reach for most, and free-text questions routed to Ask Signal.
"use client";
import { useRouter } from "next/navigation";
import { CommandBar, type Command } from "../components/CommandBar";
import { askSignal } from "../lib/ask";
import { NAV_ITEMS } from "../lib/nav";

export function AppCommandBar() {
  const router = useRouter();

  const commands: Command[] = [
    {
      id: "chat",
      label: "Ask Signal a question",
      hint: "Answers cite collected evidence",
      icon: "chat",
      onSelect: () => router.push("/chat"),
    },
    {
      id: "add-competitor",
      label: "Add competitor",
      hint: "Start watching a company",
      icon: "plus",
      onSelect: () => router.push("/briefing"),
    },
    ...NAV_ITEMS.map<Command>((item) => ({
      id: `go-${item.href}`,
      label: `Go to ${item.label}`,
      hint: item.hint,
      icon: item.icon,
      onSelect: () => router.push(item.href),
    })),
  ];

  return <CommandBar commands={commands} onAsk={(query) => askSignal(query)} />;
}
