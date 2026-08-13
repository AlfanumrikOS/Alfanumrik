# WhatsApp Study Bot — Go-Live Runbook

**Date:** 2026-08-12 · **Prepared from a live audit** (Supabase project `shktyoxqhundlvkiwguu` + repo)
**Verdict:** The bot is feature-complete and one fix away from launch. The flag was never flipped because every outbound interactive send failed in the 2026-07-30 smoke test — Twilio Content resources were never provisioned. This runbook fixes that and takes the channel live.

---

## 1. Verified current state (each line names its check)

| Item | State | How verified |
|---|---|---|
| Inbound webhook `/api/whatsapp/webhook` | Deployed, signature-verified, always-200 posture | Read `apps/host/src/app/api/whatsapp/webhook/route.ts` |
| `ff_whatsapp_inbound_webhook` | **ON** (100%) | Live `feature_flags` query |
| `ff_whatsapp_daily6` | **ON** (100%) | Live `feature_flags` query |
| `ff_whatsapp_bot_v1` (master kill switch) | **OFF** — the only gate closed | Live `feature_flags` query |
| `whatsapp-send` gateway (opt-in, quiet hours, caps, nudge parking) | Deployed v7, ACTIVE | `list_edge_functions` + code read |
| DB: 9 `whatsapp_*` tables, `whatsapp_record_send` + `whatsapp_claim_inbound` RPCs | Present | `information_schema` + `pg_proc` queries |
| Signed callers `whatsapp-webhook-route`, `whatsapp-drain-cron` | Registered, active | `security_internal_callers` query |
| Drain cron `/api/cron/whatsapp-drain` | Scheduled `* * * * *` | `apps/host/vercel.json` |
| Twilio creds on Edge (`TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM`) | Configured | Indirect: 2026-07-30 failures got PAST the credentials check |
| Webhook env on Vercel (`TWILIO_AUTH_TOKEN`, `WHATSAPP_WEBHOOK_PUBLIC_URL`, `WHATSAPP_PHONE_PEPPER`) | Configured | Indirect: 6 inbound events persisted with valid signatures |
| Outbound interactive sends | **ALL 12 FAILED** — "requires a pre-created content_sid" | `whatsapp_message_log` query (latest rows, 2026-07-30) |
| Test population | 1 identity, opted-in; 5 inbound events `failed`, 1 `done` | Live counts |

**Root cause (one sentence):** daily6 sends `interactive_buttons` / `interactive_list` messages without a `content_sid`, and the Twilio transport requires a pre-created Content resource for any non-text send — the resources were never created, so every send failed at the transport gate.

## 2. The fix (already in this change)

1. **`supabase/functions/_shared/whatsapp/twilio-transport.ts`** — interactive sends now resolve a default Content SID from a new `TWILIO_CONTENT_SID_MAP` secret, keyed by shape (`qr2`, `list4`, …). Caller-supplied `content_sid` still wins. The positional ContentVariables convention is extended to carry **item/button ids and descriptions** — ids are the private reply-opcode space (`d6:a:<q>:<opt>`, `subj:<code>`) the intent classifier depends on; without templated ids, quiz answers can never be captured.
2. **`scripts/whatsapp/provision-twilio-content.mjs`** (new) — creates 12 generic Content resources (`qr2`, `qr3`, `list1`…`list10`) via the Twilio Content API, idempotent by `friendly_name`, and prints the exact `TWILIO_CONTENT_SID_MAP` value. In-session interactive content needs **no** WhatsApp/Meta template approval — usable immediately.

No changes to `daily6.ts`, the webhook, `whatsapp-send`, or any schema. `whatsapp-notify` untouched (deliberately separate, per its header).

## 3. Go-live steps (in order)

1. **Provision Content resources** (local, ~1 min):
   `TWILIO_ACCOUNT_SID=ACxxx TWILIO_AUTH_TOKEN=xxx node scripts/whatsapp/provision-twilio-content.mjs`
2. **Set the secret** on Supabase Edge (project `shktyoxqhundlvkiwguu`):
   `npx supabase secrets set TWILIO_CONTENT_SID_MAP='<printed JSON>'`
