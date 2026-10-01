// Pushes new alerts into view without a page refresh. AlertCreatedPayload is self-sufficient
// to render (pattern + confidence). Mounted in the (app) layout's shell so it lives for the
// whole client-side session. alert:created is a global broadcast with no per-user dismissal
// persistence; the cap keeps the stack bounded.
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AlertCreatedPayload } from "@signal/shared";
import { Icon } from "@/components/ui/icons";
import { onAlertCreated } from "../lib/socket";

const MAX_ALERTS = 5;

export function AlertBanner() {
  const [alerts, setAlerts] = useState<AlertCreatedPayload[]>([]);

  useEffect(() => {
    return onAlertCreated((payload) => {
      setAlerts((current) => [payload, ...current].slice(0, MAX_ALERTS));
    });
  }, []);

  function dismiss(id: string) {
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }

  if (alerts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-20 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2 sm:right-6"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="toast-in pointer-events-auto flex items-center justify-between gap-3 rounded-[14px] bg-surface px-4 py-3 shadow-[var(--shadow-popover)]"
        >
          <Link href="/alerts" className="flex min-w-0 items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sun-deep" aria-hidden="true" />
            <p className="truncate text-[14px] text-ink">
              New alert: <span className="font-semibold">{alert.pattern.replace(/_/g, " ")}</span>
            </p>
          </Link>
          <button
            type="button"
            onClick={() => dismiss(alert.id)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Dismiss alert"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
