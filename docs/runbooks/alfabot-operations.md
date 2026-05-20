# AlfaBot Operations Runbook

Operational reference for the AlfaBot landing-page chat assistant. Audience:
an on-call engineer or admin who needs to monitor, roll out, kill, or
investigate AlfaBot in production.

For the product invariants and agent ownership, see
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).
For the landing-page surface itself, see [`docs/landing-page.md`](../landing-page.md).
For the knowledge-base copy that drives answers, see
[`docs/alfabot/knowledge-base.md`](../alfabot/knowledge-base.md).

---

## 1. Overview

AlfaBot is a bilingual chat assistant that lives at the bottom-right of
`/welcome` (and only `/welcome` in v1). It answers questions about
Alfanumrik for four audiences — **parents**, **students**, **teachers**,
**schools** — in English and Hindi.

AlfaBot is **not Foxy**. Foxy is the AI tutor inside the authenticated
product. AlfaBot is the pre-signup marketing assistant. The two surfaces
share none of the same routes, prompts, or rate limits.

**Underlying model:** OpenAI `gpt-4o-mini` (CEO directive 2026-05-19). The
fallback model on grounding-failure retries is `gpt-4o`. Embeddings for KB
retrieval use Voyage `rerank-2` (already provisioned for Foxy).

**Who serves whom:**

| Surface | Authenticated? | Model | Owner |
|---|---|---|---|
| AlfaBot (`/welcome`) | No | gpt-4o-mini | ops + ai-engineer |
| Foxy (`/foxy`) | Yes | Claude Haiku | ai-engineer + assessment |

---

## 2. Architecture

```
┌────────────────┐       ┌────────────────────┐       ┌─────────────────────────┐
│ Browser widget │──POST─▶│ /api/alfabot       │──RPC─▶│ alfabot-answer (Deno)   │
│  /welcome      │  SSE  │  (Next.js, Node)   │       │ Supabase Edge Function  │
└────────────────┘       └─────┬──────────────┘       └─────┬───────────────────┘
       ▲                       │                            │
       │                       │                            ├─▶ Voyage rerank-2
       │                       │                            ├─▶ OpenAI gpt-4o-mini
       │                       ▼                            ▼
       │      ┌────────────────────────────────────────────────────────┐
       │      │ Supabase Postgres                                      │
       │      │   alfabot_sessions / alfabot_messages /                │
       │      │   alfabot_leads / alfabot_kb_chunks /                  │
       │      │   alfabot_denylist / audit_logs                        │
       │      └────────────────────────────────────────────────────────┘
       │                       ▲
       │                       │
       └─── Upstash Redis ─────┘
            (3 rate-limit buckets + daily $ ledger)
```

Key boundaries:

- **/api/alfabot** owns: anon-id cookie, rate limiting, abuse pre-filter,
  session persistence, audit logging, USD budget tally.
- **alfabot-answer Edge Function** owns: KB retrieval, OpenAI call, source
  citation, abstain decisions.
- **Super-admin** owns: dashboard at `/super-admin/alfabot`, denylist CRUD,
  feature-flag toggles, runbook (this doc).

---

## 3. Feature flags

All flags live in the `feature_flags` table. Toggle from
`/super-admin/flags?search=ff_alfabot` or by direct UPDATE.

| Flag | Default | Effect when OFF | Effect when ON |
|---|---|---|---|
| `ff_alfabot_v1` | OFF | `/api/alfabot` returns 404 — widget hides | Widget renders + chat works |
| `ff_alfabot_lead_capture_v1` | OFF | Lead form hidden | Lead form rendered post-chat |
| `ff_alfabot_streaming` | ON | All responses non-streamed (single JSON) | SSE streaming used when client accepts it |

### Rollout plan for `ff_alfabot_v1`

| Stage | Rollout | Duration | Gate criteria |
|---|---|---|---|
| 0 | OFF (internal QA) | until ready | smoke test from 4 audiences × 2 langs |
| 1 | 5% (`rollout_percentage=5`) | 7 days | abuse rate < 5/day, spend < $5/day, abstain rate < 30% |
| 2 | 25% | 7 days | same gates + p95 latency < 4500ms |
| 3 | 100% | indefinite | same gates + 7-day retention plan |

Each stage transition is logged to `audit_logs` automatically by the
feature-flag PATCH route.

---

## 4. Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | yes (Edge Function secret) | — | gpt-4o-mini call |
| `VOYAGE_API_KEY` | yes (Edge Function secret) | — | embedding + rerank |
| `ALFABOT_DAILY_USD_CAP` | optional | `20` | hard daily spend cap; over-cap degrades to FAQ-only mode |
| `ALFABOT_IP_SALT` | yes | — | salts IP hashes before persistence (P13) |
| `ALFABOT_LEAD_CAPTURE_WEBHOOK_URL` | optional | — | downstream CRM webhook for new leads |
| `UPSTASH_REDIS_REST_URL` | optional | — | rate-limit + budget store (falls back to in-memory) |
| `UPSTASH_REDIS_REST_TOKEN` | optional | — | same |

