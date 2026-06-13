// Typed Socket.io event contracts shared between the API server and web dashboard.
import type { AlertPayload } from "./alert.js";

export interface ServerToClientEvents {
  competitor_alert: (payload: AlertPayload) => void;
  signal_received: (payload: { competitorId: number; signalId: number }) => void;
}

export interface ClientToServerEvents {
  join_competitor: (competitorId: string) => void;
}
