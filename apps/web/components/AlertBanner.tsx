// Pushes new alerts into view without a page refresh. AlertCreatedPayload is self-sufficient
// to render (pattern + confidence) — unlike SignalFeed, this never needs to refetch.
"use client";
import { useEffect, useState } from "react";
import type { AlertCreatedPayload } from "@signal/shared";
import { STATUS_COLORS } from "../lib/chart-colors";
import { onAlertCreated } from "../lib/socket";

export function AlertBanner() {
  const [alerts, setAlerts] = useState<AlertCreatedPayload[]>([]);

  useEffect(() => {
    return onAlertCreated((payload) => {
      setAlerts((current) => [payload, ...current]);
    });
  }, []);

  function dismiss(id: string) {
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-4">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-center justify-between rounded-md border-l-4 bg-white px-4 py-2 shadow-sm"
          style={{ borderLeftColor: STATUS_COLORS.warning }}
        >
          <p className="text-sm text-slate-800">
            New alert: <span className="font-medium">{alert.pattern}</span>
          </p>
          <button
            type="button"
            onClick={() => dismiss(alert.id)}
            className="text-xs text-slate-400 transition-colors hover:text-slate-600"
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
