"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  createApiToken,
  listApiTokens,
  MCP_URL,
  revokeApiToken,
  type ApiToken,
} from "@/lib/api";
import { Button, TextInput } from "@/components/ui/primitives";

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function snippets(token: string) {
  return [
    {
      label: "Claude Code",
      code: `claude mcp add --transport http signal ${MCP_URL} --header "Authorization: Bearer ${token}"`,
    },
    {
      label: "Cursor (.cursor/mcp.json)",
      code: JSON.stringify(
        {
          mcpServers: {
            signal: {
              url: MCP_URL,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      label: "Claude Desktop (claude_desktop_config.json)",
      code: JSON.stringify(
        {
          mcpServers: {
            signal: {
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                MCP_URL,
                "--header",
                `Authorization: Bearer ${token}`,
              ],
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

export function McpAccess() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    listApiTokens()
      .then(setTokens)
      .catch(() => setError("Couldn't load your tokens."));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await createApiToken(name.trim());
      const { token, ...rest } = row;
      setTokens((prev) => [rest, ...(prev ?? [])]);
      setCreated(token);
      setName("");
    } catch (err) {
      setError(
        (err as { status?: number }).status === 409
          ? "This workspace has the maximum number of active tokens. Revoke one first."
          : "Couldn't create the token. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await revokeApiToken(id);
      setTokens((prev) => prev?.filter((t) => t.id !== id) ?? null);
    } catch {
      setError("Couldn't revoke the token. Try again.");
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError("Couldn't copy. Select the text and copy it by hand.");
    }
  }

  const active = tokens?.filter((t) => !t.revoked_at) ?? [];

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">MCP access</h2>
        <p className="mt-1 text-[14px] text-ink-secondary">
          Use Signal from Claude, Cursor and other MCP clients. Tokens are
          read-only and can see everything in this workspace.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[10px] bg-tint-rose px-3 py-2 text-[13.5px] text-miss-text"
        >
          {error}
        </p>
      )}

      {created && (
        <div className="flex flex-col gap-3 rounded-[10px] bg-tint-sun p-4">
          <p className="text-[14px] font-semibold text-ink">
            Copy this token now. You won&apos;t see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface px-3 py-2 font-mono text-[13px] text-ink">
              {created}
            </code>
            <Button size="sm" onClick={() => copy(created, "token")}>
              {copied === "token" ? "Copied" : "Copy"}
            </Button>
          </div>
          {snippets(created).map((s) => (
            <div key={s.label}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">
                  {s.label}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(s.code, s.label)}
                >
                  {copied === s.label ? "Copied" : "Copy"}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-[8px] bg-surface p-3 font-mono text-[12.5px] text-ink">
                {s.code}
              </pre>
            </div>
          ))}
          <Button
            size="sm"
            variant="primary"
            className="self-start"
            onClick={() => {
              setCreated(null);
              setCopied(null);
            }}
          >
            Done
          </Button>
        </div>
      )}

      <form onSubmit={create} className="flex items-end gap-2">
        <TextInput
          label="Token name"
          className="flex-1"
          placeholder="e.g. Cursor on my laptop"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || created !== null || !name.trim()}
        >
          Create token
        </Button>
      </form>

      {tokens === null ? (
        error ? null : <p className="text-[13.5px] text-ink-muted">Loading tokens…</p>
      ) : active.length === 0 ? (
        <p className="text-[13.5px] text-ink-muted">No active tokens.</p>
      ) : (
        <ul className="divide-y divide-line">
          {active.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {t.name}
                </p>
                <p className="text-[12.5px] text-ink-muted">
                  <span className="font-mono">{t.prefix}…</span> · created{" "}
                  {dateFormat.format(new Date(t.created_at))} ·{" "}
                  {t.last_used_at
                    ? `last used ${dateFormat.format(new Date(t.last_used_at))}`
                    : "never used"}
                </p>
              </div>
              {confirming === t.id ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => revoke(t.id)}
                  >
                    Revoke {t.name}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(t.id)}
                  aria-label={`Revoke ${t.name}`}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
