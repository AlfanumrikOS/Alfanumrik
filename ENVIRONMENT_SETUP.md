# Alfanumrik — Environment Setup Guide

This is the **authoritative operator guide** for setting up environment
variables across local development, Vercel preview/production, Supabase Edge
Functions, Mailgun, and Razorpay.

> **TL;DR**
> 1. `cp .env.local.example .env.local` and fill in the 3 Supabase vars — that's enough to boot locally.
> 2. For production, set every `[required]` variable in the Vercel project settings.
> 3. For Edge Function secrets (Mailgun, ADMIN_API_KEY, etc.), use `supabase secrets set` or the Supabase Dashboard.

---

## 1. Architecture — where each variable lives

Alfanumrik has four independent runtime contexts. Each reads env vars from a different place:

| Context | Runtime | Variables come from | Where you set them |
|---|---|---|---|
| **Next.js (web) — browser** | React client | `NEXT_PUBLIC_*` only, inlined at build time | Vercel env settings (or `.env.local` for dev) |
| **Next.js (web) — server** | Node.js on Vercel | `process.env.*` — all vars in Vercel project settings | Vercel env settings (or `.env.local` for dev) |
| **Supabase Edge Functions** | Deno on Supabase | `Deno.env.get(...)` — secrets set on the Supabase side | Supabase Dashboard → Edge Functions → Secrets, or `supabase secrets set` |
| **Mobile (Flutter)** | Dart on device | `--dart-define=KEY=value` at build time | Passed to `flutter build` via `mobile/build_apk.sh` |

**Why the separation matters:** Setting `MAILGUN_API_KEY` in Vercel does NOT make it available to Edge Functions. Set it on the Supabase side. Conversely, setting `RAZORPAY_KEY_ID` in Supabase does nothing — Razorpay is called from Next.js API routes.

---

## 2. Variable catalog — by category

### 2.1 Supabase (core — always required)
| Variable | Scope | Why | Where |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (client + server) | DB, Auth, storage endpoint | Vercel + `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon API access (RLS-respecting) | Vercel + `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret | Admin operations (bypasses RLS) | Vercel + `.env.local` |

**Where to get them:** Supabase Dashboard → Project Settings → API. Copy the Project URL, the `anon public` key, and the `service_role` key.

### 2.2 Anthropic Claude (AI)
| Variable | Scope | Set in |
|---|---|---|
| `ANTHROPIC_API_KEY` | Server secret | Vercel **AND** Supabase Edge Secrets |

Used by the `/api/foxy` route and 14 Edge Functions. Get a key from the Anthropic Console.

### 2.3 Voyage AI (RAG embeddings + reranking)
| Variable | Scope | Set in |
|---|---|---|
| `VOYAGE_API_KEY` | Server secret | Vercel **AND** Supabase Edge Secrets |
| `OPENAI_API_KEY` *(optional fallback)* | Server secret | Supabase Edge Secrets |

Used for `voyage-3` embeddings (1024-dim) and reranking.

### 2.4 Razorpay (payments)
| Variable | Scope | Set in |
|---|---|---|
| `RAZORPAY_KEY_ID` | Server secret | Vercel only |
| `RAZORPAY_KEY_SECRET` | Server secret | Vercel only |
| `RAZORPAY_WEBHOOK_SECRET` | Server secret | Vercel only |

**Webhook setup:** In the Razorpay dashboard, register the webhook endpoint `https://alfanumrik.com/api/payments/webhook` and choose a signing secret. Store the exact same value in `RAZORPAY_WEBHOOK_SECRET` in Vercel.

### 2.5 Mailgun (email — Edge Functions only)
| Variable | Scope | Set in |
|---|---|---|
| `MAILGUN_API_KEY` | Edge secret | Supabase Edge Secrets |
| `MAILGUN_DOMAIN` | Edge secret | Supabase Edge Secrets |
| `SEND_EMAIL_HOOK_SECRET` | Edge secret | Supabase Edge Secrets |
| `SITE_URL` | Edge secret | Supabase Edge Secrets |

**Setup flow:**
1. In Mailgun, verify the `alfanumrik.com` sending domain (add DKIM, SPF, DMARC DNS records). See `EMAIL_DELIVERABILITY.md`.
2. Grab the Mailgun API key from Mailgun Dashboard → API Security.
3. Register the Supabase Auth Send Email hook (Dashboard → Authentication → Hooks → HTTPS). Supabase generates a hook secret (`v1,whsec_...`). Paste it into `SEND_EMAIL_HOOK_SECRET`.
4. Set `SITE_URL` to the environment's public URL (e.g. `https://alfanumrik.com` prod; `https://staging.alfanumrik.com` staging).

