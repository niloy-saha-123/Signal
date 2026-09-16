// Company-document ingestion — the first file-upload endpoint in this codebase.
//
// POST /api/company-documents (multipart file upload) and
// POST /api/company-documents/text (pasted/chat-sourced text) both converge on the same
// classify-then-route logic: classifyDocument decides whether the material is structured
// company_profile facts or narrative text to embed into the profile:<workspace_id>
// Pinecone namespace (see db/schema.ts's company_documents comment).
import express, { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { classifyDocument as classifyDocumentImpl } from "../lib/document-classifier";
import { parseDocument } from "../lib/document-parser";
import { embedText as embedTextImpl } from "../lib/embeddings";
import { pineconeUpsert as pineconeUpsertRecords } from "../vector/pinecone";
import * as queries from "../db/queries";
import type { CompanyProfileInput } from "../db/queries";
import { wrap, fallbackErrorHandler } from "./http";

export interface CompanyDocumentsRouterDeps {
  classifyDocument: typeof classifyDocumentImpl;
  embedText: typeof embedTextImpl;
  pineconeUpsert: (namespace: string, id: string, vector: number[], text: string) => Promise<void>;
  getCompanyProfileForWorkspace: typeof queries.getCompanyProfileForWorkspace;
  // Not `typeof queries.upsertCompanyProfileForWorkspace` (whose signature is
  // (input, workspaceId)) — this router only ever writes a partial field set extracted by
  // the classifier, and (workspaceId, fields) reads better at the call site here. The
  // default impl below adapts to the real query function's actual argument order.
  upsertCompanyProfileForWorkspace: (
    workspaceId: string,
    fields: Partial<CompanyProfileInput>
  ) => Promise<unknown>;
  createCompanyDocument: (input: queries.CompanyDocumentCreateInput) => Promise<{ id: string }>;
}

export const defaultCompanyDocumentsRouterDeps: CompanyDocumentsRouterDeps = {
  classifyDocument: classifyDocumentImpl,
  embedText: embedTextImpl,
  // Reuses vector/pinecone.ts's own module-level Pinecone client (getIndex()) — no second
  // client instantiated. That module's pineconeUpsert already takes a plain namespace
  // string (named competitorId there, but never checked against a competitor), so this is
  // just a single-record adapter over it, not a new client.
  pineconeUpsert: (namespace, id, vector, text) =>
    pineconeUpsertRecords(namespace, [{ id, values: vector, metadata: { text } }]),
  getCompanyProfileForWorkspace: queries.getCompanyProfileForWorkspace,
  upsertCompanyProfileForWorkspace: (workspaceId, fields) =>
    queries.upsertCompanyProfileForWorkspace(fields as CompanyProfileInput, workspaceId),
  createCompanyDocument: queries.createCompanyDocument,
};

const TextBodySchema = z.object({ text: z.string().trim().min(1).max(50_000) }).strict();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

async function ingest(
  deps: CompanyDocumentsRouterDeps,
  workspaceId: string,
  filename: string,
  mimeType: string,
  text: string
): Promise<{ id: string }> {
  const classification = await deps.classifyDocument(text);
  const namespace = `profile:${workspaceId}`;

  if (classification.mode === "structured" && classification.structured_fields) {
    // company_profile.product_description is NOT NULL with no default. The classifier
    // doesn't always extract one (and the heuristic fallback never does) — fall back to
    // the existing profile's value, or "" on a workspace's very first upload.
    const existingProfile = await deps.getCompanyProfileForWorkspace(workspaceId);
    const product_description =
      classification.structured_fields.product_description ?? existingProfile?.product_description ?? "";
    await deps.upsertCompanyProfileForWorkspace(workspaceId, {
      ...classification.structured_fields,
      product_description,
    });
  } else {
    const vector = await deps.embedText(text);
    await deps.pineconeUpsert(namespace, `${workspaceId}:${filename}`, vector, text);
  }

  return deps.createCompanyDocument({
    workspace_id: workspaceId,
    filename,
    mime_type: mimeType,
    doc_type: classification.doc_type,
    extraction_status: classification.mode === "structured" ? "structured" : "embedded",
    ...(classification.mode === "structured" ? {} : { pinecone_namespace: namespace }),
  });
}

export function createCompanyDocumentsRouter(
  deps: CompanyDocumentsRouterDeps = defaultCompanyDocumentsRouterDeps
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
    "/text",
    wrap(async (req, res) => {
      const parsed = TextBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const doc = await ingest(deps, req.workspaceId!, "pasted-text", "text/plain", parsed.data.text);
      res.status(201).json(doc);
    })
  );

  router.post(
    "/",
    // Cast: @types/multer resolves against the workspace root's hoisted @types/express (a
    // different major than apps/api's own pinned v4 copy) — a monorepo hoisting artifact,
    // not a real type mismatch, since both describe the same express@4 Request at runtime.
    upload.single("file") as unknown as RequestHandler,
    wrap(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: "validation", issues: [{ message: "file is required" }] });
        return;
      }
      const text = await parseDocument(req.file.buffer, req.file.mimetype);
      const doc = await ingest(deps, req.workspaceId!, req.file.originalname, req.file.mimetype, text);
      res.status(201).json(doc);
    })
  );

  router.use(fallbackErrorHandler);
  return router;
}
