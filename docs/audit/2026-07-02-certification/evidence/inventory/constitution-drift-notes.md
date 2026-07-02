# Constitution drift notes - independently found during Wave 1 certification

Every number below was independently re-derived this wave, not copied from a prior claim. The
"constitution" here refers to the project's own root-level and dotfile guidance documents that
state these numbers as facts.

| Claim in the project's constitution documents | Claimed value | Actual value (this wave) | Found by |
|---|---|---|---|
| Supabase Edge Function count | 43 (mission) / 29 (constitution) | 48 | orchestrator inventory pass |
| Regression catalog entries / latest id | 142 / REG-175 | 193 / REG-226 | ops and testing, independently |
| E2E Playwright spec count | 17 | 37 | testing |
| Vitest global coverage thresholds | 35/30/35/35 | 54/49/58/55, both healthier than claimed | testing |
| cognitive-engine coverage threshold | 65 percent all metrics | 80 percent all metrics, healthier than claimed | testing |
| Deployment target | Vercel only, no mention of AWS | a second AWS pipeline has been actively deploying since 2026-06-23 | architect and ops, independently |
| Super-admin panel size per its own runbook | 8 tabs | 62 pages, well over 100 API routes | ops |
| Backup and restore runbook claim | admin-secret auth path removed | still live and actively consumed | ops |

## Interpretation

No single one of these is a runtime defect - each is a documentation-accuracy gap. Taken
together, however, they indicate the constitution documents' numeric claims should not be
trusted at face value for any release-readiness purpose without a fresh reconciliation pass,
which is exactly the posture this certification wave took throughout. Recommend a dedicated
reconciliation pass before these documents are next used as a basis for a decision.
