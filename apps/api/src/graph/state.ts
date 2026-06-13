// Immutable shared state interface passed between all LangGraph analysis nodes.
export interface AnalysisGraphState {
  competitorId: string;
  pricingDiffDetected: boolean;
  intentAnalysis: Record<string, unknown> | null;
  sentimentClusters: Record<string, unknown> | null;
  changeReport: Record<string, unknown> | null;
  patternAnalysis: Record<string, unknown> | null;
  vulnerabilityWindow: Record<string, unknown> | null;
  synthesis: Record<string, unknown> | null;
}

export const initialAnalysisState = (competitorId: string): AnalysisGraphState => ({
  competitorId,
  pricingDiffDetected: false,
  intentAnalysis: null,
  sentimentClusters: null,
  changeReport: null,
  patternAnalysis: null,
  vulnerabilityWindow: null,
  synthesis: null,
});
