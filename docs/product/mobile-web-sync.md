# Mobile-Web API Contract Sync Audit

**Date**: 2026-04-02
**Auditor**: mobile agent (read-only)
**Status**: MULTIPLE CRITICAL MISMATCHES FOUND

---

## Summary

| Category | Status | Severity |
|---|---|---|
| XP Values | IN SYNC | -- |
| Plan Codes | OUT OF SYNC | HIGH |
| Pricing | OUT OF SYNC | MEDIUM |
| Grade Format | IN SYNC | -- |
| Subject Codes | OUT OF SYNC | MEDIUM |
| Payment API Endpoint | OUT OF SYNC | CRITICAL |
| Payment API Response Shape | OUT OF SYNC | HIGH |
| Question Bank Schema | OUT OF SYNC | CRITICAL |
| Quiz Submission Table | OUT OF SYNC | CRITICAL |
| Usage Limits | IN SYNC | -- |
| RPC Signatures | IN SYNC | -- |
| Foxy Edge Function | IN SYNC | -- |

---

## Detailed Findings

### 1. XP Values -- IN SYNC

The XP constants in mobile `quiz_repository.dart` (lines 77-79) now match web `src/lib/xp-rules.ts`:

| Constant | Web (`XP_RULES`) | Mobile (`quiz_repository.dart`) | Match |
|---|---|---|---|
| Per correct answer | 10 | 10 (line 77) | YES |
| High score bonus (>=80%) | 20 | 20 (line 78) | YES |
| Perfect bonus (100%) | 50 | 50 (line 79) | YES |

**Note**: The CLAUDE.md system prompt states mobile has values 5/10/20, but the actual code has been updated to 10/20/50. The documentation in CLAUDE.md is stale.

**Remaining gap**: Mobile does NOT enforce the daily quiz XP cap of 200 (`XP_RULES.quiz_daily_cap`). The web relies on the `atomic_quiz_profile_update()` RPC to enforce this, but mobile calls `add_xp` RPC directly. If the server-side `add_xp` RPC does not enforce the cap, a student could earn unlimited quiz XP via the mobile app.

---

### 2. Plan Codes -- OUT OF SYNC (HIGH)

**Web** (`src/lib/plans.ts`): Uses simple codes `free`, `starter`, `pro`, `unlimited`.

**Mobile** has two conflicting systems:

- `subscription.dart` `Plans.all` (line 66-109): Uses `starter`, `pro`, `unlimited` (matches web).
- `student.dart` `planDisplayName` getter (lines 70-83): Expects `starter_monthly`, `starter_yearly`, `pro_monthly`, `pro_yearly`, `ultimate_monthly`, `ultimate_yearly`.

Problems:
1. The `student.dart` model expects compound plan codes (`starter_monthly`) that the web never produces. The DB `students.subscription_plan` stores simple codes (`starter`).
2. `student.dart` references `ultimate_monthly`/`ultimate_yearly` instead of `unlimited_monthly`/`unlimited_yearly`. The plan named "Ultimate" does not exist in the web; the web calls it "Unlimited".
3. The `planDisplayName` getter will return "Free" for any student with plan_code `starter`, `pro`, or `unlimited` because those strings don't match the `_monthly`/`_yearly` suffixed cases.

**Files**:
- `/home/user/Alfanumrik/mobile/lib/data/models/student.dart` lines 70-83
- `/home/user/Alfanumrik/mobile/lib/data/models/subscription.dart` lines 65-109

---

### 3. Pricing -- OUT OF SYNC (MEDIUM)

| Plan | Web Monthly | Mobile Monthly | Web Yearly | Mobile Yearly |
|---|---|---|---|---|
| Starter | 299 | 299 | 2,399 | 2,399 |
| Pro | 699 | 699 | 5,599 | 5,599 |
| Unlimited | 1,499 | 1,499 | 11,999 | 11,999 |

Prices match. However, mobile `subscription.dart` `Plans.all` omits the `free` plan entirely. This means the pricing/plans screen has no representation of the free tier for comparison, unlike the web which lists it.

---

### 4. Grade Format -- IN SYNC

Mobile uses string grades (`'6'` through `'12'`) in `grade_subjects.dart`. Web uses string grades in `constants.ts`. The `Student.fromJson` reads `grade` as `String`. Consistent with P5.

---

### 5. Subject Codes -- OUT OF SYNC (MEDIUM)

