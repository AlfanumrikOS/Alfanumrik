# Lawyer Review Categories

All 29 `[LAWYER REVIEW: ...]` markers from the two scaffold files, grouped by legal category. For each category: the specific markers (with file + line ref), brief context, and the question the lawyer needs to opine on.

File abbreviations: **PP** = `privacy-policy-scaffold.md`, **ToS** = `terms-of-service-scaffold.md`.

---

## A. DPDP Act 2023 specifics

### A.1 Notification status of the Act and its sections

- **Marker:** PP line 31 (Section 1).
- **Context:** the policy claims compliance with the DPDP Act, but as of drafting, not all sections of the Act may have been notified into force.
- **Lawyer to opine:** which sections are operative on the effective date, which remain dormant, and how to phrase compliance language so it is accurate today and self-updating where possible.

### A.2 SPDI Rules categorisation

- **Marker:** PP line 91 (Section 2.8 / end of Section 2).
- **Context:** the DPDP Act does not formally use the SPDI categorisation; the SPDI Rules continue to apply where the IT Act regime is invoked.
- **Lawyer to opine:** whether any of the data categories collected (especially payment metadata, device data, learning performance) need to be flagged as "sensitive personal data or information" with heightened consent language.

### A.3 Consent-notice wording (DPDP §5)

- **Marker:** PP line 146 (Section 5).
- **Context:** Section 5 of the DPDP Act prescribes specific consent-notice content; the in-app consent screen and the policy must mirror that wording.
- **Lawyer to opine:** the precise consent-notice text required by Section 5, plus a confirmation that the in-app consent UI matches.

### A.4 Statutory response timeline for data-principal rights

- **Marker:** PP line 286 (Section 9).
- **Context:** the policy currently leaves the response timeline as a `[FOUNDER FILL]` of "30 days, recommended"; the actual maximum will be set by DPDP Rules once notified.
- **Lawyer to opine:** the binding maximum once Rules are notified, and a defensible interim wording.

### A.5 DPO appointment threshold

- Implied by PP §16 and ToS §15. The DPDP Act requires a DPO only for "Significant Data Fiduciaries" as classified by the Central Government.
- **Lawyer to opine:** whether Alfanumrik is at risk of SDF classification given its handling of children's data, and whether to appoint a formal DPO regardless.

### A.6 Breach notification timeline

- **Marker:** PP line 353 (Section 11).
- **Context:** breach-notification timing and content requirements will be set by DPDP Rules.
- **Lawyer to opine:** the operative timeline today (CERT-In 6-hour rule) and the expected DPDP rule, so the policy can pin the longer of the two.

---

## B. Cross-border data transfer

### B.1 Restricted-country list under DPDP Act §16

- **Marker:** PP line 364 (Section 12).
- **Context:** DPDP §16 permits cross-border transfer except to countries on a Central-Government-notified blacklist. Several processors (Anthropic, possibly Sentry, possibly PostHog) sit in the US.
- **Lawyer to opine:** whether any blacklist exists at the effective date, whether the US is on it, and whether the cross-border-transfer disclosures need rewording.

---

## C. Service-provider data residency

### C.1 Supabase region

- **Marker:** PP line 200 (Section 7.1, processor table).
- **Context:** primary project is in Mumbai (AWS ap-south-1) but Supabase metadata may sit on US infra.
- **Lawyer to opine:** how to disclose this accurately and whether metadata-residency creates a §16 cross-border-transfer trigger.

### C.2 Sentry residency

- **Marker:** PP line 204 (Section 7.1, processor table).
- **Context:** Sentry offers EU and US data residency; the chosen region determines disclosure language.
- **Lawyer to opine:** confirm with engineering which region is selected, and validate the disclosure.

### C.3 PostHog residency

- **Marker:** PP line 205 (Section 7.1, processor table).
- **Context:** PostHog offers EU Cloud and US Cloud; the chosen region determines disclosure.
- **Lawyer to opine:** same as C.2.

---

## D. Cookie consent banner standard

### D.1 India-specific cookie consent requirements

