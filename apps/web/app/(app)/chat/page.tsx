import { ChatInterface } from "@/components/ChatInterface";
import { EmptyState, LinkButton } from "@/components/ui/primitives";
import { listCompetitors } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";

export default async function Page() {
  const token = await getOptionalAccessToken();

  if (!token) {
    return (
      <EmptyState
        title="Sign in to ask Signal"
        note="Ask Signal answers from your own collected evidence, so it needs your workspace. The preview shows Home, Evidence and Competitors without a live chat."
        action={
          <LinkButton href="/login" variant="primary" size="sm">
            Sign in
          </LinkButton>
        }
      />
    );
  }

  const competitors = await listCompetitors(token);
  const competitorIds = competitors.filter((competitor) => competitor.is_active).map((c) => c.id);

  if (competitorIds.length === 0) {
    return (
      <EmptyState
        mood="unsure"
        title="Nothing to answer from yet"
        note="Signal answers from evidence it has collected. Add a competitor, and ask once the first signals arrive."
        action={
          <LinkButton href="/board" variant="primary" size="sm">
            Add a competitor
          </LinkButton>
        }
      />
    );
  }

  return (
    <div className="h-[calc(100dvh-9rem)] min-h-[480px] overflow-hidden rounded-[14px] border border-line bg-surface">
      <ChatInterface competitorIds={competitorIds} />
    </div>
  );
}