### 2.6 Rate limiting (Upstash Redis — optional but recommended)
| Variable | Scope | Set in |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Server | Vercel |
| `UPSTASH_REDIS_REST_TOKEN` | Server | Vercel |

If unset, rate limiting falls back to an in-memory Map per Vercel instance — counters reset on cold start and are not shared across instances. Get a free tier from https://console.upstash.com.

### 2.7 Security / Admin / Cron
| Variable | Scope | Set in |
|---|---|---|
| `SUPER_ADMIN_SECRET` | Server secret | Vercel |
| `CRON_SECRET` | Server secret | Vercel **AND** Supabase Edge Secrets |
| `ADMIN_API_KEY` | Edge secret | Supabase Edge Secrets |

Pick long random strings (≥ 32 chars). `CRON_SECRET` must match between Vercel and Supabase so Vercel Cron and Supabase scheduled invocations can both authenticate.

### 2.8 Monitoring (Sentry — optional)
| Variable | Scope | Set in |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Public | Vercel |
| `SENTRY_ORG` | Build-time | Vercel |
| `SENTRY_PROJECT` | Build-time | Vercel |

### 2.9 Integrations (optional)
| Variable | Scope | Set in |
|---|---|---|
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Edge secret | Supabase Edge Secrets |
| `GOOGLE_VISION_API_KEY` | Edge secret | Supabase Edge Secrets |
| `OCR_SPACE_API_KEY` | Edge secret | Supabase Edge Secrets (defaults to free tier `helloworld`) |
| `ENVIRONMENT` | Edge secret | Supabase Edge Secrets — set to `production` in prod |

### 2.10 Auto-injected (never set these manually)
`NODE_ENV`, `NEXT_PHASE`, `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_*`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, `CI`, `ANALYZE`.

On the Edge Function side, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by the Supabase runtime.

---

## 3. Step-by-step — Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```
3. Fill in the three Supabase vars at minimum. Paste values from your Supabase project's API settings.
4. (Optional) Add `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` if working on Foxy.
5. (Optional) Add `RAZORPAY_*` test keys if working on payments.
6. Run the app:
   ```bash
   npm run dev
   ```

If the app throws `[env] Missing required public environment variables: ...` on first request, re-check `.env.local`. The error message names the exact missing keys.

---

## 4. Step-by-step — Vercel production/preview

1. Go to Vercel → Project → Settings → Environment Variables.
2. For EACH variable in the "Required" sections above, add a row:
   - Key: the variable name (e.g. `SUPABASE_SERVICE_ROLE_KEY`)
   - Value: the secret
   - Environments: select Production, Preview, and Development as appropriate. Usually Production + Preview.
3. Save. Redeploy (or trigger a new push — Vercel applies env vars on every build).
4. Confirm with a smoke test:
   ```bash
   curl -s https://alfanumrik.com/api/v1/health | jq .
   ```
   Should return a health JSON including `deploy.environment`.

**Do NOT set `VERCEL_*` or `NODE_ENV` by hand** — Vercel injects them.

---

## 5. Step-by-step — Supabase Edge Function secrets

Secrets are scoped to the Supabase project and apply to every Edge Function in it.

### CLI (recommended for CI):
```bash
supabase secrets set MAILGUN_API_KEY=key-...
supabase secrets set MAILGUN_DOMAIN=alfanumrik.com
supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_..."
supabase secrets set SITE_URL=https://alfanumrik.com
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set VOYAGE_API_KEY=pa-...
supabase secrets set CRON_SECRET=<same-value-as-vercel>
supabase secrets set ADMIN_API_KEY=<long-random-string>
supabase secrets set ENVIRONMENT=production
```

### Dashboard:
Supabase Dashboard → Project → Edge Functions → Secrets → Add new secret.

List current secrets:
```bash
supabase secrets list
```

### Redeploy Edge Functions after changing secrets:
```bash
supabase functions deploy send-auth-email
supabase functions deploy foxy-tutor
# ...etc
```

---

## 6. Step-by-step — Mobile (Flutter) build

The mobile app reads build-time constants via `--dart-define`. See `mobile/build_apk.sh`.

```bash
export SUPABASE_ANON_KEY="<anon-key>"
export RAZORPAY_KEY_ID="<rzp-key-id>"
./mobile/build_apk.sh
```

> ⚠️ **Known issue (2026-04-18):** `mobile/build_apk.sh:45` and `mobile/lib/core/constants/api_constants.dart:8` currently hardcode the production Supabase URL as default. Ops should either inject `SUPABASE_URL` as an env var before the build, or accept that all unsigned local mobile builds point at production.

---

## 7. Validation — what happens if a variable is missing

