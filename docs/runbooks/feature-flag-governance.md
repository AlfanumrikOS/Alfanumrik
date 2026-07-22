# Feature Flag Governance Runbook

**Owner:** architect (schema/RLS/DB guard), ops (day-to-day operation of the console + canary alerts).
**Status:** live as of 2026-07-22 (Phase 0 of the flag-governance hardening program).

## Why this exists

Two incidents made it clear that a single confirm-typing gate at the console
API layer is not enough:

1. **2026-06-21** — a premature manual enable of a constitution-pinned flag.
2. **2026-07-20** — a console bulk-enable action re-armed 49 of 52
   CEO-approved forced-OFF flags at rollout 100 in one click. Restored by
   migration `20260720130000_restore_approved_flag_posture.sql`.

The fix that shipped immediately after incident #2 —
`packages/lib/src/flags/protected-flags.ts` + the confirm-gate in
`apps/host/src/app/api/super-admin/feature-flags/route.ts` — is
**application-layer only**. It does nothing to stop a mutation issued
directly against Postgres (Supabase Studio SQL editor, a one-off `psql`
session, a CI script with the service-role key, etc.), which is the likely
vector for incident #2's underlying action. This runbook documents the
**Phase 0** hardening that closes that gap, and the operating procedure going
forward.

## Source of truth

**`packages/lib/src/flags/protected-flags.ts` is the single source of truth**
for which flags are protected and why. Everything else in this document and
in the DB is a *mirror* of that file:

- `public.protected_feature_flags` (migration
  `20260722090000_protected_feature_flags_registry.sql`) — a 1:1 DB mirror
  of `PROTECTED_FLAGS`, read by the DB-layer trigger below.
- A static parity test
  (`apps/host/src/__tests__/api/super-admin/feature-flags-protected-guardrail.test.ts`,
  describe block `protected_feature_flags DB/TS registry parity`) pins the TS
  registry and the DB seed migration together so they cannot silently drift.

**If you add, remove, or re-tier a flag in `protected-flags.ts`, you MUST add
a companion migration updating `protected_feature_flags` in the SAME PR.**
The parity test will fail CI otherwise.

## The four layers (defense in depth)

| Layer | What it does | Can be bypassed by |
|---|---|---|
| 1. Console confirm-gate (`route.ts`) | Requires `body.confirm === flag_name` for any transition that makes a protected flag MORE enabled (or, for `special_do_not_touch`/`p11_payment`, LESS enabled). | A direct Postgres write (Studio, `psql`, a script with the service-role key) |
| 2. DB BEFORE UPDATE trigger (`trg_protect_feature_flags`, migration `20260722090100`) | Blocks the SAME class of transition at the row level, unless the transaction has `SET LOCAL app.protected_flag_ack = '<flag_name>'` armed. | A direct UPDATE that supplies the ack GUC itself (only the RPC below does this) — this is closed by keeping the ack-setting code path DEFINER-only and never client-reachable |
| 3. `admin_flip_feature_flag` RPC (migration `20260722090200`) | The ONLY code path that both validates the confirm AND arms the ack GUC, atomically with the UPDATE + an `admin_audit_log` row. Direct-column UPDATE privilege on `is_enabled`/`rollout_percentage` is REVOKEd from `authenticated`. | Nothing at the `authenticated` role level; `service_role` can still call the RPC or (for non-gated transitions) write directly — this is intentional, service_role IS the trusted operator surface |
| 4. Velocity/burst guard (`route.ts`, 2026-07-22) | If the same admin makes more than 3 CONFIRMED protected-flag mutations in a trailing 10-minute window, the 4th+ requires a SECOND typed token: `bulk_confirm === "BULK-<ordinal>-<flag_name>"`. Refused attempts are logged under the distinct action `feature_flag.bulk_mutation_burst`. | Nothing — this is the guard that would have caught incident #2 after the 3rd flag |

