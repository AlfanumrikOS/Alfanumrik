# Founder Fill Checklist

Every `[FOUNDER FILL: ...]` marker from `privacy-policy-scaffold.md` and `terms-of-service-scaffold.md`, grouped by category. Complete before engaging a law firm — the lawyer needs most of these to give a useful first opinion.

For each item: a blank line for the value, plus a hint about what good looks like. References to scaffold sections (e.g., "PP §1" = Privacy Policy section 1; "ToS §4.1" = Terms of Service section 4.1) follow each item.

---

## A. Company identity

**A.1 Registered company name**
Value: ___________________________________________
Hint: full legal name as on the Certificate of Incorporation, e.g., "Cusiosense Learning India Private Limited". Used in PP §1, ToS §1.

**A.2 Corporate Identity Number (CIN)**
Value: ___________________________________________
Hint: 21-character MCA identifier, e.g., "U80903KA2024PTC123456". Found on the Certificate of Incorporation. Used in PP §1, ToS §1.

**A.3 Registered office address**
Value: ___________________________________________
Hint: full postal address with PIN code, matching MCA records. Used in PP §1, PP §10.1, PP §17, ToS §1, ToS §13, ToS §15, ToS §18.

**A.4 GSTIN**
Value: ___________________________________________
Hint: 15-character GST identifier. Used on invoices and to confirm GST treatment in ToS §4.1.

**A.5 Date of incorporation**
Value: ___________________________________________
Hint: from Certificate of Incorporation. Reference for the lawyer; not displayed to users.

**A.6 Production domain**
Value: ___________________________________________
Hint: e.g., "https://alfanumrik.com". Used in PP §1.

---

## B. Data Protection Officer / Grievance Officer

The DPDP Act and IT Rules 2021 require a named individual. The same person can hold both roles.

**B.1 DPO / Grievance Officer name**
Value: ___________________________________________
Hint: full name of the appointed person. Must be a real, contactable individual — not a generic team. Used in PP §16, ToS §15.

**B.2 Designation**
Value: ___________________________________________
Hint: e.g., "Data Protection Officer", "Grievance Officer", or both. Used in PP §16, ToS §15.

**B.3 Direct email**
Value: ___________________________________________
Hint: dedicated email reaching this person. See Section D for alias suggestions.

**B.4 Direct phone (with country code)**
Value: ___________________________________________
Hint: e.g., "+91 XXXXX XXXXX". Working-hours line. Used in PP §16, ToS §15.

**B.5 Postal address for grievances**
Value: ___________________________________________
Hint: usually same as registered office. Used in PP §16, ToS §15.

**B.6 Working hours**
Value: ___________________________________________
Hint: e.g., "Monday-Friday, 10:00-18:00 IST, excluding public holidays". Used in ToS §15.

---

## C. Email aliases (set up DNS + mailbox before publication)

Each alias should route to a monitored inbox. Suggest configuring all on the company domain.

**C.1 privacy@** (general privacy queries) — PP §17
Configured: [ ] yes / [ ] no

**C.2 dpo@ or grievance@** (DPO / Grievance Officer) — PP §16, ToS §15
Configured: [ ] yes / [ ] no

**C.3 security@** (security incident reports, suspected unauthorized access) — ToS §3.2, ToS §5
Configured: [ ] yes / [ ] no

**C.4 copyright@** (IP takedown notices under IT Act §79 / IT Rules 2021 Rule 3) — ToS §7.5
Configured: [ ] yes / [ ] no

**C.5 support@** (general customer support) — PP §17, ToS §18
Configured: [ ] yes / [ ] no

**C.6 delete@** (account deletion requests) — PP §10.1
Configured: [ ] yes / [ ] no

---

## D. URLs (must exist before scaffold goes live)

**D.1 Pricing page URL**
Value: ___________________________________________
Hint: ToS §4.1 references this. Page must show plan features, INR prices, GST treatment, billing cycle.

**D.2 Privacy Policy URL**
Value: ___________________________________________
Hint: e.g., "https://alfanumrik.com/privacy". Referenced in ToS §1.

**D.3 SLA document URL (if institutional SLA exists)**
Value: ___________________________________________
Hint: ToS §8 references this. If no SLA, set to "N/A" and the section will state so.

**D.4 Cookie disclosure / banner page URL**
Value: ___________________________________________
Hint: PP §13 references this. Either a standalone page or in-app banner detail screen.

**D.5 Refund policy page URL (if separate from ToS §4.6)**
Value: ___________________________________________
Hint: optional — refund terms are inline in ToS §4.6. If you want a separate page, link here.

---

## E. Retention windows

Each is a `[FOUNDER FILL: ...]` in PP §8 or PP §10. Lawyer will check these against statutory minimums.

**E.1 Account profile retention after deletion request (recovery window)**
Value: ___________________________________________
Hint: scaffold suggests 90 days. Range 30-90 days is typical.

**E.2 Foxy AI conversation history retention**
Value: ___________________________________________
Hint: scaffold suggests 12 months rolling. Trade-off: longer = better personalization continuity; shorter = less data exposure.

**E.3 Audit log retention (admin actions, security events)**
Value: ___________________________________________
Hint: scaffold suggests 3 years. Should align with fraud investigation horizon and storage cost.

**E.4 Server access log retention**
Value: ___________________________________________
Hint: scaffold suggests 90 days. Operational debugging window.