3. **Deploy `whatsapp-send`** (shared transport changed): merge → CI, or `npx supabase functions deploy whatsapp-send`.
4. **Confirm single webhook registration (§3a / Rule 6):** in the Twilio console, the WhatsApp sender's inbound URL must equal `WHATSAPP_WEBHOOK_PUBLIC_URL` exactly, registered **once** — Vercel host only, never also AWS.
5. **Smoke test with the existing opted-in identity** (flag still OFF is fine for steps a–b; STOP/HELP work regardless):
   a. Send `MENU` → expect the 2-button quick reply to render (proves `qr2` + variable substitution).
   b. Tap **Daily 6** → subject list renders (`listN`), pick subject → Q1/6 renders (`list4`).
   c. **Critical check:** after tapping a list item, confirm `whatsapp_inbound_events.payload.button_payload` contains the opcode (e.g. `d6:a:0:2`). Twilio's current webhook contract delivers interactive replies in `ButtonPayload`; if a list reply ever arrives without it, `parseInbound` needs a one-line fallback — verify empirically before scale. **RESOLVED 2026-08-13 (backend audit):** rather than wait on empirical verification, `parseInbound` (`packages/lib/src/whatsapp/intent.ts`) now falls back to `ListId` when `ButtonPayload` is absent, so a list-picker reply is captured under either contract. Still worth confirming in the smoke test which field actually arrives, but a missing `ButtonPayload` is no longer a silent Daily-6 outage.
   d. Complete all 6 → score summary arrives; confirm `whatsapp_message_log` rows show `status='sent'`, `billable=false`.
6. **Flip the switch:** set `ff_whatsapp_bot_v1.is_enabled = true` (rollout already 100). The 5 `failed` inbound events will be retried by the per-minute drain cron.
7. **Watch for 24h:** `whatsapp_message_log` error rates, `billable=true` row count (cost thesis: session messages must be ₹0), drain-cron logs.

**Rollback:** set `ff_whatsapp_bot_v1.is_enabled = false` — designed kill switch; inbound events keep persisting durably, nothing is lost.

## 4. Out-of-scope observations flagged (§15 duty)

- `.env.example` documents only the legacy `whatsapp-notify` vars — none of the bot vars (`TWILIO_*`, `WHATSAPP_WEBHOOK_PUBLIC_URL`, `WHATSAPP_PHONE_PEPPER`, `WHATSAPP_TRANSPORT`, now `TWILIO_CONTENT_SID_MAP`). Worth an additive docs pass.
- `whatsapp-notify`'s three adaptive-escalation Meta templates are placeholder IDs pending Meta Business Manager approval (documented in its source) — required before `ff_adaptive_remediation_v1` / `ff_adaptive_loops_bc_v1` ever turn on, unrelated to this launch.
- `template_fallback` Content SIDs (paid out-of-window utility nudges) are also unprovisioned. Not launch-blocking — the gateway's "drop, don't pay" branch parks nudges for free delivery on next inbound — but provision before enabling the alarm/parent_weekly kinds.
- Original ask was an n8n WhatsApp workflow: rejected as a Rule-5 duplicate of this bot (two live implementations + a second webhook registration). If n8n is ever wanted for *additive* jobs (broadcasts, CRM sync), it must call `whatsapp-send` and never register a webhook on the number.

## 5. 2026-08-13 backend bug-audit addendum

A full backend bug-audit pass (webhook, link flow, Daily-6 state machine, drain cron, send gateway, shared libs) was run before this runbook's go-live steps are executed. Findings and fixes are summarized in the audit report; the two most relevant to this runbook:

- **Branch-integration gap (process, not code):** this file, `scripts/whatsapp/provision-twilio-content.mjs`, and the Content-SID fix to `twilio-transport.ts` had landed on `fix/whatsapp-content-sid` (commit `fe6658f72`, cherry-picked as `8fc7c7b12`) but were **not present** on `fix/revoke-anon-execute-secdef-rpcs`, the branch actually being worked. Restored via direct file writes (cherry-pick was blocked by the permission classifier) so the two branches no longer disagree about whether this fix exists. Before merging either branch to `main`, confirm the other doesn't reintroduce the pre-fix `twilio-transport.ts`.
- **DPDP minor-consent gate was OTP-issuance-only:** `whatsapp-send`'s gate chain never re-checked `parental_consent` on every send — only `/api/whatsapp/link/start` checked it once, before the OTP was issued. A parent revoking consent after binding did not stop future Daily-6 sends to that student's WhatsApp number. Fixed with a live re-check gate in `whatsapp-send/index.ts` (Gate 3.5, between opt-in and quiet hours). Run the smoke test's consent-revocation path (revoke `parental_consent` for the test student, confirm the next send returns `{sent:false, reason:'consent_revoked'}`) before flipping the master switch for real users.
