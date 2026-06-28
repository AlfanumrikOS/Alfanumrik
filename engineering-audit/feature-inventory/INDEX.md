# Feature Inventory — Index

Canonical catalog of existing features/workflows by role. Built from a light
exploration of `src/app/` and `src/app/api/` on 2026-06-28. Route lists are confirmed;
**DB tables and APIs are best-effort and to be verified per cycle** during the MAP phase.

This inventory answers "what exists today" so the audit loop can decide "what is not
yet enterprise-grade".

## Catalog by role

| Role | File | Headline surfaces |
|---|---|---|
| Student | [`student.md`](./student.md) | dashboard, learn, quiz, progress, foxy, exams, leaderboard, dive, synthesis, simulations |
| Parent | [`parent.md`](./parent.md) | portal home, children, reports, messages, billing, consent, attendance, calendar, support |
| Teacher | [`teacher.md`](./teacher.md) | dashboard, classes, students, assignments, grade-book, attendance, reports, submissions, worksheets |
| School Admin | [`school-admin.md`](./school-admin.md) | dashboard, students, teachers, classes, enroll, reports, branding, rbac, billing, modules |
| Super Admin | [`super-admin.md`](./super-admin.md) | control room, users, institutions, content, grounding/AI-quality, flags, analytics, observability, marking-integrity, support |
| Cross-cutting | [`cross-cutting.md`](./cross-cutting.md) | auth/onboarding, bilingual i18n, RLS/RBAC, feature flags, notifications, bundle/perf, mobile |

## Status legend

- **complete** — works end-to-end, no obvious gaps found in light pass.
- **partial** — core path works; edge/empty/error states or depth unverified.
- **stub** — page/route exists but thin or placeholder.
- **to verify** — existence noted; behavior not yet inspected (most entries until MAP).

## Confirmed route counts (2026-06-28 light pass)

- `src/app/**/page.tsx`: 177 page files matched.
- `src/app/api/**/route.ts`: 360 API route files matched.
- Super-admin pages: ~70+ under `src/app/super-admin/` (far beyond the 12 in the ops
  charter — the admin surface has grown; reconcile during the Super-Admin cycle).

> Counts are point-in-time from Glob. Re-confirm during each workflow's MAP phase.
