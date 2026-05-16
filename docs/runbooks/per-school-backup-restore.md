# Runbook — Per-School Backup and Restore

**Scope:** logical backup + restore of a single school's data, scoped via `school_id`. Distinct from full-Supabase Point-in-Time Recovery (PITR), which restores the entire project.

**Triggered by:**
- A school requests their data on departure / contract end (DPDP-compliant offboarding)
- Pre-migration / pre-deploy snapshot for a high-risk schema change touching school data
- Disaster recovery — restoring one school after a destructive operation
- Forensics / audit response (read-only export)

**Owner:** ops + DPO. Requires service-role access to prod Supabase project (`shktyoxqhundlvkiwguu`).

**Targets (objectives):**
- **RPO** (recovery-point objective): ≤ 5 min. Achieved via Supabase PITR (full-project) + the school-scoped backup procedure below as a complement.
- **RTO** (recovery-time objective): ≤ 2 hours for a single school of ≤ 1000 students. Linearly with size beyond that.
- **DPDP retention:** offboarded school data must be erasable in ≤ 30 days after contract end (see §7).

---

## 1. What's school-scoped

Tables that filter by `school_id`:
- `schools`, `school_admins`, `school_subscriptions`, `school_invite_codes`, `school_audit_log`, `school_alert_rules`, `school_branding` (where these exist)
- `students` (`school_id` column)
- `teachers` (`school_id` column)
- `classes`, `class_students`, `teacher_class_assignments`
- `assignments`, `assignment_submissions`
- `quiz_sessions`, `quiz_attempts`, `student_learning_profiles`, `score_history`
- `foxy_chat_messages` (after Phase B.4 — has `school_id` denormalized)
- `audit_logs` (after Phase B.4 — has `school_id` denormalized for school-actor rows)
- `notification_sends`, `notification_preferences` (joined through `guardians` → `guardian_student_links` → `students.school_id`)

**Not school-scoped (out of scope for this runbook):**
- `question_bank`, `curriculum_topics`, `ncert_*` — global content, shared across schools
- `subscription_plans`, `feature_flags` — global config
- `super_admin_*` — operator-only
- `auth.users` — shared with B2C; only `auth.users` rows whose `auth_user_id` appears in this school's `students` / `teachers` / `school_admins` belong to the school

---

## 2. Backup procedure (logical export)

### 2.1 Prerequisites

```bash
# Confirm service-role access
psql "$SUPABASE_PROD_URL" -c "SELECT current_user;"
# Expected: postgres (or service_role)

# Confirm the school exists and is the right one
psql "$SUPABASE_PROD_URL" -c "SELECT id, name, code, is_active FROM schools WHERE id = '<SCHOOL_ID>';"
```

### 2.2 Run the backup

There is no single `pg_dump --table` per-school filter; use `COPY (SELECT ...)` per table. Wrap in a single transaction to get a consistent snapshot:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;

\copy (SELECT * FROM schools WHERE id = :'school_id')                              TO '/tmp/backup/schools.csv'                            WITH CSV HEADER;
\copy (SELECT * FROM school_admins WHERE school_id = :'school_id')                 TO '/tmp/backup/school_admins.csv'                     WITH CSV HEADER;
\copy (SELECT * FROM school_subscriptions WHERE school_id = :'school_id')          TO '/tmp/backup/school_subscriptions.csv'              WITH CSV HEADER;
\copy (SELECT * FROM school_invite_codes WHERE school_id = :'school_id')           TO '/tmp/backup/school_invite_codes.csv'               WITH CSV HEADER;
\copy (SELECT * FROM school_audit_log WHERE school_id = :'school_id')              TO '/tmp/backup/school_audit_log.csv'                  WITH CSV HEADER;
\copy (SELECT * FROM students WHERE school_id = :'school_id')                      TO '/tmp/backup/students.csv'                          WITH CSV HEADER;
\copy (SELECT * FROM teachers WHERE school_id = :'school_id')                      TO '/tmp/backup/teachers.csv'                          WITH CSV HEADER;
\copy (SELECT * FROM classes WHERE school_id = :'school_id')                       TO '/tmp/backup/classes.csv'                           WITH CSV HEADER;
\copy (SELECT cs.* FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE c.school_id = :'school_id')   TO '/tmp/backup/class_students.csv'   WITH CSV HEADER;
\copy (SELECT * FROM assignments WHERE class_id IN (SELECT id FROM classes WHERE school_id = :'school_id'))        TO '/tmp/backup/assignments.csv'      WITH CSV HEADER;
\copy (SELECT qs.* FROM quiz_sessions qs JOIN students s ON s.id = qs.student_id WHERE s.school_id = :'school_id') TO '/tmp/backup/quiz_sessions.csv'    WITH CSV HEADER;
\copy (SELECT * FROM student_learning_profiles WHERE student_id IN (SELECT id FROM students WHERE school_id = :'school_id')) TO '/tmp/backup/profiles.csv' WITH CSV HEADER;
\copy (SELECT * FROM foxy_chat_messages WHERE school_id = :'school_id')            TO '/tmp/backup/foxy_chat_messages.csv'                WITH CSV HEADER;
\copy (SELECT * FROM audit_logs WHERE school_id = :'school_id')                    TO '/tmp/backup/audit_logs.csv'                        WITH CSV HEADER;

