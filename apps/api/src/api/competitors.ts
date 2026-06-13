// REST endpoints for competitor registration, retrieval, and manual analysis triggers.
import { Router } from "express";
import { CreateCompetitorSchema } from "@signal/shared";

export const competitorsRouter = Router();

competitorsRouter.post("/", async (req, res) => {
  const parsed = CreateCompetitorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(501).json({ message: "Not implemented", input: parsed.data });
});

competitorsRouter.get("/:id", async (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

competitorsRouter.post("/:id/analyze", async (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});
