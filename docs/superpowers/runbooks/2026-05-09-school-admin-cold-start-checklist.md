# School Admin Cold-Start Checklist (2026-05-09)

Manual QA pass for a brand-new tenant: zero classes, zero students, zero teachers, zero exams.
Code-level pre-audit completed by Plan 3 Task 4 — see "Code Audit Findings" below.

## Setup (for whoever runs this on staging)

1. In Supabase staging, create a new school via `/super-admin/institutions` (or `INSERT` directly):
   - Name: "Cold Start QA School"
   - Board: "CBSE"
   - tenant_type: "school"
2. Create a school_admin user via `/super-admin/users` and link them to the school.
3. Login as that school admin.

## Walk-through (target: every page renders without error and shows a humane empty state)

| # | URL | Expected on cold-start | Code-audit | Manual QA |
|---|---|---|---|---|
| 1 | `/school-admin` | Dashboard with zero stats; CTA to set up first | PASS — `recentActivity.length === 0` shows EmptyState; stats null-guarded by skeletons; quick-action tiles link to creation flows | ☐ |
| 2 | `/school-admin/setup` | Setup wizard renders | PASS — `if (!profile) return null;` guards null; loading + error states render skeletons; wizard always starts at Step 0 (no list to be empty) | ☐ |
| 3 | `/school-admin/students` | Empty list + "Invite first student" CTA | FAIL (P2): `students.length === 0` shows EmptyState with bilingual description ("Share an invite code…") but NO explicit CTA button — users must navigate manually to invite-codes page | ☐ |
| 4 | `/school-admin/teachers` | Empty list + "Invite first teacher" CTA | PASS — EmptyState with bilingual title/description AND primary "Invite Teacher" button that opens invite sheet (line 700-714) | ☐ |
| 5 | `/school-admin/classes` | Empty list + "Create first class" CTA | PASS — EmptyState with primary "Create Class" CTA opening modal (line 773-787) | ☐ |
| 6 | `/school-admin/parents` | Empty list (parents come via invite codes) | PASS — EmptyState explains parents auto-link upon signup; correct copy for the indirect creation flow; no fake CTA. (Task 1 already removed unshipped 'Coming soon' row.) | ☐ |
| 7 | `/school-admin/invite-codes` | Empty list + "Generate invite code" CTA | PASS — EmptyState with tab-aware copy (active vs all); generate CTA exists in header bar | ☐ |
| 8 | `/school-admin/announcements` | Empty list + "Create first announcement" CTA | PASS — Two empty states (Published / Drafts); Published has primary "+ Create Announcement" CTA (line 981-985) | ☐ |
| 9 | `/school-admin/exams` | Empty list + "Schedule first exam" CTA | PASS — Multiple EmptyStates per tab; both upcoming + all-exams branches have primary "+ Create Exam" CTA | ☐ |
| 10 | `/school-admin/content` | Empty list (or pre-populated common-content row) | PASS — EmptyState with dual "Add Question" / "Bulk Upload" CTAs (line 1517-1525); separate filtered-no-results state | ☐ |
| 11 | `/school-admin/reports` | Empty state — "Reports appear after exams complete" | PASS — Multiple targeted EmptyStates (subject, grade, class, student, gaps tabs); each tab gracefully renders with bilingual "Data will appear as students take quizzes" message | ☐ |
| 12 | `/school-admin/branding` | Form renders with default colors; logo upload works | PASS — Pure config form; no list, no empty state needed; defaults loaded from API; null-safe `data: BrandingResponse \| null` with skeleton fallback | ☐ |
| 13 | `/school-admin/modules` | Module list with default tenant-type enablements | PASS — Server returns full registry list with default+override flags; never empty for a valid tenant_type; flag-off banner handled | ☐ |
| 14 | `/school-admin/ai-config` | Config form with sensible defaults | PASS — Server returns AI_KEYS entries with defaults always present; no empty state needed; flag-off banner handled | ☐ |
| 15 | `/school-admin/api-keys` | Empty list + "Generate first key" CTA | PASS — `keys.length === 0` shows EmptyState with primary "Generate API Key" CTA (line 745-758) | ☐ |
| 16 | `/school-admin/audit-log` | Shows "school_admin logged in" entry only | PASS — `entries.length === 0` shows EmptyState with bilingual explainer; will normally have at least the login event | ☐ |
| 17 | `/school-admin/billing` | Free tier card + upgrade CTA | PASS — `seatSnapshots.length === 0` and `invoices.length === 0` both render dedicated EmptyStates; subscription card always renders with current plan | ☐ |
| 18 | `/school-admin/rbac` | Default role list (school_admin, teacher, etc.) | PASS — Three section EmptyStates (elevations / delegations / approvals); RBAC table itself comes pre-populated by server | ☐ |
| 19 | `/school-admin/enroll` | Enrollment widget renders | PASS — Step state machine starts at `'upload'`; CSV drop zone + "Maximum 200 rows, 5 MB" guidance always renders; no list to be empty | ☐ |

## Code Audit Findings

For each page that did NOT pass code audit, list the specific issue + line numbers.

**Pages that did not pass:**

- **`/school-admin/students` (P2)** — `src/app/school-admin/students/page.tsx:622-633`
  Empty state lacks an action button. Description says "Share an invite code so students can join your school." but there's no button linking to `/school-admin/invite-codes` or to a bulk upload flow. Users on cold-start see static text and must figure out the next step on their own.
  Fix in Task 5: add an `action` prop with a primary Button linking to `/school-admin/invite-codes` (or open a quick "Generate invite code" sheet inline). Match the pattern used in teachers page (line 700-714) and announcements page (line 981-985).

**No P0 (crashes) or P1 (fake placeholder data) issues found.** Risk-pattern grep returned zero `Array.fill` instances in the school-admin tree, and the only `rows[0]` access is in CSV header parsing in `enroll/page.tsx:206` (safe — not a list-render path).

**Cross-cutting strengths:**

- All 16 list-style pages share a consistent `EmptyState` component from `@/components/ui` with icon + bilingual title + bilingual description + optional action prop. This is the right primitive — the polish gap is purely "did the author pass an `action`?", not architectural.
- All pages use bilingual `t(isHi, en, hi)` helper for empty-state copy. Coverage is complete.
- Filtered-no-results states (search/filter-applied empty) are correctly distinguished from base-empty states on students, exams, and content pages, with "Clear filters" CTAs.
- Form-only pages (branding, modules, ai-config) correctly skip empty-state machinery — they're config surfaces with server-provided defaults.

## Severity Legend

- **P0 (block launch):** crash on cold-start
- **P1 (looks broken):** fake placeholder rows shown as real data
- **P2 (UX gap):** no empty-state CTA, user doesn't know what to do
- **P3 (cosmetic):** wrong/missing copy

## Output for Plan 3 Task 5

If the audit found any P0/P1/P2 items, list the pages that need empty-state polish — Task 5 will add CTAs/empty-state blocks per finding.

- `/school-admin/students` — add a primary "Generate invite code" CTA to the cold-start EmptyState (the existing description already names invite codes as the path forward; we just need the button).
