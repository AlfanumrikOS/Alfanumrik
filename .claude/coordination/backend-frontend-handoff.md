# Backend ⇄ Frontend Coordination & Handoff

> Single shared handoff document between the **backend/db doctor agent** and the **frontend agent**.
> Append entries chronologically. Do not create additional status/audit/handoff files.

---

## Session: Backend & DB Doctor
- **Timestamp**: 2026-08-09 (session start)
- **Agent**: backend-db-doctor (orchestrator session, skill `alfanumrik-backend-db-doctor`)
- **Branch**: `repair/backend-db-doctor` (from `main` @ `819a5e71a`)
- **Worktree**: `.claude/worktrees/reload-skills-475fac`

### Frontend agent footprint observed (2026-08-09)
- Worktree: `.claude/worktrees/invoke-skills-54dda6`, branch `Alfanumrik/invoke-skills-54dda6`
- Uncommitted: `apps/host/src/app/teacher/reports/page.tsx`
- Recent commits: failure-as-empty sweep across teacher/parent portals (#1483–#1485)
- **Backend agent will NOT touch**: `apps/host/src/app/**/page.tsx`, `packages/ui/**`, layouts, styles, design tokens, navigation.

### Files owned / being modified by backend agent
- (updated as work proceeds — see "Change log" below)
- Scope: `apps/host/src/app/api/**`, `supabase/migrations/**`, `supabase/functions/**`, `packages/lib/src/**` (server-side modules only), backend tests.

### Shared-boundary files (coordination required before edit)
- `packages/lib/src/types.ts` / generated DB types — no edits planned yet
- Validation schemas, API clients, shared hooks, `AuthContext.tsx`, `proxy.ts`, feature flags — no edits planned yet
- If a contract change becomes unavoidable, it will be recorded here (old contract / new contract / reason / affected callers / migration path / required frontend action) BEFORE implementation.

### API contract changes proposed
- None yet.

### Backend defects affecting frontend
- None recorded yet.

### Frontend observations affecting backend
- (frontend agent: append here)

### Blockers / required decisions
- None yet.

### Change log (completed changes + commit hashes + verification evidence)
- (empty)

---
## Update — 2026-08-09 (backend-db-doctor, branch `repair/backend-db-doctor`)

### Completed changes
| Commit | Change | Frontend impact |
|---|---|---|
| `0aad96cf3` | This coordination doc | none |
| `3c16d25e8` | **CRITICAL security fix**: `delete_student_account(uuid)` — NULL-safe ownership guard + `REVOKE ALL FROM PUBLIC, anon` / `GRANT TO authenticated, service_role`. New migration `20260814000003` + static pin test (27 assertions). | **NONE — contract unchanged.** Same signature `{p_student_id}`, same `{success,error}` jsonb. The caller `apps/host/src/app/(student)/profile/page.tsx:570` needs no change and keeps working for the signed-in owner. |

Verification: `npm run type-check` exit 0; pin test 27/27 (integration lane, `RUN_INTEGRATION_TESTS=1`); architect APPROVE; quality APPROVE.

### API contract changes proposed
- **None.** No shared-boundary file was modified. `packages/lib/src/types.ts`, generated DB types, validation schemas, API clients, shared hooks, `AuthContext.tsx`, `proxy.ts` and feature flags are all UNTOUCHED by backend so far.

### ⚠️ Backend defects that affect frontend (FYI — no action required from you yet)
These are diagnosed, NOT yet fixed. Listed so you don't mistake them for frontend bugs:
1. **`/api/learn/prereq-check` and `/api/learn/remediation` return `NextResponse.json(null, {status:200})` on error** — a frontend caller cannot distinguish "no data" from "lookup failed". Relevant to your failure-as-empty-state sweep (#1483-#1485): these two endpoints make a correct frontend look like an empty state. Backend will fix the endpoints; **do not** work around it client-side.
2. **`/api/error-report` returns `{received:true}` 200 even when the report is dropped** (admin client unconfigured). Client-side error reporting may be silently going nowhere.
3. **`/api/foxy` silently downgrades to free-plan behaviour** when the entitlement read fails (`route.ts:801`) — can look like a UI/plan bug.
4. Several flag-off endpoints return `200 {skipped:true}` / `{gated:true, data:null}` (`cron/board-score`, `cron/streak-guardian`, `school-admin/leadership`) — intentional, documented.

### Frontend observations affecting backend
- (frontend agent: append here)

### Blockers / decisions needed from CEO (not frontend)
- 44 deployed Edge Functions have **no source in git** (incl. `payments`, `super-admin`, `quiz-submit`).
- 130 SECURITY DEFINER RPCs remain anon-EXECUTE-able; broader REVOKE batch pending.
- Projector pipeline is a zombie (0 events processed, 33-88 day lag) while health checks report green.

---
