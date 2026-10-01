// Company — company profile (the intelligence Signal uses to scope briefings) plus the
// document library (uploaded pitch decks, financials, and other context).
import { getCompanyProfile, listCompetitors, listCompanyDocuments } from "@/lib/api";
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
    // No catches: a failed load must not render as a blank profile, because
    // saving that blank form would overwrite the real one.
    getCompanyProfile(token),
    listCompetitors(token),
    listCompanyDocuments(token),
  ]);

  return <CompanyClient profile={profile} competitors={competitors} documents={documents} />;
}