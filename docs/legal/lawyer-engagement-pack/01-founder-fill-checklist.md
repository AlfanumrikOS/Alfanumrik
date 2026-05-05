# Founder Fill Checklist

Every `[FOUNDER FILL: ...]` marker from `privacy-policy-scaffold.md` and `terms-of-service-scaffold.md`, grouped by category. Complete before engaging a law firm — the lawyer needs most of these to give a useful first opinion.

For each item: a value line (pre-filled where the codebase already commits us to a deterministic answer, or a defensible default exists), plus a hint about what good looks like. References to scaffold sections (e.g., "PP §1" = Privacy Policy section 1; "ToS §4.1" = Terms of Service section 4.1) follow each item.

**Legend:**
- `<!-- AUTO-FILLED 2026-05-05: <reason> -->` — the value is fixed by code/config; founder verifies but should not need to change.
- `<!-- DEFAULT 2026-05-05: <source>; founder may override -->` — defensible default applied; founder may tighten/loosen.
- `<!-- FOUNDER MUST FILL — no deterministic answer in code -->` — judgment call, no pre-fill possible.

---

## A. Company identity

**A.1 Registered company name**
Value: Cusiosense Learning India Private Limited
<!-- AUTO-FILLED 2026-05-05: docs/legal/lawyer-engagement-pack/05-platform-summary-for-lawyer.md and PostHog org name "Cusiosense Learning India Private Limited" both reference this entity. Founder verify against Certificate of Incorporation. -->
Hint: full legal name as on the Certificate of Incorporation. Used in PP §1, ToS §1.

**A.2 Corporate Identity Number (CIN)**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code -->
Hint: 21-character MCA identifier, e.g., "U80903KA2024PTC123456". Found on the Certificate of Incorporation. Used in PP §1, ToS §1.

**A.3 Registered office address**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code -->
Hint: full postal address with PIN code, matching MCA records. Used in PP §1, PP §10.1, PP §17, ToS §1, ToS §13, ToS §15, ToS §18.

**A.4 GSTIN**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code -->
Hint: 15-character GST identifier. Used on invoices and to confirm GST treatment in ToS §4.1.

**A.5 Date of incorporation**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code -->
Hint: from Certificate of Incorporation. Reference for the lawyer; not displayed to users.

**A.6 Production domain**
Value: https://alfanumrik.com
<!-- AUTO-FILLED 2026-05-05: every email template, OG metadata, and SITE_URL reference uses alfanumrik.com -->
Hint: e.g., "https://alfanumrik.com". Used in PP §1.

---

## B. Data Protection Officer / Grievance Officer

The DPDP Act and IT Rules 2021 require a named individual. The same person can hold both roles.

**B.1 DPO / Grievance Officer name**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code (must be a real, named individual) -->
Hint: full name of the appointed person. Must be a real, contactable individual — not a generic team. Used in PP §16, ToS §15.

**B.2 Designation**
Value: Data Protection Officer & Grievance Officer
<!-- DEFAULT 2026-05-05: DPDP Act Section 8(5) + IT Rules 2021 Rule 3(2) both require a named contact; combining the role is the standard approach for sub-SSMI EdTech platforms; founder may override -->
Hint: e.g., "Data Protection Officer", "Grievance Officer", or both. Used in PP §16, ToS §15.

**B.3 Direct email**
Value: dpo@alfanumrik.com
<!-- DEFAULT 2026-05-05: aligns with the alias suggested in C.2 below; founder may override -->
Hint: dedicated email reaching this person. See Section D for alias suggestions.

**B.4 Direct phone (with country code)**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — no deterministic answer in code (working-hours line for the appointed individual) -->
Hint: e.g., "+91 XXXXX XXXXX". Working-hours line. Used in PP §16, ToS §15.

**B.5 Postal address for grievances**
Value: (same as A.3 registered office)
<!-- DEFAULT 2026-05-05: standard practice for sub-SSMI Indian platforms is to route grievances to the registered office; founder may override -->
Hint: usually same as registered office. Used in PP §16, ToS §15.

**B.6 Working hours**
Value: Monday-Friday, 10:00-18:00 IST, excluding Indian public holidays
<!-- DEFAULT 2026-05-05: standard Indian business hours; matches scaffold suggestion in ToS §15; founder may override -->
Hint: e.g., "Monday-Friday, 10:00-18:00 IST, excluding public holidays". Used in ToS §15.

---

## C. Email aliases (set up DNS + mailbox before publication)

Each alias should route to a monitored inbox. Suggest configuring all on the company domain.

**C.1 privacy@** (general privacy queries) — PP §17
Configured: [ ] yes / [ ] no
<!-- DEFAULT 2026-05-05: alias is privacy@alfanumrik.com (matches scaffold suggestion); founder must confirm DNS+mailbox provisioning -->

