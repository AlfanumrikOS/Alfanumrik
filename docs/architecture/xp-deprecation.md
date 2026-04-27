# XP Rules Deprecation — Migration Roadmap

> **Status: in-progress.** `src/lib/xp-rules.ts` is `@deprecated`. New code must NOT import from it. Existing 17 importers remain for backward compatibility.
>
> Audit reference: F19 (deferred from production-readiness audit 2026-04-27).

## Why this exists

The XP economy was the v1 mastery scoring system: unbounded integer XP, levels at every 500 XP, streaks, redemption shop. Two replacements have shipped (or are shipping) alongside it:

| Replaces | New module | Concept |
|---|---|---|
| XP for mastery / level / progress | `src/lib/score-config.ts` | **Performance Score** — bounded 0-100 per subject. Inherent progress display, no "next level" math. |
| XP redemption shop / engagement rewards | `src/lib/coin-rules.ts` | **Foxy Coins** — spendable engagement currency, separate from mastery. |

The dual existence is intentional during the transition. The v1 economy keeps working for existing students until all callers migrate.

## Currently-active P-invariant ties

`xp-rules.ts` is still load-bearing for **P2 (XP economy)**:

- `XP_RULES.quiz_per_correct = 10`
- `XP_RULES.quiz_high_score_bonus = 20`
- `XP_RULES.quiz_perfect_bonus = 50`
- `XP_RULES.quiz_daily_cap = 200`

These are pinned to SQL via parity tests in `src/__tests__/lib/xp-daily-cap.test.ts` (F20 closes the per-correct + bonus gap; daily-cap was already pinned).

**Until all 17 importers migrate, do NOT remove or change values in `xp-rules.ts`.**

## Mechanical guard

`.eslintrc.json` warns on every new import of `@/lib/xp-rules` from `src/app/`, `src/components/`, `src/lib/` (excluding the file itself and tests). Existing 17 imports surface as warnings; new imports cannot land without surfacing in CI/IDE.

```jsonc
// no-restricted-imports — warn level, exempts tests + xp-rules.ts itself
```

## Existing 17 importers (audit 2026-04-27)

| File | What it uses | Migration target |
|---|---|---|
| `src/app/dashboard/page.tsx` | `calculateLevel`, `xpToNextLevel`, `getLevelName` | `getLevelFromScore` from score-config |
| `src/app/quiz/page.tsx` | `XP_RULES` | hold — quiz scoring is P2 critical path |
| `src/components/dashboard/FocusDashboard.tsx` | `calculateLevel`, `xpToNextLevel`, `getLevelName`, `XP_PER_LEVEL` | `LEVEL_THRESHOLDS` + `getLevelFromScore` |
| `src/components/dashboard/ProgressSnapshot.tsx` | `calculateLevel`, `xpToNextLevel`, `getLevelName` | `getLevelFromScore` |
| `src/components/progress/LearningJourney.tsx` | `calculateLevel`, `xpToNextLevel`, `getLevelName` | `getLevelFromScore` |
| `src/components/xp/XPActivityFeed.tsx` | `XP_RULES` | hold — surfaces XP for v1 economy |
| `src/components/xp/XPDailyStatus.tsx` | `XP_RULES` | hold — surfaces daily cap to learner |
| `src/components/xp/XPProgressRing.tsx` | `calculateLevel`, `xpToNextLevel`, `getLevelName` | `getLevelFromScore` |
| `src/components/xp/XPRewardShop.tsx` | `XP_REWARDS` | `COIN_SHOP` from coin-rules |
| `src/lib/learning-monitors.ts` | `XP_RULES` | hold — server-side XP awarding |
| `src/__tests__/*` (7 tests) | `XP_RULES`, etc. | exempt from rule (tests verify v1 economy) |

## Phased migration plan

### Phase 1 — UI level/progress display (low risk, P2-neutral)
Migrate the 6 dashboard / progress components to read Performance Score from `score-config.ts` instead of XP-derived levels. UI changes only; backend keeps writing XP.

**Files:** `dashboard/page.tsx`, `FocusDashboard.tsx`, `ProgressSnapshot.tsx`, `LearningJourney.tsx`, `XPProgressRing.tsx`, plus any "level X" copy.

**Risk:** medium-low. Visual change but no DB schema change. Rollback by reverting commit.

**Out of scope for this phase:** the `XPActivityFeed`/`XPDailyStatus` cards remain XP-themed because they show the v1 economy directly.

### Phase 2 — Reward shop migration
Migrate `XPRewardShop.tsx` to consume `COIN_SHOP` instead of `XP_REWARDS`. Adds a Foxy-Coins balance display alongside (or replacing) the XP balance.

**Coupling:** requires `student_coin_balance` table + `redeem_coin_reward` RPC (separate work — coin economy infra).

### Phase 3 — Scoring path migration (highest risk)
Migrate `submitQuizResults`, `atomic_quiz_profile_update`, `learning-monitors.ts`, and the SQL RPC to write Performance Score deltas instead of XP. Keep `xp_total` column populated as a derived view for backward compat.

**Risk:** HIGH. P1 (score formula) and P2 (XP economy) directly affected. Requires full review chain (assessment + testing + ai-engineer + backend + frontend + mobile).

**Out of scope until product decision is made.** Performance Score and XP economy may run in parallel indefinitely if the product wants both.

### Phase 4 — Removal
Once all 17 importers migrate (Phase 1-3) and 2-week production stability passes, delete `src/lib/xp-rules.ts`. The ESLint guard becomes unnecessary.

## What NOT to do

- **Do NOT** remove any `XP_RULES` constant value while v1 economy is active. The SQL RPC pins these values via parity tests — changing one without the other breaks P2.
- **Do NOT** add new imports from `@/lib/xp-rules`. The lint warning surfaces this to reviewers.
- **Do NOT** mix Performance Score and XP in the same display widget. Pick one source per surface.

## Owner

- **Assessment** owns the scoring rules. P1/P2/P5 invariants live here.
- **Frontend** owns the UI migration (Phase 1, Phase 2 UI bits).
- **Backend** owns the RPC migration (Phase 3, server-side).
- **Mobile** must verify XP display in the Flutter app once Phase 1 lands.
- **Testing** owns the parity tests (`xp-daily-cap.test.ts`, `xp-ledger-parity.test.ts`, etc.).

## Re-visit cadence

When Phase 1 ships, update this doc to mark migrated importers ✓. When all 17 are done, schedule the Phase 4 removal PR.