**E.5 Support ticket retention after closure**
Value: ___________________________________________
Hint: scaffold suggests 3 years. Useful for repeat-issue handling.

**E.6 Backup retention window (used for deletion-from-backup propagation)**
Value: ___________________________________________
Hint: scaffold suggests 35 days. Must match the actual Supabase backup retention you have configured.

**E.7 Acknowledgement window for deletion request**
Value: ___________________________________________
Hint: scaffold suggests 7 days. The 30-day completion deadline is fixed by the Act.

**E.8 Response window for data-principal rights requests (PP §9)**
Value: ___________________________________________
Hint: recommended 30 days. The lawyer will confirm against final DPDP Rules.

**E.9 Notice window for material Privacy Policy changes (PP §15)**
Value: ___________________________________________
Hint: scaffold suggests 7 days. 14-30 days is more conservative.

---

## F. Refund policy specifics (ToS §4.6, §4.7)

**F.1 Yearly plan administrative fee on refund**
Value: ___________________________________________
Hint: scaffold offers "₹0 / 5% / fixed ₹100". Lower = consumer-friendly; higher = covers payment-gateway fees. Indian consumer courts dislike high admin fees.

**F.2 Failed-payment retry policy**
Value: ___________________________________________
Hint: scaffold suggests "3 times over 5 days". Razorpay default is similar.

**F.3 Per-day Foxy cap for under-13 users (PP §6.2)**
Value: ___________________________________________
Hint: scaffold suggests "30 minutes per day". Set with an eye on screen-time guidance.

**F.4 Maintenance window threshold for prior notice (ToS §8)**
Value: ___________________________________________
Hint: scaffold suggests "10 minutes". Below this, no notice; above, in-app banner.

---

## G. Misc — payments, GST, arbitration, AI training, channels

**G.1 GST treatment shown on pricing page**
Value: ___________________________________________
Hint: "inclusive of GST" or "exclusive of GST, added at checkout". Used in ToS §4.1. Confirm with your tax advisor.

**G.2 Liability cap floor (ToS §10)**
Value: ___________________________________________
Hint: scaffold suggests "₹5,000 INR". Cap should be defensible against consumer-court scrutiny — neither token nor uncapped.

**G.3 Arbitration appointing authority (ToS §14.2)**
Value: ___________________________________________
Hint: e.g., "the President of the Bar Council of [State]" or "an institutional arbitral body". Lawyer will recommend.

**G.4 Arbitration seat and venue (ToS §14.2)**
Value: ___________________________________________
Hint: e.g., "Mumbai, Maharashtra". Usually matches registered office. Lawyer will validate enforceability against minors/parents.

**G.5 Court of exclusive jurisdiction (ToS §13)**
Value: ___________________________________________
Hint: city of registered office. Lawyer may recommend "non-exclusive" given consumer-court doctrine.

**G.6 Privacy Policy version number**
Value: ___________________________________________
Hint: PP top matter. Suggest "2.0" if this replaces an older policy.

**G.7 Privacy Policy effective date**
Value: ___________________________________________
Hint: date of publication after lawyer sign-off. PP top matter.

**G.8 ToS version number**
Value: ___________________________________________
Hint: ToS top matter. Suggest "2.0" if this replaces an older policy.

**G.9 ToS effective date**
Value: ___________________________________________
Hint: ToS top matter.

**G.10 Email delivery provider name + region (PP §7.1)**
Value: ___________________________________________
Hint: e.g., "AWS SES (ap-south-1)", "Resend (US)", "SendGrid (US)". Region matters for cross-border-transfer disclosure.

**G.11 WhatsApp Business Service Provider name (PP §7.1, if used)**
Value: ___________________________________________
Hint: e.g., "Gupshup", "AiSensy", "Meta direct". If WhatsApp not used, write "Not used".

**G.12 Parental consent verification channel (PP §6.1, step 3)**
Value: ___________________________________________
Hint: scaffold suggests "email link + mobile OTP". Lawyer will opine on whether this is "verifiable consent" under DPDP. Aadhaar eKYC is the strongest but most onerous.

**G.13 AI-conversation training opt-out wording (PP §14.2)**
Value: Choose ONE: [ ] "We do NOT use Foxy conversations to train any AI model." OR [ ] "Anonymized Foxy conversations may be used to evaluate and improve our AI features. You may opt out via Settings → AI Preferences."
Hint: simpler legal posture is "we do not use". If you want optionality, the lawyer will write the opt-out wording.

**G.14 NCERT licensing basis (ToS §7.2)**
Value: ___________________________________________
Hint: choose ONE: (a) "NCERT open educational use policy", (b) "fair-dealing under Section 52(1)(i) of the Copyright Act 1957 for educational purposes", or (c) "specific licensing arrangement with NCERT". Lawyer will validate against actual usage pattern.

**G.15 RBAC summary phrasing (PP §11)**
Value: ___________________________________________
Hint: scaffold suggests "6 roles and 71 granular permissions". Confirm current count with architect before publishing.

---

## Sign-off

When all items above are filled:

- [ ] Reviewed by founder
- [ ] Reviewed by accountant (Section A, G.1, G.2)
- [ ] Reviewed by ops/engineering (Section C, D, E, G.10-G.15)
- [ ] Bundled with the rest of the engagement pack and sent to the chosen firm
