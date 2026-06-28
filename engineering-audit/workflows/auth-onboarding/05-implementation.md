# Auth & Onboarding — Cycle 1 Implementation Log

Tracks the concrete code/test/UI changes for the Cycle 1 auto-fix-safe set defined in
`04-solution-design.md`. Each agent fills its own section.

---

## AO-4 (backend) — bootstrap route honours the RPC logical-failure channel

**Status:** DONE.
**File changed (code):** `src/app/api/auth/bootstrap/route.ts` (single file; no other code touched).
**Type-check:** `npm run type-check` → PASS (clean, no errors).

### RPC contract relied upon (cited)

`public.bootstrap_user_profile(...) RETURNS JSONB`, defined in
`supabase/migrations/20260610090100_bootstrap_link_code.sql` (read-only; not modified). Its return
shapes:

| Outcome | Payload | Source line |
|---|---|---|
| Fresh success | `{ status: 'success', profile_id: <uuid>, role, link_status }` | `20260610090100_bootstrap_link_code.sql:316-317` |
| Idempotent (already onboarded) | `{ status: 'already_completed', profile_id: <uuid>, link_status }` | `:177-178` |
| Invalid role (ELSE branch, **no raise**) | `{ status: 'error', error: 'Invalid role', link_status: 'not_attempted' }` | `:224-225` |
| Insert failure (`EXCEPTION WHEN OTHERS`, **no raise**) | `{ status: 'error', error: SQLERRM, link_status: 'not_attempted' }` | `:233-234` |

Key facts: (1) the two `status:'error'` paths RETURN rather than RAISE, so they never populate the
Supabase client's `rpcError` (transport/PG error) channel; (2) both success paths carry a non-null
`profile_id` (`profile_id` is set by `RETURNING id INTO v_profile_id` after a successful insert, and
`already_completed` reads the persisted `profile_id` from `onboarding_state`, `:136`).

### Before / after behavior

**Before.** The route inspected only `rpcError` (the transport/PG-error channel). On an in-body
`status:'error'` (invalid role, or any `EXCEPTION WHEN OTHERS` insert failure), `rpcError` was null,
so execution fell straight through to the success return:

```ts
// (old) after the `if (rpcError) { … return 500 … }` block:
return NextResponse.json({
  success: true,
  data: {
    status: result?.status || 'success',   // could be 'error'
    profile_id: result?.profile_id,         // undefined on failure
    role,
    redirect: destination,
  },
});
```

Result: HTTP 200 `success:true` with `profile_id` undefined — a masked failure. The client treated it
as a completed signup, redirected to a profile-less portal, and fired `signup_complete` prematurely;
the P15 layer-3 AuthContext fallback never engaged.

**After.** A new guard sits immediately after the `rpcError` block and before the success audit/return.
It branches on the RPC's in-body contract:

```ts
const rpcStatus = typeof result?.status === 'string' ? result.status : undefined;
const profileId = result?.profile_id;
if (rpcStatus === 'error' || !profileId) {
  const failureCtx = extractAuditContext(request, admin, user.id);
  await logIdentityEvent(failureCtx, 'bootstrap_failure', {
    error: rpcStatus === 'error' ? 'rpc_logical_error' : 'missing_profile_id',
    role,
    rpc_status: rpcStatus ?? 'unknown',
  });
  console.error('[Bootstrap] RPC logical failure (no profile created):', {
    userId: user.id, role, rpcStatus: rpcStatus ?? 'unknown',
  });
  return NextResponse.json(
    { success: false, error: 'Profile creation failed. Please try again.', code: 'BOOTSTRAP_FAILED' },
    { status: 500 }
  );
}
```

When the RPC reports a logical error (or returns no `profile_id`), the route now returns a non-200
`{ success:false, code:'BOOTSTRAP_FAILED' }` — the same shape the pre-existing `rpcError` branch
returns — so the client's next failsafe layer (AuthContext runtime fallback) takes over. The success
audit + return below run ONLY when a profile genuinely exists, so the happy-path response is unchanged
byte-for-byte (`status:'success'`/`'already_completed'` both carry `profile_id`, satisfying the guard).

