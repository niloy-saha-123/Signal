import { ChatInterface } from "@/components/ChatInterface";
import { listCompetitors } from "@/lib/api";
import { getOptionalAccessToken } from "@/lib/supabase-server";

export default async function Page() {
  const token = await getOptionalAccessToken();

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

  const competitors = await listCompetitors(token);
  const competitorIds = competitors.filter((competitor) => competitor.is_active).map((c) => c.id);

  return (
    <div className="h-[calc(100vh-9rem)] overflow-hidden rounded-[1.6rem] border border-studio-line bg-studio-paper">
      <ChatInterface competitorIds={competitorIds} />
    </div>
  );
}