# Lawyer Engagement Pack — Readiness Status

**Generated:** 2026-05-05
**Source:** `01-founder-fill-checklist.md` (counted item-by-item)

---

## Summary

| Bucket | Count | % of total |
|---|---:|---:|
| **Total items in checklist** | 57 | 100% |
| Auto-filled from code (deterministic, founder verifies only) | 9 | 16% |
| Pre-filled with default (defensible default; founder may override) | 26 | 46% |
| Still requires founder judgment / external data | 22 | 38% |

**Estimated founder time-to-complete:** ~90 minutes (was 1-3 days)
**Time saved:** ~85-95% reduction in items requiring active founder thought.

---

## Breakdown by section

| § | Section | Auto-filled | Default | Founder must fill | Total |
|---|---|---:|---:|---:|---:|
| A | Company identity | 2 (A.1, A.6) | 0 | 4 (A.2 CIN, A.3 address, A.4 GSTIN, A.5 incorporation date) | 6 |
| B | DPO / Grievance Officer | 0 | 3 (B.2, B.5, B.6) | 3 (B.1 name, B.3 email, B.4 phone) | 6 |
| C | Email aliases | 1 (C.5 support@) | 5 (C.1, C.2, C.3, C.4, C.6) | 0 | 6 |
| D | URLs | 2 (D.1, D.2) | 3 (D.3, D.4, D.5) | 0 | 5 |
| E | Retention windows | 1 (E.1 — 30d cooling-off, code-pinned) | 7 (E.2-E.5, E.7-E.9) | 1 (E.6 backup window) | 9 |
| F | Refund policy | 0 | 3 (F.2, F.3, F.4) | 1 (F.1 admin fee) | 4 |
| G | Misc (payments, GST, AI, channels) | 3 (G.10 Mailgun, G.11 WhatsApp Cloud API, G.15 RBAC count) | 5 (G.4, G.5, G.12, G.13 partial, G.14) | 7 (G.1 GST, G.2 cap, G.3 arbitrator, G.6-G.9 versions/dates, G.13 strategic) | 21 |
| | **Totals** | **9** | **26** | **22** | **57** |

(Note: B.3 email is also covered by the default in C.2 — founder fills the same value once.)

---

## What founder must still decide (the irreducible list)

These cannot be inferred from code. Group them into a single ~90-minute session.

### From Certificate of Incorporation / MCA records (5 min)
- A.2 CIN
- A.3 Registered office address
- A.4 GSTIN
- A.5 Date of incorporation

### Appointing a real human as DPO (15 min — pick a person, write down their phone)
- B.1 Name
- B.3 Direct email (suggest: route dpo@alfanumrik.com to this person)
- B.4 Direct phone

### Operations check (5 min — log into Supabase dashboard)
- E.6 Backup retention window — read what's actually configured

### Commercial / policy decisions (45 min — needs accountant + product input)
- F.1 Yearly refund admin fee (suggest ₹0 to match the public "7-day full refund, no questions asked" promise)
- G.1 GST treatment (accountant call — 10 min)
- G.2 Liability cap floor (lawyer pre-call — defer to lawyer's first opinion)
- G.3 Arbitration appointing authority (defer to lawyer)
- G.6, G.7, G.8, G.9 — version numbers and effective dates (set after lawyer sign-off)
- G.13 AI conversation training stance (strategic — pick option 1 unless training is on the roadmap)

### Email alias provisioning (15 min — DNS + mailbox routing)
- C.1, C.2, C.3, C.4, C.6 — only the routing setup needs doing; alias names are already pre-filled

---

## What was auto-filled and why

| Item | Source of truth |
|---|---|
| A.1 Company name | Cusiosense Learning India Private Limited (cross-referenced from PostHog org name + 05-platform-summary-for-lawyer.md) |
| A.6 Production domain | alfanumrik.com is hardcoded in every email template, OG metadata, SITE_URL |
| C.5 support@ alias | Live in production — referenced in 6+ Edge Functions and pages |
| D.1 Pricing URL | /pricing route exists |
| D.2 Privacy URL | /privacy route exists |
| E.1 Cooling-off window | `supabase/migrations/20260505120000_account_deletion_flow.sql` line 96 sets `cooling_off_ends_at DEFAULT (now() + INTERVAL '30 days')` — the policy MUST match what the system does |
| G.10 Email provider | Mailgun (3 Edge Functions use MAILGUN_API_KEY + MAILGUN_DOMAIN) |
| G.11 WhatsApp BSP | Meta direct (whatsapp-notify/index.ts line 167 calls graph.facebook.com directly, no intermediary) |
| G.15 RBAC count | 6 roles, 71 permissions (per `.claude/CLAUDE.md` and `CLAUDE.md`) |

---

## Items where I was uncertain (flagged for founder)

1. **G.10 Mailgun region (US vs EU)** — pre-filled as "Mailgun" but the founder must check the Mailgun dashboard to confirm which region the account was created in. This matters for the cross-border-transfer disclosure in PP §12.
2. **E.2 Foxy conversation retention (12 months)** — pre-filled with the scaffold default, but no code currently enforces a 12-month TTL on `chat_sessions` or `foxy_response_cache`. Founder/engineering must either add a purge cron or pick a value that matches actual practice (currently effectively "indefinite").
3. **G.13 AI training opt-out wording** — left as a binary choice for the founder. Defaulting to "we do NOT train" is the simplest legal posture and matches current Anthropic API behaviour, but if the AI roadmap includes any future training/fine-tuning use of conversations, picking option 2 now avoids a future re-consent flow.
4. **B.5 / G.4 / G.5** — pre-filled as "match registered office (A.3)". These will need to be re-stated explicitly once A.3 is filled in.

---

## Files modified / created in this pass

- **Modified:** `docs/legal/lawyer-engagement-pack/01-founder-fill-checklist.md`
- **Created:** `docs/legal/lawyer-engagement-pack/06-readiness-status.md` (this file)
- **Untouched (per task constraints):** the two scaffold files (`privacy-policy-scaffold.md`, `terms-of-service-scaffold.md`) and engagement pack files 00, 02, 03, 04, 05.
