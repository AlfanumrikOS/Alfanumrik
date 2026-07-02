# Environment Readiness Assessment — Third-Party Integrations (Backend Agent)

Read-only investigation. No files edited, no traffic dispatched. Performed 2026-07-02
against `D:\Alfa_local\Alfanumrik` (branch `fix/prod-readiness-remaining`) plus
read-only `gh api`, `vercel env ls`, and `supabase secrets list` probes (names/scopes
only — no secret values were pulled or displayed).

---

## CRITICAL CROSS-CUTTING CAVEAT — READ THIS FIRST

Before the per-integration verdicts: the prior session's premise ("a separate staging
Supabase project exists, distinct from production") is **true at the Supabase-project
level** but **does not by itself guarantee the deployed staging website is isolated**.
Evidence:

- `supabase projects list` (authenticated CLI session) confirms two genuinely distinct
  projects: production `shktyoxqhundlvkiwguu` ("Alfanumrik Adaptive Learning OS") and
  staging `gzpxqklxwzishrkiaatd` (`alfanumrik@outlook.com's Project`, matches the
  `STAGING_SUPABASE_URL` comment in `.github/workflows/mesh-cron.yml:11`).
- Edge Functions deploy independently and correctly to each project — confirmed below
  under CRON.
- **However**, the Vercel project that actually serves the staging web app
  (`vercel env ls`, project `alfanumrik`) shows the public Supabase URL var, the public
  Supabase anon-key var, and the server-only Supabase service-role-key var each as
  **one single encrypted value** whose "environments" column lists `Production, Preview,
  Development, staging` together — i.e. one shared secret applied to all four Vercel deployment
  targets, not a distinct staging-scoped value. `.github/workflows/deploy-staging.yml`
  pulls `--environment=preview` when building the app that gets deployed and
  health-checked, so **the Vercel-deployed staging/preview website appears to read the
  same Supabase URL/keys as the Production Vercel deployment** — I cannot tell from
  `vercel env ls` alone which project that shared value actually points at (I did not
  pull the value), but structurally there is no per-environment override in Vercel's
  store the way there is a genuine separate `STAGING_SUPABASE_URL` GitHub secret used
  by the migrations/seed/mesh-cron workflows.
- The same one-value-for-all-targets pattern applies to `RAZORPAY_KEY_ID`,
  `RAZORPAY_WEBHOOK_SECRET` (Vercel), `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, and
  `OPENAI_API_KEY` — see the sections below.

**Recommendation before any certification traffic hits the Vercel-deployed staging
URL: architect (schema/env ownership) must confirm, by inspecting the actual Vercel
dashboard values (not just `env ls` names), which Supabase project and which Razorpay
mode the Preview/staging target's `NEXT_PUBLIC_SUPABASE_URL` / `RAZORPAY_KEY_ID`
actually resolve to.** This gates every verdict below, so I am flagging it once here
rather than repeating "NOT VERIFIABLE — see caveat" in every section.

---

## RAZORPAY: NOT VERIFIABLE (structural evidence points toward shared/live risk)

**No runtime prefix check exists.** Searched `src/lib/razorpay.ts`,
`src/app/api/payments/webhook/route.ts`, `src/app/api/payments/subscribe/route.ts`,
`src/app/api/payments/create-order/route.ts` — none of them inspect or log the
`rzp_test_`/`rzp_live_` prefix of `RAZORPAY_KEY_ID` at runtime. The only places the
literal strings `rzp_test_`/`rzp_live_` appear are: `.env.example` (a placeholder,
`RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx`), test fixtures (`src/__tests__/...` — all use
`rzp_test_*` as fake values), and the CI secret scanner in
`.github/workflows/ci.yml:115-118`, which greps *committed source* for
`rzp_live_[A-Za-z0-9]{14,}` and fails the build if found (this only prevents a live key
from being hardcoded into a file; it says nothing about the deployed environment's
actual secret value). No admin panel displays or logs the key prefix either — grepped
`src/app` for `RAZORPAY_KEY_ID` and found no display/logging usage beyond the payment
routes reading it for API calls.

**No environment-conditional branching in code.** `src/lib/razorpay.ts` and
`src/app/api/payments/webhook/route.ts` were read in full — there is no
`if (process.env.NODE_ENV === 'staging')`-style branch anywhere in the payment path.
Behavior (webhook signature verification, RPC calls, event handling) is identical
regardless of environment; only the *value* of `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/
`RAZORPAY_WEBHOOK_SECRET` would differ between test and live mode, and that value is
supplied entirely by the deployment platform's env store.

