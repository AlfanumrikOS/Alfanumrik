# Super Admin Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Pre-requisite:** Plan 0 (`2026-05-09-dashboard-foundation.md`) merged. The admin-ui kit + Recharts wrappers are mandatory inputs.

**Goal:** Migrate all 44 sub-pages under `/super-admin/*` to the shared `admin-ui` kit (Plan 0), replacing inline `style={S.*}` records with Tailwind classes, swapping ad-hoc cards/tables/badges/charts for shared primitives, and deprecating `super-admin/_components/admin-styles.ts`. Goal is consistency + maintainability across the operator surface, NOT new features.

**Architecture:** This is a **systematic migration**, not a redesign. We define one canonical migration recipe (Task 1) and apply it to ~44 pages in clusters by domain (Tasks 2-7). Each cluster is a separate commit chain so the work can be paused/resumed/parallelized.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, Tailwind 3.4, admin-ui kit (Plan 0), Recharts (Plan 0).

**Solo-developer estimate:** ~5-7 working days. Roughly 5-10 pages per day depending on size. Cluster 1 (large pages) is the slowest at ~1 day per page; later clusters move faster as the pattern becomes muscle memory.

---

## Inventory (verified 2026-05-09)

44 pages, 19,629 LOC total. Top size buckets:

| Cluster | Pages | LOC | Priority |
|---|---|---|---|
| **Cluster 1 — High-traffic / large** | command-center (1305), institutions (1240), users (397), subscriptions (347), invoices (435), analytics (325) | ~4,049 | P0 |
| **Cluster 2 — Grounding / AI** | grounding/health (869), grounding/traces (413), grounding/ai-issues (362), grounding/verification-queue (323), grounding/coverage (233), foxy-quality (276), oracle-health (327) | ~2,803 | P1 |
| **Cluster 3 — Observability / Ops** | observability (297), observability/rules (617), observability/channels (448), alerts (370), sla (359), logs, diagnostics (346), marking-integrity (450) | ~2,887 | P1 |
| **Cluster 4 — Content / CMS** | cms (752), content (384), bulk-upload (714), workbench (227), demo (474), goal-profiles (349) | ~2,900 | P2 |
| **Cluster 5 — Subjects / RBAC / Flags** | subjects (419), subjects/grade-map (399), subjects/plan-access (375), subjects/violations (414), rbac (488), flags (173), oauth-apps (643), module-overrides (225), misconceptions (263), readiness-rubric (318), learning (444), analytics-b2b (344), support (477), students/[id] (394), view-as/[studentId]/* (3 pages, 966 total), Overview (page.tsx, 172) | ~6,990 | P2 |

44 pages total. Cluster 5 is a long tail of moderate-size pages with similar shapes (table + filter + drawer).

31 of 44 pages use the inline `style={S.*}` pattern from `super-admin/_components/admin-styles.ts`. The migration deletes that file at the end.

---

## File Structure

**Modify:** all 44 `src/app/super-admin/**/page.tsx` files (clustered).

**Delete (final task):**
- `src/app/super-admin/_components/admin-styles.ts` (once zero consumers)
- Per-page inline `colors` / `S` references (replaced by Tailwind tokens from Plan 0)

**Already created in Plan 0** — re-used here:
- `src/components/admin-ui/{StatCard, StatusBadge, StalenessTag, DetailDrawer, DataTable, DashboardSidebar}.tsx`
- `src/components/admin-ui/charts/{LineChart, BarChart, DonutChart}.tsx`

**Optional creation** (only if a cluster reveals a missing primitive):
- New `admin-ui` primitive — added to Plan 0's index, then used in Cluster N. Document in commit message.

---

## Pre-flight

- [ ] **Step 0.1: Confirm Plan 0 is merged**

```bash
ls src/components/admin-ui/index.ts
grep -c "export " src/components/admin-ui/index.ts
```

Expected: ≥10 exports.

- [ ] **Step 0.2: Green baseline + branch**

```bash
npm run type-check && npm run lint && npm test -- --run
git checkout main && git pull
git checkout -b refactor/super-admin-visual-upgrade
```

- [ ] **Step 0.3: Record baseline LOC**

```bash
find src/app/super-admin -name page.tsx | xargs wc -l | tail -1
```

Note the total. Goal post-migration: similar or slightly lower LOC (Tailwind classes are denser than inline styles, so 5-15% reduction is realistic).

- [ ] **Step 0.4: Confirm AdminShell already wired**

After Plan 0 was merged, AdminShell uses DashboardSidebar with bilingual labels. Verify:

```bash
grep -n "DashboardSidebar" src/app/super-admin/_components/AdminShell.tsx
```

Should show one import. If absent, complete Plan 0 first.

---

## Task 1: Define the migration recipe

This is the canonical pattern applied per page in Tasks 2-7. Read carefully; every page migration follows it.

### Recipe (apply to one page at a time)

For each `src/app/super-admin/<area>/page.tsx`:

1. **Read the page** — note its imports, top-level structure, what data it fetches, what UI primitives it uses inline (custom cards, tables, badges, charts).

2. **Add admin-ui imports**

```tsx
import {
  StatCard, StatusBadge, StalenessTag, DetailDrawer, DataTable,
  type Column,
} from '@/components/admin-ui';
import { LineChart, BarChart, DonutChart } from '@/components/admin-ui/charts';
```

3. **Replace primitive usages, top-down:**

| Pattern in current page | Replace with |
|---|---|
| `<div style={S.card}>...header + stats grid...</div>` (KPI tile) | `<StatCard label=... value=... icon=... trend=... />` |
| `<span style={{ background: ..., color: ... }}>{statusLabel}</span>` (chip) | `<StatusBadge label={statusLabel} variant="success\|danger\|warning\|info\|neutral" />` |
| Inline `<table style={S.table}>...</table>` with manual sort/empty states | `<DataTable<RowType> columns={...} data={...} keyField="id" loading={...} emptyMessage=... />` |
| Inline drawer with `position: fixed` + ESC handler | `<DetailDrawer open={...} onClose={...} title=... width={520}>{...}</DetailDrawer>` |
| Custom SVG sparkline / bar chart | `<LineChart>` / `<BarChart>` / `<DonutChart>` from charts |
| `<span className="text-xs text-amber-600">{age}m ago</span>` patterns | `<StalenessTag lastUpdated={ts} thresholdMinutes={5} />` |

4. **Replace inline `style={S.*}` with Tailwind utility classes.** Common substitutions:

| Old | New |
|---|---|
| `style={S.page}` | `className="min-h-screen bg-surface-1 text-foreground"` |
| `style={S.container}` | `className="mx-auto max-w-screen-2xl p-6"` |
| `style={S.h1}` | `className="text-xl font-bold tracking-tight text-foreground"` |
| `style={S.h2}` | `className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"` |
| `style={S.subtitle}` | `className="text-sm text-muted-foreground"` |
| `style={S.card}` | `className="rounded-lg border border-surface-3 bg-surface-1 p-4"` |
| `style={S.cardSurface}` | `className="rounded-lg border border-surface-3 bg-surface-2 p-4"` |
| `style={S.searchInput}` | `className="w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"` |
| `style={S.select}` | `className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"` |
| `style={S.filterBtn}` | `className="rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2"` |
| `style={S.filterActive}` | (state-dependent: add to className via twMerge) |
| `style={S.primaryBtn}` | `className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"` |
| `style={S.secondaryBtn}` | `className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"` |
| `style={S.dangerBtn}` | `className="rounded-md border border-danger bg-danger/10 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/20"` |
| `style={S.actionBtn}` | `className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-2"` |
| `style={S.pageBtn}` | same as filterBtn |
| `style={S.dlBtn}` | `className="rounded-md border border-surface-3 bg-surface-2 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-surface-3"` |

