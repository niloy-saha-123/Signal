# Signal Frontend - Complete Implementation Plan

## Executive Summary
This is a **complete rebuild** of the Signal frontend, not incremental patches. Following the end-to-end guide, this plan addresses:
- Full UX/UI redesign with proper agent states
- Complete data visualization strategy
- Chat UX with streaming, thinking states, and proper controls
- All empty/loading/error states
- Route restructuring with proper auth boundaries
- Missing backend routes
- Systematic build order

## Part 1: Critical Fixes (Do First)

### 1.1 Chat Sidebar Redesign
**Problem:** Lavender/purple colors, looks "AI-generated", doesn't match ChatGPT's clean minimal design

**Solution:**
- Remove ALL purple/indigo colors from chat
- Use pure white background (`bg-white`)
- Gray text (`text-slate-700` for messages, `text-slate-400` for meta)
- Clean input with subtle border
- Minimal "thinking" indicator (3 dots animation, gray)
- Thread list on left side of chat panel
- Messages on right with clear user/assistant distinction

**Chat States to Handle:**
1. **Empty** - "Start a conversation" prompt
2. **Typing** - User can type, send button enabled
3. **Streaming** - Show live tokens + "thinking" indicator, input DISABLED, show "Stop generating" button
4. **Complete** - Message done, input re-enabled
5. **Error** - Show error, allow retry
6. **Refused** - Show refusal reason + suggested query as clickable

### 1.2 Remove All AI Slop
- ❌ Emoji icons (already removed)
- ❌ Purple/lavender colors in chat
- ❌ Generic "AI assistant" language
- ✅ Use Manrope font (already done)
- ✅ Clean minimal design
- ✅ Proper data hierarchy

## Part 2: Architecture Restructuring

### 2.1 Route Groups (Required)
```
app/
├── layout.tsx                    # Root: fonts + globals only
├── page.tsx                      # PUBLIC landing page
├── (auth)/
│   ├── layout.tsx               # Minimal centered layout
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   └── onboarding/page.tsx
└── (app)/
    ├── layout.tsx               # THREE-COLUMN SHELL
    ├── page.tsx                 # Briefing (move from root)
    ├── intel/page.tsx
    ├── discovery/page.tsx       # NEW
    ├── alerts/page.tsx
    ├── board/page.tsx
    ├── company/
    │   ├── page.tsx            # NEW - Profile + docs
    │   └── compare/page.tsx    # NEW (wait for backend)
    ├── profile/page.tsx        # NEW - User account
    └── settings/page.tsx
```

### 2.2 Middleware Update
Add `/` to public paths so landing page is accessible when logged out

## Part 3: Missing Backend Routes (Build These First!)

### 3.1 Discovery Board
```typescript
// apps/api/src/api/tracked-entities.ts
GET /api/tracked-entities
Response: TrackedEntity[] {
  id, candidate_name, candidate_domain,
  relationship_type, relationship_confidence,
  candidate_reason, source, status, created_at
}
```

### 3.2 Dashboard Summary
```typescript
// apps/api/src/api/dashboard.ts
GET /api/dashboard/summary
Response: {
  competitors_tracked: number,
  signals_this_week: number,
  open_alerts: number,
  pending_candidates: number
}
```

### 3.3 Company Documents
```typescript
// apps/api/src/api/company-documents.ts
GET /api/company-documents
Response: CompanyDocument[] {
  id, filename, mime_type, doc_type,
  extraction_status, created_at
}
```

## Part 4: Data Visualization Strategy

### 4.1 Briefing Page
**KPI Tiles** (4 tiles, horizontal row):
- Competitors Tracked (number)
- Signals This Week (number + vs last week)
- Open Alerts (number, link to alerts page)
- Pending Candidates (number, link to discovery)

**Insight Card** (hero):
- Highest-signal alert
- Show: competitor, pattern, interpretation, confidence
- Call-to-action button

**Volume Chart**:
- 7-day bar chart
- Highlight today's bar in indigo
- Others in gray
- Show mention volume

**Discovery Board** (kanban, 3 columns):
- Suggested | Tracking | Dismissed
- Drag-and-drop between columns
- Confirm/Dismiss buttons on Suggested cards

### 4.2 Intel Page
**Table View** with columns:
- Source (badge with color)
- Title (bold, clickable)
- Competitor
- Quality Score (1-10, colored indicator)
- Date (relative, e.g. "2 hours ago")

**Filters:**
- Source dropdown (reddit, hn, jobs, changelog, pricing)
- Competitor dropdown
- Date range pills (Today, 7 days, 30 days)

### 4.3 Company Page
**Two-column layout:**

Left: Company Profile
- Product description (textarea)
- ICP details (company size, industries, buyer role)
- Pricing tiers (editable list)
- Key differentiators (chips)
- Primary competitors (multi-select)
- Save button

Right: Documents
- Upload area (drag-and-drop)
- Document list with status badges
- Extraction status indicators

### 4.4 Charts & Visualizations
All charts use colors from `lib/chart-colors.ts`:
- Signal Score: Line chart, `SEQUENTIAL_COLOR`
- Sentiment: Area chart, `DIVERGING_COLORS`
- Hiring: Bar chart by department, `SOURCE_COLORS`
- Volume: Simple bar chart, one highlighted

## Part 5: Chat UX (Complete Specification)

