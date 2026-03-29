# Skill: Quiz Integrity

Use this skill when reviewing or modifying anything in the quiz pipeline: question fetching, answer tracking, score calculation, XP awarding, anti-cheat, or results display.

## The Quiz Integrity Contract

These invariants MUST hold at all times. Violating any of these is a BLOCKER.

### Invariant 1: Score Accuracy
```
score_percent = ROUND((correct_answers / total_questions) * 100)
```
- `correct_answers` = count of responses where selected option matches `correct_answer_index`
- `total_questions` = length of the question array served to the student
- This calculation happens in `submitQuizResults()` in `src/lib/supabase.ts`
- The same formula must be used in `QuizResults.tsx` for display
- Never truncate or floor — use `Math.round()`

### Invariant 2: XP Consistency
```
xp_earned = (correct_answers * 10)
          + (score_percent >= 80 ? 20 : 0)
          + (score_percent === 100 ? 50 : 0)
```
- Constants come from `XP_RULES` in `src/lib/xp-rules.ts`
- The `quiz_per_correct`, `quiz_high_score_bonus`, and `quiz_perfect_bonus` fields
- Daily cap: `quiz_daily_cap = 200` — enforced by `atomic_quiz_profile_update()` RPC
- XP must NEVER be calculated in the component layer. Only in `submitQuizResults()`.

### Invariant 3: Atomic Updates
Quiz submission MUST use the `atomic_quiz_profile_update()` Postgres RPC which:
1. Inserts into `quiz_sessions`
2. Upserts `student_learning_profiles` (XP, sessions, questions)
3. Updates `students.xp_total`
4. Updates streak if applicable
5. All in a single transaction

If the RPC is unavailable, `submitQuizResults()` has a fallback that does these as separate operations. This fallback is acceptable but should be logged as a warning.

### Invariant 4: Anti-Cheat
Before accepting a submission, validate:
```typescript
// 1. Time check: at least 3 seconds per question
if (totalTimeSeconds / totalQuestions < 3) REJECT;

// 2. Pattern check: not all same answer
const indices = responses.map(r => r.selectedIndex);
if (new Set(indices).size === 1 && indices.length > 3) FLAG;

// 3. Count check: responses match questions
if (responses.length !== questions.length) REJECT;
```
These checks exist in `src/app/quiz/page.tsx` during submission. They must also be enforced server-side (migration `20260329140000_server_side_quiz_verification.sql`).

### Invariant 5: Timer Integrity
- Practice mode: timer counts UP (no limit)
- Cognitive mode: timer counts UP (no limit, but fatigue detection may pause)
- Exam mode: timer counts DOWN from `ExamConfig.durationSeconds`
- Timer uses `useRef` for the interval, not `useState` (prevents re-render drift)
- `time_taken_seconds` saved to `quiz_sessions` is wall-clock time, not accumulated pause-adjusted time

### Invariant 6: Question Quality Gate
Questions served to students must pass:
```typescript
// In getQuizQuestions() validation
- question_text is non-empty and does not contain '{{' or '[BLANK]'
- options is an array of exactly 4 non-empty strings
- correct_answer_index is 0, 1, 2, or 3
- explanation is non-empty
- No duplicate questions in the same session (deduplicated by question ID)
```

## Files That Must Stay In Sync
If you change one of these, check the others:

| File | What It Contains | Synced With |
|---|---|---|
| `src/lib/xp-rules.ts` | XP constants | `submitQuizResults()`, `atomic_quiz_profile_update()` |
| `src/lib/supabase.ts` | `submitQuizResults()` | Quiz page, XP rules, RPC |
| `src/app/quiz/page.tsx` | Quiz flow + anti-cheat | `submitQuizResults()`, timer, cognitive engine |
| `src/components/quiz/QuizResults.tsx` | Score display | Same formula as `submitQuizResults()` |
| `supabase/migrations/*_atomic_quiz_profile_update.sql` | Server-side XP | Must match `XP_RULES` constants |
| `supabase/migrations/*_server_side_quiz_verification.sql` | Server-side anti-cheat | Must match client-side checks |

## Red Flags During Review
- [ ] XP number that doesn't match `XP_RULES` constant
- [ ] Score calculated differently in results display vs submission
- [ ] `quiz_sessions` INSERT without `atomic_quiz_profile_update()` call
- [ ] Timer using `useState` instead of `useRef`
- [ ] Anti-cheat check removed or weakened
- [ ] Question served with fewer than 4 options
- [ ] Grade passed as integer instead of string
