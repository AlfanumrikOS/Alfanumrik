# 08 — Adaptive Learning Closed Loop

**Audit date:** 2026-08-29
**Evidence source:** Adaptive learning agent (completed)

---

## 1. Architecture Summary

### Core Loop: answer → attempt → mastery → recommendation
1. **Student submits quiz answer** → validated client-side, sent to `/api/quiz/submit`
2. **Atomic quiz submission** → `atomic_quiz_profile_update()` SQL RPC processes in single transaction:
   - Records attempt in `quiz_attempts`
   - Updates `concept_mastery` (total_attempts, total_correct, mastery_level)
   - Awards XP via `xp_transactions`
   - Anti-cheat checks (timing, pattern detection)
   - Idempotency key prevents duplicate processing
3. **Mastery update** → BKT (Bayesian Knowledge Tracing) and IRT 2PL (Item Response Theory) models compute mastery probability
4. **Recommendation engine** → cognitive-engine.ts applies:
   - ZPD (Zone of Proximal Development) targeting
   - Bloom's taxonomy progression
   - Interleaving across subjects
   - Fatigue detection and session management
   - Daily rhythm / weekly dive / monthly synthesis orchestration

### Adaptive Loops
| Loop | Purpose | Status |
|------|---------|--------|
| Loop A | Concept mastery tracking (BKT) | Active |
| Loop B | Difficulty calibration (IRT 2PL Fisher information) | Active |
| Loop C | Learning path optimization (cognitive engine) | Active |
| Loop D | Content quality feedback (question difficulty recalibration) | Active |

### Spaced Repetition
- **Algorithm:** SM-2 implemented as SQL RPC (`calculate_next_review()`)
- **Scheduling:** pg_cron runs daily to populate review queue
- **BKT mirror:** TypeScript read-only mirror for UI predictions; writes are SQL-only (by contract)

---

## 2. Findings

### P2
| ID | Finding | Impact |
|----|---------|--------|
| P2-08 | Learning velocity (`calculateLearningVelocity`) clamps negative values to 0 — regression signals are suppressed | Mastery predictions and `predictMasteryDate` become falsely optimistic; struggling students don't get accelerated intervention |
| P2-09 | `recordExperimentEvidence` collects per-session experiment data but never persists it to the database — the call is fire-and-forget into memory | Experiment outcomes (which teaching strategy worked better) are lost on process exit; Loop D can't learn from experiments |
| P2-10 | BKT model uses hardcoded priors (P(L0)=0.3, P(T)=0.09, P(G)=0.2, P(S)=0.1) rather than per-concept calibrated values | Mastery estimates are one-size-fits-all; some concepts may be systematically over/under-estimated |
| P2-11 | BKT (SQL) and IRT (TypeScript) models can produce divergent mastery estimates for the same concept without reconciliation | Student sees different mastery levels depending on which code path serves the UI; no conflict resolution |

### P3
| ID | Finding | Impact |
|----|---------|--------|
| P3-01 | Fatigue detection thresholds are hardcoded (5 wrong in a row = frustrated, 20 min continuous = fatigued) — no per-student calibration | Some students may be flagged too early/late for intervention |
| P3-02 | Interleaving algorithm uses fixed 30% cross-subject injection rate — no adaptive adjustment | May be too aggressive or too mild depending on student performance |
| P3-03 | Monthly synthesis has no student-facing progress view — synthesis happens server-side only | Students don't see their monthly learning arc |
| P3-04 | cognitive-engine.ts bloom_level progression is linear (remember→understand→apply→…) — no support for non-linear Bloom's patterns | Some subjects may benefit from different Bloom's ordering |

---

## 3. Positive Findings

1. **Quiz submission atomicity is genuinely strong:** Fully transactional inside a SQL RPC, idempotency-keyed, anti-cheat checks embedded, single canonical mastery write path. This is one of the best-designed components in the system.
2. **XP economy is well-controlled:** Single canonical write path, daily cap (200 XP), anti-cheat pattern detection, no XP writes from Foxy or any other side channel.
3. **SM-2 spaced repetition is implemented correctly** at the SQL level with proper interval calculations and review scheduling.
4. **Adaptive Loop architecture (A/B/C/D)** is a thoughtful pedagogical design that goes beyond simple "more questions = more learning" approaches.
5. **Daily rhythm / weekly dive / monthly synthesis** is an unusually sophisticated temporal orchestration for a K-12 platform.

---

## 4. Gate Verdict

**CONDITIONAL GO** — The closed loop works end-to-end (answer→attempt→mastery→recommendation is verified). P2 findings affect quality of adaptation but not correctness of the core loop. No data corruption risk.
