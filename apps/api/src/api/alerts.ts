// Paginated REST endpoint for retrieving historical strategic alert records.
import { Router } from "express";

export const alertsRouter = Router();

alertsRouter.get("/", async (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});
