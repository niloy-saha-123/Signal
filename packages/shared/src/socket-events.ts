// Type-safe Socket.io event payload definitions shared by the API and web client.

import type { DiscoveryStatus, SignalSource } from "./signals";

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

// Emitted when a new Signal row clears the quality/dedup pipeline. Kept loose (id +
// competitor_id + source) rather than the full Signal row — same rationale as
// AlertCreatedPayload: the dashboard fetches full detail over REST, this is just the push.
export interface SignalCreatedPayload {
  id: string;
  competitor_id: string;
  source: SignalSource;
}

// ponytail: three events defined, zero producers today (see
// .claude/loop/frontend/00-overview.md's Discovered Gaps) — SignalFeed (Part 5) is
// signal:new's first real caller. Add more (chat:token, etc.) when a real caller needs one.
//
// Outbound-only, server-generated payloads — unlike every other schema in this
// package, these aren't validating untrusted input, so they're plain TS
// interfaces with no runtime Zod validation by design. Do not convert to Zod.
export interface ServerToClientEvents {
  "discovery:status_changed": (payload: DiscoveryStatusChangedPayload) => void;
  "alert:created": (payload: AlertCreatedPayload) => void;
  "signal:new": (payload: SignalCreatedPayload) => void;
}