| Grade | Web Subjects | Mobile Subjects | Difference |
|---|---|---|---|
| 6-8 | math, science, english, hindi, social_studies, coding | math, science, english, hindi, social_studies, coding | Match |
| 9 | math, science, english, hindi, social_studies, **computer_science** | math, science, english, hindi, social_studies | Mobile MISSING computer_science |
| 10 | math, science, english, hindi, social_studies, **computer_science** | math, science, english, hindi, social_studies | Mobile MISSING computer_science |
| 11-12 | math, physics, chemistry, biology, english, computer_science, **economics, accountancy, business_studies, political_science, history_sr, geography** | math, physics, chemistry, biology, english, computer_science | Mobile MISSING 6 commerce/humanities subjects |

**Files**:
- `/home/user/Alfanumrik/mobile/lib/core/constants/grade_subjects.dart`
- `/home/user/Alfanumrik/src/lib/constants.ts` (GRADE_SUBJECTS)

---

### 6. Payment API Endpoint -- OUT OF SYNC (CRITICAL)

Mobile calls: `/payments/create-order`
Web backend has: `/api/payments/subscribe` (no `create-order` route exists)

The mobile `subscription_repository.dart` (line 45) and `api_constants.dart` (line 27) reference a non-existent endpoint. Any attempt to purchase a subscription from the mobile app will receive a 404 error.

**Files**:
- `/home/user/Alfanumrik/mobile/lib/core/constants/api_constants.dart` line 27
- `/home/user/Alfanumrik/mobile/lib/data/repositories/subscription_repository.dart` line 44-45
- `/home/user/Alfanumrik/src/app/api/payments/subscribe/route.ts` (actual endpoint)

---

### 7. Payment API Response Shape -- OUT OF SYNC (HIGH)

Mobile sends to `/payments/create-order`:
```json
{ "plan_code": "...", "billing_cycle": "..." }
```

Web subscribe endpoint expects the same body shape (`plan_code`, `billing_cycle`) -- this part matches.

But mobile calls `/payments/verify` with:
```json
{
  "razorpay_order_id": "...",
  "razorpay_payment_id": "...",
  "razorpay_signature": "...",
  "plan_code": "...",
  "billing_cycle": "..."
}
```

The web verify endpoint would need to accept these fields. This should be verified against `src/app/api/payments/verify/route.ts`.

Additionally, the subscribe response includes a `data` wrapper:
```json
{ "success": true, "data": { "type": "subscription|order", "subscription_id|order_id": "...", "key": "...", ... } }
```

Mobile's `createOrder` reads `response.data` as a flat map, but the actual response nests the useful data inside a `data` field, so mobile would get `{ "success": true, "data": { ... } }` and would need to access `response.data['data']` to get the Razorpay details.

---

### 8. Question Bank Schema -- OUT OF SYNC (CRITICAL)

**Database schema** (`question_bank` table):
- `options` -- JSONB array (e.g., `["opt1","opt2","opt3","opt4"]`)
- `correct_answer_index` -- INTEGER (0-3)

**Mobile model** (`quiz_question.dart` lines 33-44):
- Reads `option_1`, `option_2`, `option_3`, `option_4` (individual columns that DO NOT EXIST)
- Reads `correct_option` as 1-based integer, then subtracts 1 (column DOES NOT EXIST)

This means quiz question loading will fail silently: all options will be empty lists, and correct index will default to -1 or 0 incorrectly. Quizzes are non-functional on mobile.

**Files**:
- `/home/user/Alfanumrik/mobile/lib/data/models/quiz_question.dart` lines 32-44
- `/home/user/Alfanumrik/supabase/migrations/_legacy/000_core_schema.sql` lines 349-350

---

### 9. Quiz Submission Table -- OUT OF SYNC (CRITICAL)

Mobile inserts quiz results into `quiz_attempts` table (line 66 of `quiz_repository.dart`).
Web uses `quiz_sessions` table via `atomic_quiz_profile_update()` RPC.

The `quiz_attempts` table may not exist in the schema (only `quiz_sessions` is defined in the core schema migration). If it does not exist, quiz submission will fail with a "relation does not exist" error.

Additionally, mobile does NOT use the `atomic_quiz_profile_update()` RPC (P4 violation). Instead it:
1. Directly inserts into `quiz_attempts` (wrong table)
2. Calls `add_xp` RPC separately
3. Calls `increment_daily_usage` RPC separately

This is three separate operations instead of one atomic transaction, violating product invariant P4.

**Files**:
- `/home/user/Alfanumrik/mobile/lib/data/repositories/quiz_repository.dart` lines 54-109
- Web: `src/lib/supabase.ts` `submitQuizResults()` function

---

### 10. Usage Limits -- IN SYNC

Mobile `dashboard_repository.dart` (lines 103-116) matches web `src/lib/usage.ts` (lines 20-25):

