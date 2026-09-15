// apps/web/app/app-command-bar.tsx
// Real command wiring for CommandBar (Part 6). Only 2 of the 5 spec'd actions have a backend
// today (see 00-overview.md's Discovered Gaps) — the other 3 are omitted, not dead-ended.
"use client";
import { useRouter } from "next/navigation";
import { CommandBar, type Command } from "../components/CommandBar";

export function AppCommandBar() {
  const router = useRouter();

  const commands: Command[] = [
    { id: "chat", label: "Ask Signal a question", onSelect: () => router.push("/chat") },
    { id: "add-competitor", label: "Add competitor", onSelect: () => router.push("/") },
  ];

  return <CommandBar commands={commands} />;
}
