import { describe, it, expect } from "vitest";
import { db } from "@/db/client";

describe("db client", () => {
  it("exports a Drizzle instance with a query builder", () => {
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
    expect(typeof db.insert).toBe("function");
  });
});
