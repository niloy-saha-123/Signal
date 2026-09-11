import { describe, it, expectTypeOf } from "vitest";
import type { ServerToClientEvents } from "../src/socket-events";

describe("ServerToClientEvents", () => {
  it("types discovery:status_changed with a discovery_status field", () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty("discovery:status_changed");
  });

  it("types alert:created with an Alert-shaped payload", () => {
    expectTypeOf<ServerToClientEvents>().toHaveProperty("alert:created");
  });
});
