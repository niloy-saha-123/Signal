# Signal design system (v4)

This file defines how Signal looks, and it overrides every earlier version.
- Tokens: `apps/web/app/globals.css` (`@theme`).
- Shared primitives: `apps/web/components/ui/primitives.tsx`.
- Research and reasoning: `docs/superpowers/plans/2026-09-25-signal-v4-brand-redesign.md`.

When the system changes, update this file in the same commit so the two never drift apart.

The idea behind it: Signal's content is measurements (probabilities, dates, scores). The brand is a calm navy system with a single warm signal colour. The interface stays quiet, so the one thing that lights up is the thing worth noticing.

## Colour

The scheme is complementary on a tinted-neutral base. All values were derived in OKLCH.
- Every neutral carries a trace of the brand hue (262), so the greys belong to the palette instead of fighting it.
- The ink is navy, not black. v3 paired a neutral near-black with teal, and that pairing is what clashed.
- The one warm colour, flare (hue 42), is the complement of the brand blue.

Proportions follow 60/30/10: ground and surfaces 60%, ink and brand blues 30%, flare 10%.

| Token | Hex | Job |
|---|---|---|
| `ground` | `#f9fafd` | Page background and browser `themeColor` |
| `surface` | `#ffffff` | Cards, panels, inputs |
| `surface-sunken` | `#f2f4f9` | Hover, wells, inactive toggles |
| `line` / `line-strong` | `#e0e4eb` / `#cad0d9` | Hairlines and dividers |
| `ink` | `#0e1d3a` | Primary text (16:1 on ground) |
| `ink-secondary` | `#485366` | Body copy (7.4:1) |
| `ink-muted` | `#677181` | Meta, captions (4.75:1, AA) |
| `accent` (Signal blue) | `#2b61cc` | Everything interactive: links, selection, focus, app primary buttons (5.7:1 with white) |
| `accent-hover` / `accent-tint` / `accent-line` | `#1f50b2` / `#e8f1ff` / `#b9cdf3` | Hover, soft fills, borders |
| `midnight` | `#061436` | The brand's dark: logo tile, app sidebar, announcement bar, the dark band |
| `midnight-raised` / `-line` / `-ink` / `-muted` | `#0f2150` / `#22335f` / `#eef2fb` / `#9aa7c4` | Surfaces and text on midnight |
| `flare` | `#f96e31` | The signal: logo peak, marketing commit CTAs, forecast moments, the active-nav marker |
| `flare-deep` / `flare-hover` / `flare-tint` | `#c94a00` / `#ff8249` / `#fff0e3` | Flare text on light (4.7:1), hover, soft fill |

**Rules for flare:**
- Flare is never a status colour.
- Flare buttons always carry **midnight text**. White on orange fails AA; midnight passes at 6.3:1.
- In the app, flare appears only in the logo, the chat avatar and the active-nav marker.

**Light tints** (L≈0.955, no status meaning) are `tint-blue #e8f1ff`, `tint-flare #fff0e3`, `tint-mist #e5f2fb`, `tint-lilac #efeefd`, `tint-sage #e6f7ed` and `tint-stone #f0f2f6`. Use them for metric cells, product-panel backdrops, source-group headers and comparison highlights. They are where the site gets its colour without any saturated fill competing with content.

**Status and outcome** colours carry meaning, so they are used for nothing else:

| Token | Hex | Meaning |
|---|---|---|
| `outcome-hit` / `status-good` | `#008039` | Came true |
| `outcome-miss` / `status-critical` | `#cc3148` | Was wrong; errors |
| `outcome-unresolved` | `#677181` | Window closed, no evidence |
| `outcome-open` | `#2b61cc` | Waiting on its date |
| `status-warning` / `status-serious` | `#f3b01d` / `#e97125` | Alert severity |

Badge fills are hit `#e6f5ec` / `#b5dfc5` and miss `#fdecef` / `#f3c0ca`.

**Source colours** are nine hues at matched OKLCH lightness and chroma, each at least 3:1 on white:

| Source | Hex |
|---|---|
| reddit | `#d06454` |
| hn | `#cf7b00` |
| jobs | `#3ca059` |
| changelog | `#366bd3` |
| pricing | `#c3639c` |
| github | `#49566c` |
| website | `#9773d0` |
| community | `#86962c` |
| postings | `#009ca9` |

These are mirrored in `lib/chart-colors.ts`, and a test enforces the match.

**Brand gradient:** `linear-gradient(135deg, #2b61cc, #0f2150 ~55%, #061436)`. It's used for the logo tile, the chat avatar, the auth panel and the final CTA band, and never behind body text on a light page.

## Logo

A rounded tile carrying the brand gradient, a white signal trace, and a flare dot at the peak with a soft flare halo.
- The gradient is applied with CSS, not an SVG `<defs>`, so repeated or hidden instances never lose their fill.
- `SignalMark` props:
  - `compact`: the tile alone;
  - `tone="dark"`: white wordmark, for midnight surfaces.
