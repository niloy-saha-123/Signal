"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getWorkspace, renameWorkspace, type Workspace } from "@/lib/api";

export function SettingsClient() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.auth.getUser(),
      getWorkspace().catch(() => null),
    ])
      .then(([auth, ws]) => {
        const user = auth.data.user;
        if (user) {
          setEmail(user.email ?? "");
          const metaName = (user.user_metadata?.full_name as string | undefined) ?? "";
          setName(metaName);
        }
        if (ws) {
          setWorkspace(ws);
          setWorkspaceName(ws.name);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (error) {
      setMessage({ kind: "error", text: error.message });
    } else {
      setMessage({ kind: "ok", text: "Name updated." });
    }
    setBusy(false);
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 6) {
      setMessage({ kind: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: "Passwords don't match." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMessage({ kind: "error", text: error.message });
    } else {
      setMessage({ kind: "ok", text: "Password updated." });
      setNewPassword("");
      setConfirmPassword("");
    }
    setBusy(false);
  }

  async function saveWorkspaceName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const updated = await renameWorkspace(workspaceName);
      setWorkspace(updated);
      setMessage({ kind: "ok", text: "Company name updated." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Couldn't update the company name." });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-studio-muted">Loading account…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Settings
        </h1>
        <p className="text-sm text-studio-muted">Your account, company, and security.</p>
      </div>

      {message && (
        <p
          className={`max-w-2xl rounded-2xl px-4 py-3 text-sm ${
            message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Account */}
      <form
        onSubmit={saveName}
        className="flex max-w-2xl flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8"
      >
        <h2 className="text-sm font-bold text-studio-ink">Account</h2>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Email
          <input
            value={email}
            disabled
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-muted opacity-70"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-full bg-studio-ink px-6 py-3 text-sm font-bold text-white hover:bg-[#071625] disabled:opacity-50"
        >
          Save name
        </button>
      </form>

      {/* Workspace / company name */}
      <form
        onSubmit={saveWorkspaceName}
        className="flex max-w-2xl flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8"
      >
        <h2 className="text-sm font-bold text-studio-ink">Company</h2>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Company name
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !workspace}
          className="self-start rounded-full bg-studio-ink px-6 py-3 text-sm font-bold text-white hover:bg-[#071625] disabled:opacity-50"
        >
          Save company name
        </button>
      </form>

      {/* Security */}
      <form
        onSubmit={savePassword}
        className="flex max-w-2xl flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8"
      >
        <h2 className="text-sm font-bold text-studio-ink">Security</h2>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            placeholder="At least 6 characters"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-full bg-studio-ink px-6 py-3 text-sm font-bold text-white hover:bg-[#071625] disabled:opacity-50"
        >
          Update password
        </button>
      </form>

      {/* Session */}
      <div className="flex max-w-2xl flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8">
        <h2 className="text-sm font-bold text-studio-ink">Session</h2>
        <button
          onClick={signOut}
          className="self-start rounded-full border border-red-200 bg-red-50 px-6 py-3 text-sm font-bold text-red-700 transition-colors hover:bg-red-100"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}