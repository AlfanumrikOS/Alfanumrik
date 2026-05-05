# Lawyer Engagement Pack — Privacy Policy + Terms of Service

This folder contains everything the founder needs to engage an Indian law firm to review the Privacy Policy and Terms of Service scaffolds at:

- `docs/legal/privacy-policy-scaffold.md`
- `docs/legal/terms-of-service-scaffold.md`

The scaffolds were produced by engineering. They contain 29 `[LAWYER REVIEW: ...]` markers (legal opinions required) and 57 `[FOUNDER FILL: ...]` markers (company-specific facts the founder must supply). Both passes must complete before either document is published at `/privacy` or `/terms`.

---

## Who reads what

| Audience | Files |
|---|---|
| Founder (preparation) | `01-founder-fill-checklist.md`, `02-firm-shortlist.md` |
| Founder (outreach) | `03-cold-outreach-email-template.md` |
| Lawyer (engagement materials) | `04-lawyer-review-categories.md`, `05-platform-summary-for-lawyer.md`, the two scaffold files |
| Both | This README |

---

## Order of operations

1. **Founder fills `01-founder-fill-checklist.md`.** This collects the 57 founder-supplied facts (company identity, DPO contact, retention windows, refund specifics, etc.). Do this BEFORE engaging a firm — the lawyer will need most of these to give a useful first opinion.

2. **Founder picks a firm from `02-firm-shortlist.md`.** The shortlist groups 7 Indian law firms by practice fit and engagement model. No firm is recommended; the founder selects based on budget and fit.

3. **Founder sends `03-cold-outreach-email-template.md` to the chosen firm.** The template has slots for the firm-specific salutation, scope ask, timeline, and budget question.

4. **On engagement, founder shares with the lawyer:**
   - The two scaffold files (`privacy-policy-scaffold.md` + `terms-of-service-scaffold.md`)
   - `04-lawyer-review-categories.md` — pre-grouped legal questions, mapped to scaffold line numbers
   - `05-platform-summary-for-lawyer.md` — 1-page legal context briefing
   - The completed `01-founder-fill-checklist.md`

5. **Lawyer returns redlines.** Expect a tracked-changes Word/PDF version of each scaffold, plus a memo on the open `[LAWYER REVIEW]` items.

6. **Founder updates the scaffolds.** Apply the lawyer's redlines. Replace `[LAWYER REVIEW: ...]` markers with the lawyer's wording. Replace `[FOUNDER FILL: ...]` markers with the values from `01-founder-fill-checklist.md`. Remove the "SCAFFOLD ONLY" warning banner once both passes are clean.

7. **Frontend swaps the final text into `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`.** This is the publication step. Confirm the lawyer has signed off in writing before swapping.

---

## Expected timeline

| Phase | Calendar time |
|---|---|
| Founder fill (#1) | 1-3 days |
| Cold outreach + firm response (#3) | 3-7 business days |
| First-pass legal review (#5) | 5-10 business days after engagement signed |
| Founder turn-around on redlines (#6) | 2-5 business days |
| Second-pass review (if material changes) | 3-5 business days |
| Publication (#7) | Same-day after sign-off |

**Realistic total: 1.5 to 3 weeks from the day the founder starts on `01-founder-fill-checklist.md`.** Premium firms (NDA, AZB, Trilegal) typically run 1-2 weeks longer than mid-market and startup-tier firms.

---

## What this pack does NOT do

- It does not give legal advice. Engineering produced the scaffolds; only an Indian-licensed advocate can opine on them.
- It does not recommend a specific firm. The shortlist is descriptive (practice areas, engagement model, public contact) — selection is the founder's call.
- It does not replace the cookie disclosure, refund policy page, or pricing page that the scaffolds reference. Those are separate artefacts.
- It does not cover the school B2B contract, the teacher-platform agreement, or any institutional MSA. Scope here is the consumer-facing Privacy Policy + ToS only.

---

## Quick links

- Privacy scaffold: `../privacy-policy-scaffold.md`
- ToS scaffold: `../terms-of-service-scaffold.md`
- Frontend mount points: `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`
