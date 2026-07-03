# Executive Decision Matrix

Decisions this program needs from you (or a named delegate), separated from decisions the
engineering process can make on its own.

| Decision | Options | Who decides | Status |
|---|---|---|---|
| Is the deployed staging website safe to use for certification? | Confirmed safe / needs correction first | Human with hosting-dashboard access | **PENDING - the sole blocker** |
| Should the QUIZ-ACTIVE RPC-layer gap (CERT-01) be fixed before or after Stage 2/3 evidence is collected? | Fix now / accept as a tracked Should-Fix and fix in parallel with Stage 2/3 | You, on Board's recommendation | Open - Board will recommend once Stage 2/3 evidence exists, but you may pre-empt this now if you prefer it fixed immediately |
| Is the AI-fallback free-text PII exposure (CERT-06) acceptable as currently architected? | Accept as-is / require redaction before fallback / disable fallback | You | Open, unrelated to CERT-17 |
| Is the second AWS deployment pipeline (CERT-02) intentional? | Intentional DR rehearsal / unintentional, disable it | You or Ops lead | Open, unrelated to CERT-17 |
| Do content-author and support-staff roles need a real frontend, or should they be deprecated? | Build minimal portals / deprecate the roles | Product | Open, unrelated to CERT-17 |
| Should coupon/referral logic be built out, or is "not yet implemented" acceptable for this release? | Build now / defer to a future release | Product | Open, unrelated to CERT-17 |
| Adopt a permanent Product Organization alongside the engineering agent roles? | Adopt as proposed / adopt with changes / decline | You | New this turn - see the governance proposal |
| Adopt a permanent 10-phase SDLC for all future requests? | Adopt as proposed / adopt with changes / decline | You | New this turn - see the governance proposal |

## Recommended sequencing

Resolve CERT-17 first - it is the only item on this list that blocks other work. Everything else
on this list can be decided in parallel, on your own timeline, without slowing the certification
program down once it resumes.
