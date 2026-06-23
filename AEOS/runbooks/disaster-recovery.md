# Disaster Recovery — Backups, RTO/RPO, Restore Drills, and Failover Posture

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Runbook
**Priority:** P0 (Critical — defines how the platform survives data loss and major failure)
**Applies To:** Disaster recovery for the live Alfanumrik platform: backup strategy, RTO/RPO targets, restore procedures and drills, the Vercel↔dormant-AWS failover posture, data-loss recovery, and DR test cadence.

---

# Purpose

This runbook is the executable disaster-recovery procedure for Alfanumrik. The system of record is **Supabase Postgres** (`ap-south-1`/Mumbai), fronted by the live **Vercel** (`bom1`) web tier. DR therefore centers on protecting and restoring the Supabase data tier, and on the failover posture of the web tier between Vercel (live) and the **dormant** AWS path.

The governing principle, from core doc 12: *a backup is not considered valid until restoration has been verified.* A backup you have never restored is a hope, not a recovery plan. This runbook makes restoration a rehearsed, evidence-backed operation.

---

# Scope

In scope: Supabase Postgres backups (automated PITR + logical dumps), the schema-reproducibility baseline, RTO/RPO targets, restore drills, the web-tier failover posture (Vercel live ↔ AWS dormant), data-loss recovery (accidental delete / bad migration), and DR test cadence.

Out of scope: routine incident response (the SRE runbook), CI/CD gate definitions (the github-operations runbook), and the full AWS cutover ramp (the aws-operations runbook).

---

# What Must Be Recoverable

| Asset | Where it lives | DR mechanism |
|---|---|---|
| Student/parent/teacher data, quizzes, payments, subscriptions | Supabase Postgres (`ap-south-1`) | Supabase automated backups + PITR; logical dumps |
| Schema (tables, RLS, RBAC, RPCs, indexes) | `supabase/migrations/` | Idempotent baseline `00000000000000_baseline_from_prod.sql` + migration chain |
| Vector store (NCERT RAG) | pgvector tables in the same Postgres | Same Supabase backup (it is one database) |
| Server secrets | Vercel env (live); AWS Secrets Manager `alfa-prod/app` (dormant path) | Out-of-band secret store; re-injected, never restored from a DB backup |
| Web application | Vercel deployments (immutable) | Promote previous deployment; rebuild from a git tag |
| Auth (sessions/JWT) | Supabase Auth | Restored with the Supabase project; sessions re-establish on next login |

Note: secrets are **not** part of the data backup. They are restored by re-injecting from the secret store (Vercel env / Secrets Manager), per core doc 20's "secrets are never in source / rotation is first-class."

---

# Backup Strategy (Supabase Postgres)

Supabase provides managed backups for the production project. The DR posture layers three tiers:

1. **Automated daily backups** (Supabase Dashboard → Database → Backups). Plan-dependent retention; confirm the active retention window matches the RPO below.
2. **Point-in-time recovery (PITR)** where enabled — replays the write-ahead log to restore to a chosen second, bounding data loss to the PITR window rather than a full day. Confirm PITR is enabled for the production project; if not, it is a tracked gap that widens RPO to the daily-backup interval.
3. **Logical dumps for portability and schema reproducibility.** The schema-reproducibility baseline (`00000000000000_baseline_from_prod.sql`, see `docs/runbooks/schema-reproducibility-fix.md`) is a pg_dump-derived **idempotent** baseline, pre-marked applied on prod and main-staging via `supabase migration repair`, so it only executes against fresh projects (CI live-DB tests, new staging, DR restore). This baseline is what makes a clean schema rebuild reproducible from source control.

Backup hygiene (core doc 12):
- Backups are encrypted at rest (Supabase default); never disable encryption.
- Never remove backups or shorten retention to save cost without an explicit, approved DR-impact assessment.
- A backup is valid only after a verified restore (see Restore Drills).

---

# RTO / RPO Targets

- **RTO (Recovery Time Objective) — ≤ 1 hour for the web tier, ≤ 4 hours for a full data-tier restore.** The web tier recovers fast because Vercel rollback (promote previous) is near-instant and the app is stateless against Supabase. A full Postgres restore (provision/restore + verify) is the long pole and is bounded at 4 hours.
- **RPO (Recovery Point Objective) — ≤ 5 minutes with PITR enabled; otherwise ≤ 24 hours (the daily-backup interval).** Closing the gap to the 5-minute target requires PITR on the production project — treat its absence as the single highest-priority DR gap.

These targets align with the availability SLO in the SRE runbook (99.5% monthly uptime). A DR event consumes error budget; prioritize restoration over feature work until recovered.

---

# Web-Tier Failover Posture (Vercel ↔ Dormant AWS)

The web tier has two independent serving paths against the **same** Supabase data tier:

- **Live: Vercel (`bom1`).** Primary and authoritative. First-line failover for a bad deploy is **Vercel rollback** — Deployments → Promote previous (instant, no rebuild). The production workflow also auto-rolls-back on a genuine health failure.
- **Dormant: AWS ECS + CloudFront (`ap-south-1`).** Built but OFF (`ENABLE_AWS_DEPLOY=false`, Route 53 weight 0). It is a *migration target*, not a hot standby — bringing it up is a deliberate, multi-day cutover (aws-operations runbook), not an incident mitigation. Because both paths read the same Supabase project, switching serving paths involves **no data reconciliation**.

DR implication: for a Vercel-platform outage, the fastest real recovery is to wait out / escalate with Vercel and rely on the stateless rollback model; the AWS path is a strategic alternative, not a sub-hour failover. Do not attempt an AWS cutover under incident pressure. The data tier (Supabase) is the shared dependency and the true single point of failure — which is why its backups and restore drills are the heart of this runbook.

