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
import { EmptyState, LinkButton } from "@/components/ui/primitives";
import { CompanyClient } from "./company-client";

export default async function CompanyPage() {
  const token = await getOptionalAccessToken();
  if (!token) {
    return (
      <EmptyState
        title="Sign in to set up your company"
        note="Signal judges every competitor move against your own product, buyers and goals."
        action={
          <LinkButton href="/login" variant="primary" size="sm">
            Sign in
          </LinkButton>
        }
      />
    );
  }

  const [profile, competitors, documents] = await Promise.all([
    getCompanyProfile().catch(() => null),
    listCompetitors(token).catch(() => [] as Competitor[]),
    listCompanyDocuments(token).catch(() => [] as CompanyDocument[]),
  ]);

  return <CompanyClient profile={profile} competitors={competitors} documents={documents} />;
}