5. **Drop the `import { colors, S } from '../_components/admin-styles'` line** once all references are gone. Type-check will fail if any remain.

6. **Run page-specific test (if exists), then manual smoke + commit.**

```bash
npx vitest run src/__tests__/super-admin/<area>*.test.ts 2>/dev/null
npm run dev
# Open http://localhost:3000/super-admin/<area>, click through, verify visual + interactive parity
git add src/app/super-admin/<area>/page.tsx
git commit -m "refactor(super-admin): migrate <area> to admin-ui kit"
```

7. **Cross-check** (per memory `feedback_cross_check_previews.md`): EN + हिं × empty + populated + loading + error states × the breakpoint(s) the operator panel actually targets (super-admin is desktop-only — confirm 1280px works; mobile not required).

### Anti-patterns to watch for

- ❌ **Don't migrate "while you're there"** — if a page has a real bug, file a separate issue. Migration should be visually neutral or better.
- ❌ **Don't merge two pages into one.** If a refactor opportunity appears (e.g. two near-identical pages), file a follow-up issue.
- ❌ **Don't add new charts unless a hand-rolled one already exists.** Goal is migration, not new viz.
- ❌ **Don't change column headers, action button labels, or copy.** Visual parity = same words.

---

## Task 2: Cluster 1 — High-traffic / large pages