**Known residual gaps (explicitly out of Phase 0 scope, tracked for a
follow-up phase):**
- The DB trigger is `BEFORE UPDATE` only. A direct `INSERT` (creating a new
  row under a protected name with `is_enabled=true` from the start) or a
  direct `DELETE` of a protected row is **not** blocked at the DB layer —
  only at the console API layer (which already gates POST/DELETE with the
  same confirm requirement). If you are hardening this further, add
  `BEFORE INSERT` / `BEFORE DELETE` triggers using the same
  `protected_feature_flags` lookup.
- Every migration that ships an intentional flag flip must currently
  self-document with a `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` marker
  comment (enforced by `scripts/check-protected-flag-migrations.mjs` in CI —
  see below). This is a text-based heuristic, not a cryptographic proof of
  approval; treat it as a review-forcing function, not a security boundary.

## Tiers and who approves what

Tiers are defined in `packages/lib/src/flags/protected-flags.ts`
(`ProtectedTier` union). Approval requirements below are process, not
mechanically enforced by any hook — the mechanical enforcement is the
confirm-gate + trigger + RPC + burst guard above, which stop an ACCIDENTAL
flip; approval is about whether a DELIBERATE flip should happen at all.

| Tier | Meaning | Approval required before flipping |
|---|---|---|
| `p0_outage` | Enabling without deployed preconditions breaks a P0 surface (e.g. quiz submission) for all students. | **CEO + architect co-sign.** Verify the deployed precondition exists first (check the tier's `reason` string in `protected-flags.ts` for what that precondition is). |
| `p11_payment` | Payment-coupled — enabling requires a real-world dependency (e.g. a live Razorpay SKU) to exist first. | **CEO + architect co-sign**, plus backend confirmation the payment-side dependency is live. |
| `special_do_not_touch` | Payment kill-switches, standing CEO exclusions, or metadata-envelope-controlled flags (`ff_python_*`) where the `is_enabled`/`rollout_percentage` columns are not even the real control surface. | **CEO + architect co-sign.** For `ff_python_*` flags: do not use the console at all — see the flag's `reason` string for the real control surface (the `metadata` jsonb envelope via python-ai-proxy). |
| `ai_provider` | Changes which AI provider serves a surface (MoL program). | **CEO + architect co-sign** (matches the constitution's "AI model or provider changes" approval gate). |
| `constitution_pinned` | Default-OFF per `.claude/CLAUDE.md`; has a staged-rollout runbook associated with it (see the flag's own runbook, e.g. `docs/runbooks/adaptive-remediation-rollout.md`, `docs/runbooks/adaptive-program-rollout.md`). | **Runbook-stage-gate required** — follow that flag's specific rollout runbook. Do not flip ahead of the runbook's stated stage even with CEO verbal approval; the runbook exists precisely so ramps are staged and observed. |
| `staged_rollout` | CEO-approved forced-OFF posture for a not-yet-built, not-yet-launched, or retired feature (see migration `20260720110000` for the original 52-flag block). | **Documented reason required** (a PR description or Linear ticket citing why this feature is now ready) — no separate co-sign, but the reason must be recorded before flipping, and the flip should still go through the confirm-gate/RPC path like any protected flag. |

## Operating procedure: flipping a protected flag

1. **Confirm the tier and its approval requirement** from the table above
   (or directly from `getProtection(flagName)` in `protected-flags.ts`).
2. **Get the required sign-off** (CEO/architect co-sign, or a recorded
   reason, per the tier).
3. **Use the console**, not a direct DB write. The console PATCH endpoint
   (`/api/super-admin/feature-flags`) will prompt for `confirm` if you omit
   it; supply the exact flag name.
4. **If you are the 4th+ protected-flag mutation you've made in the last 10
   minutes**, the console will additionally ask for `bulk_confirm`. This is
   not a bug — it is the burst guard. Supply the exact token it echoes back
   (`BULK-<n>-<flag_name>`). If you are seeing this and did NOT intend to
   make several protected flips in a row, STOP and investigate before
   proceeding — this is exactly incident #2's shape.
5. **Never issue a raw SQL `UPDATE feature_flags ...`** against a protected
   flag outside of an approved migration with a
   `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` marker. The DB trigger will
   reject it anyway (see Layer 2 above) unless you also know how to arm the
   `app.protected_flag_ack` GUC, which is deliberately not documented for
   interactive use — if you find yourself trying to do this, use the console
   or the RPC directly with a proper actor id and audit trail, not a bare
   `SET LOCAL`.
6. **If a migration must ship a flag flip** (e.g. a coordinated release that
   turns a flag on as part of a larger rollout), add the
   `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` marker comment to that migration
   file. `scripts/check-protected-flag-migrations.mjs` (run in CI on every PR
   touching `supabase/migrations/`, see `.github/workflows/ci.yml` job
   `protected-flag-migration-guard`) will fail the PR otherwise.

## Responding to a flag-posture-canary alert

The nightly canary (`/api/cron/flag-posture-canary`, Vercel cron at 03:25
UTC) compares live `feature_flags` rows against `EXPECTED_OFF_FLAGS` (plus
the P11 kill-switch and the MoL shadow-flag metadata contract) and raises an
`ops_events` row (severity `error`) plus an `audit_logs` row on any drift.

**As of 2026-07-22, the SAME canary also runs synchronously as a deploy-time
gate**: `.github/workflows/deploy-production.yml`'s `health-check` job calls
`/api/cron/flag-posture-canary` right after the app health check and fails
the deploy job (without triggering an automatic code rollback — see the
step's comment for why) if any drift is found.

If you see a canary alert (nightly or deploy-time):

1. **Do not panic-disable the flag from the console first** — read the
   `drift` payload in the alert (flag names + current state only, no PII).
   Compare against what you expect the posture to be.
2. **Check `admin_audit_log` / `audit_logs`** for recent `feature_flag.*`
   actions around the drift's `updated_at` — every console mutation (and
   every RPC-routed mutation) leaves a row with `tier` and
   `protected_confirmed` fields (as of 2026-07-22). A drift with NO
   corresponding audit row strongly suggests a direct-Postgres mutation
   bypassed the console entirely — escalate to architect immediately, this
   is exactly the class of incident this hardening exists to catch.
3. **If the drift is a genuine, approved change** that the registries simply
   haven't caught up to yet (e.g. a flag's approved posture changed and
   `EXPECTED_OFF_FLAGS`/`protected_feature_flags` need updating): update
   `protected-flags.ts` AND the companion migration together, run the parity
   test, and ship the fix.
4. **If the drift is NOT approved**: use the console (with the proper
   confirm/bulk_confirm flow) to restore the flag to its expected posture,
   then investigate how the unapproved change happened.

## Where things live (quick reference)

| Concern | File |
|---|---|
| TS registry (source of truth) | `packages/lib/src/flags/protected-flags.ts` |
| DB mirror table + RLS | `supabase/migrations/20260722090000_protected_feature_flags_registry.sql` |
| DB BEFORE UPDATE guard trigger | `supabase/migrations/20260722090100_feature_flags_db_guard_trigger.sql` |
| Sanctioned RPC write path | `supabase/migrations/20260722090200_admin_flip_feature_flag_rpc.sql` |
| Console API (confirm-gate, RPC routing, burst guard, audit) | `apps/host/src/app/api/super-admin/feature-flags/route.ts` |
| CI migration guard script | `scripts/check-protected-flag-migrations.mjs` |
| CI job wiring the guard script | `.github/workflows/ci.yml` (job `protected-flag-migration-guard`) |
| Deploy-time canary gate | `.github/workflows/deploy-production.yml` (`health-check` job, step "Flag posture canary check") |
| Nightly canary route | `apps/host/src/app/api/cron/flag-posture-canary/route.ts` |
| DB/TS parity test | `apps/host/src/__tests__/api/super-admin/feature-flags-protected-guardrail.test.ts` |

## Change log

- **2026-07-22** — Phase 0 of the flag-governance hardening program (this
  runbook's initial version). Added the DB-layer trigger, the
  `admin_flip_feature_flag` RPC, the velocity/burst guard, the CI migration
  guard script, and the deploy-time canary gate. Added
  `ff_productive_failure_v1` and `ff_pedagogy_v2_monthly_synthesis` to the
  registry (both `constitution_pinned`) as they were found live but
  unprotected during this hardening pass.
