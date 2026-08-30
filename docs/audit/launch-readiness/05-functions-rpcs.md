# 05 — Functions, RPCs, Triggers & Views

**Audit date:** 2026-08-29
**Evidence source:** Grants agent (completed), RLS agent (completed), adaptive learning agent (completed)

---

## 1. Key RPCs

| RPC | Purpose | Security | Findings |
|-----|---------|----------|----------|
| `atomic_quiz_profile_update()` | Atomic quiz submission — attempt + mastery + XP in single transaction | Idempotency-keyed; anti-cheat; single canonical write path | P3 (DB-17): 4 overloads with inconsistent argument order |
| `calculate_next_review()` | SM-2 spaced repetition interval calculation | Server-side only (cron) | Clean |
| `compute_mrr_snapshot()` | Monthly recurring revenue calculation | **P2-05:** Executable by anon — should be admin-only | P2 |
| `match_rag_chunks_ncert()` | Vector similarity search for RAG retrieval | **P1-07:** EXECUTE granted to authenticated; all callers use service_role | P1 |
| `get_student_dashboard()` | Student dashboard data aggregation | RLS-enforced; student_id scoped | Clean |
| `get_teacher_class_report()` | Teacher class report data | RLS-enforced; school_id + teacher scoped | Clean |

## 2. Views

| Finding | Status |
|---------|--------|
| DB-1: 7 views bypassing RLS | **VERIFIED CLOSED** — independent behavioral probe confirmed fix |

Prior audit (FIX-LEDGER) identified 7 views that bypassed RLS because views execute with definer's privileges. The fix (migration 20260815000003) converted these to `SECURITY INVOKER` views. This audit independently verified the fix holds.

## 3. Triggers

Limited data — the full trigger inventory was not completed due to agent failures. Known triggers from cross-references:

| Trigger | Table | Purpose |
|---------|-------|---------|
| `on_auth_user_created` | `auth.users` | Post-signup role assignment and student profile creation |
| `on_quiz_attempt_insert` | `quiz_attempts` | Update mastery and award XP (deferred to RPC for atomicity) |
| `on_xp_transaction_insert` | `xp_transactions` | Update student XP total (deferred to RPC) |
| `state_events_notify` | `state_events` | Notify projector subscribers via LISTEN/NOTIFY |

## 4. Default Privileges

| Target | Granted to | Grants | Finding |
|--------|-----------|--------|---------|
| New public tables | anon, authenticated | INSERT, UPDATE, DELETE | P2-01: Over-permissive defaults |
| New public functions | anon, authenticated | EXECUTE | P2-02: Over-permissive defaults |
| New public sequences | anon, authenticated | USAGE | P2 (minor) |

These defaults mean every new table and function is automatically accessible to all users unless explicitly restricted. RLS policies provide the actual access control, but the grant layer should also be restrictive.

## 5. Data Gaps

- Full function/RPC inventory not completed (schema inventory agent failed)
- Full trigger inventory not completed
- Stored procedure analysis not completed

## 6. Gate Verdict

**CONDITIONAL GO** — Critical RPCs (quiz submission, spaced repetition) are well-designed. Grant hygiene needs remediation (Phase 1). View bypass fix is verified closed.
