"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  confirmSlackInstall,
  disconnectSlack,
  getSlackStatus,
  getWorkspace,
  renameWorkspace,
  startSlackInstall,
  type SlackStatus,
  type Workspace,
} from "@/lib/api";
import { SettingsAreaTabs } from "@/components/area-tabs";
import { Button, LoadingRows, PageHeader, TextInput } from "@/components/ui/primitives";
import type { ReactNode } from "react";

export function SettingsClient() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");

  const [slack, setSlack] = useState<SlackStatus | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.auth.getUser(),
      getWorkspace().catch(() => null),
      getSlackStatus().catch(() => null),
    ])
      .then(([auth, ws, slackStatus]) => {
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
        setSlack(slackStatus);
      })
      .then(handleSlackReturn)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slack's callback sends the browser back with ?slack_install=<id> (confirm it as the
  // signed-in user) or ?slack=cancelled|error.
  async function handleSlackReturn() {
    const params = new URLSearchParams(window.location.search);
    const installId = params.get("slack_install");
    const result = params.get("slack");
    if (installId) {
      try {
        const status = await confirmSlackInstall(installId);
        setSlack(status);
        setMessage({ kind: "ok", text: "Slack connected." });
      } catch (error) {
        setMessage({ kind: "error", text: SLACK_CONFIRM_ERRORS[(error as { status?: number }).status ?? 0] ?? SLACK_FAILED });
      }
      router.replace("/settings");
    } else if (result && SLACK_RESULTS[result]) {
      setMessage(SLACK_RESULTS[result]);
      router.replace("/settings");
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      await disconnectSlack();
      setSlack(await getSlackStatus().catch(() => ({ connected: false as const })));
      setMessage({ kind: "ok", text: "Slack disconnected." });
    } catch {
      setMessage({ kind: "error", text: "Couldn't disconnect Slack. Try again." });
    } finally {
      setBusy(false);
    }
  }

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

  const header = (
    <PageHeader
      title="Settings"
      description="Your account, your company's name in Signal, and sign-in."
      action={<SettingsAreaTabs active="settings" />}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <LoadingRows rows={3} />
      </div>
    );
  }

  return (
    <div>
      {header}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={
            message.kind === "ok"
              ? "mb-4 max-w-2xl rounded-[10px] bg-tint-mint px-4 py-3 text-[14px] text-hit-text"
              : "mb-4 max-w-2xl rounded-[10px] bg-tint-rose px-4 py-3 text-[14px] text-miss-text"
          }
        >
          {message.text}
        </p>
      )}

      <div className="flex max-w-2xl flex-col gap-4">
        <Section title="Account" onSubmit={saveName}>
          <TextInput label="Email" value={email} disabled readOnly />
          <TextInput label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" size="sm" disabled={busy} className="self-start">
            Save name
          </Button>
        </Section>

        <Section title="Company" onSubmit={saveWorkspaceName}>
          <TextInput label="Company name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !workspace} className="self-start">
            Save company name
          </Button>
        </Section>

        <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-semibold text-ink">Slack</h2>
          {slack?.connected ? (
            <>
              <p className="text-[14px] text-ink-secondary">
                Connected to <strong className="text-ink">{slack.team_name ?? "your Slack workspace"}</strong>
                {slack.channel_name ? (
                  <>
                    {" "}
                    · posting to <strong className="text-ink">{slack.channel_name}</strong>
                  </>
                ) : null}
              </p>
              <Button variant="danger" size="sm" onClick={disconnect} disabled={busy} className="self-start">
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <p className="text-[14px] text-ink-secondary">
                Ask Signal questions with @Signal, and get alerts, forecasts and a weekly digest in a channel your team
                can see.
              </p>
              <AddToSlackButton onError={(text) => setMessage({ kind: "error", text })} />
            </>
          )}
        </section>

        <Section title="Password" onSubmit={savePassword}>
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
          <TextInput
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy} className="self-start">
            Update password
          </Button>
        </Section>

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Sign out</h2>
            <p className="mt-0.5 text-[13.5px] text-ink-muted">Signed in as {email || "you"}.</p>
          </div>
          <Button variant="danger" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </section>
      </div>
    </div>
  );
}

function Section({ title, onSubmit, children }: { title: string; onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </form>
  );
}

const SLACK_FAILED = "Couldn't connect Slack. Try again.";

const SLACK_RESULTS: Record<string, { kind: "ok" | "error"; text: string }> = {
  cancelled: { kind: "error", text: "Slack install cancelled." },
  error: { kind: "error", text: SLACK_FAILED },
};

const SLACK_CONFIRM_ERRORS: Record<number, string> = {
  409: "That Slack workspace is already connected to another Signal workspace.",
  403: "That Slack install was started from a different Signal account.",
};

export function AddToSlackButton({ onError }: { onError: (text: string) => void }) {
  const [starting, setStarting] = useState(false);
  async function start() {
    setStarting(true);
    try {
      const { url } = await startSlackInstall();
      window.location.assign(url);
    } catch (error) {
      setStarting(false);
      const status = (error as { status?: number }).status;
      onError(status === 503 ? "Slack isn't configured on this server." : "Couldn't start the Slack install. Try again.");
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={start} disabled={starting} className="self-start">
      Add to Slack
    </Button>
  );
}
