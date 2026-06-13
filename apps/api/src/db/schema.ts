// Drizzle ORM table definitions for competitors, signals, intelligence outputs, and alert history.
import { pgTable, serial, text, timestamp, jsonb, integer, real } from "drizzle-orm/pg-core";

export const competitors = pgTable("competitors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  source: text("source").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  payload: jsonb("payload").notNull(),
  confidence: text("confidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const intelligence = pgTable("intelligence", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const baselines = pgTable("baselines", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  source: text("source").notNull(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  agent: text("agent").notNull(),
  status: text("status").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const llmCosts = pgTable("llm_costs", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").references(() => competitors.id),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costUsd: real("cost_usd").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
