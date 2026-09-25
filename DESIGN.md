# Signal design system (v3)

This file is the source of truth for how Signal looks. The tokens live in
`apps/web/app/globals.css` (`@theme`). Shared primitives live in
`apps/web/components/ui/primitives.tsx`. When the system changes, update this
file in the same commit so the two never drift apart.

The idea behind it: Signal's content is measurements (probabilities, dates,
scores). So the interface stays quiet, numbers get their own typeface, and
colour is reserved for meaning.

## Colour

A warm off-white ground, white surfaces, and one deep-teal accent. Borders
give depth; shadows are only for things that float.

| Token | Hex | Job |
|---|---|---|
| `ground` | `#faf9f7` | Page background (also the browser `themeColor`) |
| `surface` | `#ffffff` | Cards, panels, inputs |
| `surface-sunken` | `#f5f4f1` | Hover, wells, inactive toggles |
| `line` / `line-strong` | `#e7e5e0` / `#d6d3cc` | Borders, dividers |
| `ink` | `#1a1a18` | Primary text |
| `ink-secondary` | `#5c5a55` | Body copy, labels |
| `ink-muted` | `#8a8780` | Meta, placeholders |
| `accent` | `#0f6e68` | Primary actions, active nav, focus, links |
| `accent-hover` | `#0b5651` | Hover on accent fills |
| `accent-tint` | `#e6f2f1` | Active nav background, soft accent chips |
| `accent-line` | `#9cc9c5` | Accent borders and pills |

**Decorative tints** (`tint-teal #e9f4f2`, `tint-sand #faf1e6`,
`tint-sky #ecf3fa`, `tint-sage #eef4ec`, `tint-clay #fbeeea`,
`tint-stone #f2f1ee`) are light washes. Use them for metric cells, category
chips and panels that carry **no status meaning**. Never use a tint to mean
good or bad.

**Status and outcome** colours carry meaning, so they are used for nothing else:

| Token | Hex | Meaning |
|---|---|---|
| `outcome-hit` / `status-good` | `#0ca30c` | Prediction came true |
| `outcome-miss` / `status-critical` | `#d03b3b` | Prediction was wrong; errors |
| `outcome-unresolved` | `#8a8780` | Window closed with no evidence |
| `outcome-open` | `#0f6e68` | Still waiting on its date |
| `status-warning` / `status-serious` | `#fab219` / `#ec835a` | Alert severity |

**Source colours** (charts, source chips): reddit `#2a78d6`, hn `#eb6834`,
jobs `#1baf7a`, changelog `#eda100`, pricing `#e87ba4`, github `#4b5563`,
website `#9a6a3a`, community `#7a8b2e`, postings `#1c9aa8`. These are mirrored
in `lib/chart-colors.ts`, and a test enforces the match.

**Public pages only:** trace gradient `trace-a..d` (`#0f6e68 → #3f9fc4 →
#8cc9d6 → #efc79a`) for the signal-line motif, and the deep band
(`deep #0b3b38`, `deep-ink #e8f3f1`, `deep-muted #a6c9c4`), used once on the
landing page.

## Type

- **Instrument Sans** (400/500/600/700) for all UI and headings.
- **JetBrains Mono** (400/500/600) for every number that means something:
  probabilities, Brier scores, dates, counts. Add `.tabular` wherever a number
  sits in a column or updates in place.
- Body copy is 15px. Dense tables and meta text use 13px, labels 12px.
- Headings are `font-semibold` with negative tracking (`-0.03em` for section
  headings, `-0.04em` for the hero). Add `text-balance` to any multi-line
  heading so it doesn't leave one word on the last line.
- **Two-tone headings** on public pages: the first clause in `ink`, the second
  in `ink-muted` (the `TwoTone` helper in `app/page.tsx`). Never use gradient
  text.

## Shape and depth

| Radius | Value | Use |
|---|---|---|
| `sm` | 4px | Badges |
| `md` | 6px | Buttons, toggles, inputs in dense UI |
| `lg` / `rounded-[10px]` | 10px | Cards, panels, banners |
| `rounded-xl` | 12px | Auth card, landing product frames |
| `rounded-full` | pill | Status dots, avatar, announcement pills only |

Static cards use a 1px `line` border and no shadow. Shadows are only for
popovers (`--shadow-popover`), modals and the chat panel (`--shadow-modal`),
and the primary CTA on public pages.

## Components

- **Primary button**: `bg-accent text-white hover:bg-accent-hover`, medium
  weight. One per view.
- **Secondary button**: `border border-line-strong bg-surface text-ink`.
- **Segmented toggles and filters**: active = `bg-accent text-white`, inactive
  = `text-ink-secondary hover:bg-surface-sunken`. Set `aria-pressed`.
- **Nav (AppSidebar)**: grouped Today / Forecast / Evidence / Workspace;
  active = `bg-accent-tint text-accent font-semibold` plus a left marker bar.
  Below `lg`, the TopBar hamburger carries navigation.
- **Metric**: mono numeral on a tinted cell. The empty track record shows `—`,
  never `0`.
- **Badge**: `hit` / `miss` / `unresolved` / `open`, drawn only from outcome
  tokens.
- **Chat avatar**: a 44px circle with the trace glyph and an accent
  availability dot. Fixed at the vertical centre of the right edge on `lg+`,
  bottom-right below that. Opens the "Ask Signal" panel.
- **Empty, loading and error states** are designed, not left out:
  `EmptyState`, `LoadingRows`, `ErrorState`. An empty state says why it's
  empty and what will fill it.
- **Preview banner**: when the dev preview renders without a session, the app
  shell shows a sand-tinted `role="status"` line saying the data is fictional.

## Layout

- Content max width is `max-w-6xl`, with 20px gutters on mobile and 32px from
  `sm` up.
- Public pages use `.rails`: two vertical hairlines at the content edges. Full-bleed
  bands that should cover them need `relative z-[1]`.
- `.grid-backdrop` (48px masked grid) sits behind the hero only.
- No horizontal scroll at 375px. Check it after any layout change.

## Copy rules

- No metric the product hasn't measured: no user counts, no "trusted by", no
  accuracy percentages. `test/app/landing-page.test.tsx` enforces this.
- Product views on public pages use **fictional companies only** (Kestrel,
  Parallax, Tidewater, Halcyon) and carry an "illustrative" label.
- Predictions are probabilities, never promises. Say "expects", not "will".
- CTAs name the next action in product language ("Track your first
  competitor"), not "Get started".

## Banned (anti-slop)

Purple, indigo or violet anywhere. Gradient text. Emoji as icons. Glassmorphism.
Three identical feature cards in a row. Every container
`rounded-xl shadow-sm`. Numbered markers on content that isn't a sequence.
Tailwind default palette classes for brand or decorative colour: use tokens.
Default reds, ambers and greens are tolerated only for inline error and
success text.
