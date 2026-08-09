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
