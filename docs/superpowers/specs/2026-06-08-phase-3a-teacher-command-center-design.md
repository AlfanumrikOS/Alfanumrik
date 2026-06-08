# Phase 3A — Teacher Professional Depth: The Class Command Center

- **Date:** 2026-06-08
- **Status:** Approved (design) — pending implementation plan
- **Owners:** frontend (Command Center UI) · backend (Edge Function + routes) · assessment (remediation correctness) · architect (schema/RLS) · ai-engineer (remediation reuse)
- **Relates to:** `2026-06-06-consumer-minimalist-redesign-design.md` (§5 Teacher, §9 Phase 3). This is the **teacher** track of Phase 3. School/Admin (3B) and White-Label (3C) follow as their own spec→plan cycles, in that order.

## 1. Context & Motivation

The original system-design brief was *"minimalistic mobile for students and parents; **detailed design for teachers and schools**."* Phases 1–2 delivered the consumer half (consumer minimalism + mobile parity). Phase 3 is the professional half. Per the user's decision it is sequenced **3A Teacher → 3B School/Admin → 3C White-Label**.

The teacher surface is **not greenfield**. `main` already has 12 teacher pages, 13 teacher routes, and a rich `teacher-dashboard` Edge Function exposing `get_dashboard`, `get_heatmap`, `get_alerts`, `resolve_alert`, `launch_poll`/`close_poll`, `get_class_overview`, `get_student_report`, `get_class_trends`, `get_students_list`, plus a gradebook (subject + attendance columns, score-override, CSV export). Classes/rosters already exist, so 3A does **not** depend on 3B's provisioning.

The gap is the **action layer**: the "detect" side (heatmap, alerts, trends) exists, but the "act" loops are shallow or scattered across 12 tabs. **3A completes the action layer and unifies it behind a Class Command Center.** For teachers, *density is the feature* — the opposite of consumer minimalism.

## 2. Goals & Non-Goals

**Goals**
- A single, dense, desktop-first **Class Command Center** that is the teacher's daily driver: detect → act → verify in one place.
- Four first-class action loops, sequenced as waves: **A** Alert→Remediation, **B** Assignment lifecycle, **C** Gradebook+reporting depth, **D** Parent comms.
- Reuse and deepen the existing teacher systems rather than rebuild them.

**Non-Goals (explicit scope boundaries)**
- **No** Flutter/mobile teacher app — desktop-first web only.
- **No** school-admin provisioning, bulk teacher/student CSV, or seat enforcement — that is **3B**; 3A uses today's class/roster mechanism.
- **No** white-label `tenant_type` copy/branding variants — that is **3C**.
- Attendance stays the existing optional feature; not expanded.
- No new scoring/XP math — quiz-based work reuses the existing P1/P2 engine verbatim.

## 3. Architecture: the Command Center

`/teacher` becomes the **Command Center home**, scoped by a **class switcher** in the header (the teacher chooses which class the surface is scoped to). It composes four panels, all fed by the existing `teacher-dashboard` Edge Function:

1. **Roster mastery heatmap** (concept × student) — `get_heatmap`.
2. **At-risk alerts rail** — `get_alerts`, now *actionable* (each alert exposes the action bar).
3. **Today summary** — submissions awaiting grading · assignments due today · unresolved alerts · active poll status.
4. **Action bar** — the launch point for the four loops (assign remediation, open grading queue, message parent, open gradebook).

The Command Center consolidates the **entry point**, not the deep tools. The existing rich pages remain as **deep-dive destinations linked from the Command Center**, not rebuilt.

## 4. Information architecture / navigation

Top-level teacher nav slims from 12 scattered tabs to **five**:

- **Command Center** (home; was `/teacher`)
- **Gradebook** (`/teacher/grade-book`)
- **Assignments** (`/teacher/assignments`, incl. `[id]` detail + submissions/grading queue)
- **Messages** (`/teacher/messages`)
- **Reports** (`/teacher/reports`)

Existing pages that become sub-destinations rather than top-level tabs: `students`, `submissions`, `worksheets`, `classes`, `lab-leaderboard`, `profile`, `onboarding`. They keep their routes (no dead links) but move out of primary nav; the Command Center and the five sections link into them. `onboarding` and `profile` remain reachable from an account menu.

## 5. The four action loops (waves)

### Wave A — Alert → Remediation (the spine)
The differentiator: a dashboard that **acts**, not just reports.

- Each at-risk alert (struggling student / weak concept derived from the heatmap) exposes a one-tap **"Assign remediation."**
- This creates a **teacher-assigned remediation task** on the exact weak concept, which surfaces in that **student's Today queue** tagged *"from your teacher,"* reusing the student-side remediation engine (Pedagogy v2 wrong-answer remediation / targeted practice). Integration point: the student Today resolver (`resolveTodayQueue()` / daily-rhythm orchestrator) gains a **high-priority branch** that surfaces pending teacher-assigned tasks ahead of the routine SRS/ZPD slots.
- The alert then tracks **assigned → in progress → resolved**: it advances as the student completes the task and the underlying concept mastery lifts (re-using the existing mastery/BKT signal).
- Backend: extend the `teacher-dashboard` Edge Function with an `assign_remediation` action; new table `teacher_remediation_assignments`.

