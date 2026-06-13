// SSE streaming endpoint for RAG-powered competitive intelligence chat queries.
import { Router } from "express";
import { ChatRequestSchema } from "@signal/shared";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(501).json({ message: "Not implemented" });
});
