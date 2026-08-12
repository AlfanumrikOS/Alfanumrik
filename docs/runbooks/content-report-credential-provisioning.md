# Runbook — Provision the read-only content-reporting credential (OD-1)

**Owner:** architect (role/RBAC + credential) · **Co-owner:** ops (workflow + environment settings)
**Closes:** OD-1 and OD-4 in `docs/runbooks/content-gap-detection.md`
**Artifact:** `supabase/migrations/20260814000015_content_reporter_readonly_role.sql`
**Status when written:** PREPARED, NOT APPLIED. Nothing in this runbook has been executed.

This provisions `SUPABASE_CONTENT_REPORT_KEY` — the least-privilege credential
that lets `.github/workflows/content-quality-nightly.yml` stop borrowing the
RLS-bypassing `SUPABASE_SERVICE_ROLE_KEY`.

---

## ⛔ READ THIS FIRST — THIS WORKING COPY POINTS AT PRODUCTION

The Supabase CLI in this repository is **linked to `shktyoxqhundlvkiwguu`, which
is PRODUCTION** (`.env.local`). Staging is a *different* project,
`gzpxqklxwzishrkiaatd` (`.env.staging.local`).

**Any `supabase db push`, `supabase db reset`, or `supabase migration` command
run from this directory hits the live production database by default.** There is
no confirmation prompt that names the environment for you.

Consequences to internalise before Step 2:

- Do **not** run `supabase db push` to "test" this migration. There is no test
  mode; the link is production.
- The migration is additive and idempotent, but it is still DDL against a live
  database serving students.
- Applying it is a **separately approved action**, not part of preparing it.

Every command in Steps 0, 3, 4, 5 and 6 is safe — they touch GitHub only, never
a database. **Step 2 is the only step that writes to a database**, and it is
fenced accordingly.

---

## Step 0 — Resolve the credential-reachability contradiction (do this FIRST)

Two runs (`30325456772`, `30326862812`) already aborted at preflight because
somebody *inferred* which environment held the Supabase secrets.
`.github/workflows/rag-cosine-replay.yml:91-95` records — from the settings page,
explicitly "NOT inferred" — that `SUPABASE_SERVICE_ROLE_KEY` lives in the
**`supabase`** environment, not `production-ops`.

**Confirm it. Do not infer it.** These commands print secret *names* only —
GitHub never returns secret values through the API, so this is safe to run and
safe to paste into a ticket.

```bash
# 0a. What environments exist at all?
gh api repos/AlfanumrikOS/Alfanumrik/environments --jq '.environments[].name'

# 0b. What does production-ops actually hold? (the nightly reads from here)
gh secret list --env production-ops --repo AlfanumrikOS/Alfanumrik

# 0c. What does the `supabase` environment hold? (where the service key is said to live)
gh secret list --env supabase --repo AlfanumrikOS/Alfanumrik

# 0d. Repo-level secrets, visible to every environment
gh secret list --repo AlfanumrikOS/Alfanumrik
```

Interpret the output against this table:

| Observation on `production-ops` | Meaning | Action |
|---|---|---|
| `SUPABASE_URL` absent | The nightly's preflight exits 1 **tonight**, before any credential logic runs | Must be added — Step 3b |
| `SUPABASE_URL` present | Preflight passes | Nothing |
| `SUPABASE_SERVICE_ROLE_KEY` absent | Confirms the `rag-cosine-replay` note. The current fallback is a **dead branch** — it resolves to empty and the job fails every night | Expected. Do **not** fix by copying the service key here |
| `SUPABASE_SERVICE_ROLE_KEY` present | The note has gone stale; the fallback works today | Record it; still proceed |
| `SUPABASE_CONTENT_REPORT_KEY` absent | OD-1 open | This runbook |

