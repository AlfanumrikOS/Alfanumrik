# 02 — Dependency and Trust Map

**Status:** DRAFT — Phase 1. Env var VALUES are never printed in this doc or by any agent on this program —
only names, presence, and plausibility (length/shape) checks are permitted, consistent with P13 (no secrets
in logs) and general secret hygiene. Anyone extending this doc must follow the same rule.

## External providers referenced by env var names (presence confirmed, no values inspected beyond length)
| Provider | Purpose | Env vars (names only) |
|---|---|---|
| Supabase | DB/Auth/Storage/Edge Functions | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Razorpay | Payments (INR) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (webhook secret var name not yet confirmed present) |
| Anthropic | Claude (Foxy, ncert-solver, quiz-generator, cme-engine) | `ANTHROPIC_API_KEY` |
| OpenAI | MoL shadow comparison ONLY (never student-facing per Cycle-4 FOX-4 finding — governed, default-OFF) | `OPENAI_API_KEY` |
| Voyage | Embeddings/reranking for RAG | `VOYAGE_API_KEY` |
| Gemini | present in apps/host env, purpose not yet confirmed in this pass | `GEMINI_API_KEY` |
| Upstash Redis | Rate limiting, feature flags | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| PostHog | Analytics | `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` |
| Twilio / WhatsApp | Parent notifications | `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_WEBHOOK_PUBLIC_URL`, `WHATSAPP_PHONE_PEPPER` |
| Sentry | Monitoring | referenced in `next.config.js`; `NEXT_PUBLIC_SENTRY_DSN` per root CLAUDE.md |
| Super admin | Privileged access gate | `SUPER_ADMIN_SECRET`, `ADMIN_API_KEY`, `INTERNAL_CALLER_SIGNING_SECRET` |
| Cron | Scheduled job auth | `CRON_SECRET` |

## Supabase project references discovered
| Project ref | Where found | Status |
|---|---|---|
| `shktyoxqhundlvkiwguu` | `apps/host/.env.local`, `.env.local.LIVE-SAVE` (repo root) | **PRODUCTION — confirmed directly by the CEO** (2026-08-23, during the PAY-2 investigation). `payment_history` table there has exactly 5 rows total as of that check — see `04_FINDINGS_AND_CONFLICTS.md` for why this matters (very low real transaction volume to date; not a defect, but material context for load-testing expectations under Gate G). |
| `gzpxqklxwzishrkiaatd` | `.env.staging.local` (repo root) | Credential in this file looks like a placeholder (41-char "service role key" — real Supabase JWTs run several hundred characters). **Not confirmed usable.** Needs a real staging credential source identified before any staging-environment testing in this program can proceed against it. |

## Multiple `.env*` files present at repo root (housekeeping note, not yet actioned)
`.env.example`, `.env.local`, `.env.local.LIVE-SAVE`, `.env.local.sandbox`, `.env.staging.local`,
`.env.staging.local.txt`. The presence of a `.txt` twin of a staging env file and a `LIVE-SAVE` backup
sitting in a working tree (not `.gitignore`d as far as confirmed) is a secret-hygiene smell worth a
dedicated architect/ops look before launch — **not yet triaged**, added to task ledger as a Medium finding
pending confirmation of whether these are actually git-ignored or at risk of being committed.

## Trust boundary summary (per root CLAUDE.md, re-confirmed not re-derived)
- `packages/lib/src/supabase.ts` — client-side, RLS-respecting.
- `packages/lib/src/supabase-server.ts` — server components/middleware, RLS-respecting.
- `packages/lib/src/supabase-admin.ts` — server-only, **bypasses RLS** (service role). Never import in
  client code. XC-3 (open Tier-3 item from the prior audit) flags that ~87% of API routes use this client —
  re-verification of that ratio is in progress via the backend/API recon agent.

## Pending
Full dependency graph (`dependency-cruiser` is a devDependency — not yet run), a complete list of Edge
Function secrets, and confirmation of which providers are actually reachable from this environment (only
Supabase REST connectivity has been confirmed working this session, via the read-only PAY-2 query).