- The favicon is `app/icon.svg`.

## Type

- **Funnel Display** (500/600/700) sets headlines and page titles. The global `h1`–`h3` rule applies it; use the `.font-display` class elsewhere.
- **Geist** sets all UI and body text. Card titles and small labels set `font-sans` explicitly.
- **Geist Mono** sets every number that means something. Add `.tabular` for columns.

| Role | Size | Leading | Tracking |
|---|---|---|---|
| Hero | `clamp(2.75rem, 6.6vw, 5.6rem)` | 0.95 | −0.045em |
| Section title | `clamp(2rem, 4.2vw, 3.4rem)` | 1.02 | −0.035em |
| Page title (app) | 32px | tight | display default |
| Body (marketing) | 16–19px | relaxed | normal |
| Body (app) | 15px | normal | normal |
| Dense and meta | 13px | normal | normal |
| Label | 12px | normal | normal |

- Every multi-line heading gets `text-balance`.
- Two-tone headings (first clause `ink`, second `ink-muted`) are the house style for section titles.
- Never use gradient text.

## Shape and depth

| Radius | Use |
|---|---|
| `rounded-md` (8px) | Badges, small toggles |
| `rounded-lg` (12px) | Buttons, inputs, list rows |
| `rounded-xl` (18px) | App cards (the `Card` primitive), empty states |
| `rounded-[22px]` | Marketing panels and product frames |
| `rounded-[28px]` | The final CTA band and the auth panel |
| `rounded-full` | Avatar, status dots, pills |

Depth is a hairline plus an **ink-tinted** shadow. Shadows never use grey or black.
- `--shadow-card` for static cards.
- `--shadow-float` for product frames and the avatar.
- `--shadow-popover` and `--shadow-modal` for things that float.

## Components

- **Buttons:**
  - `primary` is blue with white text, one per view in the app.
  - `flare` is flare with midnight text, reserved for commitment actions: start tracking, create a workspace.
  - `secondary` is a white surface with a hairline.
  - `ghost` is text only.
- **App shell:**
  - A midnight sidebar (`AppSidebar`) with grouped navigation and stroke icons (`components/ui/icons.tsx`).
  - The active item gets a `white/9` fill and a flare left marker.
  - A light top bar shows the breadcrumb, a ⌘K search pill (opening the command palette) and the account.
  - One navigation model lives in `lib/nav.ts` and feeds the sidebar, the mobile menu and the palette.
- **Chat avatar:** a 48px brand-gradient circle with a white trace, a flare peak and a green availability dot. It sits at the vertical centre of the right edge from `lg` up, and bottom-right below that.
- **Metric:** a mono numeral on a tinted cell. An empty track record shows `—`, never `0`.
- **Empty, loading and error states** are designed: `EmptyState` shows the mark glyph, a title and why it's empty; `LoadingRows` shows card-shaped skeletons; `ErrorState` uses the miss tint.
- **Preview banner:** in the dev-only preview without a session, a `role="status"` line on `tint-flare` says the data is fictional.

## Landing page structure

1. Midnight announcement bar.
2. Sticky header: logo, section links, Sign in, and the flare "Start tracking".
3. Hero: pill, two-tone headline, subcopy, flare CTA plus a tour link, and the `HeroProduct` frame on the brand glow and grid.
4. "Reads the public trail from" strip in lowercase mono. It replaces a customer-logo wall; there are no customers to show.
5. How it works: `LeadTimeline` plus the Watch / Predict / Keep score strip.
6. `ProductTour`: five tabbed surfaces, each on its own tint.
7. Midnight scorecard band with `Calibration`, an empty reliability diagram. No bars are drawn until predictions resolve.
8. Nine sources grouped by timing.
9. Ask Signal: evidence, scope and the approval gate.
10. Comparison table.
11. FAQ.
12. Gradient CTA band.
13. Footer.

## Motion

- On load, the hero staggers in with `rise-in` and the traces draw with `trace-draw`.
- Tour panels cross-fade in 380ms.
- Hover states are colour only. Nothing fades in on scroll.
- `prefers-reduced-motion` collapses every animation.

## Copy rules

- Show no metric the product hasn't measured: no user counts, no "trusted by", no accuracy percentages. `test/app/landing-page.test.tsx` enforces this.
- Product views use **fictional companies only** (Kestrel, Halcyon, Parallax, Tidewater) and carry an "illustrative" label.
- Predictions are probabilities, never promises. Say "expects", not "will".
- CTAs name the next action ("Track your first competitor", "Create a workspace").

## Banned

- Pure black anywhere. Use `ink` or `midnight`.
- Purple or indigo as the brand; gradient text.
- White text on flare; flare as a status colour.
- Grey drop shadows.
- Emoji as icons; three identical feature cards; a fake customer-logo wall.
- Tailwind default palette classes for brand or decorative colour. Default reds and greens are tolerated only for inline form errors and success text.