COMMIT;
```

Replace `:'school_id'` via psql's `-v` flag or substitute the literal UUID.

The full template lives at `scripts/per-school-backup.sql` (TODO: scaffold script in a follow-up — kept inline here for now).

### 2.3 Output

A directory `/tmp/backup/` with ~14 CSV files. Compress + encrypt:

```bash
tar czf "school-${SCHOOL_ID}-${TIMESTAMP}.tar.gz" -C /tmp backup/
# Encrypt with the ops team's GPG key (NOT the developer's personal key)
gpg --encrypt --recipient ops@cusiosense.com \
    --output "school-${SCHOOL_ID}-${TIMESTAMP}.tar.gz.gpg" \
    "school-${SCHOOL_ID}-${TIMESTAMP}.tar.gz"
rm "school-${SCHOOL_ID}-${TIMESTAMP}.tar.gz"   # never leave plaintext
```

Upload to ops S3 bucket: `s3://alfanumrik-ops-backups/school-exports/<YYYY>/<MM>/`.

### 2.4 Verify

```bash
# Read the row counts and confirm they match a SELECT COUNT(*) against prod
for f in /tmp/backup/*.csv; do
  echo "$(basename $f): $(($(wc -l < $f) - 1)) rows"   # -1 for header
done

psql "$SUPABASE_PROD_URL" <<EOF
SELECT
  (SELECT COUNT(*) FROM students WHERE school_id = '$SCHOOL_ID') AS students,
  (SELECT COUNT(*) FROM teachers WHERE school_id = '$SCHOOL_ID') AS teachers,
  (SELECT COUNT(*) FROM classes WHERE school_id = '$SCHOOL_ID') AS classes,
  (SELECT COUNT(*) FROM foxy_chat_messages WHERE school_id = '$SCHOOL_ID') AS chat;
EOF
```

Row counts MUST match. If they don't, abort and investigate — likely an RLS policy is hiding rows from the service-role connection (rare but possible).

Log the backup to `audit_logs`:
```sql
INSERT INTO audit_logs (auth_user_id, action, resource_type, resource_id, details, school_id)
VALUES (
  '<OPERATOR_AUTH_UUID>',
  'ops.school_backup_taken',
  'schools',
  '<SCHOOL_ID>',
  jsonb_build_object(
    'reason', '<departure | pre_migration | dr | audit>',
    'backup_location', 's3://alfanumrik-ops-backups/school-exports/.../<file>.gpg',
    'row_counts', '<json from §2.4>'
  ),
  '<SCHOOL_ID>'
);
```

---

## 3. Restore procedure (logical import)

### 3.1 Pre-flight

**Verify the target environment.** Do NOT run a restore against production unless explicitly authorized — the typical destination is a staging or a per-tenant scratch project.

```bash
echo "Restoring to: $SUPABASE_TARGET_URL"
psql "$SUPABASE_TARGET_URL" -c "SELECT current_database(), inet_server_addr(), now();"
# Confirm this is the right environment with the operator before proceeding
```