Edge Function secrets are managed via `supabase secrets set ...` per
`docs/SUPABASE_DASHBOARD_SETUP.md`. Vercel env vars are set in the Vercel
dashboard.

---

## 5. Rate limits

Three Upstash layers + a budget cap, evaluated in order:

| Layer | Limit | Key | Notes |
|---|---|---|---|
| Burst | 6 / 60s sliding | `alfabot:burst:<anon_id>` | Stops keyboard-mashers |
| Per-anon daily | 30 / 24h fixed | `alfabot:day:<anon_id>` | Hard cap per visitor / day |
| Per-IP daily | 60 / 24h fixed | `alfabot:ipday:<ip_hash>` | Stops cookie-rotation abuse |
| Session max | 30 messages | `alfabot_sessions.message_count` | Forces new session after 30 turns |
| Budget cap | `$ALFABOT_DAILY_USD_CAP` | `alfabot:budget:usd:<yyyymmdd>` | Degrades to FAQ-only on the day it trips |

When any limit blocks, the route returns either:
- 429 + `{ error: 'rate_limited', scope, resetAt }`, or
- 200 + `{ degradedMode: true, response: '<budget abstain copy>' }`.

The dashboard's "Rate-limit hit %" tile reflects the rate at which
`rate_limit_hit=true` was stamped on `alfabot_sessions` today.

---

## 6. How to roll out

Treat each transition as a deploy:

1. **Stage 0 → 1 (off → 5%)**
   1. Verify `ALFABOT_DAILY_USD_CAP` is set (default 20).
   2. Verify Upstash is reachable (check `/super-admin/observability`).
   3. Update flag: `rollout_percentage=5, is_enabled=true`.
   4. Watch `/super-admin/alfabot` for 24h. Gate criteria as in section 3.
2. **Stage 1 → 2 (5% → 25%)**: only after 7 days at stage 1 with no
   incident. Update `rollout_percentage=25`.
3. **Stage 2 → 3 (25% → 100%)**: only after 7 days at stage 2. Update
   `rollout_percentage=100`.

If a stage gate fails, **roll back** to the prior stage by setting
`rollout_percentage` back. The flag cache TTL is ≤ 60s, so the new value
propagates within a minute.

---

## 7. Kill switch

To stop the widget immediately:

```sql
UPDATE public.feature_flags
   SET is_enabled = false, updated_at = now()
 WHERE flag_name = 'ff_alfabot_v1';
```

Effect: within 60 seconds the `/api/alfabot` route returns 404 (so the
widget hides) and `/welcome` renders without the bubble. Already-open
panels show a rate-limit-style error copy on their next message attempt.

To pause SSE streaming only (e.g. SSE infra degrades) without killing the
bot:

```sql
UPDATE public.feature_flags
   SET is_enabled = false, updated_at = now()
 WHERE flag_name = 'ff_alfabot_streaming';
```

Effect: all responses go via the blocking JSON path. UX degrades (no
token-by-token streaming) but the bot keeps working.

---

## 8. How to investigate an abuse complaint

A visitor or partner has reported an abusive AlfaBot interaction:

1. Get the `anon_id` from the report (the widget shows the first 8 chars
   in its footer for cite-back).
2. Open `/super-admin/alfabot`, search the recent-sessions table for that
   `anonIdPrefix`. Click **Inspect** to open the session detail page.
3. The session detail page requires `alfabot.read_messages` permission.
   Reading it emits an `alfabot.admin_message_read` audit row tied to your
   admin id.
4. Review the message thread. Decide:
   - **False alarm**: nothing to do.
   - **Misconception in KB**: edit `docs/alfabot/knowledge-base.md`, re-run
     `node scripts/embed-alfabot-kb.mjs` (section 9).
   - **Banworthy abuse**: add the `anon_id` to the denylist from the
     dashboard. The route writes an `alfabot.denylist_added` audit row.

Forensic SQL when the dashboard is unavailable:

```sql
SELECT role, content, model, tokens_used, latency_ms, created_at
  FROM public.alfabot_messages
 WHERE session_id = '<uuid>'
 ORDER BY created_at ASC;
```

(Service-role only — `alfabot_messages` has no anon/authenticated policies.)

---

## 9. How to update the knowledge base

The KB lives at [`docs/alfabot/knowledge-base.md`](../alfabot/knowledge-base.md).
Each H2 section becomes one row in `alfabot_kb_chunks`. The `section_id` is
the slugified H2 title; sections tagged `<!-- canonical -->` are quoted
verbatim by the model and MUST NOT be paraphrased downstream.

Workflow:

1. Edit `docs/alfabot/knowledge-base.md`. Keep each section ≤ 400 words —
   chunking budgets one section per Voyage embedding.