---

# Restore Procedures

## A. Web-tier recovery (bad deploy / serving failure)
1. Confirm the data tier is healthy (`/api/v1/health` `status` and dependency probes).
2. Vercel Dashboard → Deployments → select last known-good → **Promote**. Near-instant.
3. Verify: `https://alfanumrik.com/api/v1/health` returns HTTP 200 `status: healthy`; synthetic monitor green.
4. If the failure was schema-correlated, hold the schema and roll only the app back (additive migrations make this safe). Never `DROP` to "undo" a migration.

## B. Full data-tier restore (Supabase Postgres)
1. **Declare the incident** (SEV-1) and freeze writes if integrity is at risk.
2. **Choose the recovery point.** PITR: pick the timestamp just before the corruption. Daily backup: pick the most recent clean snapshot.
3. **Restore** via Supabase Dashboard → Database → Backups → Restore (PITR or snapshot), restoring into the production project or a fresh project per the situation.
4. **Re-inject secrets** if a fresh project — server secrets from Vercel env / Secrets Manager (not from any DB backup).
5. **Verify schema reproducibility** if rebuilding from baseline: `supabase db push --linked --include-all` applies the idempotent baseline + chain cleanly on a fresh project.
6. **Verify data integrity:** spot-check recent quizzes/payments/subscriptions; confirm RLS is enabled on all tables (the CI P8 gate logic); confirm RBAC roles/permissions present.
7. **Re-point the app** at the restored project if the URL changed (Vercel env), redeploy, health-check.
8. **Verify recovery with evidence** and hand off to RCA (core doc 23).

## C. Data-loss recovery (accidental delete / bad migration)
1. **Do not panic-`DROP` or improvise.** Capture the current state for forensics first (core doc 22).
2. **Prefer PITR to a point just before the loss** over a full restore when only specific rows/tables are affected — restore to a fresh project, extract the affected rows, and re-insert into prod.
3. **For a bad migration:** write a **compensating migration** (additive, idempotent, with user approval for any destructive step) — never reverse by dropping in production (core doc 20, and the supabase extension's "no `DROP TABLE/COLUMN` without approval").
4. Add a regression check so the same data-loss path cannot recur.

---

# DR Test Cadence

A DR plan is a hypothesis until exercised. Run these on a schedule and record evidence each time.

| Drill | Cadence | Pass criteria |
|---|---|---|
| Vercel rollback (promote previous) | Monthly | Last-good promoted; health green within RTO |
| Supabase restore to a fresh project | Quarterly | Schema + data restored; integrity spot-checks pass; within RTO/RPO |
| Schema rebuild from idempotent baseline | Per release (CI live-DB) + quarterly | `supabase db push` applies cleanly on a fresh project |
| Secret re-injection drill | Quarterly | All required env vars resolved; app boots and validates env at startup |
| Tabletop SEV-1 data-loss exercise | Semi-annual | Team executes the runbook end-to-end; gaps logged and owned |

Every drill produces evidence classified honestly as verified / observed / unverified (core doc 10). A drill that "should work" but was not run is not a passing drill.

---

# Checklist

- [ ] Supabase automated backups active; retention matches the RPO target.
- [ ] PITR status confirmed (and its absence tracked as the top DR gap).
- [ ] Idempotent schema baseline reproduces the schema on a fresh project.
- [ ] RTO ≤ 1h web / ≤ 4h full-data; RPO ≤ 5 min (PITR) documented and understood.
- [ ] Secrets restorable from the secret store, never from a DB backup.
- [ ] Web failover is Vercel rollback; AWS is a deliberate cutover, not a sub-hour failover.
- [ ] No panic `DROP`; data loss recovered via PITR + compensating migration.
- [ ] Restore drills run on cadence with recorded, honestly-classified evidence.
- [ ] Every restore/data-loss event hands off to RCA with a regression check.

---

# References

Core docs:
- `07_DATABASE_ENGINEERING.md` — database-as-system-of-record, schema-change and integrity discipline.
- `12_AWS_INFRASTRUCTURE.md` — "a backup is not valid until restoration is verified"; backup/retention/encryption standards.
- `20_DEPLOYMENT_PIPELINE.md` — rollback strategy, additive/backward-compatible migrations, secrets as first-class restorable config.
- `22_DEBUGGING_PROTOCOL.md` — preserve evidence before acting during a data-loss event.
- `23_ROOT_CAUSE_ANALYSIS.md` — post-event RCA and regression-check requirement.
- `10_VERIFICATION_ENGINE.md` — restore/drill claims require classified evidence.

Extensions:
- `extensions/supabase.md` — the data tier: clients, RLS, migration conventions, the idempotent baseline.
- `extensions/aws.md` — the dormant AWS path and the reversible Route 53 posture.

Repo:
- `supabase/migrations/` (incl. `00000000000000_baseline_from_prod.sql`), `docs/runbooks/schema-reproducibility-fix.md`, `src/app/api/v1/health/route.ts`, `aws/task-definition.json` (secret references), `vercel.json`.

Related runbooks: sre (incident response and SLOs), github-operations (deploy/migration pipeline), aws-operations (dormant-path activation).

---

# Final Directive

The Supabase data tier is the true single point of failure; protect it with layered backups and prove them with rehearsed restores. Recover the web tier in minutes by promoting a previous Vercel deployment, recover data within RTO/RPO from PITR or snapshot, and never reach for the dormant AWS path or a panic `DROP` under incident pressure. A backup you have not restored is not a backup — drill on cadence, record the evidence, and close every event with a regression check.

**End of Document**