**Decompress + decrypt the backup:**

```bash
gpg --decrypt "school-${SCHOOL_ID}-${TIMESTAMP}.tar.gz.gpg" > "/tmp/restore.tar.gz"
mkdir -p /tmp/restore && tar xzf /tmp/restore.tar.gz -C /tmp/restore --strip-components=1
ls /tmp/restore/  # 14 .csv files expected
```

### 3.2 ID-collision check

If a row with the same primary key already exists in the target, the restore will fail at INSERT. Decide ahead of time:

- **Option A (clean target):** DELETE existing rows for this school_id first. Lethal — only for scratch / staging.
- **Option B (merge):** Use `ON CONFLICT DO UPDATE` per table — preserves target's existing data, overwrites with backup where IDs match.
- **Option C (id-remap):** Generate new UUIDs and rewrite FKs as you import. Required for cross-tenant restores. Most complex; involves a SQL script per table.

Most school-departure restores use Option A on a clean staging env. Pre-migration snapshots also use Option A.

### 3.3 Run the restore

Within a transaction, in FK-respecting order:

```sql
BEGIN;
\copy schools                       FROM '/tmp/restore/schools.csv'                   WITH CSV HEADER;
\copy school_admins                 FROM '/tmp/restore/school_admins.csv'             WITH CSV HEADER;
\copy school_subscriptions          FROM '/tmp/restore/school_subscriptions.csv'      WITH CSV HEADER;
\copy school_invite_codes           FROM '/tmp/restore/school_invite_codes.csv'       WITH CSV HEADER;
\copy school_audit_log              FROM '/tmp/restore/school_audit_log.csv'          WITH CSV HEADER;
\copy teachers                      FROM '/tmp/restore/teachers.csv'                  WITH CSV HEADER;
\copy students                      FROM '/tmp/restore/students.csv'                  WITH CSV HEADER;
\copy classes                       FROM '/tmp/restore/classes.csv'                   WITH CSV HEADER;
\copy class_students                FROM '/tmp/restore/class_students.csv'            WITH CSV HEADER;
\copy assignments                   FROM '/tmp/restore/assignments.csv'               WITH CSV HEADER;
\copy quiz_sessions                 FROM '/tmp/restore/quiz_sessions.csv'             WITH CSV HEADER;
\copy student_learning_profiles     FROM '/tmp/restore/profiles.csv'                  WITH CSV HEADER;
\copy foxy_chat_messages            FROM '/tmp/restore/foxy_chat_messages.csv'        WITH CSV HEADER;
\copy audit_logs                    FROM '/tmp/restore/audit_logs.csv'                WITH CSV HEADER;
COMMIT;
```

If any \copy fails, the entire transaction rolls back. Inspect the error, fix, re-run.

### 3.4 Post-restore verification

```sql
-- Row count parity with the backup manifest (per §2.4)
SELECT
  (SELECT COUNT(*) FROM students WHERE school_id = '<SCHOOL_ID>') AS students_restored,
  (SELECT COUNT(*) FROM teachers WHERE school_id = '<SCHOOL_ID>') AS teachers_restored,
  (SELECT COUNT(*) FROM classes WHERE school_id = '<SCHOOL_ID>') AS classes_restored;
```

Spot-check RLS:
```sql
-- As a school_admin of this school: should see only this school's rows
SET ROLE school_admin_<id>;   -- or use auth.uid() switch in real session
SELECT COUNT(*) FROM students;  -- should equal students_restored
```

Re-emit `state_events` if downstream projectors need to rehydrate views. (TODO: link to projector rehydration runbook when one exists.)

Audit log the restore:
```sql
INSERT INTO audit_logs (...) VALUES (..., 'ops.school_restore_completed', ...);
```

---

## 4. Staging rehearsal (mandatory before any production restore)

A bad restore is much worse than no restore. Rehearse:

