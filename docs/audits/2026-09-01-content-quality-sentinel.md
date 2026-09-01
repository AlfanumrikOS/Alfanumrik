# Content Quality Sentinel — 2026-09-01

**Scheduled task:** Content Coverage & Quality Sentinel (daily)  
**Run date:** 2026-09-01  
**Status:** FAILED — Required MCP servers not configured

---

## Failure Summary

The scheduled Content Quality Sentinel could not execute its database queries or
post results to Slack. Two required MCP server connections were absent from this
session:

| Required Tool | Status | Impact |
|---|---|---|
| Supabase MCP (execute_sql) | NOT CONFIGURED | Cannot query question_bank |
| Slack MCP | NOT CONFIGURED | Cannot post coverage report to #general |

No database credentials were present in the session environment, and no Supabase
CLI access token was set — so the Supabase CLI also could not authenticate.

---

## What This Audit Should Check (when MCP is configured)

Coverage targets by subject/grade cell:
- math grades 6-12: 100 questions/cell minimum (7 cells)
- science grades 6-10: 100 questions/cell (5 cells)
- physics, chemistry, biology grades 11-12: 50 questions/cell (2 cells each)
- english, hindi, social_studies grades 6-10: 30 questions/cell (5 cells each)
- economics, accountancy, business_studies grades 11-12: 30 questions/cell (2 cells each)
- political_science, computer_science grades 11-12: 20 questions/cell (2 cells each)

Total: 56 subject-grade cells audited

Quality checks that should run:
- Options array length != 4 (P6 violation)
- correct_answer_index outside 0-3 (P6 violation)
- Missing or empty explanation (P6 violation)
- Template markers in question_text (P6 violation)
- Empty question_text (P6 violation)
- Grade values outside '6'-'12' string format (P5 compliance)
- Duplicate questions within subject/grade

---

## Previous Coverage Context

From docs/audits/2026-08-13-rag-math-science-coverage.md:
- RAG corpus: 27,778 chunks in rag_content_chunks (measured 2026-08-11)
- rag_status='ready' is structurally unreachable — max verified_question_count
  is 19 against a threshold of 40 (reported BLIND on 2026-08-13)

The live question bank coverage view is the super-admin content-coverage API.

---

## Action Required

To fix this scheduled task, the session needs:
1. Supabase MCP server configured with service-role credentials for project shktyoxqhundlvkiwguu
2. Slack MCP configured (or a webhook env var) for posting to #general
3. Alternatively: run manually from a local env with .env.local credentials set

Relevant files:
- Coverage API: apps/host/src/app/api/super-admin/content-coverage/route.ts
- Grounding coverage: apps/host/src/app/api/super-admin/grounding/coverage/route.ts
- Schema: supabase/migrations/00000000000000_baseline_from_prod.sql (table question_bank)