**GitHub Environment secrets:** the `staging` GitHub Environment (id `14384859913`)
has **zero** environment-scoped secrets (`gh api repos/:owner/:repo/environments/staging/secrets` →
`{"total_count":0}`). No Razorpay secret is configured at the GitHub-Environment layer
at all — Razorpay credentials are not sourced from GitHub Actions secrets/environments
for either production or staging; they come from Vercel's env store (used by
`vercel build`/`vercel deploy` in `deploy-staging.yml`/`deploy-production.yml`) or from
Supabase Edge Function secrets (for the now-disabled legacy `payments` Edge Function
path, per the comment at `webhook/route.ts:14-16`).

**Vercel env store (the layer that actually matters — this IS where
`RAZORPAY_KEY_ID` is read from at runtime for the deployed app):** `vercel env ls`
(project `alfanumrik`, read-only listing of names/scopes, no values pulled) shows:

```
RAZORPAY_KEY_ID          Encrypted   Production, Preview, Development, staging   99d ago
RAZORPAY_KEY_SECRET      Encrypted   Development, Preview, Production            99d ago
RAZORPAY_WEBHOOK_SECRET  Encrypted   Production, Preview, Development, staging   99d ago
```

Each is a **single row** — meaning one stored value is shared across all four
deployment targets, not a distinct staging-scoped credential. Since Alfanumrik is a
live revenue product (per `.claude/CLAUDE.md` P11 and the subscription-lifecycle code),
the shared value is almost certainly the **live** `rzp_live_*` key. I cannot read the
actual value to confirm the prefix, so I am not asserting LIVE-MODE as a fact — but the
absence of any per-environment override is itself the finding: **there is no structural
guarantee staging uses test-mode Razorpay keys, and the default assumption should be
that it does NOT**, pending a manual dashboard check of the actual key value.

