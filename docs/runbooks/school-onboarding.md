# Runbook — School Onboarding (End-to-End)

**Scope:** the complete operator playbook for taking a new school tenant from "contract signed" to "students are using the platform." Covers the school record, white-label DNS, feature flags, email infrastructure, an end-to-end smoke test, monitoring, and off-boarding hand-off.

**Pairs with:**
- [`docs/runbooks/per-school-backup-restore.md`](./per-school-backup-restore.md) — the inverse runbook (offboarding/erasure).
- [`docs/runbooks/2026-05-07-single-school-flag-rollout.md`](./2026-05-07-single-school-flag-rollout.md) — drill-down for any flag flip during onboarding.
- [`docs/runbooks/sentry-alert-setup.md`](./sentry-alert-setup.md) — per-tenant monitoring rules.

**Owner:** ops + customer-success. Requires:
- Service-role access to prod Supabase project (`shktyoxqhundlvkiwguu`).
- Vercel deploy + domain admin on the `alfanumrik` project.
- DNS edit access (Cloudflare or the customer's registrar — depending on white-label posture).
- Mailgun console access (`mg.alfanumrik.com` domain).
- Sentry + PostHog org access (for §7 monitoring set-up).

**Targets:**
- **TTL** (time-to-live): a small pilot (≤ 50 students) is fully smoke-tested within **4 hours** of contract counter-sign. Larger or custom-domain tenants stretch to **1 business day**.
- **Reversibility:** every step in §2-§5 is reversible via the inverse SQL in the linked runbook. The point of no return is §6 step 4 (admin signs in for the first time, creating an `auth.users` row that the admin can never voluntarily release without going through the DPDP erasure flow — D.3).

---

## 1. Pre-onboarding checklist

Block on every item below before doing anything in Supabase, DNS, or Vercel. If any is missing, push back to the AE / customer-success owner — onboarding a school halfway is much worse than not at all.

### 1.1 Commercial + legal

- [ ] **Signed contract** on file (Docusign envelope ID + countersigned PDF in `s3://alfanumrik-legal/contracts/`).
- [ ] **DPDP processor agreement** countersigned. If this is missing, **stop** — without it, any production data we ingest is unlawful under DPDP §8(1). Escalate to DPO before continuing.
- [ ] **Razorpay invoicing details** captured: school's GSTIN (for GST invoicing — see `supabase/migrations/20260507130003_add_ff_gst_invoicing_v1.sql`), billing contact email, PO number if applicable.
- [ ] **Plan tier** decided (`trial`, `family`, `school`, `school_plus`). `trial` is the default; everything else requires a CRM ticket reference.

### 1.2 Tenant inputs (must collect from school)

Use the canonical intake form. The fields below map 1:1 to `POST /api/schools/trial` body parameters and `school_admins` / `school_subscriptions` rows.

| Field | Source | Required | Notes |
|---|---|---|---|
| School legal name | Contract | yes | Maps to `schools.name`. Max 200 chars (enforced by route). |
| Primary contact name | Intake form | yes | Maps to `schools.principal_name`. Max 100 chars. |
| Primary contact email | Intake form | yes | Maps to `schools.email`. UNIQUE — duplicate returns HTTP 409. |
| Primary contact phone | Intake form | yes for pilot | Maps to `schools.phone`. E.164 preferred. |
| Expected pilot size | Intake form | yes | Drives `school_subscriptions.seats_purchased` (default 50 on trial). |
| Custom domain decision | Intake form | yes | "Custom" (`learn.<school>.com`) OR "subdomain" (`<slug>.alfanumrik.com`). |
| Grade range | Intake form | yes | Comma-separated grade list, e.g. `6,7,8,9,10`. Drives default `classes` rows. |
| Board | Intake form | yes | `CBSE` (default), `ICSE`, `STATE`. Maps to `schools.board`. |
| City + state | Intake form | yes | Maps to `schools.city` + `schools.state`. Used for analytics segmentation. |
| Pilot start date | Contract | yes | Drives the trial-end date in `school_subscriptions.current_period_end` (default 30 days from creation). |
| Tenant type | AE call | yes | `school` (default), `coaching`, `corporate`, or `government`. Set on the row after creation via `UPDATE schools SET tenant_type = '...'` — the trial route always sets `'school'`. |
| Optional modules at launch | AE call | yes | The 9 module keys defined in `src/lib/modules/registry.ts` (`lms`, `ai_tutor`, `testing_engine`, `live_classes`, `analytics`, `crm`, `assignments`, `attendance`, `communication`). Defaults are tenant-type-driven; deviations need explicit `tenant_modules` rows. |

### 1.3 Operational inputs

- [ ] **Slug availability** — the trial route auto-suffixes `-N` on collision, but if the customer is married to `dps-noida.alfanumrik.com`, verify:
  ```sql
  SELECT id, name FROM schools WHERE code = '<requested-slug>';
  ```
  If a row exists, escalate — the customer picks a different slug or the incumbent is archived first.
- [ ] **Pilot kickoff date** on ops calendar so §6 smoke-tests at least 48h ahead of go-live.

---

## 2. Provision the school record

### 2.1 Verify prerequisites

```bash
# Confirm service-role access to prod
psql "$SUPABASE_PROD_URL" -c "SELECT current_user;"
# Expected: postgres (or service_role)

# Confirm the trial route is reachable
curl -I https://www.alfanumrik.com/api/schools/trial
# Expected: HTTP/2 405 (POST-only) — anything else is a 502/503 outage, stop and page on-call
```

### 2.2 Create the school via the API

`POST /api/schools/trial` is the canonical path. It creates the school row, the `school_subscriptions` row (30-day trial, 50 seats), the seed `school_invite_codes` row, and dispatches the `school-trial-provisioned` email. See `src/app/api/schools/trial/route.ts`.

**Request body** (from `src/app/api/schools/trial/route.ts:73-79`):

```bash
curl -X POST https://www.alfanumrik.com/api/schools/trial \
  -H 'Content-Type: application/json' \
  -d '{
    "school_name": "Delhi Public School Noida",
    "board": "CBSE",
    "city": "Noida",
    "state": "Uttar Pradesh",
    "principal_name": "Dr. Priya Sharma",
    "principal_email": "principal@dpsnoida.edu.in",
    "phone": "+919811234567"
  }'
```

**Success response** (`200 OK`):

```json
{
  "success": true,
  "data": {
    "school_id": "f7e8a3c2-...-...",
    "slug": "delhi-public-school-noida",
    "subdomain": "delhi-public-school-noida.alfanumrik.com",
    "invite_code": "A7K9PQXM",
    "trial_days": 30,
    "seats": 50
  }
}
```

**Failure modes:**
- `400` — validation error. Fix body, retry.
- `409` — email already in `schools`. Investigate with `SELECT id, name, created_at FROM schools WHERE email = '<email>'` before merging or switching contact.
- `429` — rate-limit (5/IP/hour). Wait or run from a different operator workstation.
- `500` — unexpected. Read Vercel log for `school_trial_create_school_failed`; do NOT retry until the cause is understood (partial inserts may have left orphans).

**Capture immediately**: `school_id`, `slug`, `invite_code` — treat the invite code as a secret until the admin redeems it.

### 2.3 Verify the row landed

```sql
-- Replace placeholders
SELECT id, name, code, slug, board, principal_name, email, phone,
       tenant_type, is_active, created_at
  FROM public.schools
 WHERE name = 'Delhi Public School Noida';
```

Expected:
- `code` and `slug` match each other (both derived from `name` by `generateSlug`).
- `is_active = true`.
- `tenant_type = 'school'` (default — change in §2.5 if the customer is coaching/corp/govt).
- `created_at` within the last few minutes.

Cross-check the related rows:

```sql
SELECT plan, seats_purchased, status, current_period_end
  FROM public.school_subscriptions
 WHERE school_id = '<SCHOOL_ID>';
-- Expected: 1 row, plan='trial', seats_purchased=50, status='trial', current_period_end ~ 30 days out

SELECT code, role, max_uses, use_count, expires_at, is_active
  FROM public.school_invite_codes
 WHERE school_id = '<SCHOOL_ID>';
-- Expected: 1 row, code = (the captured invite_code), role='teacher', max_uses=1, expires_at ~ 90 days
```

If `school_subscriptions` is missing, the trial route swallowed an insert failure (see `school_trial_subscription_insert_skipped` log line). Insert manually:

```sql
INSERT INTO public.school_subscriptions
  (school_id, plan, seats_purchased, price_per_seat_monthly, status, current_period_end)
VALUES
  ('<SCHOOL_ID>', 'trial', 50, 0, 'trial', (now() + interval '30 days'));
```

If `school_invite_codes` is missing, generate one:

```sql
INSERT INTO public.school_invite_codes
  (school_id, code, role, max_uses, use_count, expires_at, is_active)
VALUES
  ('<SCHOOL_ID>', '<8-char-code>', 'teacher', 1, 0, (now() + interval '90 days'), true);
```

### 2.4 Bootstrap the school admin

The trial route's seed invite has `role = 'teacher'`. The primary contact needs admin, not teacher. After they redeem the invite and an `auth.users` row exists, promote:

```sql
-- 1. Find the auth_user_id (after they sign up at <slug>.alfanumrik.com)
SELECT u.id AS auth_user_id, u.email
  FROM auth.users u
  JOIN public.teachers t ON t.auth_user_id = u.id
 WHERE u.email = 'principal@dpsnoida.edu.in'
   AND t.school_id = '<SCHOOL_ID>';

-- 2. Insert the school_admins row
INSERT INTO public.school_admins
  (school_id, auth_user_id, role, is_active, permissions)
VALUES
  ('<SCHOOL_ID>', '<AUTH_USER_ID>', 'principal', true,
   ARRAY['institution.manage','school.manage_modules','school.manage_billing']);

-- 3. (Optional) deactivate the now-redundant teachers row
UPDATE public.teachers SET is_active = false WHERE auth_user_id = '<AUTH_USER_ID>';
```

`school.manage_modules` was added by `20260507110000_add_school_manage_modules_permission.sql` and is required for `/school-admin/modules` (§4).

### 2.5 Set `tenant_type` if non-school

Only required for `coaching`, `corporate`, or `government`. The trial route always inserts `'school'`.

```sql
UPDATE public.schools SET tenant_type = 'coaching' WHERE id = '<SCHOOL_ID>';
-- valid values: 'school' | 'coaching' | 'corporate' | 'government'
```

Note: `tenant_type` only drives UI/copy variants when `ff_tenant_type_v1` is ON (§4). The column is always populated.

---

## 3. White-label DNS (custom domain only)

Skip if the school is using `<slug>.alfanumrik.com`. The subdomain works out-of-the-box because `*.alfanumrik.com` is a wildcard pointed at Vercel; `src/proxy.ts:233-304` (`extractSubdomain` → `getSchoolBySlug`) handles the lookup per request.

### 3.1 Add the custom domain in Vercel

Vercel → `alfanumrik` project → Settings → Domains → Add → enter the customer's domain (e.g., `learn.dpsnoida.edu.in`). Vercel returns the exact CNAME target — as of 2026-05-16 it's `cname.vercel-dns.com` for standard projects, but **always copy from the Vercel UI** since it varies by project/region.

### 3.2 Set the CNAME at the customer's registrar

Done by the school's IT contact. Send them:

```
Record type:  CNAME
Host:         learn   (or whatever subdomain they chose)
Value:        cname.vercel-dns.com    (use what Vercel actually showed)
TTL:          300    (5 minutes during pilot)
Proxy/Cloud:  DNS-only (NOT Cloudflare-proxied — must reach Vercel directly)
```

If the record is Cloudflare-proxied (orange-clouded), Vercel verification will time out. Verify with `dig` before troubleshooting elsewhere:

```bash
dig CNAME learn.dpsnoida.edu.in +short
# Expected: cname.vercel-dns.com.
```

### 3.3 Wire the custom domain to the school record

```sql
UPDATE public.schools
   SET custom_domain = 'learn.dpsnoida.edu.in',
       domain_verified = false   -- flip to TRUE only after §3.4 passes
 WHERE id = '<SCHOOL_ID>';
```

`domain_verified` gates `getSchoolByCustomDomain()` in `src/proxy.ts:310-340`. Leave it FALSE while DNS propagates — the resolver short-circuits to default Alfanumrik branding instead of breaking the school halfway.

### 3.4 Verify tenant resolution end-to-end

```bash
# 1. Wait for DNS to propagate (typically 5-15 min on a fresh CNAME with TTL=300).
dig CNAME learn.dpsnoida.edu.in +short

# 2. Confirm the domain resolves at Vercel and the cert is issued.
curl -I https://learn.dpsnoida.edu.in/
# Expected: HTTP/2 200 (or 307 redirect to /welcome), NO certificate warning.

# 3. Flip domain_verified
psql "$SUPABASE_PROD_URL" \
  -c "UPDATE public.schools SET domain_verified = true WHERE id = '<SCHOOL_ID>';"

# 4. Hit the school-config endpoint with the school's Host header to confirm
#    the tenant resolution in proxy.ts actually fires:
curl -H 'Host: learn.dpsnoida.edu.in' \
  https://www.alfanumrik.com/api/school-config
```

Expected response:

```json
{
  "isSchoolContext": true,
  "id": "<SCHOOL_ID>",
  "name": "Delhi Public School Noida",
  "slug": "delhi-public-school-noida",
  "logoUrl": null,
  "primaryColor": "#7C3AED",
  "secondaryColor": "#F97316"
}
```

If `isSchoolContext: false`, the proxy did not resolve the tenant. Debug ladder:
1. School cache has 5-min positive / 1-min negative TTL (`src/proxy.ts:296`). A negative cache may hold a stale "not found" — wait 60s and retry.
2. Confirm `domain_verified = true` and `is_active = true` in the schools row.
3. The forwarded-header fix that lets `/api/school-config` see `x-school-id` lives at `src/proxy.ts:556-570` — it sets headers on the forwarded REQUEST (`NextResponse.next({ request: { headers: requestHeaders } })`), not the response. Older deploys (pre-2026-04-08) returned `isSchoolContext: false` even after DNS was correct. Confirm the deploy SHA includes commit `c159784c` or later.

### 3.5 TTL bump after stable

After the smoke test passes and DNS is steady, bump the CNAME TTL from 300 → 3600 (1 hour). Lowers nameserver query load on both sides.

---

## 4. Feature flag enablement

Flags live in `public.feature_flags`. The evaluator at `src/lib/feature-flags.ts:96-135` (`isFeatureEnabled`) follows precedence: global `is_enabled` → environment → role → institution → rollout percentage.

**Default stance:** every flag below is seeded `is_enabled = false`. For a pilot school, enable per-tenant via `target_institutions` rather than flipping global. Matches the single-school rollout runbook and gives instant rollback.

### 4.1 Onboarding-relevant flags

Registry in `src/lib/feature-flags.ts` + `supabase/migrations/*ff_*.sql`. Below are the flags that matter day-one for a pilot. Verify each by `grep` before quoting in operator instructions — flags churn.

| Flag name | Seeded by | What it gates | Default | Pilot recommendation |
|---|---|---|---|---|
| `ff_tenant_type_v1` | `20260507000004_add_tenant_type_and_typography.sql` | UI/copy variants that branch on `schools.tenant_type` (e.g. "students" vs "learners" vs "employees"). The column is always populated; the flag only controls whether the frontend differentiates. | OFF | OFF unless tenant_type is non-`school` AND copy differentiation is part of their contract. |
| `ff_tenant_module_registry_v1` | `20260507000005_tenant_modules.sql` | Per-tenant module on/off via `tenant_modules`. When OFF, every module is implicitly enabled. When ON, server resolvers consult `tenant_modules` and the `/school-admin/modules` UI takes effect. | OFF | ON for the pilot school if they have non-default module choices (see §1.2). OFF if they're getting the full default platter — saves a flag flip. |
| `ff_event_bus_v1` | `20260507000007_add_ff_event_bus_v1.sql` | In-process event bus (`src/lib/events/`). When OFF, `emit()` is a no-op so publishers can ship ahead of subscribers. | OFF | OFF for the pilot. Flip globally when subscribers are wired. |
| `ff_realtime_subscriptions_v1` | `20260527000002_add_ff_realtime_subscriptions_v1.sql` | Supabase Realtime postgres_changes on teacher heatmap, classroom polls, parent child-progress. Requires `supabase_realtime` publication to include the relevant tables (see migration header). | OFF | OFF for the first 48 hours of pilot. Flip ON once admin + 1 teacher + 5 students are active and the heatmap has data to render. |
| `ff_editorial_atlas_v1` (+ per-role canaries `_student`, `_parent`, `_teacher`, `_school`) | `20260511180000_add_ff_editorial_atlas.sql` | The Atlas multi-role redesign (Fraunces typography, unified shell, monoline iconography). When OFF, legacy surfaces render. | OFF | OFF for the pilot unless the school's contract explicitly commits to Atlas — currently most schools see legacy until the 3-week phased rollout completes. |
| `ff_agent_mesh_v1` | `20260511120000_agent_mesh_foundation.sql` | The L1–L8 agent mesh runtime (cycles, tasks, evaluations). Substrate-only — no agent loop ships on prod. | OFF | OFF. Never enable per-school until the runtime ships. |
| `ff_school_self_service_billing_v1` | `20260507000002_add_ff_school_self_service_billing_v1.sql` | School admin can self-serve Razorpay billing changes (plan upgrade, seat add). | OFF | OFF for the first 30 days (trial). Flip ON only when the customer is converting to paid and you want them on self-serve. |
| `ff_gst_invoicing_v1` | `20260507130003_add_ff_gst_invoicing_v1.sql` | GST invoice PDFs against the school's GSTIN. | OFF | ON only after the customer has provided GSTIN and you've verified it in §1.1. |

For contract-driven extras (e.g. early access to a v2 feature), grep the migrations directory and follow §4.2.

### 4.2 Per-school enablement pattern

Append the school's UUID to `target_institutions` rather than flipping `is_enabled` globally — flag stays OFF for every other school, ON for this one.

```sql
-- Add this school to a flag's allowlist
UPDATE public.feature_flags
   SET target_institutions = COALESCE(target_institutions, '{}'::uuid[])
                           || ARRAY['<SCHOOL_ID>'::uuid],
       is_enabled = true,
       updated_at = now()
 WHERE flag_name = 'ff_tenant_module_registry_v1';
```

Verify:

```sql
SELECT flag_name, is_enabled, target_institutions, updated_at
  FROM public.feature_flags
 WHERE flag_name = 'ff_tenant_module_registry_v1';
```

`is_enabled = true` AND the school's UUID present in `target_institutions` → flag is ON for that school only. The in-memory cache (`src/lib/feature-flags.ts:50`, 5-min TTL) picks up the change within 5 minutes; invalidate sooner via the super-admin console or a Vercel redeploy.

**Instant rollback** — remove the school:

```sql
UPDATE public.feature_flags
   SET target_institutions = array_remove(target_institutions, '<SCHOOL_ID>'::uuid),
       updated_at = now()
 WHERE flag_name = 'ff_tenant_module_registry_v1';
```

If `target_institutions` is now empty, decide whether to flip `is_enabled = false`. Leave ON if other schools remain in the allowlist.

### 4.3 Module-level enablement (when `ff_tenant_module_registry_v1` is ON)

The 9 module keys live in `src/lib/modules/registry.ts:68-89`; tenant-type defaults in `defaultsForTenantType()` (same file). To override:

```sql
-- Disable the CRM module for this school
INSERT INTO public.tenant_modules (school_id, module_key, is_enabled, config)
VALUES ('<SCHOOL_ID>', 'crm', false, '{}'::jsonb)
ON CONFLICT (school_id, module_key) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled, updated_at = now();

-- Re-enable later
UPDATE public.tenant_modules
   SET is_enabled = true, updated_at = now()
 WHERE school_id = '<SCHOOL_ID>' AND module_key = 'crm';
```

The admin can self-serve via `/school-admin/modules` (route: `src/app/api/school-admin/modules/route.ts`) once they hold `school.manage_modules` from §2.4.

---

## 5. Email infrastructure (Mailgun)

Central send path: `supabase/functions/send-transactional-email/index.ts`. Templates:

- `school-trial-provisioned` — auto-sent by `POST /api/schools/trial`.
- `school-invite-code-issued` — sent when teacher/student invite codes are generated via the admin UI.
- `parent-link-code-otp` — Phase D.4 parent linking.

All templates ship `en` + `hi` variants picked by `pickLocaleFromAcceptLanguage()` (`src/lib/email-delivery.ts`).

### 5.1 Confirm the sending domain is healthy

Default from-domain is `mg.alfanumrik.com`. Confirm DNS is set:

```bash
# SPF
dig TXT mg.alfanumrik.com +short | grep spf
# Expected: "v=spf1 include:mailgun.org ~all"

# DKIM
dig TXT k1._domainkey.mg.alfanumrik.com +short
# Expected: a long "v=DKIM1; k=rsa; p=MIGfMA0..." TXT record

# MX (for bounce-handling)
dig MX mg.alfanumrik.com +short
# Expected: 10 mxa.mailgun.org. and 10 mxb.mailgun.org.
```

If any are missing, mail still ships (Mailgun signs from the parent domain) but spam-filter risk climbs. Escalate to ops before sending bulk invites.

### 5.2 Custom from-domain (white-label)

If the contract specifies mail originates from the school's own domain (e.g. `learn@dpsnoida.edu.in`), set up a parallel Mailgun sending domain. As of 2026-05-16 this is manual ops, not self-serve:

1. Mailgun → Sending → Add new domain → the customer's sending subdomain.
2. Send the customer their SPF/DKIM/MX records.
3. Once verified, update the per-tenant config:
   ```sql
   UPDATE public.tenant_configs
      SET communication = jsonb_set(
            COALESCE(communication, '{}'::jsonb),
            '{email,from_domain}',
            '"learn.dpsnoida.edu.in"'::jsonb
          )
    WHERE school_id = '<SCHOOL_ID>';
   ```
   (Assumes the consumer reads `communication.email.from_domain` per migration `20260507000006_tenant_configs.sql`. If the consumer isn't wired yet, leave the default — white-label from-address ships in a later phase.)

### 5.3 Smoke test — the trial-provisioned email

§2.2 already dispatched this email if `inviteStored` was true (`src/app/api/schools/trial/route.ts:262-291`). Confirm delivery in Mailgun → Sending → Logs, filter by recipient within the last 5 minutes. Expected: 1 row, status `delivered` (or `accepted` if checking within 30s).

If missing after 10 minutes:
- Status `rejected`/`failed` → reason field has the cause (typically invalid mailbox / hard bounce).
- Row absent entirely → the send call failed before reaching Mailgun. Check Vercel logs for `school_trial_email_dispatch_failed` (`src/app/api/schools/trial/route.ts:283`).

To re-send manually:

```bash
SUPABASE_URL=https://shktyoxqhundlvkiwguu.supabase.co
curl -X POST "$SUPABASE_URL/functions/v1/send-transactional-email" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "template": "school-trial-provisioned",
    "to": "principal@dpsnoida.edu.in",
    "locale": "en",
    "params": {
      "school_name": "Delhi Public School Noida",
      "invite_code": "A7K9PQXM",
      "expires_at": "2026-08-14T00:00:00.000Z",
      "subdomain_url": "https://delhi-public-school-noida.alfanumrik.com",
      "recipient_name": "Dr. Priya Sharma"
    }
  }'
```

Expected: `{"sent": true, "id": "<mailgun-id>"}`. If `sent: false`, the `error` field has the cause — common one is an expired `SUPABASE_SERVICE_ROLE_KEY` (rotate via `docs/runbooks/vault-secret-rotation.md`).

---

## 6. Smoke test

Run end-to-end at least 4 hours before pilot kickoff. Block on every step.

### 6.1 Public homepage loads with school branding

```bash
# Subdomain tenant
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://delhi-public-school-noida.alfanumrik.com/

# Custom-domain tenant
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://learn.dpsnoida.edu.in/
```

Expected: `HTTP 200` or `307` to `/welcome`. In-browser: school's `primaryColor` accent + school name in header — confirms proxy resolved tenant AND `SchoolContext` consumed headers.

### 6.2 `/api/school-config` returns the school

```bash
# Subdomain
curl -s https://delhi-public-school-noida.alfanumrik.com/api/school-config | jq .
# Expected: { "isSchoolContext": true, "id": "<SCHOOL_ID>", "name": "Delhi Public School Noida", ... }

# Tenant config (enriched view including modules)
curl -s https://delhi-public-school-noida.alfanumrik.com/api/tenant/config | jq .
# Expected: { "isTenantContext": true, "tenant_type": "school", "enabled_modules": [...], ... }
```

If either returns `false`, return to §3.4 — proxy did not resolve.

### 6.3 Invite code can claim an admin account

In a fresh incognito browser:

1. Visit `https://<host>/join?code=A7K9PQXM`. Page loads with school name + "Already have an account / Create one" widget. `POST /api/schools/join` (`src/app/api/schools/join/route.ts`) returns the school payload for pre-filled signup.
2. Click "Create account" — principal's email + password.
3. Confirmation email arrives via Mailgun (`send-auth-email` template). Click the link → signed-in dashboard.
4. Run §2.4 to promote the new `auth.users` row into `school_admins`.

### 6.4 Admin can sign in

After §6.3 step 5:

```sql
-- Verify the admin row exists and is active
SELECT sa.id, sa.role, sa.is_active, sa.permissions, u.email
  FROM public.school_admins sa
  JOIN auth.users u ON u.id = sa.auth_user_id
 WHERE sa.school_id = '<SCHOOL_ID>';
-- Expected: 1 row, role='principal', is_active=true,
--           permissions includes 'institution.manage' and 'school.manage_modules'
```

Sign in at `https://<slug>.alfanumrik.com/login` (or the custom domain). The admin should land at `/school-admin` and see the school's name + their own profile.

### 6.5 Admin can create a teacher and a student

From the admin UI, or via API (`src/app/api/schools/setup/invite-codes/route.ts`):

```bash
curl -X POST https://<host>/api/schools/setup/invite-codes \
  -H 'Authorization: Bearer <admin-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"school_id":"<SCHOOL_ID>","role":"teacher","max_uses":1,"expires_days":30}'
# Expected: 200, { success: true, data: { code, expires_at } }

# Student-role code (after a class is created)
curl -X POST https://<host>/api/schools/setup/invite-codes \
  -H 'Authorization: Bearer <admin-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"school_id":"<SCHOOL_ID>","role":"student","class_id":"<CLASS_ID>","max_uses":1,"expires_days":30}'
```

Distribute to test teacher + student emails; sign them up via `/join?code=<code>`; confirm rows land in `teachers` and `students`.

### 6.6 Student can sign in and see a quiz

In a fresh incognito browser:

1. Sign in as the test student from §6.5.
2. Land at `/dashboard`. Expected: school-branded shell + "Practice" / "Start quiz" CTA.
3. Click into a subject → start a quiz.
4. Quiz must render ≥ 1 question. "No questions available" → the school's grade range is outside seeded `question_bank` content. Grades 6-10 are dense; 11-12 thinner.

### 6.7 Parent flow (optional)

Skip unless the contract includes a parent-portal pilot.

1. Student initiates the parent-link flow (Phase D.4).
2. Parent receives `parent-link-code-otp` email (§5).
3. Parent enters the 6-digit OTP, links to the student, lands at `/parent`.
4. Expected: single child card with the student's name. **Must NOT** show any other school's child.

The cross-tenant check is load-bearing. If the parent view leaks a different school's student, **stop the smoke test and escalate to DPO immediately** — sev-1 tenant isolation failure.

### 6.8 Audit trail

```sql
SELECT created_at, action, resource_type, resource_id, details
  FROM public.school_audit_log
 WHERE school_id = '<SCHOOL_ID>'
 ORDER BY created_at DESC LIMIT 50;
```

Expected: `school.created`, `invite_code.generated`, `school_admin.added`, `teacher.invited`, `student.invited`. Missing rows are non-blocking but indicate an audit hook didn't fire — log it and follow up post-pilot.

---

## 7. Monitoring & escalation

### 7.1 Logs — per-school filtering

Every request to a school subdomain carries `x-school-id` (set by `src/proxy.ts:558`). Vercel function logs surface this header inline.

```bash
vercel logs --project alfanumrik --since 10m \
  | grep -E 'x-school-id|school_id' \
  | grep '<SCHOOL_ID>'
```

Or Vercel dashboard → Project → Logs → filter `requestPath: /api/*` and grep the line.

### 7.2 Sentry

API-route events include `tenant_id` (= `school_id`) as a tag. Filter Sentry → Issues → `tenant_id:<SCHOOL_ID>`. Time-range to the last hour during smoke test; expect zero errors.

Full alert rule taxonomy in [`docs/runbooks/sentry-alert-setup.md`](./sentry-alert-setup.md). Default global alerts cover a pilot — no per-tenant rule unless the contract has a custom SLA.

### 7.3 PostHog

Every event carries `tenant_id`. Filter: PostHog → Insights → Event Properties → `tenant_id = <SCHOOL_ID>`.

Useful onboarding dashboards:
- `student.signup_completed` vs invite codes issued (should converge to ~1:1).
- `quiz.session_completed` count in week 1 (engagement signal).
- `school_seat_cap_hit` count (should be 0; non-zero means over-provisioned invites vs seats).

### 7.4 On-call

**As of 2026-05-16 there is no formal on-call rotation.** Escalation:
1. Ops Slack `#alfanumrik-ops`.
2. Page Pradeep (CEO) for sev-1 (data loss, cross-tenant leak, full outage).
3. Sev-2 (per-school outage, payment issue): wait for business hours unless contract has a 24×7 SLA.

**Fill in once on-call exists** — at that point, link the PagerDuty service and roster.

### 7.5 Rollback options

Safest reversible actions for the first 72 hours of pilot, in order of preference:

| Symptom | Rollback action |
|---|---|
| White-label DNS returns wrong tenant | `UPDATE schools SET domain_verified = false WHERE id = '<SCHOOL_ID>'` — proxy falls back to default branding. |
| Per-school flag misbehaves | `UPDATE feature_flags SET target_institutions = array_remove(target_institutions, '<SCHOOL_ID>'::uuid) WHERE flag_name = '<flag>'` — flips OFF only for this school. |
| Module enablement breaks UI | `UPDATE tenant_modules SET is_enabled = true WHERE school_id = '<SCHOOL_ID>'` (revert to defaults) OR `UPDATE feature_flags SET target_institutions = array_remove(...) WHERE flag_name = 'ff_tenant_module_registry_v1'` to take this school out of the per-tenant module path. |
| Invite codes leak / wrong-tenant signup | `UPDATE school_invite_codes SET is_active = false, expires_at = now() WHERE school_id = '<SCHOOL_ID>'` — kills all outstanding codes. |
| School needs to be fully taken offline (sev-1) | `UPDATE schools SET is_active = false WHERE id = '<SCHOOL_ID>'` — every login, every invite, every public page returns 404 / default branding. Communicate with the school's primary contact within 1 hour. |

Each rollback is logged via the `school_audit_log` trigger; no separate audit row needed.

---

## 8. Off-boarding (placeholder)

When a school leaves, two parallel tracks run:

1. **Data side** — follow [`per-school-backup-restore.md`](./per-school-backup-restore.md) §2 for the final encrypted backup, then §7 to erase. DPDP timeline: ≤ 30 days from contract end. The Phase D.3 parent-initiated erasure flow (PR #802) does NOT cover school-level off-boarding — that's still manual.
2. **Tenant cleanup** — currently manual:
   - `UPDATE schools SET is_active = false, deleted_at = now() WHERE id = '<SCHOOL_ID>'` (soft-delete; the backup-restore §7 hard-deletes after retention).
   - Remove the school from every `feature_flags.target_institutions` array.
   - Remove the custom domain from Vercel.
   - Remove the custom Mailgun sending domain if §5.2 was used.
   - Cancel the Razorpay subscription via `/api/payments/cancel-subscription`.
   - Notify the school's IT contact to drop their CNAME (otherwise their DNS keeps pointing at a 404).

**Backlog:** an `/api/super-admin/schools/<id>/offboard` endpoint wrapping the above into a single atomic call. Not in scope as of 2026-05-16. Until it ships, tenant cleanup IS a tribal-knowledge exercise — keep this runbook updated as steps stabilize.

---

## Related runbooks

- [`per-school-backup-restore.md`](./per-school-backup-restore.md) — final backup + DPDP-compliant erasure.
- [`2026-05-07-single-school-flag-rollout.md`](./2026-05-07-single-school-flag-rollout.md) — pre-flight checklist for any flag flip.
- [`sentry-alert-setup.md`](./sentry-alert-setup.md) — per-route SLO alerting.
- [`vault-secret-rotation.md`](./vault-secret-rotation.md) — rotating the Mailgun / Supabase service keys this runbook depends on.
- [`audit-production-readiness.md`](./audit-production-readiness.md) — companion checklist for the broader production-readiness assessment.
