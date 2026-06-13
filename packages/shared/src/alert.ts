// Zod schemas and inferred types for strategic alert payloads surfaced to the dashboard.
import { z } from "zod";

export const AlertEvidenceSchema = z.object({
  source: z.string(),
  detail: z.string(),
});

export const AlertActionSchema = z.object({
  type: z.string(),
  text: z.string(),
});

export const AlertPayloadSchema = z.object({
  competitor: z.string(),
  pattern: z.string(),
  evidence: z.array(AlertEvidenceSchema),
  interpretation: z.string(),
  confidence: z.number().min(0).max(1),
  vulnerabilityWindow: z.string().optional(),
  actions: z.array(AlertActionSchema),
});

export const AlertSchema = z.object({
  id: z.number(),
  competitorId: z.number(),
  payload: AlertPayloadSchema,
  confidence: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type AlertPayload = z.infer<typeof AlertPayloadSchema>;
export type Alert = z.infer<typeof AlertSchema>;