**Pages:** command-center, institutions, users, subscriptions, invoices, analytics

These are the most-used + most-impactful. Do these first so improvements are felt by operators on day 1.

- [ ] **Step 2.1: command-center (1305 LOC)**

The largest page in super-admin. Likely has its own widgets — `_components/widgets/` directory exists in canonical (LearnerHealth, PlatformHealth, LiveStatus, etc.). Apply Recipe (Task 1) to the page.tsx itself; the widgets are separate components — leave them for Cluster 6 if they need migration.

After migration, check:
```bash
wc -l src/app/super-admin/command-center/page.tsx
```
Expected: 5-15% LOC reduction (Tailwind is denser than inline style strings).

Commit per major section if needed: `refactor(super-admin/command-center): migrate <section> to admin-ui kit`.

- [ ] **Step 2.2: institutions (1240 LOC)**

This page already imports `DataTable`, `StatCard`, `StatusBadge` from local `_components/`. After Plan 0, those re-export from admin-ui — so existing imports still work. The migration is mostly: replace remaining `style={S.*}` instances + drop the `import { colors, S } from '../_components/admin-styles'`. Should be straightforward.

- [ ] **Step 2.3: users (397 LOC)**

Standard table + drawer pattern. Apply Recipe.

- [ ] **Step 2.4: subscriptions (347 LOC)**

Likely a `<DataTable>` of subscription records with status badges. Apply Recipe.

- [ ] **Step 2.5: invoices (435 LOC)**

Invoice list + detail drawer. Apply Recipe.

- [ ] **Step 2.6: analytics (325 LOC)**

This is the page Plan 0 already migrated as its validation page. Verify Plan 0's migration stuck — should already be done. If only partially migrated (e.g. one chart added but inline styles remain elsewhere), finish the migration here.

- [ ] **Step 2.7: Cluster 1 validation**

```bash
npm run type-check && npm run lint && npx vitest run
npm run dev
# Click through all 6 pages, verify visual parity
```

Cluster 1 commit chain should be ~6 commits total (one per page). Push to feature branch but don't open PR yet — wait for at least Cluster 2 done.

---

## Task 3: Cluster 2 — Grounding / AI

**Pages:** grounding/health, grounding/traces, grounding/ai-issues, grounding/verification-queue, grounding/coverage, foxy-quality, oracle-health

These have unique-ish UI elements (trace viewer, verification queue cards, coverage heatmap). Apply Recipe — but if a page has a custom visualization that doesn't fit `<LineChart>`/`<BarChart>`/`<DonutChart>`, leave it as-is and document in commit message that it's NOT migrated. Don't shoehorn.

- [ ] **Step 3.1-3.7: per-page migration**

Apply Recipe to each. Per-page commits.

- [ ] **Step 3.8: Cluster 2 validation**

Same as Step 2.7 but for these 7 pages.

---

## Task 4: Cluster 3 — Observability / Ops

**Pages:** observability, observability/rules, observability/channels, alerts, sla, diagnostics, marking-integrity

Mostly tables + alerts panels. The `alerts` and `sla` pages may have time-series charts — replace with `<LineChart>` (Plan 0).

- [ ] **Step 4.1-4.7: per-page migration**

Per-page commits.

- [ ] **Step 4.8: Cluster 3 validation**