> **Do not resolve a missing service key by adding it to `production-ops`.**
> Scoping it to the `supabase` environment deliberately keeps an RLS-bypassing
> credential out of reach of every other workflow. Widening it undoes exactly
> the containment that commit `b66c25c3b` bought. The correct end state is the
> read-only key, which is what the rest of this runbook creates.

---

## Step 1 — Confirm the project still has a legacy JWT secret

The two scripts talk to **PostgREST via `@supabase/supabase-js`**, not to
Postgres over libpq. This is decisive and is worth stating plainly:

> **A Postgres connection string is USELESS here.** `scripts/check-content-gaps.ts`
> and `scripts/audit-question-quality.ts` both call `createClient(url, key)`.
> The credential must be an **API key (a JWT)**, not a DSN. Handing the operator
> a `postgresql://…` string would require rewriting both scripts.

PostgREST authenticates as `authenticator` and runs `SET LOCAL ROLE` from the
token's `role` claim. So the credential is a JWT with `role: content_reporter`,
signed with the **project JWT secret**.

Find it: **Supabase Dashboard → Project Settings → API → JWT Settings → JWT Secret.**

- **If a JWT Secret is shown** → continue to Step 2. This is the normal case.
- **If the project has migrated to the new API-key system** (`sb_publishable_…` /
  `sb_secret_…`) **and legacy JWT signing is disabled** → **STOP and escalate to
  architect.** The new secret keys map to `service_role`; they are not a
  drop-in least-privilege credential. Re-enabling legacy JWTs, or changing the
  scripts' client construction, is a design decision, not an operator call.

---

## Step 2 — Apply the migration ⚠️ DATABASE WRITE — SEPARATE APPROVAL REQUIRED

`supabase/migrations/20260814000015_content_reporter_readonly_role.sql` creates
the role, the column-level grants and the two RLS policies. It is additive,
idempotent, drops nothing, and **refuses to commit half-provisioned** — its
verification block raises an exception if the role ends up with `BYPASSRLS`, with
`LOGIN`, without both policies, or with the wrong number of granted columns.

**Do not run this from this working copy on a whim — the CLI here is linked to
production (see the banner above).**

Recommended order:

1. **Staging first.** Apply against `gzpxqklxwzishrkiaatd` and confirm the
   `NOTICE: verified: content_reporter NOLOGIN/NOBYPASSRLS, 2 scoped SELECT
   policies, 4 rag columns, 20 question_bank columns…` line appears.
2. **Smoke-test the token against staging** (Step 4) *before* touching production.
   This is the step that proves the API gateway accepts a custom-role JWT at all
   — the one assumption in this design that cannot be verified from source.
3. **Then production**, as a normal reviewed migration deploy.

Post-apply sanity check, read-only, safe to run against either environment:

```sql
-- Exactly 2 rows expected, both FOR SELECT.
SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE 'content_reporter' = ANY (roles);

-- Expect rolcanlogin = f, rolbypassrls = f.
SELECT rolname, rolcanlogin, rolbypassrls
  FROM pg_roles WHERE rolname = 'content_reporter';

-- Expect 4 (rag_content_chunks) and 20 (question_bank), nothing else.
SELECT table_name, count(*)
  FROM information_schema.column_privileges
 WHERE grantee = 'content_reporter' AND privilege_type = 'SELECT'
 GROUP BY table_name;
```

---

## Step 3 — Mint the token and set it on `production-ops`

### 3a. Mint + store in one pipe (the token never touches disk or shell history)

Paste the JWT secret when prompted — it is read into an env var, **not** passed
as an argument, so it never appears in `ps` output or shell history.

```bash
cd /path/to/Alfanumrik

read -rsp 'Paste Supabase JWT Secret (input hidden): ' SUPABASE_JWT_SECRET
export SUPABASE_JWT_SECRET
echo

node -e '
  const crypto = require("crypto");
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) { console.error("SUPABASE_JWT_SECRET not set"); process.exit(1); }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60 * 24 * 365;            // HARD EXPIRY: 365 days
  const data = b64({ alg: "HS256", typ: "JWT" }) + "." +
               b64({ role: "content_reporter", iss: "supabase", iat, exp });
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  process.stdout.write(data + "." + sig);
' | gh secret set SUPABASE_CONTENT_REPORT_KEY \
      --env production-ops \
      --repo AlfanumrikOS/Alfanumrik

unset SUPABASE_JWT_SECRET
```

