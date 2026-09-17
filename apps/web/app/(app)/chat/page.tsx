import { ChatInterface } from "@/components/ChatInterface";
import { listCompetitors } from "@/lib/api";
import { PREVIEW_COMPETITORS } from "@/lib/preview-workspace";
import { getOptionalAccessToken } from "@/lib/supabase-server";

export default async function Page() {
  const token = await getOptionalAccessToken();
  let competitorIds = PREVIEW_COMPETITORS.map((competitor) => competitor.id);

  if (token) {
    try {
      const competitors = await listCompetitors(token);
      competitorIds = competitors.filter((competitor) => competitor.is_active).map((c) => c.id);
    } catch {
      competitorIds = PREVIEW_COMPETITORS.map((competitor) => competitor.id);
    }
  }

  if (!token) {
    return (
      <div className="rounded-[1.6rem] border border-studio-line bg-studio-paper px-6 py-12">
        <p className="max-w-md text-sm leading-relaxed text-studio-muted">
          Sign in to ask follow-up questions against collected evidence. The preview workspace
          shows the briefing, intel, and alerts without a live research thread.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-9rem)] overflow-hidden rounded-[1.6rem] border border-studio-line bg-studio-paper">
      <ChatInterface competitorIds={competitorIds} />
    </div>
  );
}