### 5.1 Layout
```
┌─────────────────────────────────────┐
│ Chat                     [Collapse] │  Header
├─────────────────────────────────────┤
│ ┌─────────┐ ┌──────────────────┐   │
│ │ Threads │ │    Messages      │   │
│ │         │ │                  │   │
│ │ • Today │ │ User: question   │   │
│ │ • Week  │ │ AI: answer       │   │
│ │         │ │ [Citations]      │   │
│ └─────────┘ └──────────────────┘   │
│                                     │
│ ┌────────────────────────────────┐ │
│ │ Ask Signal a question...       │ │ Input
│ │                         [Send] │ │
│ └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 5.2 Message States

**While AI is thinking/generating:**
- Show "thinking..." indicator (3 animated dots)
- Stream tokens as they arrive
- Input is DISABLED
- Show "Stop generating" button
- User CANNOT send new messages

**After message completes:**
- Input re-enabled
- "Stop generating" button disappears
- Show regenerate button (circular arrow icon)
- User can send new messages

**On refusal:**
- Show refusal reason in gray box
- Show suggested query as clickable pill
- Input still enabled

### 5.3 Thread Management
- Auto-save threads
- Show thread list on left (last 10)
- Click thread to load history
- "New thread" button creates fresh context
- Thread title auto-generated from first message

### 5.4 Citations
- Render as chips below message
- Show source + link
- Click to open in new tab
- Max 5 citations, "View all X" if more

## Part 6: Empty/Loading/Error States (Mandatory for ALL Pages)

### 6.1 Empty States
Each page needs guidance on what to do:
- **Briefing**: "Add your first competitor to get started" + [Add Competitor] button
- **Intel**: "No signals yet. Intelligence will appear here as competitors are monitored."
- **Discovery**: "No candidates yet" + [Start Discovery] button
- **Alerts**: "No alerts yet. You'll be notified of important competitive movements."
- **Chat**: "Ask Signal a question about your competitive landscape..."

### 6.2 Loading States
- Skeleton loaders for cards/lists
- Spinner for long operations
- Progress bar for file uploads
- "Loading..." text only as last resort

### 6.3 Error States
- Friendly error messages (never show raw API errors)
- Retry button when appropriate
- "Something went wrong" with description
- Link to support/docs if relevant

## Part 7: Component Hierarchy

### 7.1 Shell Components
- `LeftNav` - Collapsible navigation with badge counts
- `TopBar` - Search + profile button
- `ChatPanel` - Persistent chat sidebar
- `AlertBanner` - Global alerts via Socket.io

### 7.2 Page Components
- `BriefingPage` - KPI tiles + insight + chart + discovery
- `IntelPage` - Filtered signal feed + table
- `DiscoveryPage` - Kanban board with drag-and-drop
- `AlertsPage` - Alert list with filtering
- `CompanyPage` - Profile editor + document upload
- `ProfilePage` - User account info

### 7.3 Reusable Components
- `StatTile` - KPI display with icon + value + delta
- `SignalCard` - Intel card with source + quality score
- `AlertCard` - Alert with confidence + evidence
- `CandidateCard` - Discovery card with confirm/dismiss
- `EvidenceChip` - Citation link chip
- `PillTabs` - Filter pills
- `FileUpload` - Drag-and-drop upload area

## Part 8: Build Order

### Phase 1: Foundation (Do First)
1. ✅ Add missing backend routes
2. ✅ Restructure with route groups
3. ✅ Update middleware for public landing
4. ✅ Redesign chat sidebar (clean, no purple)
5. ✅ Add lib/api.ts functions for new endpoints

### Phase 2: Core Pages
6. ✅ Briefing page with KPI tiles + discovery board
7. ✅ Intel page with proper table + filters
8. ✅ Company page with profile + documents
9. ✅ Profile page (simple)
10. ✅ Update Alerts page with evidence/actions

### Phase 3: Polish
11. ✅ All empty/loading/error states
12. ✅ Socket.io realtime updates
13. ✅ Proper mobile responsive
14. ✅ Accessibility (keyboard nav, ARIA labels)

### Phase 4: Testing
15. ✅ Test all pages in browser
16. ✅ Test all agent states (streaming, thinking, error)
17. ✅ Test all data viz with real data
18. ✅ Test mobile responsive
19. ✅ Run type checking + build
20. ✅ Get user approval

## Part 9: Design System (Strict Rules)

### Colors
- Background: `bg-slate-50`
- Cards: `bg-white`
- Text: `text-slate-900` (primary), `text-slate-600` (secondary), `text-slate-400` (muted)
- Accent: `indigo-600` (buttons, links, active states)
- **Chat: NO purple/lavender - use grays only**
- Status: red (urgent), amber (high), blue (medium), slate (low)

### Typography
- Manrope for everything (serif and sans variants)
- Page titles: `font-serif text-4xl font-semibold`
- Section heads: `font-sans text-lg font-semibold`
- Body: `font-sans text-sm`
- Labels: `font-sans text-xs font-medium uppercase`

### Spacing
- Page padding: `px-8 py-10`
- Card padding: `p-6` or `p-8`
- Card gaps: `gap-4` (compact), `gap-6` (normal), `gap-8` (spacious)
- Rounded corners: `rounded-2xl` (cards), `rounded-lg` (inputs), `rounded-full` (pills)

### Shadows
- Default: `shadow-sm`
- Hover: `shadow-md`
- Active/dragging: `shadow-lg`

## Success Criteria

✅ Build passes without errors
✅ All pages visible in browser
✅ Chat works with proper streaming + states
✅ All empty/loading/error states work
✅ Data viz renders correctly
✅ Mobile responsive
✅ No purple in chat
✅ Clean, professional design
✅ User approves

---

**Next Step:** Start with Phase 1 - Add missing backend routes, then rebuild chat sidebar