### Why P15 is preserved

- **3-layer failsafe restored, not weakened.** Previously the API masked a logical failure as success,
  so layer 3 (AuthContext runtime fallback) was never invoked. Returning a non-200 on real failure is
  precisely what hands control to that layer — the change makes the failsafe MORE complete, never less.
- **No new break paths.** The non-200 mirrors the existing `rpcError` 500 the client already handles;
  no new client contract. Graceful degradation is preserved — the route returns a structured response,
  never an unhandled throw.
- **Happy path byte-for-byte unchanged.** Both success statuses carry `profile_id`; the guard is a
  no-op for them. The downstream minor guardian-invite block (`result?.profile_id`) and final redirect
  are untouched.
- **Idempotency intact.** The in-memory + Redis dedup and the RPC's `ON CONFLICT` idempotency are
  unchanged; the guard only reinterprets an already-returned result. Retry spacing is governed by the
  same 30s Redis TTL as the pre-existing 500 path.
- **P13 (no PII).** Audit metadata is role + static token + `rpc_status` only; the raw `SQLERRM` is NOT
  logged. The diagnostic `console.error` carries only a UUID (`user.id`), `role`, and status — no
  name/email/grade.

### AO-9 transitive resolution
With AO-4, the bootstrap 2xx signal is trustworthy, so the client's `res.ok`-gated `signup_complete`
event no longer fires on a masked failure. The dedicated client-side analytics gate hardening, if
desired, is a frontend follow-up in `AuthContext.tsx` and is not required for AO-4's correctness.

### Backend self-review

- **Logic.** Failure condition `rpcStatus === 'error' || !profileId` covers both no-raise error
  branches (`:224`, `:233`) and any future logical error; success branches (`:316`, `:177`) both
  carry `profile_id` so the guard is a no-op for them. Verified against the RPC body line-by-line.
- **Error handling.** The new branch returns a structured non-200; it does not throw. The audit write
  is best-effort via the existing `logIdentityEvent` (which is itself fail-soft) and is awaited exactly
  like the pre-existing `rpcError` audit, so it cannot escalate into an unhandled rejection. The outer
  `try/catch` in `handleBootstrap` still backstops any unexpected throw with a 500.
- **No PII in logs.** Confirmed: only `role`, a static error token, `rpc_status`, and the UUID
  `user.id` are logged. No name/email/grade; raw `SQLERRM` intentionally omitted (could embed a column
  value). Consistent with P13 and with the file's existing redaction posture.
- **No behavior change on happy path.** The success audit (`bootstrap_success` /
  `bootstrap_idempotent`), the minor guardian-invite enqueue, and the final redirect response are all
  unchanged and unreachable only when a profile does not exist. `npm run type-check` passes clean.
- **Scope.** Exactly one code file touched; no schema/migration change; rollback = `git revert`.

---

### AO-8 (frontend) — auth-form accessibility (labels + full tab ARIA)

**Status:** DONE. **APPROVED** by independent quality validation.
**Files changed:** `src/components/auth/AuthScreen.tsx`, `src/app/onboarding/page.tsx` (markup/ARIA only;
no logic, visual, or copy change). **Type-check / lint / test / build:** PASS (see `07-validation.md`).

#### What changed

- **Role tablist semantics (`AuthScreen.tsx`).** The `role="tablist"` now drives a real ARIA tab widget:
  each role `<button role="tab">` carries `aria-selected`, `aria-controls`, and a roving `tabIndex`
  (selected tab `0`, others `-1`) with arrow-key (Left/Right/Home/End) navigation that moves focus and
  selection together. The associated panel is wired as a `role="tabpanel"` with `aria-labelledby` back to
  the active tab.
  - **Dangling-ref guard:** the `tabpanel` association is **gated to `mode !== 'check-email'`** — in the
    check-email state the tabbed form is not rendered, so emitting `aria-controls`/`tabpanel` there would
    point at a non-existent node. Gating avoids a dangling ARIA reference (a real AT bug, not cosmetic).
