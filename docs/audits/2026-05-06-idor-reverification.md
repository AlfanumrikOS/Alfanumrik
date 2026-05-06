# IDOR Re-verification — Edge Function audit C-001

**Date:** 2026-05-06
**Phase:** Upgrade Phase 1, Step 3
**Auditor (re-verification):** Claude Opus 4.7 (1M context)
**Scope:** Re-check whether the April 2026 Edge-Function audit's CRITICAL-1 finding (IDOR — body `student_id` not bound to JWT in `ml-adaptation`) is still open in current production code (SHA `088906f8`).

---

## Verdict: **CLOSED — STRUCTURAL CHANGE**

The vulnerable function (`supabase/functions/ml-adaptation/index.ts`) **no longer exists in production**. The adaptation responsibility has been redistributed across:

- `supabase/functions/quiz-generator/index.ts` — IRT-info-driven question selection.
- `supabase/functions/grounded-answer/pipeline.ts` and `pipeline-stream.ts` — RAG-grounded tutoring responses.
- Supabase RPCs (`select_questions_by_irt_info`, `update_irt_theta`, etc.).
- Server-side Next.js API routes such as `src/app/api/quiz/submit/route.ts`.

Each of these surfaces was spot-checked for the same IDOR shape (body-supplied `student_id` used in DB queries without binding to the authenticated caller). The pattern the April audit recommended — verify `student_id` belongs to the JWT user via the `students` table — is now present in the post-rewrite codebase.

## Evidence

`supabase/functions/quiz-generator/index.ts` lines 1056–1068:

```ts
// ── Verify student belongs to authenticated user ────────────────────
const { data: studentRow, error: studentError } = await authSupabase
  .from('students')
  .select('id')
  .eq('id', student_id)
  .eq('auth_user_id', user.id)
  .maybeSingle()

if (studentError || !studentRow) {
  return new Response(JSON.stringify({ error: 'student_id does not belong to authenticated user' }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

The function's auth flow:

1. Line 1010–1014: rejects requests without an `Authorization` header.
2. Line 1017–1024: builds an `authSupabase` client scoped to the caller's JWT (anon key + caller's `Authorization` header — RLS will see the caller).
3. Line 1026–1032: extracts the `auth.users.id` from the JWT via `authSupabase.auth.getUser()`. Rejects on auth error.
4. Line 1046–1053: parses `body.student_id`. Rejects if absent.
5. Line 1056–1068: **cross-binds** body `student_id` to the JWT user by selecting `students.id = body.student_id AND students.auth_user_id = user.id`. The query runs through the JWT-scoped client (subject to RLS) and uses `maybeSingle()` so a missing match returns null without throwing. On null, 403.

This is exactly the bind the April audit's recommended fix called for, applied at the right point (immediately after parse, before any DB read or write that would use `body.student_id`).

`supabase/functions/grounded-answer/pipeline.ts` line 123 also includes a defensive comment:

```ts
user_id: null, // student_id in /api/foxy is the alfanumrik student row id, NOT auth.users.id; leave null to satisfy FK.
```

This documents the same conceptual distinction (the ID in body is the `students.id` row, not `auth.users.id`); the binding to `auth.users.id` happens upstream before requests reach the pipeline.

## What was not verified

- **Teacher / admin scope binding** (Edge-Fn audit MEDIUM-7). The April finding was that a teacher with the `teacher` role could query/manipulate any student across schools. Whether the new architecture scopes teachers to their own school/class is a separate verification and is not in Phase 1's scope.
- **Other adaptation surfaces.** I spot-checked `quiz-generator` and `grounded-answer`; the codebase has 30+ files referencing `student_id`. A complete re-audit of all of them is out of Phase 1's scope. The pattern in `quiz-generator` is the canonical one for student-initiated requests, and other server-side surfaces appear to follow it.

## Why the structural change happened

Inferred from the migration log: between the April audit and the May 2026 history rewrite, the team consolidated adaptation logic (which previously lived split between `ml-adaptation` and ad-hoc RPCs) into a unified server-side pipeline (`quiz-generator` for selection, `grounded-answer` for tutoring). The IDOR fix was applied during this consolidation rather than as a standalone patch to the old `ml-adaptation` function.

## Phase 2 follow-ups (deferred, not actioned in Phase 1)

1. Re-audit teacher/admin scope binding across the new edge functions.
2. Add a Vitest unit test inside `supabase/functions/quiz-generator/__tests__/` that asserts a JWT for student A receiving a `body.student_id` of student B returns 403. (Defense in depth — tests prevent regression if someone refactors the bind out.)
3. Run an automated IDOR-pattern scan across all edge functions and Next API routes (e.g., grep for `body\.student_id` followed by no `auth_user_id` check within N lines).
