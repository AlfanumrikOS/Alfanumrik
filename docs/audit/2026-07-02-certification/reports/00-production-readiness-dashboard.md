# 00 - Production Readiness Dashboard

Snapshot as of Wave 1 completion, 2026-07-02. This is the single-page rollup; see
01-executive-summary.md for narrative and 14-risk-register.md / 13-production-readiness-scorecard.md
for full detail.

## Program status

| Wave | Scope | Status |
|---|---|---|
| Wave 1 | Stage 1 static/read-only certification, 100% inventory classification | COMPLETE (this package) |
| Wave 2 | Stage 2 - local integration testing on seeded dev accounts | NOT STARTED - requires confirming a non-shared Supabase target and authoring a seed-accounts script |
| Wave 3 | Stage 3 - dedicated staging certification tenant | NOT STARTED - requires ops GitHub Actions write/dispatch access and human confirmation of Razorpay staging test-mode keys |
| Wave 4 | Executive Release Board independent re-derivation and final decision | NOT STARTED - gated on Waves 2-3 per the Board's own completeness rule |

## Certification coverage (100% classified, depth varies by tier)

| Artifact class | Total | Tier 0 (hand-verified) | Open findings |
|---|---:|---:|---:|
| Pages | 177 | 17 | 1 (role-routing gap, product-scope item) |
| API routes | 362 | 44 | 0 route-level defects (1 upstream RPC-layer gap tracked under migrations) |
| Edge Functions | 48 | ~36 Tier-0-adjacent | 1 (proxy bypass, compensating control unverified) |
| DB migrations | 350 | ~46 hand-read | 1 (missing search_path, low exploitability) |
| Super-admin pages | 62 | 16 | 0 page-level defects (documentation-accuracy issues tracked separately) |

## Risk summary

| Tag | Count |
|---|---:|
| Blocker | 0 (1 item flagged for Board consideration to elevate - see CERT-01) |
| Should-Fix-Before-Release | 12 |
| Post-Release-Acceptable | 3 |
| Pending a decision (not a defect) | 1 - escalated to user |

## Stage-1 weighted scorecard (interim, MEDIUM-confidence ceiling)

80.6 / 100 - see 13-production-readiness-scorecard.md for the category breakdown and why this
number cannot yet support a final release decision.

## Interim readiness signal

APPROVED WITH CONDITIONS is the defensible ceiling on Wave 1 evidence alone (0 Blockers, 12
Should-Fix items on Tier-0/1 surfaces). This is NOT a release decision - the Executive Release
Board has not convened, and per its own completeness gate it cannot render a decision without
Stage 2/3 live evidence on Tier-0 surfaces (auth, payments, AI, scoring). No release action
should be taken on the basis of this dashboard alone.

## What must happen before a real decision can be issued

1. Fix or explicitly accept-with-rationale each of the 12 Should-Fix-Before-Release items,
   starting with CERT-01 (QUIZ-ACTIVE RPC-layer gap, live-reachable via the default mobile
   build) and CERT-04 (incorrect incident runbook).
2. Obtain a CEO ruling on CERT-06 (G-5 AI-fallback PII dossier).
3. Execute Wave 2 (seeded local integration testing) for every Tier-0 surface.
4. Execute Wave 3 (staging tenant) for Tier-0 surfaces, or formally accept it as deferred with
   documented rationale if it cannot be provisioned.
5. Convene the Executive Release Board (Wave 4) to independently re-derive the scorecard and
   issue APPROVED / APPROVED WITH CONDITIONS / REJECTED.