- **Form-level error association (`AuthScreen.tsx`).** The existing `role="alert"` message region is now
  referenced by the form via `aria-describedby`, so an error is announced and programmatically tied to
  the form, not just visually present.
- **Onboarding field labelling (`onboarding/page.tsx`).** Grade and board `<select>`s now have explicit
  `<label htmlFor>` ↔ `id` pairing; the learning-goal chip set is wrapped in `role="group"` with
  `aria-labelledby` pointing at its heading, so the group has an accessible name.

#### Invariant posture
- **P7 (bilingual) preserved.** No user-facing copy added or changed; all labels reuse existing
  `isHi`-aware strings. (One **pre-existing** English-only string — the tablist `aria-label="Account
  type"` — is noted by validation as a future P7 pass; it was NOT introduced this cycle.)
- **No logic / visual / behavior change.** Pure markup + ARIA + keyboard-handler additions. No data path
  touched, so P8/P9/P13 are not in scope for this item. UX-audit sign-off recorded in `07-validation.md`.
- **Rollback:** `git revert` of the component edits; no schema, no migration.

---

### AO-1 / AO-2 (testing) — executable always-200 test + honest 3-role E2E

**Status:** DONE (AO-1 fully landed; AO-2 landed test-fixme-gated pending CI seeding). **APPROVED** by
independent quality validation.

#### AO-1 — `send-auth-email` always-200 invariant now has a real executable test
- **File added:** `supabase/functions/send-auth-email/__tests__/always-200.test.ts` — **10 Deno tests**,
  behavioral handler-capture style (imports/invokes the function's request handler and asserts the HTTP
  status it returns), covering **all 9 documented handler paths** (non-POST, missing secret, bad
  signature, invalid payload, no Mailgun config, send success, send failure, top-level throw, OPTIONS)
  plus a **source canary** that fails if a code path can return a non-200 status.
- **Placeholder removed:** the `expect(true).toBe(true)` marker in `e2e/auth-onboarding-p15.spec.ts` is
  replaced with a **real fs-guard** assertion (verifies the always-200 Deno suite exists on disk) — the
  regression catalog no longer over-reports coverage that does not exist.
- **AO-4 regression test (filed under this cycle):** `src/__tests__/api/auth/bootstrap-rpc-logical-failure.test.ts`
  — **7 vitest** that pin the AO-4 behavior (in-body `status:'error'` / missing `profile_id` → 500
  `BOOTSTRAP_FAILED`, happy/idempotent paths unchanged) and the **P13 metadata-only audit** shape.
- **Root-cause closure:** the infra blocker (no Deno harness) is removed at lowest cost — the function is
  now testable from the Deno lane; CI wiring of this suite into `ci.yml`'s `edge-function-tests` Deno lane
  is a **separate architect task** (in flight, see Deferred), and a **separate testing task** files
  **REG-177** (`send_auth_email_always_200`, P15) into `.claude/regression-catalog.md`.

#### AO-2 — honest 3-role signup→profile→dashboard E2E (NOT fake-green)
- **File added:** `e2e/auth-onboarding-3role.spec.ts` — drives student / teacher / parent through
  signup → profile → dashboard with **real assertions** (no `if (isOnOnboarding)` conditional-positive
  guards). Because CI does not yet have per-role seeded staging credentials, the spec is **honestly
  `test.fixme`-gated** on the absent fixtures, with the **seeding requirements documented in the spec
  header**. This is deliberately a tracked, visible gap — NOT a silent skip and NOT a fake-green pass.
- **Un-gating is a follow-up:** ops must seed 3 per-role staging fixtures + secrets (documented in the
  spec header) before the `test.fixme` is lifted. Tracked in Deferred and in `STATUS.md`.
- **Rollback for AO-1/AO-2:** revert the test/spec files; no app code involved.
