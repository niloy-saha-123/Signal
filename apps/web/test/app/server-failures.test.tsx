// Focus 4: a failed fetch on a server page must not render as an empty or
// missing workspace.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";

const m = vi.hoisted(() => ({
  token: vi.fn(),
  getCalibration: vi.fn(),
  listPredictions: vi.fn(),
  listCompetitors: vi.fn(),
  getPrediction: vi.fn(),
  getCompanyProfile: vi.fn(),
  listCompanyDocuments: vi.fn(),
  getCompetitorScore: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase-server", () => ({ getOptionalAccessToken: m.token }));
vi.mock("next/navigation", () => ({ notFound: m.notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getCalibration: m.getCalibration,
    listPredictions: m.listPredictions,
    listCompetitors: m.listCompetitors,
    getPrediction: m.getPrediction,
    getCompanyProfile: m.getCompanyProfile,
    listCompanyDocuments: m.listCompanyDocuments,
    getCompetitorScore: m.getCompetitorScore,
  };
});

import ForecastPage from "../../app/(app)/forecast/page";
import ScorecardPage from "../../app/(app)/scorecard/page";
import PredictionDetailPage from "../../app/(app)/forecast/[id]/page";
import CompanyPage from "../../app/(app)/company/page";
import BoardPage from "../../app/(app)/board/page";

describe("server pages under API failure", () => {
  afterEach(() => vi.clearAllMocks());

  it("forecasts: a calibration failure reaches the error boundary", async () => {
    m.token.mockResolvedValue("tok");
    m.listPredictions.mockResolvedValue([]);
    m.listCompetitors.mockResolvedValue([]);
    m.getCalibration.mockRejectedValue(new Error("down"));
    await expect(ForecastPage()).rejects.toThrow("down");
  });

  it("scorecard: a calibration failure reaches the error boundary", async () => {
    m.token.mockResolvedValue("tok");
    m.listPredictions.mockResolvedValue([]);
    m.getCalibration.mockRejectedValue(new Error("down"));
    await expect(ScorecardPage()).rejects.toThrow("down");
  });

  it("forecast detail: only a 404 is not-found; other failures throw", async () => {
    m.token.mockResolvedValue("tok");
    m.getPrediction.mockRejectedValueOnce(new ApiError(404, {}));
    await expect(PredictionDetailPage({ params: Promise.resolve({ id: "p" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    m.getPrediction.mockRejectedValueOnce(new ApiError(503, {}));
    await expect(PredictionDetailPage({ params: Promise.resolve({ id: "p" }) })).rejects.toThrow("503");
  });

  it("company: fetches the profile with the server token and lets failures throw", async () => {
    m.token.mockResolvedValue("tok");
    m.listCompetitors.mockResolvedValue([]);
    m.listCompanyDocuments.mockResolvedValue([]);
    m.getCompanyProfile.mockResolvedValue(null);
    await CompanyPage();
    expect(m.getCompanyProfile).toHaveBeenCalledWith("tok");
    m.getCompanyProfile.mockRejectedValue(new ApiError(500, {}));
    await expect(CompanyPage()).rejects.toThrow("500");
  });

  it("board: a forecast failure marks rows unavailable instead of empty", async () => {
    m.token.mockResolvedValue("tok");
    m.listCompetitors.mockResolvedValue([
      { id: "c1", name: "Acme", domain: "acme.com", is_own_company: false, discovery_status: "complete" },
    ]);
    m.getCompetitorScore.mockResolvedValue({ score: 50, delta_7d: 0 });
    m.listPredictions.mockRejectedValue(new Error("down"));
    const el = await BoardPage();
    expect((el.props as { forecastsUnavailable?: boolean }).forecastsUnavailable).toBe(true);
  });
});