If you need to inspect the token first, replace the pipe with
`> /tmp/tok && head -c 40 /tmp/tok` — then `shred -u /tmp/tok` immediately.
Prefer the pipe.

**Hard expiry.** The `exp` above is deliberate and is the mechanism that retires
the "acceptable interim". Service-role keys effectively never expire; this one
does. Trade-off, stated openly: on expiry the nightly goes **loudly red**, not
silently blind — an expired JWT makes every query 401, the script exits non-zero
and the verdict step reports a detector error. That is the correct direction to
fail, but it *is* noise if nobody is expecting it. **Diarise renewal at 335
days**; renewal is this single command again.

### 3b. Add `SUPABASE_URL` if Step 0b showed it missing

```bash
gh secret set SUPABASE_URL --env production-ops --repo AlfanumrikOS/Alfanumrik
# paste: https://shktyoxqhundlvkiwguu.supabase.co
```

Note the workflow maps `secrets.SUPABASE_URL` onto the `NEXT_PUBLIC_SUPABASE_URL`
env var the scripts actually read. That indirection is intentional; leave it.

### 3c. Confirm the names landed

```bash
gh secret list --env production-ops --repo AlfanumrikOS/Alfanumrik
# expect BOTH: SUPABASE_CONTENT_REPORT_KEY, SUPABASE_URL
```

---

## Step 4 — Smoke-test before trusting it

Run against **staging first**. This proves the whole chain — gateway accepts the
custom-role JWT, `authenticator` can `SET ROLE`, RLS policies return rows,
column grants cover the select lists.

```bash
NEXT_PUBLIC_SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<the content_reporter token>' \
  npx tsx scripts/check-content-gaps.ts --json | head -40
```

(The env var is named `SUPABASE_SERVICE_ROLE_KEY` because that is what the script
reads; it is holding the *reporting* token here. Renaming that variable is a
follow-up for whoever owns the scripts — see the ops handoff below.)

Acceptance:

| Signal | Pass | Fail means |
|---|---|---|
| `paginationComplete` | `true` | Truncated read — do not trust counts |
| `totalRagChunks` | plausible vs ~16,006 corpus | `0` → policy/grant missing, or gateway rejected the role |
| `totalQuestions` | non-zero | as above |
| `ragUnattributed` | plausible, not equal to total | backfill signal, not a credential fault |
| HTTP 401 / `JWSError` | absent | JWT secret wrong, or legacy JWT signing disabled (Step 1) |
| `permission denied for column …` | absent | grant list drifted from the script's select list |

**A `0` row count here is the failure this whole work item exists to prevent.**
Do not proceed to Step 6 until counts are real.

---

## Step 5 — The two settings only a human can change (OD-4)

Inspect current state:

```bash
gh api repos/AlfanumrikOS/Alfanumrik/environments/production-ops \
  --jq '{deployment_branch_policy, protection_rules}'
```

### 5a. Deployment branch policy = `main` only — REQUIRED

```bash
gh api -X PUT repos/AlfanumrikOS/Alfanumrik/environments/production-ops \
  --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON

gh api -X POST \
  repos/AlfanumrikOS/Alfanumrik/environments/production-ops/deployment-branch-policies \
  -f name='main' -f type='branch'

# Verify: exactly one entry, named "main"
gh api repos/AlfanumrikOS/Alfanumrik/environments/production-ops/deployment-branch-policies \
  --jq '.branch_policies[].name'
```