---

## Task 5: Cluster 4 — Content / CMS

**Pages:** cms, content, bulk-upload, workbench, demo, goal-profiles

These have form-heavy pages. The Recipe still applies — most of the work is button + input style migration. Form validation logic doesn't change.

- [ ] **Step 5.1-5.6: per-page migration**

The `bulk-upload` page (714 LOC) and `cms` page (752 LOC) are the largest in this cluster — give them a full session each.

- [ ] **Step 5.7: Cluster 4 validation**

---

## Task 6: Cluster 5 — Subjects / RBAC / Flags / long tail

**Pages:** subjects, subjects/grade-map, subjects/plan-access, subjects/violations, rbac, flags, oauth-apps, module-overrides, misconceptions, readiness-rubric, learning, analytics-b2b, support, students/[id], view-as/[studentId]/{dashboard, foxy, progress, quizzes}, overview (super-admin/page.tsx)

19 pages. Move fast — pattern is now muscle memory. Average ~30-45 min per page.

- [ ] **Step 6.1-6.19: per-page migration**

Per-page commits. Group similar pages (e.g. all `subjects/*`) into a single push if convenient.

- [ ] **Step 6.20: Cluster 5 validation**

After this task, every super-admin page should be migrated. Verify:

```bash
grep -rn "from '../_components/admin-styles'" src/app/super-admin/
grep -rn "style={S\." src/app/super-admin/
```

Expected: zero matches in both. Any remaining match = a page Cluster 5 missed.

---

## Task 7: Delete admin-styles.ts + final cleanup

After Tasks 2-6, the legacy inline-style system should have zero consumers.

**Files:**
- Delete: `src/app/super-admin/_components/admin-styles.ts`
- Possibly: `src/app/super-admin/_components/StatCard.tsx`, `StatusBadge.tsx`, `DataTable.tsx`, `DetailDrawer.tsx`, `StalenessTag.tsx` (these are now thin re-exports from Plan 0; consider deleting if every consumer imports from `@/components/admin-ui` directly)

- [ ] **Step 7.1: Verify admin-styles.ts has no consumers**

```bash
grep -rn "from '.*admin-styles'" src/
grep -rn "from '@/.*admin-styles'" src/
```

Expected: zero matches.

- [ ] **Step 7.2: Delete the file**

```bash
git rm src/app/super-admin/_components/admin-styles.ts
git commit -m "chore(super-admin): delete admin-styles.ts (zero consumers post-migration)"
```

- [ ] **Step 7.3: Audit re-export shims**

After Plan 0, `src/app/super-admin/_components/StatCard.tsx` etc. are one-line re-exports. If every page in super-admin migrated to import directly from `@/components/admin-ui`, the shims are now unused.

```bash
grep -rn "from '\(\\./\\|\\.\\./\\)_components/StatCard'" src/app/super-admin/
grep -rn "from '\(\\./\\|\\.\\./\\)_components/DataTable'" src/app/super-admin/
# repeat for StatusBadge, DetailDrawer, StalenessTag
```

If all return empty, delete the shims:

```bash
git rm src/app/super-admin/_components/StatCard.tsx
git rm src/app/super-admin/_components/StatusBadge.tsx
git rm src/app/super-admin/_components/DataTable.tsx
git rm src/app/super-admin/_components/DetailDrawer.tsx
git rm src/app/super-admin/_components/StalenessTag.tsx
git commit -m "chore(super-admin): delete primitive re-export shims (consumers now import from admin-ui)"
```

If any return matches, leave the shim in place — it's harmless and avoids breaking the matched consumers. Document in commit message that the shim stays for the matched files.

---

## Task 8: Final validation + PR

- [ ] **Step 8.1: Full local checks**

```bash
npm run type-check
npm run lint
npm test -- --run
npm run build
```

- [ ] **Step 8.2: Bundle check**

```bash
npm run analyze
```

