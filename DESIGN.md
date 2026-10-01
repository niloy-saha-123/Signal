# Signal design system (v5, "works where you work")

This file is the source of truth for how Signal looks. Tokens live in
`apps/web/app/globals.css` (`@theme`), primitives in
`apps/web/components/ui/primitives.tsx`, brand pieces in
`apps/web/components/brand/` (`Sig`, `Isobars`, `Wordmark`). When the system
changes, update this file in the same commit.

The idea: Signal is the weather forecast for your competitors. Pale sky, isobar
line art, ink type, and one sun-yellow highlight for the thing worth noticing.
The content is measurements (probabilities, dates, scores), so the interface
stays quiet and colour is reserved for meaning.

## Colour

| Token | Hex | Job |
|---|---|---|
| `sky` | `#eef5fa` | Landing ground, soft wells (metric cells, "what to do" boxes) |
| `ground` | `#f4f8fb` | App page background |
| `surface` | `#ffffff` | Cards, panels, inputs, windows |
| `surface-sunken` | `#eef3f7` | Hover, tab tracks, inactive states |
| `line` / `line-strong` | `#dfe8ef` / `#c8d6e2` | Hairlines, input borders |
| `isobar` | `#c9dceb` | Isobar line art only |
| `ink` | `#0f1d2b` | Text and primary buttons (solid ink) |
| `ink-secondary` / `ink-muted` | `#3d4f62` / `#5a6b7d` | Body / meta (both ≥4.5:1 on white and sky) |
| `accent` | `#1d5fc4` | Links, focus ring, selection. Not for buttons. |
| `sun` | `#ffd23f` | The signature: headline highlight, Sig, active-nav marker, "new" moments |

**Sun is never text.** It is a fill under ink (`.sun-mark`, `Badge tone="sun"`,
`Button variant="sun"`). Yellow text fails contrast on every light ground.

**Outcomes and status** carry meaning and are used for nothing else: hit
`#0a8a55`, miss `#cc3148`, unresolved `#5a6b7d` (neutral on purpose: an
unresolved window is not a failure), open `#1d5fc4`; status good / warning /
serious / critical `#0a8a55 / #f3b01d / #e97125 / #cc3148`.

**Sources**: website, hn, jobs, changelog, pricing, community, github, reddit
hold the eight validated categorical slots; postings, news, docs, packages and
field have their own chip colours but fold into "Other" (`#8a97a6`) on any
chart. A source chip always prints the source's name next to its dot, so
colour is never the only cue. Mirrored in `lib/chart-colors.ts`; a test
enforces the match.

**Tints** (`tint-sky`, `tint-sun`, `tint-mint`, `tint-rose`, `tint-lilac`,
`tint-sand`) are light washes with no meaning, except `tint-mint`/`tint-rose`
behind hit/miss badges and success/error messages.

**Activity score is a threat score**: rising is shown in `status-critical`,
falling in `status-good`. Do not invert to "up = green".

## Type

- **Funnel Display** (`font-display`, `.metric`) for page titles and the big
  numbers: probabilities, scores.
- **Hanken Grotesk** (`font-sans`) for everything else. Numbers in columns or
  that update in place get `.tnum`.
- Monospace only inside code and MCP snippets.
- Page titles 32–38px, card titles 15px semibold, body 14–15px, meta 12.5–13px.

## Shape and depth

| Radius | Use |
|---|---|
| 8px (`--radius-control`) | Small controls, inline icon buttons |
| 10px | Buttons, inputs, selects, inner wells |
| 14px (`--radius-card`) | Cards, panels, list rows, empty states |
| 20px (`--radius-window`) | Floating windows, hero cards, error boundary |
| pill | Badges, source chips, filter chips |

Static cards: 1px `line` border, no shadow. Shadows only for floating things:
`--shadow-window` (chat panel, landing windows, Sig launcher),
`--shadow-popover` (⌘K, menus).

## Mascot: Sig

`<Sig mood size decorative? />`, a sun-yellow robot face. Moods are
information, not decoration: `idle` (blinks), `thinking` (an answer is
streaming), `unsure` (refusal, error, thin evidence, 404), `happy` (a hit, a
finished setup). Used for the chat launcher and avatar, empty states, error
and 404 pages, onboarding and the landing chat window. All animation is CSS and
stops under `prefers-reduced-motion`.

## App structure

Six primary destinations, each an "area" whose views are `Tabs` links in the
`PageHeader` action slot:

| Area | Views |
|---|---|
| Home `/briefing` | — |
| Forecasts | `/forecast`, `/scorecard`, detail `/forecast/[id]` |
| Competitors | Watching `/board`, Candidates `/discovery`, profile `/radar/[id]` |
| Evidence | Feed `/intel`, Alerts `/alerts` |
| Ask Signal | `/chat` and the slide-over panel |
| Your company | Profile `/company`, Us vs. them `/company/compare` |

Settings and Activity (`/settings`, `/activity`) sit in the sidebar footer.

## Components and patterns

- **Buttons**: `primary` is solid ink, one per region. `secondary` is bordered
  white. `ghost` for row actions. `danger` for sign-out and destructive acts.
- **PageHeader**: every page answers one question; `description` is that
  answer in one sentence.
- **EmptyState**: says why it's empty and offers the next action, often inline
  (the add-competitor input) rather than a link away. Never a bare "No data".
- **ErrorState / error boundary**: bounded failure with a retry. The raw error
  message is logged, never shown. Server pages let a failed primary fetch reach
  the error boundary instead of rendering an empty page that lies.
- **AskButton** ("Ask Signal about this") on forecasts, alerts, evidence and
  competitor profiles opens the panel pre-filled. Never auto-sent.
- **AddCompetitorForm** is the one way to add a competitor, used on Home, the
  board, candidates and empty states.
- **Optimistic UI** for quick decisions (watch/dismiss a candidate), rolled
  back with an error toast if the API refuses.
- **Toasts** (`toast()`) confirm async work; `LoadingRows` skeletons, not
  spinners.
- **Forms**: real `<label>`s (visible or `sr-only`), checkboxes stay in the tab
  order (`sr-only`, never `hidden`), focus ring in `accent`.

## Layout

- App content max width 1120px (`(app)/layout.tsx`). No horizontal scroll at 375px: check it
  after any layout change (header action slots wrap).
- Rows that hold a name and a number: name truncates, number never wraps.

## Copy rules

- No metric the product hasn't measured: no user counts, "trusted by", accuracy
  percentages or YC badge. `test/app/landing-page.test.tsx` enforces it.
- Example companies are fictional (Kestrel, Lumen, Northstar, Rivalex,
  Paperloom) and product views on public pages are labelled illustrative.
- The unauthenticated dev preview never shows forecasts or a track record.
- Predictions are probabilities, not promises: "expects", not "will".
- Plain language over internal names: "Activity score", not "Signal Score";
  "Candidates", not "tracked entities".

## Banned (anti-slop)

Gradient text, glassmorphism, 01/02/03 markers, mono eyebrows over every
heading, emoji or glyphs as icons (✓ ✎ ✕), logo walls, identical three-card
grids, fade-up on every section, side-tab borders, purple/indigo brand colour,
Tailwind default palette classes for brand or status colour (use tokens).