This is the containment. `workflow_dispatch` can be fired against **any** ref;
without this policy, a dispatch from an attacker-controlled branch executes
branch-controlled script content while holding a production credential. That is
the precise hole `b66c25c3b` closed. The workflow's in-file
`if: github.ref == 'refs/heads/main'` is defence in depth, **not** a substitute —
it is editable by whoever controls the branch being dispatched.

### 5b. Required reviewers — MUST REMAIN EMPTY

```bash
# Expect EMPTY output. Any output here is a defect.
gh api repos/AlfanumrikOS/Alfanumrik/environments/production-ops \
  --jq '.protection_rules[] | select(.type=="required_reviewers")'
```

**Do not add required reviewers, and remove them if present.** This is an
unattended 04:00 UTC scheduled job. A required reviewer parks every scheduled run
in "Waiting for approval" until it expires — the detector goes permanently
silent while the workflow still looks configured and enabled. That is the
green-but-blind failure this restore exists to eliminate. It is the branch
policy, not a human gate, that supplies containment here.

Same reasoning applies to a **wait timer**: leave it at 0.

---

## Step 6 — Handoff to ops: delete the service-role fallback

**Do this only after Step 4 passes against production.** Precise change,
`.github/workflows/content-quality-nightly.yml` — ops owns this file.

Two `env:` blocks, lines **217** and **242**:

```yaml
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_CONTENT_REPORT_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

becomes:

```yaml
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_CONTENT_REPORT_KEY }}
```

The preflight block, lines **188-210**, drops its `SERVICE_KEY` input and its
`elif` branch:

```yaml
      - name: Resolve reporting credential
        id: cred
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          READONLY_KEY: ${{ secrets.SUPABASE_CONTENT_REPORT_KEY }}
        run: |
          if [ -z "$SUPABASE_URL" ]; then
            echo "::error::SUPABASE_URL is not available to this workflow. The content-gap detector cannot run and is therefore BLIND. Provision the secret on the production-ops environment."
            exit 1
          fi
          if [ -z "$READONLY_KEY" ]; then
            echo "::error::SUPABASE_CONTENT_REPORT_KEY is not available. The content-gap detector cannot run and is therefore BLIND. See docs/runbooks/content-report-credential-provisioning.md."
            exit 1
          fi
          echo "Using SUPABASE_CONTENT_REPORT_KEY (read-only reporting credential)."
          echo "kind=readonly" >> "$GITHUB_OUTPUT"
```

Also for ops, in the same pass:

- Delete the `!! LIKELY-BLOCKING, UNVERIFIED FROM INSIDE THIS REPO !!` block
  (lines 53-66) and mark restore condition 3 `[x]` in the header.
- Update `docs/runbooks/content-gap-detection.md`: OD-1 and OD-4 → **CLOSED**,
  cross-link this runbook, and leave OD-5 (one trustworthy live run) **OPEN**.
- **Do not flip `CONTENT_GAP_MODE=escalate` in the same change.** OD-5 still
  gates it.

Keep `kind` as a step output — the verdict step consumes `CRED_KIND`.

---

## Rollback

Revoking access does **not** require dropping the role (and no `DROP` is
authorised without user approval). Fastest revocation, in order of speed:

1. **Instant, no DB access:** delete the GitHub secret.
   `gh secret delete SUPABASE_CONTENT_REPORT_KEY --env production-ops --repo AlfanumrikOS/Alfanumrik`
2. **Cut the credential dead at the database** (leaves the role in place):
   `REVOKE content_reporter FROM authenticator;` — PostgREST can no longer
   `SET ROLE`, every request 42501s.
3. **Narrow without revoking:** `DROP POLICY "rag_content_chunks_content_reporter_read" ON public.rag_content_chunks;`
   — the role keeps its grants but reads zero rows.

Rotating the JWT secret invalidates this token **and every other project key**
(anon and service_role included). Never rotate it as a targeted revocation for
this credential; use option 1 or 2.
