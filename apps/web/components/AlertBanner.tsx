// Pushes new alerts into view without a page refresh. AlertCreatedPayload is self-sufficient
// to render (pattern + confidence). Mounted in the (app) layout's shell so it lives for the
// whole client-side session. alert:created is a global broadcast with no per-user dismissal
// persistence; the cap keeps the toast stack bounded.
"use client";
import { useEffect, useState } from "react";
import type { AlertCreatedPayload } from "@signal/shared";
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
    <div className="pointer-events-none fixed top-20 right-6 z-50 flex flex-col gap-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-[10px] border border-studio-line bg-studio-paper px-4 py-3 shadow-[0_12px_32px_-16px_rgba(10,32,51,0.4)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-studio-action" />
            <p className="text-sm text-studio-ink">
              New alert on <span className="font-semibold">{alert.pattern.replace(/_/g, " ")}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(alert.id)}
            className="text-xs text-studio-muted transition-colors hover:text-studio-ink"
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}