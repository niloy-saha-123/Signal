// Company — company profile (the intelligence Signal uses to scope briefings) plus the
// document library (uploaded pitch decks, financials, and other context).
import {
  listCompetitors,
  listCompanyDocuments,
  type CompanyDocument,
  type Competitor,
} from "@/lib/api";
import { getCompanyProfile } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { CompanyClient } from "./company-client";

export default async function CompanyPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return (
      <div className="rounded-[10px] border border-line bg-surface px-6 py-12">
        <p className="text-sm text-ink-secondary">Sign in to manage your company profile.</p>
      </div>
    );
  }

  const [profile, competitors, documents] = await Promise.all([
    getCompanyProfile().catch(() => null),
    listCompetitors(token).catch(() => [] as Competitor[]),
    listCompanyDocuments(token).catch(() => [] as CompanyDocument[]),
  ]);

  return <CompanyClient profile={profile} competitors={competitors} documents={documents} />;
}