**C.2 dpo@ or grievance@** (DPO / Grievance Officer) — PP §16, ToS §15
Configured: [ ] yes / [ ] no
<!-- DEFAULT 2026-05-05: alias is dpo@alfanumrik.com (matches scaffold suggestion + B.3 above); founder must confirm DNS+mailbox provisioning -->

**C.3 security@** (security incident reports, suspected unauthorized access) — ToS §3.2, ToS §5
Configured: [ ] yes / [ ] no
<!-- DEFAULT 2026-05-05: alias is security@alfanumrik.com (matches scaffold suggestion); founder must confirm DNS+mailbox provisioning -->

**C.4 copyright@** (IP takedown notices under IT Act §79 / IT Rules 2021 Rule 3) — ToS §7.5
Configured: [ ] yes / [ ] no
<!-- DEFAULT 2026-05-05: alias is copyright@alfanumrik.com (matches scaffold suggestion); founder must confirm DNS+mailbox provisioning -->

**C.5 support@** (general customer support) — PP §17, ToS §18
Configured: [x] yes — already in production use
<!-- AUTO-FILLED 2026-05-05: support@alfanumrik.com is referenced in send-welcome-email/index.ts, send-pre-debit-notice/index.ts (REPLY_TO + SUPPORT_EMAIL), src/app/contact/page.tsx, src/app/parent/support/page.tsx, src/app/not-found.tsx — alias is live -->

**C.6 delete@** (account deletion requests) — PP §10.1
Configured: [ ] yes / [ ] no
<!-- DEFAULT 2026-05-05: alias is delete@alfanumrik.com (matches scaffold suggestion); founder must confirm DNS+mailbox provisioning. Note: in-app deletion is also live via supabase/migrations/20260505120000_account_deletion_flow.sql + /api/v1/account/delete -->

---

## D. URLs (must exist before scaffold goes live)

**D.1 Pricing page URL**
Value: https://alfanumrik.com/pricing
<!-- AUTO-FILLED 2026-05-05: design-previews/pricing-v2.html and existing /pricing route are the canonical pricing surface -->
Hint: ToS §4.1 references this. Page must show plan features, INR prices, GST treatment, billing cycle.

**D.2 Privacy Policy URL**
Value: https://alfanumrik.com/privacy
<!-- AUTO-FILLED 2026-05-05: src/app/privacy/page.tsx is the live route -->
Hint: e.g., "https://alfanumrik.com/privacy". Referenced in ToS §1.

**D.3 SLA document URL (if institutional SLA exists)**
Value: N/A — no contractual SLA for individual subscribers (institutional contracts may include separate SLAs negotiated case-by-case)
<!-- DEFAULT 2026-05-05: scaffold ToS §8 explicitly contemplates this fallback wording; founder may override if a public SLA is published -->
Hint: ToS §8 references this. If no SLA, set to "N/A" and the section will state so.

**D.4 Cookie disclosure / banner page URL**
Value: in-app cookie banner detail screen (no standalone page yet)
<!-- DEFAULT 2026-05-05: scaffold PP §13 explicitly contemplates this fallback wording; founder may override if a /cookies page is added -->
Hint: PP §13 references this. Either a standalone page or in-app banner detail screen.

**D.5 Refund policy page URL (if separate from ToS §4.6)**
Value: N/A — refund terms are inline in ToS §4.6
<!-- DEFAULT 2026-05-05: scaffold suggests this is optional; keeping inline reduces drift risk; founder may override -->
Hint: optional — refund terms are inline in ToS §4.6. If you want a separate page, link here.

---

## E. Retention windows

Each is a `[FOUNDER FILL: ...]` in PP §8 or PP §10. Lawyer will check these against statutory minimums.

**E.1 Account profile retention after deletion request (recovery window)**
Value: 30 days
<!-- AUTO-FILLED 2026-05-05: supabase/migrations/20260505120000_account_deletion_flow.sql line 96 — cooling_off_ends_at DEFAULT (now() + INTERVAL '30 days'). This is what the system actually does; the policy must match. -->
Hint: scaffold suggests 90 days. Range 30-90 days is typical.

**E.2 Foxy AI conversation history retention**
Value: 12 months rolling
<!-- DEFAULT 2026-05-05: scaffold suggestion; supabase/migrations/00000000000000_baseline_from_prod.sql line 9249-9251 sets grounded chunks at 90d and ungrounded at 180d, but full conversation history retention is not yet enforced by code — founder may override -->
Hint: scaffold suggests 12 months rolling. Trade-off: longer = better personalization continuity; shorter = less data exposure.

**E.3 Audit log retention (admin actions, security events)**
Value: 3 years
<!-- DEFAULT 2026-05-05: scaffold suggestion; aligns with typical Indian fraud investigation horizon; founder may override -->
Hint: scaffold suggests 3 years. Should align with fraud investigation horizon and storage cost.

