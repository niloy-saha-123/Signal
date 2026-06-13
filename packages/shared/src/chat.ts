// Zod schemas and inferred types for RAG chat requests and streaming responses.
import { z } from "zod";

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  competitorIds: z.array(z.number()).min(1),
  conversationId: z.string().optional(),
});

export const ChatCitationSchema = z.object({
  signalId: z.number(),
  excerpt: z.string(),
  source: z.string(),
});

export const ChatResponseChunkSchema = z.object({
  type: z.enum(["token", "citation", "done"]),
  content: z.string().optional(),
  citation: ChatCitationSchema.optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatCitation = z.infer<typeof ChatCitationSchema>;
export type ChatResponseChunk = z.infer<typeof ChatResponseChunkSchema>;