**Supabase Edge Function secrets** (the legacy/disabled `payments` function's scope):
`RAZORPAY_WEBHOOK_SECRET` exists in production project `shktyoxqhundlvkiwguu`'s Edge
Function secrets but is **absent** from staging project `gzpxqklxwzishrkiaatd`'s Edge
Function secrets list. This is moot for the canonical webhook handler (which is the
Next.js route reading Vercel env, per the code comment at
`webhook/route.ts:14-16` — "the legacy Supabase Edge Function `payments`
handleWebhook path is disabled") but is worth noting as one more place staging is
under-provisioned relative to production.

**Confidence: LOW-VERIFIABILITY, HIGH-RISK-BIAS.** No code check exists that would let
me confirm test-vs-live from the repository alone, and the one piece of structural
evidence I could gather (Vercel's single shared secret value across Production and
Preview/staging targets) points toward staging inheriting the production key rather
than a distinct sandbox one. **Do not run certification payment flows against the
Vercel-deployed staging/preview URL until an operator confirms the actual
`RAZORPAY_KEY_ID` value in the Vercel dashboard for the Preview/staging target starts
with `rzp_test_`.**

---

## EMAIL: NOT VERIFIABLE FOR MAILGUN DOMAIN MODE, BUT FUNCTIONALLY INERT ON STAGING (fail-safe, not sandboxed)

**No sandbox-domain pattern in code.** Searched the whole repo (case-insensitive) for
`mailgun`/`sandbox` — no code anywhere constructs or checks for Mailgun's
`sandboxXXXX.mailgun.org` convention. `send-auth-email/index.ts` and
`send-welcome-email/index.ts` both build the Mailgun API URL as
`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages` using whatever
`MAILGUN_DOMAIN` secret is configured — no validation of domain shape, no
sandbox-vs-production branching. The setup comment at the top of
`send-auth-email/index.ts:14-22` explicitly instructs operators to "Verify
alfanumrik.com domain in Mailgun" — i.e. the intended domain is the real production
sending domain, not a sandbox.

**Supabase Edge Function secrets — production vs staging (names only, no values
read):**

Production (`shktyoxqhundlvkiwguu`) has both `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`
configured. Staging (`gzpxqklxwzishrkiaatd`) has **neither** — its full secret list is
just `CRON_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`,
`SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_URL` — 8 secrets vs production's 22. No `MAILGUN_API_KEY`, no
`MAILGUN_DOMAIN`, no `SEND_EMAIL_HOOK_SECRET`, no `SITE_URL`.

**What this means functionally:** `send-auth-email/index.ts:32-33` reads
`mailgunApiKey`/`mailgunDomain` via `Deno.env.get(...) || ''`, and line 296 explicitly
guards: `if (!mailgunApiKey || !mailgunDomain) { ...return 200 with warning:
'no_mailgun_config' }` — **no outbound HTTP call to Mailgun is made at all** when the
secrets are absent, and the function still honors the P15 "always return 200"
contract. `send-welcome-email/index.ts` has the equivalent `if (MAILGUN_API_KEY &&
MAILGUN_DOMAIN)` guard at line 269. So if these functions are deployed to the staging
Supabase project (they would be, via `sync-staging-functions.yml`, since they live
under `supabase/functions/`), **no real email is sent from staging today** — not
because of a sandbox mode, but because the credentials are simply absent and the code
fails soft. This is a favorable outcome for the CEO's "no real side effects" bar, but
it also means **staging cannot currently be used to verify email deliverability as
part of certification** — onboarding-funnel checks that assert an email actually
arrives will not be exercisable on staging as configured today.

**Unverified nuance:** returning 200 with `no_mailgun_config` is Alfanumrik's own
custom "Send Email" Auth Hook responding successfully, which per Supabase's hook
contract tells Supabase Auth the hook has fully handled the email — Supabase does
**not** fall back to its own default SMTP relay in that case. I could not verify from
the repo whether the staging Supabase project's Authentication → Hooks dashboard
setting is actually wired to point at the staging-deployed `send-auth-email` function
(this is a dashboard-only configuration, not present in migrations or code) — if it is
wired, no email of any kind (Mailgun or Supabase-default) will fire on staging
signups. If it is *not* wired (hook left unconfigured on the staging project),
Supabase's own default email service could fire instead, which **would** be a real
email delivery. Flagging as NOT VERIFIABLE from static code alone; recommend an
operator confirm the staging project's Auth Hook configuration before running an
onboarding-funnel certification pass on staging.

**Confidence: MEDIUM.** Structurally confident that Mailgun itself will not be called
from staging today (missing credentials, guarded code path). Not confident about the
Supabase-default-email fallback question above.

---

## WHATSAPP: SANDBOX-EQUIVALENT — CREDENTIALS ABSENT EVERYWHERE (not staging-specific; also true in production)

`supabase/functions/whatsapp-notify/index.ts:152-157` reads `WHATSAPP_TOKEN` and
`WHATSAPP_PHONE_NUMBER_ID` via `Deno.env.get(...)` and returns
`{ success: false, error: 'WhatsApp credentials not configured' }` if either is
missing, before ever calling `https://graph.facebook.com/v18.0/...` (the WhatsApp
Cloud API — Meta does not offer a distinct sandbox/test tier for this API; test vs
live is purely a function of which phone-number-id/token is configured, and Meta
requires human template approval either way).

Notably, **neither `WHATSAPP_TOKEN` nor `WHATSAPP_PHONE_NUMBER_ID` appears in the
production Supabase Edge Function secrets list either** (the 22-secret production list
enumerated above has no WhatsApp-related entry). This means WhatsApp sending appears
to be **entirely unconfigured in production as well as staging** — i.e. this is not a
staging-specific safety mechanism, it is that the integration has not yet been wired
up with live credentials anywhere in this codebase's current deployment. On failure,
`whatsapp-notify` queues an email fallback (`task_queue` insert,
`whatsapp-notify/index.ts:247-274`) rather than silently dropping the notification —
that fallback path routes back into the (currently Mailgun-credential-less-on-staging)
email pipeline described above, so it would also no-op on staging.

No sandbox-number/test-mode distinction exists in code — this wasn't necessary to
build since the integration isn't live-wired anywhere yet.

**Confidence: HIGH** that no real WhatsApp message can be sent from either
environment today, given the credential absence is visible directly in the Edge
Function secret list (not an inference from missing code).

---

## AI PROVIDERS: NO SANDBOX EXISTS (real cost applies) — and staging inherits the SAME billed keys as production for the Next.js AI surface

Confirmed no test/sandbox tier exists for Anthropic (Claude), OpenAI, or Voyage — all
three are called via their standard production API endpoints with no alternate
base-URL or "test mode" flag anywhere in `src/app/api/foxy/route.ts` or the
Edge Functions. Searched for environment-conditional cost gating
(`VERCEL_ENV`/`NODE_ENV === 'staging'`/`isStaging`) in the Foxy route and in
`src/lib/plans.ts` — found only one `VERCEL_ENV` reference (line 1242, used for
logging/telemetry labeling, not for capping usage or swapping models). No lower
per-day quota or cheaper-model substitution exists for staging/certification traffic;
daily usage limits are plan-based only (Explorer/Starter/Pro/Unlimited), not
environment-based.

**Vercel env store — same one-shared-value pattern as Razorpay:**

```
ANTHROPIC_API_KEY   Encrypted   Production, Preview, Development     85d ago
VOYAGE_API_KEY      Encrypted   Development, Preview, Production     85d ago
OPENAI_API_KEY      Encrypted   Preview, Production, staging         45d ago
```

Every AI provider key is a single row spanning Production and Preview/staging. **Any
certification traffic that reaches `src/app/api/foxy/route.ts` (the active Foxy Next.js
route) on the Vercel-deployed staging/preview URL will make real, billed calls to the
Claude API (and Voyage for retrieval) using the same key/quota as production.** State
this to the CEO plainly: AI-tutor certification traffic on staging is not free and not
sandboxed — it is real API usage against the same billed account as production, with
no environment-specific cost ceiling.

**One partial mitigation, not by design:** the pure Supabase-Edge-Function AI surface
(`ncert-solver`, `quiz-generator`, `cme-engine`) reads its provider keys from Supabase
Edge Function secrets, not Vercel env — and staging's Supabase project
(`gzpxqklxwzishrkiaatd`) has **no** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`VOYAGE_API_KEY` in its secrets list (see the 8-secret staging list above), versus
production's full set. So if those three specific Edge Functions are invoked on
staging, they would error out for lack of credentials — an accidental cost-safety
side effect, not an intentional sandbox design. The Foxy Next.js route (the primary,
currently-active AI tutor surface per `CLAUDE.md`) is unaffected by this since it reads
from the shared Vercel `ANTHROPIC_API_KEY`, which — per the table above — is live and
shared with production.

**Confidence: HIGH.** This is a genuine constraint, not a defect: no sandbox tier
exists for any of these providers industry-wide, and the repo confirms no
staging-specific cost control was ever built for the Foxy route.

---

## WEBHOOKS: PARTIALLY ISOLATED (outbound is DB-driven/isolated-by-project; inbound Razorpay webhook URL registration is NOT VERIFIABLE from code)

**Inbound (Razorpay → Alfanumrik):** searched `deploy-staging.yml`,
`sync-staging-functions.yml`, and every other workflow under `.github/workflows/` for
any step that registers/updates a Razorpay webhook URL — found none. Razorpay webhook
URL configuration is a manual step performed in the Razorpay dashboard, not automated
anywhere in this repository. I cannot confirm from static code whether a staging-only
webhook URL (pointing at the Vercel Preview deployment's
`/api/payments/webhook`) is registered in Razorpay at all, or whether the only
registered webhook target is the production URL. **This is squarely a
dashboard-configuration fact outside the repo's reach — flagging as NOT VERIFIABLE.**
If no staging webhook is registered in Razorpay, then no Razorpay event will ever hit
the staging deployment regardless of key mode (a mitigating factor); if a staging
webhook happens to be registered pointing at a Preview URL, and the payment flow
itself uses a shared/live key (see RAZORPAY section above), a real captured payment
during certification would fire a real webhook against staging using the same
signature-verification secret as production (`RAZORPAY_WEBHOOK_SECRET` is also a single
shared Vercel value per the table above).

**Outbound (Alfanumrik → school/operator systems):** `supabase/functions/
webhook-dispatcher/index.ts` (Track A.6 outbound HMAC-signed webhook dispatcher) reads
its `target_url` from a DB row (`SubscriptionRow.target_url`, a school's registered
webhook subscription) — never hardcoded, never environment-conditional in code (read
in full, lines 1-80 plus the `DeliveryRow`/`SubscriptionRow` types). It also runs
SSRF validation (`validateWebhookTargetUrl`) before every send. Isolation here comes
entirely from the fact that staging (`gzpxqklxwzishrkiaatd`) is a genuinely separate
Postgres database — a webhook subscription row configured by a real school in
production simply does not exist in staging's database unless someone manually copied
it there (no evidence of a data-seeding step doing so was found in the migration or
workflow files reviewed). Same DB-driven, environment-isolated-by-project pattern
confirmed in `supabase/functions/alert-deliverer/index.ts:86-87` (Slack webhook URL
read from a `channel.config.webhook_url` DB column, not hardcoded/env-conditional).

**Confidence: MEDIUM for outbound** (isolation is structurally sound given separate
DBs, contingent on no cross-environment data copy having occurred — not verifiable
from static code alone). **NOT VERIFIABLE for inbound Razorpay webhook registration**
(dashboard-only configuration, outside repo).

---

## CRON: MOSTLY ISOLATED — with one caveat for manually-triggered Vercel Cron routes

**Supabase Edge Function cron (`daily-cron`, `queue-consumer`, `webhook-dispatcher`,
etc.) — ISOLATED.** `.github/workflows/sync-staging-functions.yml` deploys each
changed Edge Function to the staging project explicitly via
`supabase functions deploy "$fn" --project-ref ${{ secrets.SUPABASE_STAGING_PROJECT_REF }}`
using a dedicated `SUPABASE_STAGING_ACCESS_TOKEN` (the workflow comment at lines 71-73
notes the prod token is rejected — "returns Unauthorized" — against the staging
project ref, confirming these are genuinely separate Supabase orgs/accounts, not just
separate project refs under one account). Production deploys similarly via
`deploy-production.yml`'s own Edge Function step, targeting the production project ref
with the production access token. `daily-cron` is triggered by `pg_cron`, a Postgres
extension scoped to each project's own database (per `CLAUDE.md`'s reference to
`supabase/migrations/20260404000002_pg_cron_daily.sql`) — since pg_cron lives inside
each project's Postgres instance, staging's pg_cron schedule can only invoke staging's
own deployed Edge Function against staging's own database, and vice versa for
production. No shared external trigger exists for this class of cron.

**Vercel Cron Jobs — auto-fire only against Production, but share credentials if
manually invoked on staging.** `vercel.json:32-72+` defines ~10 `crons` entries (e.g.
`/api/cron/daily-cron`, `/api/cron/reconcile-payments`, `/api/cron/payments-health`,
`/api/cron/expired-subscriptions`) — these are Next.js API routes, not Edge Functions.
Vercel's platform-level behavior (not something this repo controls or could override)
is that Cron Jobs only execute automatically against the **Production** deployment,
never against Preview/staging deployments — so these routes will not auto-fire on the
staging URL during certification. However, if an operator or a certification script
manually issues an HTTP request to one of these `/api/cron/*` routes on the
Vercel-deployed staging/preview URL, that route would run using the shared
server-only Supabase service-role-key and public Supabase URL Vercel env values
flagged in the top caveat — i.e. it is not intrinsically protected by environment separation the way
the Supabase-Edge-Function cron path is. Each of these routes is presumably guarded by
`CRON_SECRET` (present in both Vercel's env store and both Supabase secret lists, so
at least a distinct-per-request-secret exists — I did not audit each individual
`/api/cron/*` route's auth implementation as that is outside this task's third-party-
integration scope), but the *data* it would operate against depends entirely on which
Supabase project that shared `NEXT_PUBLIC_SUPABASE_URL` resolves to (see top caveat).

**Confidence: HIGH for the Edge-Function/pg_cron path** (independently deployed,
independently triggered, verified from workflow + architecture-doc evidence).
**MEDIUM-LOW for the Vercel-Cron-route path if manually invoked on staging** — gated by
the same open question as the top-of-file caveat.

---

## Summary Table

| Integration | Verdict | Confidence |
|---|---|---|
| Razorpay | NOT VERIFIABLE (no runtime prefix check; Vercel env shows one shared key across Production+Preview/staging — bias toward assuming LIVE until an operator confirms the dashboard value) | Low-verifiability, high-risk-bias |
| Email (Mailgun) | NOT VERIFIABLE for sandbox-domain mode, but FUNCTIONALLY INERT on staging today (credentials entirely absent from staging Supabase secrets; code fails soft, returns 200, sends nothing) | Medium |
| WhatsApp | Credentials absent in BOTH environments (not staging-specific) — no real message can be sent from either environment as currently deployed | High |
| AI Providers (Claude/OpenAI/Voyage) | NO SANDBOX EXISTS — real cost applies. Foxy Next.js route uses the same shared, live Vercel-scoped keys on staging as on production; no environment-based cost cap exists | High |
| Webhooks (inbound Razorpay registration) | NOT VERIFIABLE — dashboard-only config, not in repo | N/A |
| Webhooks (outbound dispatcher/alert-deliverer) | Isolated by virtue of separate per-environment databases; no hardcoded/env-conditional target URLs in code | Medium |
| Cron (Supabase Edge Function + pg_cron) | ISOLATED — independently deployed and independently triggered per project | High |
| Cron (Vercel Cron routes, `vercel.json`) | Auto-fires only on Production (Vercel platform behavior); if manually invoked on staging, shares the same Supabase credentials flagged in the top caveat | Medium-Low |

---

## Overall Recommendation

Do not treat "a separate staging Supabase project exists" as sufficient evidence that
the Vercel-deployed staging/preview website used for certification is isolated from
production money, data, or AI billing. The concrete, actionable gap is: **confirm in
the Vercel dashboard (not just `vercel env ls`, which only shows names/scopes) what the
Preview/staging-target values of `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` actually are**, before allowing any certification traffic
(payments, cron-route manual triggers, or AI-tutor conversations) to reach that URL.
Email and WhatsApp are lower-risk today only because their credentials happen to be
absent on staging — that is a fragile accident of current configuration, not a
designed safeguard, and could silently change the moment someone adds
`MAILGUN_API_KEY`/`WHATSAPP_TOKEN` to the shared Vercel/Supabase-staging store without
re-scoping it away from real-looking domains/numbers.