Compare per-page First Load JS to baseline. Expected: roughly equal or slightly smaller (Tailwind classes are tree-shaken; inline string literals weren't shrinking under build optimization).

- [ ] **Step 8.3: Page-by-page click-through**

```bash
npm run dev
```

Click every nav entry in the super-admin sidebar (24 entries). Each must:
- Render without console errors
- Look visually consistent (same brand tokens, same layout rhythm)
- Open detail drawers / modals without breaking
- Filter / search / sort still works

If any fails, file an inline fix commit.

- [ ] **Step 8.4: LOC report**

```bash
find src/app/super-admin -name page.tsx | xargs wc -l | tail -1
```

Compare to baseline (was ~19,629). Expected: 17,000-19,000 (5-15% reduction). If LOC INCREASED beyond ~21,000, something went wrong — likely a verbose Tailwind expansion. Investigate before merging.

- [ ] **Step 8.5: Push + PR**

```bash
git push -u origin refactor/super-admin-visual-upgrade
gh pr create --title "refactor(super-admin): visual upgrade — migrate 44 pages to admin-ui kit" --body "$(cat <<'EOF'
## Summary
- Migrates 44 sub-pages under `/super-admin/*` to the shared `admin-ui` kit (Plan 0)
- Replaces inline `style={S.*}` with Tailwind tokens across the panel
- Deletes legacy `admin-styles.ts` + primitive re-export shims
- Zero behavior change — pure visual + maintainability uplift

## Closes
Plan 6 of dashboard upgrade workstream.

## Test plan
- [x] Type-check + lint + test + build clean
- [x] Bundle: every super-admin page within P10 budget
- [x] Manual click-through: 24 nav entries × verify render + interactivity
- [x] LOC: <baseline (was 19,629), confirm reduction
- [x] Cross-check: empty + populated + loading + error states on the 6 high-traffic pages
EOF
)"
```

---

## Self-Review

**Spec coverage** vs the user's "upgrade" axes for super-admin:
- Visual: ✅ unified kit, consistent tokens
- Refactor: ✅ deletion of admin-styles.ts + shims
- Mobile: super-admin is desktop-only by design (operator panel) — out of scope
- Bilingual: AdminShell now bilingual (Plan 0). Per-page bilingual completeness is a separate audit not in scope here. Most super-admin pages are English-only by intent.
- Data viz: handled per-page where ad-hoc charts already existed.

**Placeholder scan:** No "TBD" — every step has either a literal command, a documented Recipe (Task 1), or a per-page reference. The cluster tasks list page names + a brief note rather than reproducing the Recipe 44 times. ✅

**Type consistency:** All migrations import the same admin-ui symbols; types come from `@/components/admin-ui` exclusively. ✅

**Dependencies:** Task 1 (recipe) is the spec for Tasks 2-6. Tasks 2-6 are independent of each other and can parallelize across multiple sessions. Task 7 (cleanup) depends on all of 2-6 complete. Task 8 is final.

**Risk items:**
- Some pages may have visualizations that don't map cleanly to `<LineChart>`/`<BarChart>`/`<DonutChart>` (e.g. heatmaps, treemaps, force-directed graphs). The Recipe says "leave as-is" — but if many pages have this, consider adding a `<HeatmapChart>` to admin-ui in a follow-up.
- The Recipe's Tailwind substitution table approximates the legacy `S.*` styles. Visual diffs of 1-2px are expected. The goal is parity-or-better, not pixel-identical.
- Cluster 1 has long pages — be patient, commit per-section, don't rush.

---

## Out of scope (intentional)

- New super-admin features. This is migration only.
- Page-level refactor (decompose 1305-LOC `command-center` into components). Plan 5-style decomposition is a separate concern; here we just swap primitives. If post-migration the pages still feel monolithic, schedule a per-page decomposition plan.
- Mobile responsiveness for super-admin. Operator panel — desktop-only by design.
- Bilingual completeness on every super-admin page. Operator-facing; English-only acceptable. Bilingual labels on the AdminShell sidebar were handled in Plan 0.
- Migrating the `_components/widgets/*` (LearnerHealth, PlatformHealth, etc.). Those are sub-components consumed by pages; if a page that uses them gets migrated and the widget still looks fine, leave the widget alone. If a widget visibly clashes (different colors / borders), open a follow-up commit specifically for that widget.
- Performance optimizations. If a page is slow, file a perf issue separately.
