import { listCompetitors } from "../lib/api";
import { getServerAccessToken } from "../lib/supabase-server";
import { ChatInterface } from "./ChatInterface";

export async function ChatSidebar() {
  const competitors = await listCompetitors(await getServerAccessToken());
  const competitorIds = competitors.filter((c) => c.is_active).map((c) => c.id);

  return (
    <aside className="fixed right-0 top-0 z-10 flex h-screen w-96 flex-col border-l border-slate-200 bg-white">
      {/* Chat header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
        <h2 className="font-sans text-sm font-extrabold text-slate-900">Chat</h2>
        <button className="rounded-lg bg-indigo-600 px-3 py-1.5 font-sans text-xs font-bold text-white transition-colors hover:bg-indigo-700">
          New thread
        </button>
      </div>

      {/* Chat content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ChatInterface competitorIds={competitorIds} />
      </div>
    </aside>
  );
}