**E.4 Server access log retention**
Value: 90 days
<!-- DEFAULT 2026-05-05: scaffold suggestion; matches the 90-day window already used for student_daily_usage purges in baseline_from_prod.sql lines 2325/2336 -->
Hint: scaffold suggests 90 days. Operational debugging window.

**E.5 Support ticket retention after closure**
Value: 3 years from closure
<!-- DEFAULT 2026-05-05: scaffold suggestion; aligns with E.3 audit log window; founder may override -->
Hint: scaffold suggests 3 years. Useful for repeat-issue handling.

**E.6 Backup retention window (used for deletion-from-backup propagation)**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — must match actual Supabase backup retention configured in Supabase dashboard (Pro tier default is 7 days PITR; the scaffold's "35 days" assumes a higher tier) -->
Hint: scaffold suggests 35 days. Must match the actual Supabase backup retention you have configured.

**E.7 Acknowledgement window for deletion request**
Value: 7 days
<!-- DEFAULT 2026-05-05: scaffold suggestion; the 30-day completion deadline is fixed by DPDP Act and already enforced by the cooling_off_ends_at column (E.1) -->
Hint: scaffold suggests 7 days. The 30-day completion deadline is fixed by the Act.

**E.8 Response window for data-principal rights requests (PP §9)**
Value: 30 days
<!-- DEFAULT 2026-05-05: DPDP Act 2023 default response window pending final Rules notification; lawyer will tighten if Rules prescribe shorter window -->
Hint: recommended 30 days. The lawyer will confirm against final DPDP Rules.

**E.9 Notice window for material Privacy Policy changes (PP §15)**
Value: 14 days
<!-- DEFAULT 2026-05-05: scaffold suggests 7d; 14d is more conservative and is the standard for material Indian B2C platform policy changes; founder may override -->
Hint: scaffold suggests 7 days. 14-30 days is more conservative.

---

## F. Refund policy specifics (ToS §4.6, §4.7)

**F.1 Yearly plan administrative fee on refund**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — commercial/policy decision. Recommended: ₹0 (matches the "7-day full refund, no questions asked" promise already shown on design-previews/pricing-v2.html line 1665) -->
Hint: scaffold offers "₹0 / 5% / fixed ₹100". Lower = consumer-friendly; higher = covers payment-gateway fees. Indian consumer courts dislike high admin fees.

**F.2 Failed-payment retry policy**
Value: 3 retries over 5 days
<!-- DEFAULT 2026-05-05: scaffold suggestion; matches Razorpay's default recurring-payment retry behaviour; founder may override -->
Hint: scaffold suggests "3 times over 5 days". Razorpay default is similar.

**F.3 Per-day Foxy cap for under-13 users (PP §6.2)**
Value: 30 minutes per day
<!-- DEFAULT 2026-05-05: scaffold suggestion; aligns with Indian Academy of Pediatrics screen-time guidance for under-13s; founder may override -->
Hint: scaffold suggests "30 minutes per day". Set with an eye on screen-time guidance.

**F.4 Maintenance window threshold for prior notice (ToS §8)**
Value: 10 minutes
<!-- DEFAULT 2026-05-05: scaffold suggestion; below this threshold most users won't notice; founder may override -->
Hint: scaffold suggests "10 minutes". Below this, no notice; above, in-app banner.

---

## G. Misc — payments, GST, arbitration, AI training, channels

**G.1 GST treatment shown on pricing page**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — accountant-driven policy decision (inclusive vs exclusive). Will determine wording on invoices and pricing page -->
Hint: "inclusive of GST" or "exclusive of GST, added at checkout". Used in ToS §4.1. Confirm with your tax advisor.

**G.2 Liability cap floor (ToS §10)**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — commercial/legal judgment. Scaffold suggests ₹5,000 INR but lawyer must validate against Consumer Protection Act 2019 carve-outs for minors -->
Hint: scaffold suggests "₹5,000 INR". Cap should be defensible against consumer-court scrutiny — neither token nor uncapped.

**G.3 Arbitration appointing authority (ToS §14.2)**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — lawyer recommendation needed (institutional arbitral body vs Bar Council vs no arbitration clause at all for B2C minors) -->
Hint: e.g., "the President of the Bar Council of [State]" or "an institutional arbitral body". Lawyer will recommend.

**G.4 Arbitration seat and venue (ToS §14.2)**
Value: (city of registered office — match A.3)
<!-- DEFAULT 2026-05-05: standard practice is to match the registered office city; lawyer will validate enforceability against minors/parents under Consumer Protection Act 2019 -->
Hint: e.g., "Mumbai, Maharashtra". Usually matches registered office. Lawyer will validate enforceability against minors/parents.

**G.5 Court of exclusive jurisdiction (ToS §13)**
Value: (city of registered office — match A.3)
<!-- DEFAULT 2026-05-05: standard practice; lawyer may recommend "non-exclusive" given consumer-court doctrine -->
Hint: city of registered office. Lawyer may recommend "non-exclusive" given consumer-court doctrine.

**G.6 Privacy Policy version number**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — depends on whether this replaces an older policy and the founder's version-numbering scheme -->
Hint: PP top matter. Suggest "2.0" if this replaces an older policy.

**G.7 Privacy Policy effective date**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — date of publication after lawyer sign-off; cannot be set in advance -->
Hint: date of publication after lawyer sign-off. PP top matter.

**G.8 ToS version number**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — see G.6 -->
Hint: ToS top matter. Suggest "2.0" if this replaces an older policy.

**G.9 ToS effective date**
Value: ___________________________________________
<!-- FOUNDER MUST FILL — see G.7 -->
Hint: ToS top matter.

**G.10 Email delivery provider name + region (PP §7.1)**
Value: Mailgun (region per MAILGUN_DOMAIN configuration — confirm US vs EU in Supabase Edge Function secrets)
<!-- AUTO-FILLED 2026-05-05: supabase/functions/send-auth-email/index.ts, send-welcome-email/index.ts, send-pre-debit-notice/index.ts all use Mailgun via MAILGUN_API_KEY + MAILGUN_DOMAIN env vars. Region (us vs eu) is determined by which Mailgun region the founder/ops set up the account in — verify in Mailgun dashboard. -->
Hint: e.g., "AWS SES (ap-south-1)", "Resend (US)", "SendGrid (US)". Region matters for cross-border-transfer disclosure.

**G.11 WhatsApp Business Service Provider name (PP §7.1, if used)**
Value: Meta direct (WhatsApp Cloud API via graph.facebook.com)
<!-- AUTO-FILLED 2026-05-05: supabase/functions/whatsapp-notify/index.ts line 167 — calls https://graph.facebook.com/v18.0/${phoneNumberId}/messages directly using WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID. No intermediary BSP. -->
Hint: e.g., "Gupshup", "AiSensy", "Meta direct". If WhatsApp not used, write "Not used".

**G.12 Parental consent verification channel (PP §6.1, step 3)**
Value: email link + mobile OTP
<!-- DEFAULT 2026-05-05: scaffold suggestion; simplest defensible "verifiable consent" stack; lawyer will opine on whether DPDP requires Aadhaar eKYC -->
Hint: scaffold suggests "email link + mobile OTP". Lawyer will opine on whether this is "verifiable consent" under DPDP. Aadhaar eKYC is the strongest but most onerous.

**G.13 AI-conversation training opt-out wording (PP §14.2)**
Value: [ ] "We do NOT use Foxy conversations to train any AI model." OR [ ] "Anonymized Foxy conversations may be used to evaluate and improve our AI features. You may opt out via Settings → AI Preferences."
<!-- FOUNDER MUST FILL — strategic product decision. Note: the codebase does NOT currently feed Foxy conversations back to Anthropic for training (Anthropic's standard API terms exclude training by default), so option 1 is the simplest legal posture and matches current reality. -->
Hint: simpler legal posture is "we do not use". If you want optionality, the lawyer will write the opt-out wording.

**G.14 NCERT licensing basis (ToS §7.2)**
Value: fair-dealing under Section 52(1)(i) of the Copyright Act 1957 for educational purposes
<!-- DEFAULT 2026-05-05: NCERT does not publish a formal "open educational use" license; fair-dealing under Section 52(1)(i) is the standard basis Indian EdTech platforms rely on for NCERT excerpts. Lawyer will validate against actual usage pattern (verbatim quoting vs paraphrase vs full chapter reproduction). -->
Hint: choose ONE: (a) "NCERT open educational use policy", (b) "fair-dealing under Section 52(1)(i) of the Copyright Act 1957 for educational purposes", or (c) "specific licensing arrangement with NCERT". Lawyer will validate against actual usage pattern.

**G.15 RBAC summary phrasing (PP §11)**
Value: 6 roles and 71 granular permissions
<!-- AUTO-FILLED 2026-05-05: .claude/CLAUDE.md "Architecture Quick Reference" + CLAUDE.md "Database" row both state "RBAC (6 roles, 71 permissions)". This is the current production count. -->
Hint: scaffold suggests "6 roles and 71 granular permissions". Confirm current count with architect before publishing.

---

## Sign-off

When all items above are filled:

- [ ] Reviewed by founder
- [ ] Reviewed by accountant (Section A, G.1, G.2)
- [ ] Reviewed by ops/engineering (Section C, D, E, G.10-G.15)
- [ ] Bundled with the rest of the engagement pack and sent to the chosen firm
