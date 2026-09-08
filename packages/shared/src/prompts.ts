import { z } from "zod";

// One row of the `prompt_versions` table — mirrors its partial unique index
// (one is_active=true row per agent_name, enforced at the DB level, not here).
export const PromptVersionSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  version: z.number().int().min(1),
  prompt_text: z.string(),
  is_active: z.boolean(),
  accuracy: z.number().min(0).max(1).nullable().optional(),
  promoted_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;
