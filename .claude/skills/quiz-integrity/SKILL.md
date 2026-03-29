# Skill: Quiz Integrity

Checklist and invariants for the quiz pipeline. Reference this when touching question fetching, answer tracking, score calculation, XP awarding, anti-cheat, scorecard display, or post-quiz progress updates.

**Owning agent**: assessment. Other agents reference this skill but assessment has final say on correctness.

## Invariant 1: Score Accuracy
```
score_percent = Math.round((correct_answers / total_questions) * 100)
```
- `correct_answers` = count where `selectedIndex === correct_answer_index`
- `total_questions` = length of question array served to student
- Calculated in `submitQuizResults()` in `src/lib/supabase.ts`
- Displayed in `QuizResults.tsx` using the value RETURNED by `submitQuizResults()` — never recalculated in the component

Violation check: if `QuizResults.tsx` contains its own `(correct / total)` math, that's a bug.

## Invariant 2: XP Consistency
```
xp_earned = (correct_answers * 10)
          + (score_percent >= 80 ? 20 : 0)
          + (score_percent === 100 ? 50 : 0)
```
- Constants from `XP_RULES` in `src/lib/xp-rules.ts`: `quiz_per_correct=10`, `quiz_high_score_bonus=20`, `quiz_perfect_bonus=50`
- Daily cap: `quiz_daily_cap=200` enforced in `atomic_quiz_profile_update()` RPC
- XP is calculated in `submitQuizResults()` only, never in components

Violation check: grep for `* 10`, `+ 20`, `+ 50` in quiz components — if found, it's likely a hardcoded XP value.

## Invariant 3: Atomic Updates
`submitQuizResults()` calls `atomic_quiz_profile_update()` RPC which, in one transaction:
1. Inserts `quiz_sessions` row
2. Upserts `student_learning_profiles` (XP, sessions, questions)
3. Updates `students.xp_total`
4. Updates streak if first activity today

Fallback: if RPC fails, does separate operations + logs warning. Acceptable but must not be silent.

Violation check: any direct INSERT to `quiz_sessions` outside `submitQuizResults()`.

## Invariant 4: Anti-Cheat
| Check | Condition | Result |
|---|---|---|
| Speed | `totalTimeSeconds / totalQuestions < 3` | Reject |
| Pattern | `Set(indices).size === 1 && questions.length > 3` | Flag |
| Count | `responses.length !== questions.length` | Reject |

Enforced in: `src/app/quiz/page.tsx` (client) and `server_side_quiz_verification` migration (server).

Violation check: any change that removes or relaxes these conditions.

## Invariant 5: Timer Integrity
| Mode | Direction | Limit |
|---|---|---|
| Practice | Counts UP | None |
| Cognitive | Counts UP | Fatigue detection may pause |
| Exam | Counts DOWN | `ExamConfig.durationSeconds` from `calculateExamConfig()` |

- Timer interval stored in `useRef`, not `useState` (prevents re-render drift)
- `time_taken_seconds` in `quiz_sessions` = wall-clock elapsed time

Violation check: `useState` for timer interval, or `setInterval` recreated on re-render.

## Invariant 6: Question Quality Gate
Applied in `getQuizQuestions()` before serving to student:
- [ ] `question_text` non-empty, no `{{` or `[BLANK]`
- [ ] `options` is array of exactly 4 non-empty distinct strings
- [ ] `correct_answer_index` is 0, 1, 2, or 3
- [ ] `explanation` is non-empty
- [ ] No duplicate question IDs in same session

## Invariant 7: Scorecard Consistency
After quiz submission, these displays must use values from the submission response:
| Display | Source | NOT from |
|---|---|---|
| Score percentage in QuizResults | `submitQuizResults().score_percent` | Recalculation in component |
| XP earned in QuizResults | `submitQuizResults().xp_earned` | Recalculation in component |
| XP total in ProgressSnapshot | `students.xp_total` (server) | Client-side sum of quiz XP |
| Level name | `LEVEL_NAMES[Math.floor(xp/500)+1]` | Hardcoded string |
| Streak in dashboard | `students.streak_days` (server) | Client-side day counting |

## Files That Must Stay In Sync
| Change to... | Must also check... |
|---|---|
| `src/lib/xp-rules.ts` (constants) | `submitQuizResults()`, `atomic_quiz_profile_update()` RPC |
| `submitQuizResults()` (in supabase.ts) | `QuizResults.tsx` display, quiz page anti-cheat |
| `src/app/quiz/page.tsx` (quiz flow) | `submitQuizResults()`, timer, cognitive engine |
| `QuizResults.tsx` (display) | Must only show values from submission response |
| `atomic_quiz_profile_update` migration | Must match XP_RULES constants |
| `server_side_quiz_verification` migration | Must match client-side anti-cheat checks |

## Quick Grep Commands for Violations
```bash
# Hardcoded XP values in quiz components
grep -rn "* 10\|+ 20\|+ 50" src/components/quiz/ src/app/quiz/

# Direct quiz_sessions INSERT (should go through submitQuizResults)
grep -rn "quiz_sessions.*insert\|\.from('quiz_sessions')" src/app/ src/components/

# Timer in useState (should be useRef)
grep -n "useState.*timer\|useState.*interval" src/app/quiz/page.tsx

# Score recalculation in results (should use submission response)
grep -n "correct.*total\|correct_answers.*total" src/components/quiz/QuizResults.tsx
```
