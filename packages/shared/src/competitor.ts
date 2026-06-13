// Zod schemas and inferred types for competitor registration and configuration.
import { z } from "zod";

export const CompetitorConfigSchema = z.object({
  subreddits: z.array(z.string()).default([]),
  greenhouseToken: z.string().optional(),
  leverCompany: z.string().optional(),
  pricingUrl: z.string().url().optional(),
  changelogRss: z.string().url().optional(),
});

export const CreateCompetitorSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  subreddits: z.array(z.string()).default([]),
  greenhouse_token: z.string().optional(),
  lever_company: z.string().optional(),
  pricing_url: z.string().url().optional(),
  changelog_rss: z.string().url().optional(),
});

export const CompetitorSchema = z.object({
  id: z.number(),
  name: z.string(),
  domain: z.string(),
  config: CompetitorConfigSchema,
  createdAt: z.string().datetime(),
});

export type CompetitorConfig = z.infer<typeof CompetitorConfigSchema>;
export type CreateCompetitorInput = z.infer<typeof CreateCompetitorSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
