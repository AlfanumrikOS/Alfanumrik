# Phase 3A Implementation Plan — Teacher Command Center

- **Spec:** `docs/superpowers/specs/2026-06-08-phase-3a-teacher-command-center-design.md`
- **Date:** 2026-06-08
- **Sequencing:** Waves ship in order A → B → C → D, each its own PR through the review chain (builder → testing → quality), each behind a feature flag (default OFF). This plan details **Wave A**; B/C/D are outlined and will be expanded into step lists when their turn comes.

## Conventions
- Path alias `@/*` → `src/*`. Three Supabase clients (client / server / admin) used per their boundaries.
- Every new table ships RLS + policies in the same migration. Every API route uses `authorizeRequest('permission.code')`.
- No new scoring/XP math: quiz-based teacher work reuses the existing P1/P2 engine and the student anti-cheat (P3) path verbatim.
- Bilingual (P7) on all new teacher UI via `AuthContext.isHi`.

## Wave A — Command Center shell + Alert→Remediation (the spine)

### A1 — Schema + RBAC (architect)
- Migration: `teacher_remediation_assignments` (id, teacher_id, student_id, class_id, chapter_id/concept, source_alert_id nullable, status enum assigned|in_progress|resolved|dismissed, created_at, resolved_at). RLS in the same migration: teacher reads/writes only rows where the student is on the teacher's roster (reuse the existing teacher↔roster relationship); student reads only their own rows; service role for the orchestrator join. Indexes on (teacher_id, status) and (student_id, status).
- Add RBAC permission `class.assign_remediation` granted to the teacher role. NOTE: RBAC permission additions require user approval per the constitution — surface this in the PR description as an explicit approval item (the /goal directive authorizes proceeding; still flag it for visibility).

### A2 — Backend (backend)
- Extend the `teacher-dashboard` Edge Function: new action `assign_remediation` (input: student_id, chapter_id/concept, source_alert_id?) that inserts a `teacher_remediation_assignments` row (status=assigned) after verifying the student is on the caller's roster; and surfaces remediation status back through `get_alerts`/`get_dashboard` (alert shows assigned/in_progress/resolved).
- Add Next.js route `POST /api/teacher/remediation` (authorizeRequest('class.assign_remediation')) as the Command Center's call path; and a read path for the teacher's remediation list. Reuse existing teacher auth/roster helpers.

### A3 — Student integration (assessment defines correctness; ai-engineer implements)
- The student Today resolver (`resolveTodayQueue()` / daily-rhythm orchestrator) gains a **high-priority branch**: if the student has a `teacher_remediation_assignments` row with status in (assigned, in_progress), surface it as the top Today item, tagged "from your teacher", reusing the existing wrong-answer-remediation / targeted-practice item for the concept. On completion, flip the row to resolved (or in_progress→resolved when mastery crosses the at-risk threshold upward). No change to scoring/XP/anti-cheat — it runs as a normal student quiz/practice.

### A4 — Command Center UI (frontend)
- `/teacher` becomes the Command Center home behind `ff_teacher_command_center` (default OFF; old dashboard remains when OFF). Panels: roster mastery heatmap (get_heatmap), at-risk alerts rail (get_alerts) with a one-tap "Assign remediation" action calling `/api/teacher/remediation`, today summary, action bar. Class switcher in the header.
- Slim teacher primary nav to five (Command Center · Gradebook · Assignments · Messages · Reports); keep all existing routes reachable (no dead links) via the account menu / in-page links. Bilingual (P7). Loading/empty/error states.

### A5 — Tests (testing)
- E2E (the spine): teacher Command Center → alert → Assign remediation → student sees the task in Today → completes → alert advances to resolved. Unit: the `assign_remediation` Edge action + the Today-resolver branch. RLS: teacher cannot assign to / read a non-roster student; student cannot read another student's row. One regression-catalog entry (teacher detect→act→verify loop: RLS boundary + no-XP-bypass).

### A6 — Gate (quality)
- type-check / lint / build / bundle; review chain complete (architect+backend+assessment+ai-engineer+frontend+testing); verdict; merge when CI green.

## Wave B — Assignment lifecycle (outline)
Complete assign → submit → grade-with-exception-review → return-with-feedback on the existing assignments/submissions surface; new Edge action `get_grading_queue`; Command Center "N awaiting grading" → grading queue. Behind `ff_teacher_assignment_lifecycle`.

## Wave C — Gradebook + reporting depth (outline)
Add mastery + Bloom's dimensions to the existing gradebook; parent-ready report export; heatmap cell → student gradebook drill-through. Behind `ff_teacher_gradebook_depth`.

## Wave D — Parent comms (outline)
Extend messages/threads to teacher↔parent with attachments; one-tap "tell the parent" on remediation resolve, connecting to the Phase 1/2 parent glance/Encourage surfaces. Behind `ff_teacher_parent_comms`.

## Review chains (per change)
- Schema/RLS/RBAC → architect (backend, frontend, ops, testing review).
- Learner-state integration (Today resolver) → assessment (rules) + ai-engineer (impl); frontend + testing review.
- Teacher pages → frontend (ops, testing review).
- Each wave → testing then quality before merge.
