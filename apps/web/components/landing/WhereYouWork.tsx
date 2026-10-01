import { Sig } from "@/components/brand/Sig";

// Signal reaches people where they already are. Each tile shows the real
// interaction, not an icon and a sentence.
export function WhereYouWork() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article className="min-w-0 rounded-[20px] border border-line bg-surface p-6">
        <h3 className="font-display text-[22px] font-semibold text-ink">Slack</h3>
        <p className="mt-1.5 text-[14.5px] text-ink-secondary">
          Forecasts and alerts post to a channel. Ask from any thread, and send Signal a link your team spotted.
        </p>
        <div className="mt-5 space-y-2 rounded-[14px] bg-sky p-4 font-mono text-[13px] text-ink">
          <p>
            <span className="font-semibold">/signal</span> forecast kestrel
          </p>
          <p>
            <span className="font-semibold">/signal</span> intel https://kestrel.dev/blog/pg{" "}
            <span className="text-ink-muted">&ldquo;saw this in a demo&rdquo;</span>
          </p>
          <p>
            <span className="font-semibold">@Signal</span> what changed at Northwind this week?
          </p>
        </div>
      </article>

      <article className="min-w-0 rounded-[20px] border border-line bg-surface p-6">
        <h3 className="font-display text-[22px] font-semibold text-ink">Claude, Cursor and any MCP client</h3>
        <p className="mt-1.5 text-[14.5px] text-ink-secondary">
          Plug Signal into your AI tools with a workspace token. Read-only by default.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-[14px] bg-ink p-4 font-mono text-[12.5px] leading-relaxed text-[#dbe5ef]">
{`{
  "mcpServers": {
    "signal": {
      "url": "https://<your-signal-host>/mcp",
      "headers": { "Authorization": "Bearer sig_…" }
    }
  }
}`}
        </pre>
      </article>

      <article className="min-w-0 rounded-[20px] border border-line bg-surface p-6">
        <h3 className="font-display text-[22px] font-semibold text-ink">Ask Signal</h3>
        <p className="mt-1.5 text-[14.5px] text-ink-secondary">
          A chat that answers from collected evidence, cites every claim, and says so when the evidence is thin.
        </p>
        <div className="mt-5 flex items-start gap-3 rounded-[14px] bg-sky p-4 text-[14px]">
          <Sig mood="unsure" size={30} decorative className="shrink-0" />
          <p className="text-ink-secondary">
            &ldquo;I only have one signal about Arclight&rsquo;s pricing, so I won&rsquo;t guess. I&rsquo;ll flag it
            when there&rsquo;s more.&rdquo;
          </p>
        </div>
      </article>

      <article className="min-w-0 rounded-[20px] border border-line bg-surface p-6">
        <h3 className="font-display text-[22px] font-semibold text-ink">Your roadmap</h3>
        <p className="mt-1.5 text-[14.5px] text-ink-secondary">
          Link a forecast to the Linear or Jira issue it affects, so the people planning the quarter see it next to
          the work.
        </p>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-[14px] bg-sky p-4 text-[14px]">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">PLAT-412 · Postgres import wizard</span>
            <span className="block text-ink-muted">Linked to: Kestrel Postgres adapter, 72%</span>
          </span>
          <span className="shrink-0 rounded-full bg-tint-sun px-2.5 py-1 text-[12.5px] font-bold text-[#7a5a00]">
            At risk
          </span>
        </div>
      </article>
    </div>
  );
}