2. Run the embed script (shipped with PR 2):
   ```
   node scripts/embed-alfabot-kb.mjs
   ```
   The script reads the file, computes a SHA-256 per section, and
   upserts only changed sections (no embedding cost on unchanged copy).
3. Verify on the dashboard: the recent-sessions table should start citing
   the new `section_id` within minutes.
4. Smoke test by asking AlfaBot a question only the new copy can answer.

For Hindi copy, create a parallel `### हिंदी` block under each H2; the
chunker creates a separate `lang='hi'` row.

---

## 10. How to swap models

Changing the underlying model requires **user (CEO) approval** per
`.claude/CLAUDE.md` "AI model or provider changes".

When approved:

1. Update `ALFABOT_OPENAI_CONFIG.model` in
   `src/lib/ai/prompts/alfabot-system.ts`.
2. Mirror the change in the Edge Function:
   `supabase/functions/alfabot-answer/prompt.ts` (and any model string in
   `index.ts`).
3. Add an entry to `ALFABOT_MODEL_PRICING` in
   `src/lib/alfabot/pricing.ts` so cost estimation stays accurate.
4. If switching providers (OpenAI → Anthropic, etc.):
   - Add the new SDK to the Edge Function and rotate the API key secret.
   - Update the runbook (section 1) and `docs/landing-page.md` section
     listing the model.
   - Update PostHog filters that match on `model='gpt-4o-mini'`.
5. Soft-launch via `rollout_percentage=5` on the existing flag and watch
   the dashboard for cost / latency / abstain drift.

---

## 11. Incident response

| Symptom | Likely cause | First action |
|---|---|---|
| Spike in `alfabot.upstream_failed` audit rows | OpenAI / Edge Function outage | Check OpenAI status page; verify Edge Function logs; consider flipping `ff_alfabot_streaming` off to simplify the path |
| Spike in `alfabot.abuse_blocked` | New abuse vector or false positives | Review top reasons on the dashboard; tighten or loosen the regex in `route.ts` |
| Cost monitor red (≥ 80%) | Heavy usage or KB regression | The bot is already degraded (FAQ-only). Decide whether to raise `ALFABOT_DAILY_USD_CAP` for the day, or kill the bot |
| Spike in rate-limit-hit % | Single visitor abuse OR bot traffic | Look at the recent-sessions table; ban anon_id; review IP-hash distribution |
| p95 latency > 6s | OpenAI slow OR KB retrieval slow | Check Sentry traces tagged `feature:alfabot`; if KB-side, consider falling back to KB-only mode by tweaking the cap |
| Drop in lead funnel | `ff_alfabot_lead_capture_v1` flipped off OR webhook down | Check flag state; verify webhook delivery in `alfabot_leads.webhook_delivered_at` |

For an out-of-hours emergency, the kill switch (section 7) is the safe
default — flip and investigate.

---

## 12. Monitoring

| Surface | What it shows | Refresh |
|---|---|---|
| `/super-admin/alfabot` | All operational metrics (sessions / messages / cost / latency / abuse / leads / audience / lang / denylist / recent sessions) | manual + 60s cache |
| `/super-admin/logs?action=alfabot.respond` | Per-turn audit log (no content) | live |
| `/super-admin/logs?action=alfabot.abuse_blocked` | Abuse pre-LLM rejects | live |
| PostHog dashboard | `alfabot_*` events from the widget (PR 3) | 1–2 min PostHog ingest lag |
| Sentry | Errors tagged `feature:alfabot` | live |
| `v_alfabot_daily_stats` view | Per-day session / message / rate-limit roll-up | live (service role) |

The dashboard reads through a 60-second in-memory memo on the API; a hard
refresh waits at most 60s for a new sample.

---

## 13. RBAC

Three new permission codes apply to AlfaBot ops:

| Permission | Page | Held by |
|---|---|---|
| `alfabot.read_dashboard` | `/super-admin/alfabot` | super_admin, support, analyst |
| `alfabot.read_messages` | `/super-admin/alfabot/[sessionId]` | super_admin only (until architect approves wider grant) |
| `alfabot.manage_denylist` | denylist CRUD | super_admin |

These codes are **proposed but not yet seeded**. Until the RBAC migration
lands, the routes fall back to `authorizeAdmin(request, 'support')` /
`'super_admin'` as documented in the route files. See follow-up in the
"Deferred items" of PR 4.

---

## See also

- [`docs/landing-page.md`](../landing-page.md) — landing surface that hosts AlfaBot
- [`docs/alfabot/knowledge-base.md`](../alfabot/knowledge-base.md) — answer source of truth
- [`docs/RBAC_MATRIX.md`](../RBAC_MATRIX.md) — current permission codes
- [`docs/ADMIN_OPERATIONS.md`](../ADMIN_OPERATIONS.md) — broader admin runbooks
- [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) — product invariants
- [`docs/runbooks/ai-outage-response.md`](./ai-outage-response.md) — AI provider outage drill
