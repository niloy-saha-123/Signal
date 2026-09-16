import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createCompanyDocumentsRouter } from "../../src/api/company-documents";

describe("POST /api/company-documents/text", () => {
  it("routes narrative text to embedding and records a company_documents row", async () => {
    const deps = {
      classifyDocument: vi.fn().mockResolvedValue({ doc_type: "other", mode: "narrative" }),
      embedText: vi.fn().mockResolvedValue([0.1, 0.2]),
      pineconeUpsert: vi.fn().mockResolvedValue(undefined),
      getCompanyProfileForWorkspace: vi.fn(),
      upsertCompanyProfileForWorkspace: vi.fn(),
      createCompanyDocument: vi.fn().mockResolvedValue({ id: "doc-1" }),
      invalidateCompanyContextCache: vi.fn().mockResolvedValue(0),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "11111111-1111-1111-1111-111111111111";
      next();
    });
    app.use("/", createCompanyDocumentsRouter(deps));

    const res = await request(app)
      .post("/text")
      .send({ text: "We help small teams track competitors automatically." });

    expect(res.status).toBe(201);
    expect(deps.embedText).toHaveBeenCalled();
    expect(deps.upsertCompanyProfileForWorkspace).not.toHaveBeenCalled();
    expect(deps.invalidateCompanyContextCache).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("routes structured text into the company profile, not the vector store", async () => {
    const deps = {
      classifyDocument: vi.fn().mockResolvedValue({
        doc_type: "other",
        mode: "structured",
        structured_fields: { product_description: "A competitor tracker" },
      }),
      embedText: vi.fn(),
      pineconeUpsert: vi.fn(),
      getCompanyProfileForWorkspace: vi.fn().mockResolvedValue(null),
      upsertCompanyProfileForWorkspace: vi.fn().mockResolvedValue(undefined),
      createCompanyDocument: vi.fn().mockResolvedValue({ id: "doc-2" }),
      invalidateCompanyContextCache: vi.fn().mockResolvedValue(0),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "11111111-1111-1111-1111-111111111111";
      next();
    });
    app.use("/", createCompanyDocumentsRouter(deps));

    const res = await request(app).post("/text").send({ text: "We charge $29/month." });

    expect(res.status).toBe(201);
    expect(deps.upsertCompanyProfileForWorkspace).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({ product_description: "A competitor tracker" })
    );
    expect(deps.embedText).not.toHaveBeenCalled();
    expect(deps.invalidateCompanyContextCache).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("defaults product_description to \"\" when the classifier doesn't extract one and no profile exists yet", async () => {
    const deps = {
      classifyDocument: vi.fn().mockResolvedValue({
        doc_type: "other",
        mode: "structured",
        structured_fields: { pricing_tiers: [{ name: "Starter", price: 29, billing: "monthly" }] },
      }),
      embedText: vi.fn(),
      pineconeUpsert: vi.fn(),
      getCompanyProfileForWorkspace: vi.fn().mockResolvedValue(null),
      upsertCompanyProfileForWorkspace: vi.fn().mockResolvedValue(undefined),
      createCompanyDocument: vi.fn().mockResolvedValue({ id: "doc-3" }),
      invalidateCompanyContextCache: vi.fn().mockResolvedValue(0),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.workspaceId = "11111111-1111-1111-1111-111111111111";
      next();
    });
    app.use("/", createCompanyDocumentsRouter(deps));

    const res = await request(app).post("/text").send({ text: "Starter: $29/month" });

    expect(res.status).toBe(201);
    expect(deps.getCompanyProfileForWorkspace).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(deps.upsertCompanyProfileForWorkspace).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({ product_description: "" })
    );
  });
});
