# 25 — Revised Remediation Roadmap

**Status:** PROPOSED — supersedes `19-remediation-roadmap.md` for Phase 0 items only (Phases 1-8 of the original roadmap remain valid and are not repeated here). Awaiting separate CEO approval before any execution.
**Scope change from `19-remediation-roadmap.md`:** Formal DPDPA compliance items (age gate, consent engine, DPAs, consent dashboards — previously 0.x items referencing P-07/P-10/P-11) are **removed from this roadmap entirely** per the CEO's 2026-08-30 conditional approval. They are not deferred to a later phase within this document — they are out of scope for this remediation-planning exercise and would need a separate, dedicated authorization to reappear.
**Evidence basis:** `20-remediation-packets.md`, `21-dependency-graph-and-reclassified-risks.md`, `22-canonical-decision-register.md`, `23-test-matrix.md`, `24-migration-risk-register.md` (all dated 2026-08-30).

---

## Revised Phase 0 — Launch Blockers

| # | Finding | Status Found | Action | Owner | Revised Est. Effort | Dependencies |
|---|---|---|---|---|---|---|
| 0.1 | P0-01 verify-question-bank | **Fix already merged** — verification only | Confirm `52f5388f` deployed to prod, confirm `INTERNAL_CALLER_SIGNING_SECRET` set, verify `ops_events` shows real verified rows, write missing end-to-end test | Backend/DevOps | **~1 day** (down from "1 day," but now verification not implementation) | None |
| 0.2 | P1-01 question_bank answer key | **RPC leak already closed; RLS/grant leak open, blocked on mobile** | Phase A: fix mobile `quiz_repository.dart` + ship forced-upgrade release. Phase B: column-ACL migration (modeled on proven `quiz_session_shuffles` precedent), only after adoption gate clears | Mobile + DBA + Product (adoption-gate decision) | **Mobile release cycle (likely 2-4+ weeks depending on app-store review + adoption curve) + ~1-2 days DB work** — this is now the **longest lead-time item in the entire Phase 0 set**, longer than the RAG work | Product decision on adoption-gate threshold (unresolved) |
| 0.3 | P1-02 RAG retrieval regression | **Root cause reframed; faithfulness leg not a real regression** | Step 1: read-only embedding-coverage query (immediate). Step 2: retrieval-parameter tuning OR embedding backfill depending on step-1 result. Faithfulness/groundedness metric redesign is a SEPARATE, non-blocking task — do not gate GO/NO-GO on the current faithfulness number | AI/ML | **~3-7 days for recall/nDCG/MRR remediation** (down from "1-2 weeks" now that 2 of 3 root-cause hypotheses are narrowed); faithfulness redesign is out-of-band, not counted against this estimate | None for step 1; step 2 depends on step-1 result |
| 0.4 | P1-03 CI Gate not required | Confirmed, trivial | Add "CI Gate" to GitHub main-protection required status checks | Ops/CEO delegate | **~30 min** (unchanged) | None — recommend executing immediately as a standalone quick win |
| 0.5 | P1-04 Single-person alerting | Confirmed; delivery code already exists | Provision Slack webhook (ops action) → add channel via existing admin UI → attach to alert rules → test-send | Ops | **~1 day, mostly ops-provisioning time, not engineering** (down from "1 day" generic estimate — now known to require near-zero code) | Slack workspace/webhook provisioning (business/ops decision) |
| 0.6 | VULN-D1/D2/D3 Rate limiting | Confirmed; shared fix pattern identified, no new infra needed | Add `checkApiRateLimit` calls to 6 routes (3 payment routes as one diff, oauth/token + auth/bootstrap + auth/session as a second diff given auth/session's critical-path status) | Backend | **~1-2 days** (down from "1-2 days" generic — now precisely scoped with exact insertion points, no discovery work remaining) | None |
| 0.7 | P-01 Admin PII exposure (5 routes) | Confirmed 5 routes (not 6), reference pattern exists | Named column-list constant + `Pick<>` type per route, matching the v2 DTO pattern already used elsewhere | Backend | **~1 day** for the 5 confirmed routes | Route 5's exact required-column set needs a quick clarification first |
| 0.8 | P2-04→P1 RBAC check-not-enforced (3 routes) | **Newly reclassified, evidence not yet gathered** | Targeted follow-up investigation (grep for permission-check-result-ignored patterns in teacher-dashboard, parent-portal, assessment) → then packetize and fix | Backend | **~1 day investigation + ~1 day fix** (estimate, pending investigation) | None — can start immediately |

**New items not in original `19-remediation-roadmap.md` Phase 0:** 0.6 (rate limiting), 0.7 (admin PII), 0.8 (RBAC enforcement gap) — all three were absent from the original Phase 0 because the original roadmap was written before the Phase 2 vulnerability-scan and privacy-audit findings were fully synthesized. They are included here as launch-blocking per the CEO's retained "essential technical security" scope (authorization, restricted access to private student records).

**Items requiring an explicit decision before an effort estimate is meaningful (not on the critical path, but should not be silently dropped):**
- P1-07 (match_rag_chunks_ncert grant) — revoke-or-accept decision; effort is trivial either way (~30 min-2 hours) once decided.
- P1-08 (error message leaks) — scope-boundary decision (3 functions vs. +20 vs. +700); effort ranges from ~2 hours (narrow) to multi-week (full repo sweep) depending on the decision.

---

## Revised Critical Path

**The critical path is now dominated by item 0.2's mobile release cycle, not item 0.3's RAG regression work**, reversing the original roadmap's framing. Recommended sequencing:

```
Week 1 (parallel, no dependencies):
  0.1 verify P0-01 deploy        [~1 day]
  0.3 step 1: embedding query    [~1 hour, gates the rest of 0.3]
  0.4 CI Gate settings           [~30 min]
  0.6 rate limiting (6 routes)   [~1-2 days]
  0.7 admin PII (5 routes)       [~1 day]
  0.8 investigation              [~1 day]
  → START 0.2 Phase A (mobile fix) in parallel — this has the longest lead time, start immediately

Week 1 decisions needed (does not block week-1 work, but should not slip):
  P1-07 revoke-or-accept decision
  P1-08 scope-boundary decision
  0.2 adoption-gate threshold decision

Week 1-2:
  0.3 step 2 (depends on step-1 result): retrieval tuning or embedding backfill
  0.5 Slack webhook provisioning (ops-paced, not eng-paced)
  0.8 fix (once investigation lands)
  P1-05, P1-06 (small, independent, can slot in anywhere)

Ongoing (paced by external factors, not engineering):
  0.2 Phase B — waits on mobile app-store review + adoption curve, likely the true
      gating factor for when P1-01 can be marked fully closed
```

**Revised total estimate for everything EXCEPT the mobile release cycle: ~1-2 weeks of engineering effort, parallelizable across roughly 5-6 independent workstreams.** The mobile release cycle for 0.2 Phase B is the true pacing item and should be started in week 1 given its lead time, even though the database-side work it unlocks is small.

---

## What Changed From the Original `19-remediation-roadmap.md`

| Item | Original Estimate | Revised Estimate | Why |
|---|---|---|---|
| 0.1 (P0-01) | "Ship signing header fix... 1 day" | "~1 day, verification only" | Fix already merged; task is now confirm-and-test, not implement |
| 0.2 (P1-01) | "Column-level ACL... 1-2 sprint days" | "Mobile release cycle (weeks) + ~1-2 days DB work" | RPC leak already closed; remaining RLS/grant work is blocked on a mobile forced-upgrade, not a backend task |
| 0.3 (P1-02) | "Root-cause... 1-2 weeks" | "~3-7 days for recall/nDCG/MRR" | Root cause narrowed to 3 concrete, testable hypotheses; faithfulness leg separated out as a non-blocking measurement-redesign task |
| — | DPDPA items (0.x, ~1-2 weeks legal+eng) | **Removed entirely** | Out of scope per CEO's 2026-08-30 conditional approval |
| 0.6, 0.7, 0.8 | Not present in original Phase 0 | Added | Phase 2 audit findings (rate limiting, admin PII, RBAC enforcement) belong in the launch-blocking set per retained essential-security scope |

**Net effect: the revised roadmap removes the longest-estimated original item (DPDPA, 1-2 weeks) but introduces a new longest-lead-time item (mobile release cycle for P1-01) that wasn't identified as a blocker in the original roadmap at all — the original roadmap assumed P1-01 was a pure backend task.**