1. **Pick a recent backup** of a small school (< 100 students) from S3.
2. **Restore against staging** (`gzpxqklxwzishrkiaatd`) via the §3 procedure.
3. **Run the rehearsal checklist:**
   - [ ] All 14 CSV files imported without error
   - [ ] Row counts match the backup manifest
   - [ ] Spot-check one student row contains expected `name`, `grade`, `school_id`
   - [ ] Spot-check one quiz_session row links back to the right student
   - [ ] As a fake school_admin (staging-only), confirm the dashboard renders
   - [ ] Foxy chat history loads with school_id filter
4. **Tear down:** drop the restored data via `DELETE WHERE school_id = '...'` after the rehearsal — staging should never accumulate test schools.
5. **Document any discrepancies** in `audit_logs` and update this runbook.

Rehearsal cadence: at least once per quarter, OR before any major schema migration touching school-scoped tables.

---

## 5. Disaster scenarios

### 5.1 Single-school accidental delete on prod

**Symptoms:** school admin reports "all our data is gone."

**Response:**
1. **Stop the bleeding.** Disable that school's invite codes immediately so no new bad writes overwrite the missing data:
   ```sql
   UPDATE school_invite_codes SET expires_at = NOW() WHERE school_id = '<id>';
   ```
2. **Take a current snapshot** of whatever remains (§2 procedure).
3. **Use Supabase PITR** to fork a new project at the timestamp just before the delete. PITR is documented at the Supabase dashboard: Settings → Backups → Point in Time Recovery. Retention is 7 days on the Pro tier; if more recent than that, this works.
4. **Export the school's data** from the PITR fork using §2.
5. **Re-import** to prod using §3 with Option B (`ON CONFLICT DO UPDATE`) to preserve any rows added since the delete.
6. **Audit log everything** — DPDP requires a record of the recovery.

### 5.2 Cross-tenant write contamination

**Symptoms:** queries against `audit_logs` or `foxy_chat_messages` reveal rows where `school_id` doesn't match the natural FK chain (e.g., a foxy message tagged to school X but the student belongs to school Y).

**Response:**
1. Run the integrity check from Phase B.4's migration on a copy first to scope the damage
2. Open an incident in PagerDuty (sev-2 if < 100 rows, sev-1 otherwise)
3. The contaminated rows are NOT immediately fixable — they may have been seen by the wrong school in their dashboards already. Notify DPO; this may require a DPDP breach notification

---

## 6. Tooling backlog

These improvements are tracked but not in scope for the runbook itself:

- `scripts/per-school-backup.sh` — wraps §2 into a single command
- `scripts/per-school-restore.sh` — wraps §3 with Option-A/B/C as a flag
- Nightly snapshot job for top-N revenue schools (cron + S3 + retention 30d)
- Grafana dashboard tracking backup recency per school

These land in Phase E or later.

---

## 7. DPDP compliance

- **Data export on request:** parents (for their child's data) and school admins (for their school's data) can request a copy at any time. The export procedure in §2 satisfies this for school admins; for individual children, see [`child-data-export.md`](./child-data-export.md) when that runbook lands (Phase D.2).
- **Erasure on contract end:** ≤ 30 days after a school's contract ends, the school's data MUST be fully erased from prod. Use the inverse of §3:
  ```sql
  -- IRREVERSIBLE — only after final backup confirmed in S3
  BEGIN;
  DELETE FROM audit_logs                    WHERE school_id = '<id>';
  DELETE FROM foxy_chat_messages            WHERE school_id = '<id>';
  -- … (all 14 tables, reverse FK order) …
  DELETE FROM schools                       WHERE id        = '<id>';
  COMMIT;
  ```
  Log the erasure to a long-retention audit table (NOT one that's about to be deleted!).
- **Backup retention:** offboarded schools' encrypted backups in S3 must be deleted after their statutory retention period (currently 90 days post contract-end; check with legal).

---

## Related runbooks

- [`vault-secret-rotation.md`](./vault-secret-rotation.md) — for rotating service-role keys before/after a restore
- [`projector-failure.md`](./projector-failure.md) — for re-hydrating projected views after a restore
- [`2026-04-27-schema-reconciliation.md`](./2026-04-27-schema-reconciliation.md) — for schema drift between prod and a restore target
