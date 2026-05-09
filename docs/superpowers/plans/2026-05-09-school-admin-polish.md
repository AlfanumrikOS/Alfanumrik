# School Admin Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Pre-requisite:** None strictly required, but easier after Plan 0 (admin-ui kit) is merged so empty-state polish can use shared primitives.

**Goal:** Close the three remaining UI stubs in `/school-admin/*` and verify every one of the 19 pages works for an empty new tenant (cold-start UX). This is what the master roadmap calls Phase 3.

**Architecture:** No new components or files. Surgical edits to `parents/`, `exams/`, `students/` pages plus a manual cold-start audit walkthrough captured as a markdown checklist.

**Tech Stack:** Next.js 16 App Router, existing school-admin primitives.

**Solo-developer estimate:** ~0.5 working day. Half a session of edits, half a session of cold-start clicking.

---

## Audit findings (verified 2026-05-09)

Confirmed live in canonical (`C:\Users\Bharangpur Primary\Alfanumrik\`):

| Location | Code | Decision needed |
|---|---|---|
| `src/app/school-admin/parents/page.tsx:986` | `{t(isHi, 'Coming soon', 'जल्द आ रहा है')}` badge | Ship the feature OR feature-flag the row |
| `src/app/school-admin/exams/page.tsx:400` | `onClick={() => {/* View results - placeholder */}}` | Wire to `/school-admin/reports?examId=…` |
| `src/app/school-admin/exams/page.tsx:1312` | Same stub pattern, second occurrence | Same fix |
| `src/app/school-admin/students/page.tsx:302` + `:558` | `setToastMsg(t(isHi, 'Coming soon', '...'))` | Identify the action behind it; ship or hide |

Two of the three stubs ("Coming soon" badges) tell users a feature isn't ready. The exam stubs are worse — buttons that look functional but do nothing. Worst-impression-per-pixel goes to those, so we fix exams first.

---

## File Structure

**Modify:**
- `src/app/school-admin/exams/page.tsx` (lines ~400, ~1312) — wire two "View results" buttons
- `src/app/school-admin/parents/page.tsx` (line ~986) — ship/flag/delete decision
- `src/app/school-admin/students/page.tsx` (lines ~302, ~558) — ship/flag/delete decision
- (Possibly) `src/app/school-admin/reports/page.tsx` — accept new `examId` query param if not already supported

**Create (only if cold-start audit reveals gaps):**
- Empty-state additions in any school-admin sub-page that crashes or looks broken on a tenant with zero classes/students/teachers/exams

**Create:**
- `docs/superpowers/runbooks/2026-05-09-school-admin-cold-start-checklist.md` — one-time checklist (or convert to recurring QA item)

---

## Pre-flight

- [ ] **Step 0.1: Green baseline + branch**

```bash
npm run type-check && npm run lint && npm test -- --run
git checkout main && git pull
git checkout -b fix/school-admin-polish
```

- [ ] **Step 0.2: Verify the line numbers cited in this plan still match canonical**

```bash
grep -n "Coming soon" src/app/school-admin/parents/page.tsx
grep -n "View results" src/app/school-admin/exams/page.tsx
grep -n "Coming soon" src/app/school-admin/students/page.tsx
```

If any line drifted, update the references in the steps below before proceeding. The sed-based edits below assume the strings, not the line numbers.

---

## Task 1: Wire exam "View results" buttons (highest-impact fix)

Two `onClick={() => {/* View results - placeholder */}}` stubs in `exams/page.tsx`. Both should route to the existing reports page.

**Files:**
- Modify: `src/app/school-admin/exams/page.tsx`
- (Possibly) Modify: `src/app/school-admin/reports/page.tsx`

- [ ] **Step 1.1: Read both occurrences in context**

```bash
sed -n '390,410p' src/app/school-admin/exams/page.tsx
sed -n '1305,1320p' src/app/school-admin/exams/page.tsx
```

For each: identify the surrounding `<button>` and capture the exam ID variable in scope. Most likely the iteration variable is `exam` or `e` — use whatever's there.

- [ ] **Step 1.2: Verify reports page accepts an examId param**

```bash
grep -n "useSearchParams\|examId\|exam_id" src/app/school-admin/reports/page.tsx | head -10
```

If the reports page already reads `examId` from the query string, skip Step 1.3. If not, the wiring still works (the report page just shows the default tab) — link param is informational. Ideal: page reads `examId` and pre-filters to that exam.

- [ ] **Step 1.3 (conditional): Add examId support to reports**

If absent in reports, add this near the top of the reports page component:

```tsx
import { useSearchParams } from 'next/navigation';
// ...
const searchParams = useSearchParams();
const initialExamId = searchParams?.get('examId') || null;
const [filterExamId, setFilterExamId] = useState<string | null>(initialExamId);
```

Then wire `filterExamId` into whatever filter UI exists. If no exam-specific filter exists, just leave `initialExamId` documented for a future refactor — the link still works as plain navigation.

- [ ] **Step 1.4: Replace both stubs**

Use a router push instead of an empty arrow. At line ~400:

```tsx
// Before:
<button onClick={() => {/* View results - placeholder */}} ...>

// After:
<button onClick={() => router.push(`/school-admin/reports?type=exam&examId=${exam.id}`)} ...>
```

Match the same pattern at line ~1312 (variable name may differ — likely `e.id` or `examRow.id`).

If `router` isn't already imported in the file:

```tsx
import { useRouter } from 'next/navigation';
// inside component:
const router = useRouter();
```

- [ ] **Step 1.5: Smoke test**

```bash
npm run dev
```

Login as school-admin. Open `/school-admin/exams`. Click any "View results" button. Verify it navigates to `/school-admin/reports?type=exam&examId=<some-id>` and the page loads without error.

- [ ] **Step 1.6: Commit**

```bash
git add src/app/school-admin/exams/page.tsx src/app/school-admin/reports/page.tsx
git commit -m "fix(school-admin): wire exam 'View results' buttons to reports route"
```

---

## Task 2: Decide on parents/page.tsx:986 "Coming soon" badge

**Files:**
- Read: `src/app/school-admin/parents/page.tsx` around line 986
- Modify: `src/app/school-admin/parents/page.tsx`

- [ ] **Step 2.1: Identify what the badge gates**

```bash
sed -n '975,1000p' src/app/school-admin/parents/page.tsx
```

What feature row sits above/around the "Coming soon" badge? Likely candidates:
- Bulk parent invites
- Parent communication channel (would clash with the deferred parent↔teacher messaging plan)
- Parent app PWA install banner
- Parent-side report opt-in

Decide one of:

(A) **Ship now** — if the underlying feature is actually wired up server-side and only the UI label is missing.

(B) **Feature-flag** — wrap the row in `useFeatureFlag('ff_school_parent_<feature>_v1')` so it's hidden by default but can be toggled on per-tenant. Add the flag to `feature_flags` table via migration if needed.

(C) **Delete** — if the feature has no concrete plan, removing the visual stub is more honest than promising "coming soon" indefinitely.

Default recommendation when uncertain: **(C) delete the row + commit a follow-up issue**. "Coming soon" with no ship date erodes B2B trust.

- [ ] **Step 2.2: Apply the decision**

If (A): replace the badge + wire the button. Code depends on the feature.

If (B): wrap the row in a flag check:

```tsx
import { useFeatureFlag } from '@/lib/feature-flags';
// ...
const showParentInvites = useFeatureFlag('ff_school_parent_invites_v1');
// ...
{showParentInvites && (
  <div /* the existing row */>
    {/* drop the "Coming soon" badge — flag implies it's available */}
  </div>
)}
```

If (C): delete the entire feature-row block. Note in commit message what was removed and link to a tracking issue (open one if absent).

- [ ] **Step 2.3: Commit with rationale**

```bash
git add src/app/school-admin/parents/page.tsx
# Pick whichever fits the decision:
git commit -m "fix(school-admin): remove 'Coming soon' parents row (delete-pending-feature-spec)"
# OR
git commit -m "feat(school-admin): ship parents row behind ff_school_parent_invites_v1 flag"
# OR
git commit -m "feat(school-admin): wire parents row to <real backend>"
```

---

## Task 3: Decide on students/page.tsx:558 "Coming soon" toast

**Files:**
- Read: `src/app/school-admin/students/page.tsx` around lines 302 + 558
- Modify: `src/app/school-admin/students/page.tsx`

- [ ] **Step 3.1: Identify what action triggers the toast**

```bash
sed -n '550,565p' src/app/school-admin/students/page.tsx
```

What user action calls `setToastMsg(t(isHi, 'Coming soon', '...'))`? Likely candidates:
- "Bulk import students" CSV
- "Send password reset" individual action
- "Move student to another class" bulk action
- "Generate report card" individual action

Several of these actions exist real elsewhere in the codebase — verify before deleting:

```bash
grep -rn "bulk_upload\|password_reset\|move_to_class" src/app/api/school-admin/ | head -10
```

If a backend exists, the UI is the only gap — wire it (decision A). If no backend, the action either gets feature-flagged (B) or removed (C).

- [ ] **Step 3.2: Apply same decision matrix as Task 2**

(A) Wire to existing API
(B) Feature-flag the button
(C) Remove the button + the `Coming soon` toast logic

Default: (C) when in doubt.

- [ ] **Step 3.3: Cleanup unused state if removed**

If the action and its toast are removed, the `toastMsg` state at line 302 may be unused. Type-check + lint will flag. Remove the state, the setter, and the toast renderer if so.

- [ ] **Step 3.4: Commit**

```bash
git add src/app/school-admin/students/page.tsx
git commit -m "fix(school-admin): resolve students 'Coming soon' toast — <action taken>"
```

---

## Task 4: Cold-start tenant audit

Create a fresh school in staging, log in as that school's admin, click every nav entry. Document any breakage.

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-09-school-admin-cold-start-checklist.md`

- [ ] **Step 4.1: Create the checklist file**

`docs/superpowers/runbooks/2026-05-09-school-admin-cold-start-checklist.md`:

```markdown
# School Admin Cold-Start Checklist (2026-05-09)

Manual QA pass for a brand-new tenant: zero classes, zero students, zero teachers, zero exams.

## Setup

1. In Supabase staging, create a new school via `/super-admin/institutions` (or `INSERT` directly):
   - Name: "Cold Start QA School"
   - Board: "CBSE"
   - tenant_type: "school"
2. Create a school_admin user via `/super-admin/users` and link them to the school.
3. Login as that school admin.

## Walk-through (target: every page renders without error and shows a humane empty state)

| # | URL | Expected on cold-start | Result |
|---|---|---|---|
| 1 | `/school-admin` | Dashboard with zero stats; CTA to set up first | ☐ |
| 2 | `/school-admin/setup` | Setup wizard renders | ☐ |
| 3 | `/school-admin/students` | Empty list + "Invite first student" CTA | ☐ |
| 4 | `/school-admin/teachers` | Empty list + "Invite first teacher" CTA | ☐ |
| 5 | `/school-admin/classes` | Empty list + "Create first class" CTA | ☐ |
| 6 | `/school-admin/parents` | Empty list (parents come via invite codes) | ☐ |
| 7 | `/school-admin/invite-codes` | Empty list + "Generate invite code" CTA | ☐ |
| 8 | `/school-admin/announcements` | Empty list + "Create first announcement" CTA | ☐ |
| 9 | `/school-admin/exams` | Empty list + "Schedule first exam" CTA | ☐ |
| 10 | `/school-admin/content` | Empty list (or pre-populated common-content row) | ☐ |
| 11 | `/school-admin/reports` | Empty state — "Reports appear after exams complete" | ☐ |
| 12 | `/school-admin/branding` | Form renders with default colors; logo upload works | ☐ |
| 13 | `/school-admin/modules` | Module list with default tenant-type enablements | ☐ |
| 14 | `/school-admin/ai-config` | Config form with sensible defaults | ☐ |
| 15 | `/school-admin/api-keys` | Empty list + "Generate first key" CTA | ☐ |
| 16 | `/school-admin/audit-log` | Shows "school_admin logged in" entry only | ☐ |
| 17 | `/school-admin/billing` | Free tier card + upgrade CTA | ☐ |
| 18 | `/school-admin/rbac` | Default role list (school_admin, teacher, etc.) | ☐ |
| 19 | `/school-admin/enroll` | Enrollment widget renders | ☐ |

## What to flag

For each page that fails:
- Crash → file as a P0 bug (block launch)
- Empty data shown as fake placeholders → file as P1 (looks broken)
- No empty state CTA → file as P2 (user doesn't know what to do)
- Incorrect copy → file as P3 (cosmetic)

For each page that passes: tick the checkbox.

## Output

Capture screenshots of all 19 pages (cold-start state). Attach to the PR description for Plan 3. The pre-launch sales team uses these to demo "what a school sees on day 1."
```

- [ ] **Step 4.2: Walk through the checklist on staging**

Allocate ~30 minutes. Click every URL. Tick boxes. Take screenshots. Note any failures inline in the checklist file.

- [ ] **Step 4.3: Create follow-up tickets for failures**

For each P0/P1/P2 found, either:
- Fix in this same Plan 3 (if it's a one-line empty-state addition)
- Open a GitHub issue with the failing-state screenshot, labeled `school-admin-cold-start`

Do NOT silently leave broken cold-start pages. If a page can't be fixed in <30min, file the issue.

- [ ] **Step 4.4: Commit the checklist (with results)**

```bash
git add docs/superpowers/runbooks/2026-05-09-school-admin-cold-start-checklist.md
git commit -m "docs(school-admin): cold-start checklist — 19 pages × empty tenant"
```

---

## Task 5: Inline empty-state polish (only if Task 4 found gaps)

For each page Task 4 found broken on cold-start, add an empty state inline.

**Files:** vary per finding.

- [ ] **Step 5.1: For each failing page, add an empty state**

Pattern (using the Plan 0 admin-ui kit if available):

```tsx
{data.length === 0 ? (
  <div className="rounded-lg border border-dashed border-surface-3 bg-surface-2/50 p-8 text-center">
    <div className="text-4xl mb-3">📚</div>
    <p className="text-sm font-medium text-foreground">
      {t(isHi, 'No classes yet', 'अभी तक कोई कक्षा नहीं')}
    </p>
    <p className="mt-1 text-xs text-muted-foreground">
      {t(isHi,
        "Create your school's first class to get started.",
        'शुरू करने के लिए अपने स्कूल की पहली कक्षा बनाएं।')}
    </p>
    <button onClick={() => /* open create modal */} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
      {t(isHi, 'Create class', 'कक्षा बनाएं')}
    </button>
  </div>
) : (
  /* existing list rendering */
)}
```

- [ ] **Step 5.2: Repeat for each failing page**

- [ ] **Step 5.3: Re-run cold-start checklist; tick now-passing rows**

- [ ] **Step 5.4: Commit per-page**

```bash
git add src/app/school-admin/<page>/page.tsx
git commit -m "fix(school-admin): empty-state CTA on <page> for cold-start tenants"
```

---

## Task 6: Final validation + PR

- [ ] **Step 6.1: Full local checks**

```bash
npm run type-check
npm run lint
npm test -- --run
npm run build
```

- [ ] **Step 6.2: Git grep for any remaining "Coming soon" in school-admin**

```bash
grep -rn "Coming soon\|coming soon" src/app/school-admin/
```

Should return empty. Any remaining hits = a stub Task 2/3 missed.

- [ ] **Step 6.3: Confirm no `placeholder` arrow stubs remain**

```bash
grep -rn "/\* .* placeholder \*/" src/app/school-admin/
```

Should return empty (the input `placeholder=` attributes are HTML, not stubs — those are fine).

- [ ] **Step 6.4: Push + PR**

```bash
git push -u origin fix/school-admin-polish
gh pr create --title "fix(school-admin): polish — close 3 UI stubs + cold-start audit" --body "$(cat <<'EOF'
## Summary
- Wire 2 'View results' stub buttons in `school-admin/exams` to the reports page
- Resolve 'Coming soon' badge in `school-admin/parents` (ship/flag/delete per investigation)
- Resolve 'Coming soon' toast in `school-admin/students` (ship/flag/delete per investigation)
- Add cold-start tenant runbook + walk-through results
- Add any empty-state CTAs surfaced by cold-start audit

## Closes
Phase 3 of `2026-05-07-multi-role-launch-completion.md`.

## Test plan
- [x] No "Coming soon" / "placeholder" stubs remain in `src/app/school-admin/`
- [x] All 19 school-admin pages render without crashing on a fresh tenant
- [x] Each cold-start checklist row passes or has an open follow-up issue linked
- [x] Screenshots of 19 pages attached
EOF
)"
```

---

## Self-Review

**Spec coverage** vs `2026-05-07-multi-role-launch-completion.md` Phase 3:
- Step 3.1 (`git grep "Coming soon"` + decide) ✅ Tasks 2+3 + Step 6.2
- Step 3.2 (wire exam "View results") ✅ Task 1
- Step 3.3 (cold-start fresh school audit) ✅ Task 4
- Step 3.4 (polish cold-start breakages) ✅ Task 5

**Placeholder scan:** every step has either complete code, a literal grep command, or a documented decision matrix (ship/flag/delete) that the executor applies. No "TBD." ✅

**Type consistency:** No new types introduced; only edits to existing pages. ✅

**Dependencies:** Tasks 1, 2, 3 are independent and can ship as separate commits/PRs if desired. Task 4 depends on staging access. Task 5 only runs if Task 4 found breakage.

**Risk items:**
- Task 2 + Task 3 are decision-driven, not code-driven. Executor must investigate the underlying feature before picking ship/flag/delete. Default (C) is the safe choice when uncertain.
- Task 4 requires staging access + a school_admin login. If staging is down, defer the audit to a separate session and mark as `[ ]` for follow-up.
- Task 1.3 makes a small enhancement to `school-admin/reports` — verify it doesn't conflict with anything else mid-flight there.

---

## Out of scope (intentional)

- New features in school-admin. This is a polish plan, not a feature plan.
- Visual upgrade of school-admin pages. That's covered indirectly when Plan 0's admin-ui kit lands and pages migrate to it. Not Plan 3's job to migrate.
- Migration of existing school-admin pages to the admin-ui kit. Plan 6's territory (or a separate "migrate-school-admin-to-kit" plan).
- Performance optimization. The 1000+ line school-admin pages need refactor — but that's not P3 scope.
