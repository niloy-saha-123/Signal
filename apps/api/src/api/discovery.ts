import express, { Router } from "express";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import {
  discoveryGraph,
  DISCOVERY_RECURSION_LIMIT,
  setupDiscoveryCheckpointer,
} from "../agents/discovery-search/discovery-graph";
import { addDiscoveryJob } from "../queues/registry";
import { wrap, fallbackErrorHandler } from "./http";

export interface DiscoveryRouterDeps {
  enqueueDiscovery: (workspaceId: string) => Promise<void>;
  resumeDiscovery: (threadId: string, decision: "confirm" | "dismiss") => Promise<void>;
}

export const defaultDiscoveryRouterDeps: DiscoveryRouterDeps = {
  enqueueDiscovery: (workspaceId) =>
    addDiscoveryJob({ workspace_id: workspaceId }).then(() => undefined),
  resumeDiscovery: async (threadId, decision) => {
    // Same checkpointer-setup requirement as the worker — resume() invalidates
    // a checkpoint keyed on thread_id, which needs the checkpointer tables to
    // exist before the invoke touches them.
    await setupDiscoveryCheckpointer();
    await discoveryGraph.invoke(
      new Command({ resume: decision }),
      {
        configurable: { thread_id: threadId },
        recursionLimit: DISCOVERY_RECURSION_LIMIT,
      }
    );
  },
};

const ResumeBodySchema = z.object({ decision: z.enum(["confirm", "dismiss"]) }).strict();

export function createDiscoveryRouter(
  deps: DiscoveryRouterDeps = defaultDiscoveryRouterDeps
): Router {
  const router = express.Router();
  router.use(express.json());
  router.use((req, res, next) => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "no_workspace" });
      return;
    }
    next();
  });

  router.post(
    "/trigger",
    wrap(async (req, res) => {
      await deps.enqueueDiscovery(req.workspaceId!);
      res.status(202).json({ status: "enqueued" });
    })
  );

  router.post(
    "/:threadId/resume",
    wrap(async (req, res) => {
      // thread_id is the workspace UUID by construction — resuming another
      // workspace's interrupted graph would be an IDOR. Enforce the match.
      if (req.params.threadId !== req.workspaceId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const parsed = ResumeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      await deps.resumeDiscovery(req.params.threadId, parsed.data.decision);
      res.status(200).json({ status: "resumed" });
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}