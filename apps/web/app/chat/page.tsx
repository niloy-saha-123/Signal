// Persistent chat panel — scoped across every active competitor by default.
import { listCompetitors } from "../../lib/api";
import { ChatInterface } from "../../components/ChatInterface";

export default async function Page() {
  const competitors = await listCompetitors();
  const competitorIds = competitors.filter((c) => c.is_active).map((c) => c.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Chat</h1>
      <ChatInterface competitorIds={competitorIds} />
    </div>
  );
}