### Build time (Vercel)
`next.config.js` (lines 1–25) throws the build if `NODE_ENV=production && VERCEL=1` and any of these are missing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `SUPER_ADMIN_SECRET`

### Runtime (Node)
`src/lib/env.ts` offers:
- `validatePublicEnv()` — checks the two `NEXT_PUBLIC_SUPABASE_*` vars
- `validateServerEnv()` — adds `SUPABASE_SERVICE_ROLE_KEY` and scans for leaks
- `getPublicEnv()` / `getServerEnv()` / `getAIEnv()` / `getPaymentEnv()` / `getAdminEnv()` / `getRedisEnv()` / `getMonitoringEnv()` — zod-typed accessors that throw with explicit, multi-line messages naming every offending variable

Error example:
```
[env] Invalid/missing variables in group "server":
  • SUPABASE_SERVICE_ROLE_KEY: Required
Check .env.local (local) or Vercel env settings (prod). See ENVIRONMENT_SETUP.md.
```

### Edge Function runtime (Deno)
Each Edge Function checks its own secrets and returns either 500 or a graceful degraded response. `send-auth-email` always returns 200 per P15 (Supabase blocks signup on non-200).

---

## 8. Security rules (non-negotiable)

1. **Never put secrets in a `NEXT_PUBLIC_*` variable.** These are inlined into the client JS bundle and visible to every browser.
2. **Never commit real env values** to git. `.env.local` is gitignored; keep it that way.
3. **Rotate `SUPABASE_SERVICE_ROLE_KEY` immediately** if it is ever suspected of being exposed. Rotating invalidates the previous key — update Vercel, Supabase, all scripts, and CI.
4. **Rotate `RAZORPAY_WEBHOOK_SECRET`** via the Razorpay dashboard. Update Vercel and redeploy.
5. **`SEND_EMAIL_HOOK_SECRET`** comes from Supabase when you register the hook; regenerate by disabling and re-enabling the hook.
6. CI has a secret-scan step that rejects pushes containing known secret patterns. See `.github/workflows/ci.yml` → `secret-scan` job.

---

## 9. Common mistakes and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Cursor keeps asking for env vars each session | `.env.local` missing or incomplete | `cp .env.local.example .env.local`, fill in Supabase trio |
| "Missing required public environment variables" on page load | `.env.local` not loaded; dev server started before it was created | Stop server, verify file at repo root, `npm run dev` again |
| Signup/login returns 500 | `SUPABASE_SERVICE_ROLE_KEY` missing in Vercel | Set it in Vercel env and redeploy |
| Emails not arriving | `MAILGUN_*` missing in Supabase OR DNS not verified in Mailgun | Run `supabase secrets list`; confirm DNS per `EMAIL_DELIVERABILITY.md` |
| `/api/payments/webhook` returns 400 | `RAZORPAY_WEBHOOK_SECRET` mismatch between Razorpay dashboard and Vercel | Copy exact secret from Razorpay dashboard; update Vercel; redeploy |
| AI responses fail with 500 | `ANTHROPIC_API_KEY` missing in Vercel or Edge | Set on both sides; redeploy Edge Function |
| Rate limiting inconsistent | `UPSTASH_REDIS_*` unset → using per-instance in-memory | Configure Upstash (see §2.6) |
| Sentry errors not appearing | `NEXT_PUBLIC_SENTRY_DSN` missing | Set in Vercel (both Production + Preview) |
| "SECURITY VIOLATION" thrown by `getServerEnv()` | The service role key value is also in some `NEXT_PUBLIC_*` var | Remove the leak, rotate the service role key |
| CI build fails with "Missing required env vars" | New required var added but Vercel not updated | Follow step 4; also add to `.github/workflows/ci.yml` if build-time needed |

---

## 10. Migration plan (for new code)

Direct `process.env.X` access is still present in ~60 call sites (API routes, scripts, some libs). These work today. **New code should use the typed accessors:**

```ts
// Old (still works, but not preferred):
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

// New:
import { getPublicEnv } from '@/lib/env';
const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
```

Incrementally migrate call sites as files are touched for other reasons. Do NOT do a big-bang refactor — it would conflict with in-flight work.

---

## 11. References
- Template: [`.env.example`](.env.example)
- Local dev template: [`.env.local.example`](.env.local.example)
- Runtime validator: [`src/lib/env.ts`](src/lib/env.ts)
- Ops inventory (short form): [`docs/ops/env-vars-inventory.md`](docs/ops/env-vars-inventory.md)
- Email deliverability setup: [`EMAIL_DELIVERABILITY.md`](EMAIL_DELIVERABILITY.md)
- Supabase dashboard setup: [`SUPABASE_DASHBOARD_SETUP.md`](SUPABASE_DASHBOARD_SETUP.md)
- Launch checklist: [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md)