| Plan | Feature | Web | Mobile | Match |
|---|---|---|---|---|
| Free | Chat | 5 | 5 | YES |
| Free | Quiz | 5 | 5 | YES |
| Starter | Chat | 30 | 30 | YES |
| Starter | Quiz | 20 | 20 | YES |
| Pro | Chat | 100 | 100 | YES |
| Pro/Unlimited | Quiz | 999999 | 999 | Functionally equivalent |
| Unlimited | Chat | 999999 | 999 | Functionally equivalent |

**Note**: The CLAUDE.md system prompt states mobile has different limits (free: 3 quizzes, starter: 25 chats/20 quizzes). The actual code has been updated and now matches.

---

### 11. RPC Signatures -- IN SYNC

| RPC | Web Parameters | Mobile Parameters | Match |
|---|---|---|---|
| `get_dashboard_data` | `p_student_id` | `p_student_id` | YES |
| `add_xp` | `p_student_id`, `p_amount`, `p_source` | `p_student_id`, `p_amount`, `p_source` | YES |
| `increment_daily_usage` | `p_student_id`, `p_feature`, `p_usage_date` (optional) | `p_student_id`, `p_feature` (no date) | YES (date defaults) |

---

### 12. Foxy Edge Function -- IN SYNC

Mobile `chat_repository.dart` calls `foxy-tutor` with:
```json
{
  "session_id": "...",
  "student_id": "...",
  "message": "...",
  "subject": "...",
  "topic": "...",
  "grade": "...",
  "mode": "learn"
}
```

Reads response: `data['reply']` as String. Handles 429 status for usage limits. This appears compatible with the Edge Function contract.

---

## Recommendations (Prioritized)

### CRITICAL (App-breaking -- quizzes and payments non-functional)

1. **Fix question_bank model** (`quiz_question.dart`): Read `options` as JSONB array instead of `option_1..4`. Read `correct_answer_index` instead of `correct_option`. Without this, no quiz can display questions.

2. **Fix quiz submission table** (`quiz_repository.dart`): Change `quiz_attempts` to `quiz_sessions` (or verify `quiz_attempts` exists as an alias/view). Ideally use `atomic_quiz_profile_update()` RPC to comply with P4.

3. **Fix payment endpoint** (`api_constants.dart`, `subscription_repository.dart`): Change `/payments/create-order` to `/payments/subscribe`. Without this, no subscription purchase can complete.

### HIGH (Incorrect behavior)

4. **Fix plan code handling** (`student.dart`): Remove the `_monthly`/`_yearly` suffixed plan codes from `planDisplayName`. Use simple codes (`starter`, `pro`, `unlimited`) that match the DB and web. Fix `ultimate` to `unlimited`.

5. **Fix payment response parsing** (`subscription_repository.dart`): The subscribe endpoint wraps the Razorpay data inside `data.data`. Mobile needs to unwrap correctly.

### MEDIUM (Missing content, cosmetic)

6. **Add missing subjects** (`grade_subjects.dart`): Add `computer_science` for grades 9-10. Add commerce/humanities subjects for grades 11-12 (economics, accountancy, business_studies, political_science, history_sr, geography).

7. **Add daily XP cap enforcement**: Either call `atomic_quiz_profile_update()` (which enforces the 200 XP cap) or add client-side tracking.

8. **Add free plan to Plans list** (`subscription.dart`): Include the Explorer/free plan for display purposes.

### LOW (Documentation)

9. **Update CLAUDE.md**: The XP values and usage limits noted as mismatched in the system prompt have been fixed in code. The documentation is stale.

---

## Files Referenced

| File | Role |
|---|---|
| `mobile/lib/data/repositories/quiz_repository.dart` | Quiz submission, XP calculation |
| `mobile/lib/data/repositories/subscription_repository.dart` | Payment API calls |
| `mobile/lib/data/repositories/chat_repository.dart` | Foxy Edge Function calls |
| `mobile/lib/data/repositories/dashboard_repository.dart` | Dashboard RPC, usage limits |
| `mobile/lib/data/models/quiz_question.dart` | Question model (schema mismatch) |
| `mobile/lib/data/models/student.dart` | Student model (plan code mismatch) |
| `mobile/lib/data/models/subscription.dart` | Plan definitions, pricing |
| `mobile/lib/core/constants/api_constants.dart` | API endpoint URLs |
| `mobile/lib/core/constants/grade_subjects.dart` | Grade-subject mapping |
| `src/lib/xp-rules.ts` | XP constants (source of truth) |
| `src/lib/plans.ts` | Plan codes, pricing (source of truth) |
| `src/lib/constants.ts` | Grades, subjects (source of truth) |
| `src/lib/usage.ts` | Usage limits (source of truth) |
| `src/app/api/payments/subscribe/route.ts` | Subscribe endpoint |
| `supabase/migrations/_legacy/000_core_schema.sql` | DB schema |