### Wave B — Assignment lifecycle
Complete the end-to-end loop on top of the existing assignments/submissions surface:
- assign (exists) → student submits → teacher **grades with exception review** (flag anomalies; AI-assist suggestions where the item type supports it) → **return with feedback**.
- The Command Center "Today summary" surfaces *"N submissions awaiting grading"* → one-tap into the **grading queue** (new Edge action `get_grading_queue`).
- Quiz-based assignments reuse the existing quiz scoring; worksheet/non-MCQ items use manual grading + the existing score-override path.

### Wave C — Gradebook + reporting depth
Deepen the existing gradebook (which already has subject/attendance columns, score-override, CSV):
- add **mastery + Bloom's** dimensions (not just raw scores), per student and per class.
- parent-ready **report export** (reuses the existing report generator where possible).
- heatmap cell → student **gradebook detail** drill-through.

### Wave D — Parent comms
Extend the existing messages/threads:
- teacher ↔ parent threaded messaging **with attachments** (e.g., a student report).
- tie into Wave A: when remediation resolves, offer a one-tap **"tell the parent,"** connecting to the Phase 1/2 parent glance/Encourage surfaces.

## 6. Data model & reuse

**Reuse-first.** Extend, don't rebuild:
- `teacher-dashboard` Edge Function: add `assign_remediation` and `get_grading_queue` actions.
- Existing routes under `src/app/api/teacher/*` (assignments, classes, messages, students/notes) are extended for the lifecycle + comms loops.

**New table — `teacher_remediation_assignments`** (the only new schema in 3A):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `teacher_id` | uuid | the assigning teacher |
| `student_id` | uuid | target student (must be on the teacher's roster) |
| `class_id` | uuid | scoping |
| `concept` / `chapter_id` | text/uuid | the weak concept being remediated (string grade context per P5) |
| `source_alert_id` | uuid null | the alert that spawned it (nullable for manual assignment) |
| `status` | text | `assigned` → `in_progress` → `resolved` (+ `dismissed`) |
| `created_at` / `resolved_at` | timestamptz | |

RLS in the same migration: teacher sees/writes only rows for their own roster; the student sees only their own assigned tasks (read). Service role for the orchestrator join.

## 7. Invariants, RBAC, RLS, privacy

- **P8 RLS:** every teacher read/write is scoped teacher ↔ their class roster. The new table ships with RLS + policies in its migration.
- **P9 RBAC:** every route uses `authorizeRequest('permission.code')`. Add `class.assign_remediation` (user-approval gate per the constitution's "RBAC permission additions" rule — flag in the plan).
- **P5:** grades are strings end-to-end.
- **P7:** the teacher Command Center UI is bilingual (Hi/En) via `AuthContext.isHi`.
- **P13:** no PII in logs or CSV/report exports beyond what the teacher is entitled to for their own roster.
- **P1/P2:** teacher-assigned remediation runs as a normal student quiz/practice — same scoring, daily XP cap, and **anti-cheat (P3)** rules; no teacher path bypasses them.

## 8. Testing strategy

- **E2E (the spine):** teacher opens Command Center → alert → "Assign remediation" → student sees the task in Today → completes it → alert advances to resolved.
- **Unit:** the new Edge actions (`assign_remediation`, `get_grading_queue`); the Today-resolver high-priority branch; gradebook mastery/Bloom aggregation.
- **RLS:** teacher cannot assign to / read a student outside their roster; student cannot read another student's assignment.
- **Regression catalog:** one entry for the teacher detect→act→verify loop (RLS boundary + the no-XP-bypass guarantee).

## 9. Phased rollout

Waves ship in order, each behind a feature flag (default OFF), each its own PR through the standard review chain (builder → testing → quality):
- **Wave A** — Command Center shell + Alert→Remediation spine (the headline; ships first because it's the differentiator and the heatmap/alerts data already exists).
- **Wave B** — Assignment lifecycle + grading queue.
- **Wave C** — Gradebook + reporting depth.
- **Wave D** — Parent comms.

The Command Center shell lands with Wave A and is progressively enriched by B/C/D's action-bar entries.

## 10. Open questions / decisions for the plan

These have a chosen default; confirm or adjust during plan-writing:
1. **Remediation task type** — default: reuse the student wrong-answer-remediation/targeted-practice item (smallest, highest-reuse) rather than a full assignment. Confirm with assessment.
2. **`class.assign_remediation` permission** — RBAC additions need user approval per the constitution; the plan will surface it as an approval gate before the migration lands.
3. **Alert "resolved" signal** — default: resolved when the assigned task is completed AND the concept's mastery crosses the existing at-risk threshold upward; fallback to manual resolve.
4. **Flag names** — `ff_teacher_command_center`, `ff_teacher_alert_remediation`, etc. (default OFF).

## 11. Out of scope (handled by later Phase 3 specs)

- **3B (School/Admin):** org→school→class hierarchy, bulk teacher/student CSV provisioning, seat enforcement.
- **3C (White-Label):** `tenant_type` copy variants (class→batch/course), branding, flipping dormant white-label flags.
