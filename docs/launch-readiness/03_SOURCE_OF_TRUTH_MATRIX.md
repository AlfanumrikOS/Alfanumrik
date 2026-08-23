# 03 — Source of Truth Matrix

**Status:** DRAFT — Phase 1. Per the launch mandate Section 6, this file establishes one authoritative owner
and write path per domain. Rows marked CONFIRMED are independently verified this session or in the prior
audit (and spot-checked); rows marked PENDING await recon-agent verification; rows marked **CONFLICT** are
known, currently-unresolved dual-write or dual-authority situations that must be resolved or explicitly risk-
accepted before this program can recommend launch.

| Domain | Intended canonical owner | Actual current state | Status |
|---|---|---|---|
| Identity & school membership | Supabase Auth + `students`/`teachers`/school tables | Believed sound per Cycle-1 audit (3-layer profile failsafe) | PENDING re-verification |
| Learner/class/teacher roster | ONE roster table | **`class_students` vs `class_enrollments`** — two tables, kept in sync by a trigger (migration `20260702030000_class_membership_softdelete_sync.sql`), neither dropped. `class_enrollments` is documented as "canonical-by-intent" per an ADR header, but `canAccessStudent`/`is_teacher_of` reads are not yet confirmed to exclusively use it. The DROP/cutover (TSB-4-cutover) is explicitly CEO-gated in `PRIORITY-BACKLOG.md`. | **CONFLICT — known, tracked, CEO-gated. Not something this program can silently resolve.** |
| Curriculum concepts/content versions | `cbse_syllabus`, `rag_content_chunks` | 27,778 chunks measured 2026-08-11 per root CLAUDE.md; `rag_status='ready'` requires chunk_count>=50 AND verified_question_count>=40 | PENDING re-verification this cycle |
| Assignments & submissions | Backend-owned tables + RPCs | Not yet independently inventoried this session | PENDING (backend recon) |
| Attempts & learning events | `atomic_quiz_profile_update()` RPC (single transaction, P1/P2/P4) | Believed sound; this RPC is explicitly the ONLY sanctioned write path per root CLAUDE.md P4 | PENDING spot-check |
| Learner-concept state (mastery) | `cognitive-engine.ts` + `cme-engine` Edge Function | **A prior pattern (SLC-1) found a second, uncapped XP writer (legacy trigger) alongside the canonical capped writer** — same CLASS of bug (two writers, no reconciliation) as the `payment_history.amount` dual-writer the orchestrator found today. Adaptive/Foxy recon agent explicitly tasked with checking whether CME has an analogous split-brain. | PENDING (ai-engineer recon) — **treat as a live hypothesis, not resolved** |
| Recommendations / Today queue | `daily-rhythm-orchestrator.ts` (SRS + ZPD + reflection) | `ff_pedagogy_v2_daily_rhythm` reported enabled globally per root CLAUDE.md, but the dashboard renderer that used to surface this was deleted in an "orphan consolidation" — current surface is `TodaysMission.tsx` off `/api/v2/today`. Whether SRS review-due actually reaches this NEW surface is **unconfirmed** | PENDING (ai-engineer recon) — **highest-priority item for Gate E** |
| BKT/DKT, IRT, CME, SRS contributions | Multiple modules, see `01_SYSTEM_INVENTORY.md` | `ff_irt_question_selection` reported "off until calibration accumulates" per root CLAUDE.md as of last doc update — if still OFF, IRT-based selection is not live for any student regardless of calibration quality | PENDING confirmation of current flag state |
| Foxy interactions & retrieval traces | `apps/host/src/app/api/foxy/route.ts` | P12 backstop (`screenStudentFacingText`) was restored by Cycle-4 of the prior audit after being found MISSING at the live cutover — this is exactly the kind of regression this program must not let recur silently | PENDING re-verification (ai-engineer recon) |
| School/teacher/parent analytics | Super-admin + parent/teacher portal read paths | PII-export admin-tier gate was found INVERTED by Cycle-6 (most sensitive export sat at LOWEST tier, SAO-1) — reported DONE 2026-06-29 (CEO-approved `super_admin` tier) | PENDING spot-check that this is still true |
| Subscriptions & entitlements | `student_subscriptions` + Razorpay webhook/verify RPCs | P11 split-brain risk closed via atomic RPCs (Cycle-2). **NEW finding (orchestrator, 2026-08-23): `payment_history.amount` has two writers (`verify/route.ts` = live DB lookup; `webhook/route.ts` = actual gateway-captured amount) racing on the same unique constraint — inconsistent semantics depending on which wins.** | **CONFLICT — newly found, not yet in any prior audit doc. Added to findings/task ledger.** |
| Feature flags & tenant configuration | `packages/lib/src/feature-flags.ts` + `flags/defaults.ts` | Multiple flags known OFF by default (`ff_school_pulse_v1`, `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, possibly `ff_irt_question_selection`) — each OFF flag means the corresponding capability is NOT live for any student today regardless of code quality | PENDING full current-state enumeration (ai-engineer + frontend recon) |
| Privileged audit events | `audit_logs` table + `logAdminAudit()` | God-node in the graphify knowledge graph built this session (424 edges) — heavily used, believed sound | PENDING spot-check |

## Rule going forward
Any NEW finding of a dual-writer / dual-authority pattern discovered during this program must be added as a
row here immediately, not just buried in `04_FINDINGS_AND_CONFLICTS.md` — this file is the one an engineer
opens first to answer "who actually owns this data."