- **Marker:** PP line 383 (Section 13).
- **Context:** the DPDP Act does not prescribe a banner format; the IT Act 2000 + SPDI Rules may apply for non-essential cookies.
- **Lawyer to opine:** whether a formal banner is required, what user choices it must offer, and how granular the cookie disclosure must be.

---

## E. AI training / anonymisation disclosure

### E.1 Use of conversation data for AI improvement

- **Marker:** PP line 404 (Section 14.2). This is a combined `[LAWYER REVIEW + FOUNDER FILL]`.
- **Context:** the policy must say explicitly whether anonymised Foxy conversations are used to evaluate, fine-tune, or improve AI features. The founder-fill (item G.13 in `01-founder-fill-checklist.md`) chooses the policy posture; the lawyer must validate the wording.
- **Lawyer to opine:** whether the chosen wording is defensible, whether the anonymisation methodology has to be disclosed, and what the opt-out mechanism must look like.

### E.2 Parental visibility into Foxy chat

- **Marker:** PP line 229 (Section 7.3).
- **Context:** parents may see verbatim transcripts or only summaries; this is a child-autonomy-vs-parental-supervision call.
- **Lawyer to opine:** the defensible default, given DPDP §9 parental rights and child-autonomy principles in Indian and international child-protection law.

### E.3 AI labelling requirements

- **Marker:** ToS line 159 (Section 6).
- **Context:** MeitY advisories on synthetic content and any state-level AI-in-education rules may apply.
- **Lawyer to opine:** whether AI-generated content (Foxy responses, generated quiz questions) must carry an AI label, and the required wording.

---

## F. Minors: contract enforceability + minimum age

### F.1 Minor-contract enforceability under Indian Contract Act 1872

- **Marker:** ToS line 25 (Section 1, "Minors").
- **Context:** under §11 of the Indian Contract Act, contracts with minors are void; parental consent does not cure the void status. Practical workaround is to bind the parent on the minor's behalf.
- **Lawyer to opine:** which obligations should bind only the parent, which can bind the minor (e.g., acceptable-use), and how the clickwrap should be structured.

### F.2 Minimum platform age (10)

- **Marker:** ToS line 41 (Section 2).
- **Context:** the DPDP Act treats anyone under 18 as a child but sets no minimum platform age. The scaffold uses 10 to match CBSE grade 6.
- **Lawyer to opine:** whether 10 is defensible or whether a higher floor (12 or 13) is safer.

### F.3 Minor-on-reaching-majority parental access

- **Marker:** PP line 189 (Section 6.4).
- **Context:** when a minor turns 18, can they unilaterally revoke parental access?
- **Lawyer to opine:** whether DPDP permits unilateral revocation, and whether any wind-down notice to the parent is required.

### F.4 Verifiable parental consent standard

- **Marker:** PP line 166 (Section 6.1).
- **Context:** scaffold uses email-link + mobile-OTP; DPDP §9 requires "verifiable consent" without specifying mechanism.
- **Lawyer to opine:** whether the chosen mechanism meets the standard, whether Aadhaar eKYC / video KYC / ID upload is required, and the defensible minimum.

---

## G. RBI / Payments

### G.1 RBI e-mandate disclosure specifics

- **Marker:** ToS line 82 (Section 4.3).
- **Context:** RBI's e-mandate framework prescribes pre-debit notification window, AFA (Additional Factor of Authentication) thresholds, and a registered maximum-charge cap.
- **Lawyer to opine:** the current RBI requirements (these have evolved several times since 2021), and the exact disclosure wording for monthly subscriptions.

### G.2 Payment-record retention floor

- **Marker:** PP line 258 (Section 8).
- **Context:** the policy commits to 8-year payment-record retention based on Income-tax Act §44AA and Companies Act §128.
- **Lawyer to opine:** whether GST or RBI / PA-PG guidelines extend this further, and whether the 8-year figure is correct in all cases.

---

## H. Refund policy defensibility (Consumer Protection Act 2019)

### H.1 Refund-policy wording risk

