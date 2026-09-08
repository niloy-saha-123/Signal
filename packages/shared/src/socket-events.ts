// Type-safe Socket.io event payload definitions shared by the API and web client.

import type { DiscoveryStatus } from "./signals";

// Emitted by the API server when CompetitorDiscoveryAgent (agents/discovery/) finishes
// (or fails) populating a competitor's discovered fields.
export interface DiscoveryStatusChangedPayload {
  competitor_id: string;
  discovery_status: DiscoveryStatus;
}

// Emitted when SynthesisAgent creates a new row in `alerts`. Kept loose (id + competitor_id +
// pattern) rather than the full Alert row — the dashboard fetches full detail over REST on
// click, the socket event is just the "something new happened" push.
export interface AlertCreatedPayload {
  id: string;
  competitor_id: string;
  pattern: string;
  confidence: number;
}

// ponytail: only the two events with a concrete producer today. Add more
// (signal:new, chat:token, etc.) when a real caller needs them.
export interface ServerToClientEvents {
  "discovery:status_changed": (payload: DiscoveryStatusChangedPayload) => void;
  "alert:created": (payload: AlertCreatedPayload) => void;
}
