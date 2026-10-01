import { sourceColor } from "@/lib/chart-colors";

// Sources grouped by how early they tend to move before an announcement —
// the property that matters for forecasting.
const GROUPS = [
  {
    when: "Months before",
    blurb: "Teams get hired and code gets written long before a launch post.",
    sources: [
      { key: "jobs", name: "Job boards", detail: "Greenhouse and Lever roles, by department" },
      { key: "github", name: "GitHub", detail: "Public repos, PRs and releases, when they have them" },
      { key: "packages", name: "Package registries", detail: "npm and PyPI releases, for closed-source teams" },
    ],
  },
  {
    when: "Weeks before",
    blurb: "Docs, forums and threads fill in as the work gets close.",
    sources: [
      { key: "docs", name: "Docs sites", detail: "New pages appearing in the docs sitemap" },
      { key: "community", name: "Community forums", detail: "Their Discourse and GitHub Discussions" },
      { key: "hn", name: "Hacker News", detail: "Launches, comments and complaints" },
      { key: "reddit", name: "Reddit", detail: "The subreddits their users live in" },
      { key: "field", name: "Your team", detail: "Links and notes sent from Slack" },
    ],
  },
  {
    when: "At launch",
    blurb: "The announcement lands, and Signal checks its own forecast against it.",
    sources: [
      { key: "changelog", name: "Changelogs", detail: "RSS and Atom feeds" },
      { key: "website", name: "Their website", detail: "Copy changes on product and home pages" },
      { key: "pricing", name: "Pricing pages", detail: "Plan and price diffs" },
      { key: "postings", name: "Newsrooms", detail: "Press and announcement feeds" },
      { key: "news", name: "News coverage", detail: "Funding, partnerships, leadership moves" },
    ],
  },
] as const;

export const SOURCE_COUNT = GROUPS.reduce((total, group) => total + group.sources.length, 0);

export function SourceMap() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {GROUPS.map((group) => (
        <section key={group.when} className="rounded-[20px] border border-line bg-surface p-6">
          <h3 className="font-display text-[22px] font-semibold text-ink">{group.when}</h3>
          <p className="mt-1.5 text-[14px] text-ink-secondary">{group.blurb}</p>
          <ul className="mt-5 space-y-3.5">
            {group.sources.map((source) => (
              <li key={source.key} className="flex gap-3">
                <span
                  className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: sourceColor(source.key) }}
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-[15px] font-semibold text-ink">{source.name}</span>
                  <span className="block text-[13.5px] text-ink-secondary">{source.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
