// Zod schemas and inferred types for raw signals collected from external sources.
import { z } from "zod";

export const SignalSourceSchema = z.enum([
  "reddit",
  "hn",
  "jobs",
  "changelog",
  "pricing",
]);

export const SignalSchema = z.object({
  id: z.number(),
  competitorId: z.number(),
  source: SignalSourceSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type SignalSource = z.infer<typeof SignalSourceSchema>;
export type Signal = z.infer<typeof SignalSchema>;
