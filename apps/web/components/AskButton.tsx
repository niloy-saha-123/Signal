"use client";

import { Icon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/primitives";
import { askSignal } from "@/lib/ask";

// Opens the Ask Signal panel pre-filled with a question about the thing on
// screen. The question is editable before it is sent.
export function AskButton({
  prompt,
  label = "Ask Signal about this",
  variant = "secondary",
}: {
  prompt: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button type="button" onClick={() => askSignal(prompt)} className={buttonClass(variant, "sm")}>
      <Icon name="chat" className="h-4 w-4" />
      {label}
    </button>
  );
}
