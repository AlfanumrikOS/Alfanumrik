# 06 - Business Rules Certification Report

Stage 1 (static/read-only), 2026-07-02. Every rule the mission named is independently
re-derived from current source, not cited from prior phases.

| Business rule | Verdict | Evidence |
|---|---|---|
| P1 Score accuracy | Verified | formula byte-consistent across the server RPC, submitQuizResults, and QuizResults.tsx |
| P2 XP economy | Verified | constants confirmed to live only in the single owning file; daily cap and level values confirmed current |
| P3 Anti-cheat | Verified | 3 checks confirmed present in the quiz-scoring function body (3-second average, not-all-same-answer, response-count match) |
| P4 Atomic quiz submission | Verified | single-transaction RPC confirmed for both overloads, ownership check added ahead of any write |
| P5 Grade format | Verified | grade fields confirmed string-typed at the spot-checked sites |
| P6 Question quality | Partial | oracle validation confirmed present at insertion time; however bloom_level and difficulty have no database-level CHECK constraint (unlike a sibling table), so validation is app-layer-only and conditional |
| Subscription expiry during an active assessment | Not fully traced | deferred to Stage 2 - requires a live time-boxed session to observe actual behavior |
| Adaptive progression (IRT/BKT question selection) | Verified-with-open-finding | the Edge Function IRT path is dead code (selection flag hardcoded off, logic in an unclosed comment block); a separate in-repo comment falsely claims 100% production rollout. The actual live adaptive mechanism is a different, correctly-built system, itself seeded off. |
| Quiz attempt limits | Verified | mechanism located and confirmed enforced |
| Leaderboard rules | Verified-with-defect | ranking and tie-break logic confirmed correct; the scope=school parameter is silently ignored, always returning the global ranking; no opt-out exists |
| Coupon logic | Not implemented | database tables exist with sound abuse-limit primitives; zero application code reads or writes them |
| Referral logic | Not implemented | same as coupon logic - schema only |
| Teacher permissions | Verified | class/school-scoped ownership checks confirmed on every handler that accepts a student or class id |
| Parent isolation | Verified | guardian-student link status (active/approved) re-verified as a precondition on every per-child data query; new links require explicit student approval before any data is reachable |
| School isolation / multi-tenant safety | Verified | school-scoped queries confirmed fail-closed for school-less or independent accounts |
| AI usage limits | Verified | the quota-recording RPC confirmed to run before any AI provider call on the primary tutor route |

## Summary

10 of 14 rules Verified clean. 2 Verified-with-open-finding (adaptive progression's
documentation mismatch; leaderboard scope parameter). 1 Partial (question-quality database-level
enforcement). 2 Not Implemented (coupon, referral - a scope finding, not a defect, pending
product confirmation of whether these are advertised as live features). 1 Not Fully Traced,
deferred to Stage 2 (subscription expiry mid-assessment).
