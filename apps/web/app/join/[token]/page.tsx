// Thin server shell around JoinClient — reads the dynamic route param and hands it off; no
// data fetching or session check here (JoinClient itself checks the session client-side, and
// middleware treats /join/* as public so a logged-out visitor can reach this page).
import { JoinClient } from "./join-client";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <span className="text-lg font-semibold text-indigo-600">Signal</span>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Join workspace</h1>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <JoinClient token={token} />
      </div>
    </div>
  );
}