- **Marker:** ToS line 94 (Section 4.6).
- **Context:** the scaffold offers a defensible default — 7-day pro-rata for yearly plans, no mid-cycle monthly refund — under the Consumer Protection (E-Commerce) Rules 2020. This section faces the highest consumer-court litigation risk.
- **Lawyer to opine:** validate against current consumer-court precedent, recommend a stronger pro-consumer posture if defensibility risk is high, and review the administrative-fee mechanic.

### H.2 Disclaimer floor under Consumer Protection Act

- **Marker:** ToS line 220 (Section 9).
- **Context:** certain implied warranties cannot be disclaimed against a "consumer" under the CPA 2019.
- **Lawyer to opine:** the statutory floor below which the disclaimer cannot go, and how to redraft Section 9 to preserve the disclaimer's force without crossing that floor.

### H.3 Limitation-of-liability cap challenge risk

- **Marker:** ToS line 233 (Section 10).
- **Context:** liability caps in B2C digital services are routinely scrutinised by Indian consumer courts; minors / parental claims add risk.
- **Lawyer to opine:** the defensible cap, whether a separate carve-out for minors is required, and whether the cap should be a multiple of subscription value rather than a flat floor.

---

## I. Right-to-erasure carve-out vs payment retention

### I.1 Reconciling 8-year retention with right to erasure

- **Marker:** PP line 327 (Section 10.5).
- **Context:** DPDP §17 provides a carve-out where retention is "required by law"; the wording must signal that payment records survive an erasure request.
- **Lawyer to opine:** the exact wording that satisfies §17 while preserving tax-compliance retention.

---

## J. Copyright / Curriculum

### J.1 NCERT licensing basis

- **Marker:** ToS line 171 (Section 7.2).
- **Context:** the scaffold leaves the basis as a `[FOUNDER FILL]` (item G.14 in `01-founder-fill-checklist.md`); typical options are NCERT open-use, fair-dealing under Copyright Act §52(1)(i), or a specific licence.
- **Lawyer to opine:** whether the chosen basis matches actual usage pattern, and whether any acknowledgement / attribution is required.

---

## K. Jurisdiction & dispute resolution

### K.1 Exclusive vs non-exclusive jurisdiction

- **Marker:** ToS line 277 (Section 13).
- **Context:** pure exclusive-jurisdiction clauses against retail consumers can be challenged under CPA 2019, which preserves the consumer's right to file at their place of residence.
- **Lawyer to opine:** whether to use exclusive or non-exclusive jurisdiction, and how to draft the consumer carve-out.

### K.2 Arbitration enforceability against consumers / minors

- **Marker:** ToS line 287 (Section 14.2).
- **Context:** Indian consumer-court doctrine has historically frowned on mandatory pre-dispute arbitration of consumer claims, especially against minors and parents.
- **Lawyer to opine:** whether to include (a) no arbitration clause, (b) optional arbitration, or (c) mandatory arbitration with consumer-forum carve-outs. Recommend specific wording.

---

## L. IT Rules 2021 grievance officer scheme

### L.1 SSMI / Resident Grievance Officer threshold

- **Markers:** PP line 440 (Section 16) and ToS line 313 (Section 15) — same legal question, two surfaces.
- **Context:** Significant Social Media Intermediary classification triggers additional officer requirements (Resident Grievance Officer, Chief Compliance Officer, Nodal Contact Person). The 50-lakh-user threshold is the common marker.
- **Lawyer to opine:** confirm Alfanumrik sits below the SSMI threshold, confirm only a Grievance Officer is required, and pin the resolution timelines (24-hour acknowledgement, 15-day resolution).

---

## Summary count

| Category | Markers |
|---|---|
| A. DPDP specifics | 6 |
| B. Cross-border transfer | 1 |
| C. Service-provider residency | 3 |
| D. Cookie consent | 1 |
| E. AI training / anonymisation | 3 |
| F. Minors | 4 |
| G. RBI / payments | 2 |
| H. Refund / consumer protection | 3 |
| I. Erasure carve-out | 1 |
| J. Copyright / NCERT | 1 |
| K. Jurisdiction & arbitration | 2 |
| L. IT Rules grievance scheme | 2 |
| **Total** | **29** |

This matches the 29 `[LAWYER REVIEW: ...]` markers in the two scaffold files.
