# 14 — Backup & Disaster Recovery

**Audit date:** 2026-08-29
**Evidence source:** Prior scorecard, known risks register, observability agent

---

## 1. Backup Architecture

| Component | Mechanism | Notes |
|-----------|-----------|-------|
| Database | Supabase automated daily backups | Point-in-time recovery (PITR) available |
| Storage | Supabase Storage backups | Part of project backup |
| Code | Git (GitHub) | Full history; branch protection on main |
| Secrets | .env.local (local) + Vercel env vars | Not in git; manual recovery |
| Edge Functions | Supabase deployment | ~53 deployed-only functions not in source control (DB-4) |

## 2. Restore Drill

| Date | Scope | Result |
|------|-------|--------|
| 2026-08-23 | Staging restore from production backup | **EXECUTED** — restore completed successfully |

The restore drill was performed against the staging Supabase project. This verifies the mechanical restore process works. However:
- The staging project is currently **inaccessible** (P2-18)
- A full 6-item restore checklist (data verification, smoke tests, etc.) has not been executed against a populated database

## 3. Disaster Recovery Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| DB-4: 53 deployed Edge Functions not in source | P3 | Cannot be restored from git alone |
| No documented RTO/RPO targets | P3 | No formal recovery time/point objectives |
| No automated restore testing | P3 | Restore drill was manual, one-time |
| Staging environment inaccessible | P2 | Cannot test restores without staging |

## 4. Findings

| ID | Severity | Finding |
|----|----------|---------|
| P2-18 | P2 | Staging deploy workflow disabled — staging Supabase project inaccessible |

## 5. Gate Verdict

**CONDITIONAL GO** — Automated backups are in place; restore drill was executed once. For a controlled pilot with known school partners, this is acceptable. Before scaling, need: documented RTO/RPO, automated restore testing, staging environment restoration.
