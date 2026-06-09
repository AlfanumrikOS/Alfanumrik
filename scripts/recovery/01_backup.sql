-- =============================================================================
-- scripts/recovery/01_backup.sql
-- Project: Alfanumrik Learning OS — Supabase project shktyoxqhundlvkiwguu (prod)
-- =============================================================================
-- PURPOSE
-- -------
-- Verify Supabase backup health and WAL retention BEFORE deploying any
-- migration batch. All queries are READ-ONLY. Zero DDL, zero DML.
--
-- RUN BEFORE deploying migrations. Read-only. No modifications.
--
-- HOW TO USE
-- ----------
-- 1. Open the Supabase SQL editor on project shktyoxqhundlvkiwguu.
-- 2. Paste this file and execute.
-- 3. Review each section's output.  Any WARNING comment describes the risk.
-- 4. If any check shows a RISK condition, resolve it before proceeding.
-- 5. After all checks pass, run the NOTICE at the bottom manually to confirm.
--
-- EXPECTED RUNTIME: < 5 seconds on a healthy idle database.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — Database size and transaction ID consumption
-- =============================================================================
-- WHY: Large databases extend the backup window.  A high age_datfrozenxid means
--      VACUUM hasn't run recently, which can inflate backup size and slow down
--      logical replication.  age > 1.5 billion is a WARNING; > 2 billion is an
--      emergency (XID wraparound risk).
-- EXPECTED OUTPUT: pg_database_size in MB/GB, datfrozenxid age < 500 million.
-- =============================================================================
SELECT
    current_database()                                   AS database_name,
    pg_size_pretty(pg_database_size(current_database())) AS total_size,
    age(datfrozenxid)                                    AS xid_age,
    CASE
        WHEN age(datfrozenxid) > 2000000000
            THEN 'CRITICAL — XID wraparound imminent, emergency VACUUM needed'
        WHEN age(datfrozenxid) > 1500000000
            THEN 'WARNING — XID age high, schedule aggressive VACUUM FREEZE'
        WHEN age(datfrozenxid) > 500000000
            THEN 'CAUTION — XID age elevated, monitor VACUUM progress'
        ELSE 'OK'
    END                                                  AS xid_health
FROM pg_database
WHERE datname = current_database();


-- =============================================================================
-- SECTION 2 — Replication slot status
-- =============================================================================
-- WHY: Stale replication slots that are not advancing cause WAL segments to be
--      retained indefinitely, consuming disk and potentially filling the volume.
--      A slot is "stale" when confirmed_flush_lsn has not advanced in hours.
--      Supabase uses replication slots for logical replication (Realtime) and
--      for their managed backup pipeline.
-- WARNING: Any row with is_active = false OR restart_lsn very far behind
--      current pg_current_wal_lsn() is a risk.  Contact Supabase support if
--      you see inactive slots with large WAL lag.
-- EXPECTED OUTPUT: All slots active = true, wal_lag_mb < 512 MB.
-- =============================================================================
SELECT
    slot_name,
    plugin,
    slot_type,
    active,
    active_pid,
    restart_lsn,
    confirmed_flush_lsn,
    pg_size_pretty(
        pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)
    )                    AS wal_lag_size,
    pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)
                         AS wal_lag_bytes,
    CASE
        WHEN NOT active
            THEN 'WARNING — slot is inactive, WAL being retained unnecessarily'
        WHEN pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) > 536870912
            THEN 'WARNING — slot lag > 512 MB, WAL retention pressure'
        ELSE 'OK'
    END                  AS slot_health
FROM pg_replication_slots
ORDER BY wal_lag_bytes DESC NULLS LAST;


-- =============================================================================
-- SECTION 3 — Background writer (I/O health)
-- =============================================================================
-- WHY: pg_stat_bgwriter reveals whether PostgreSQL is performing efficient
--      sequential writes (bgwriter cleans ahead of demand) or is being forced
--      into backend-driven flushes (maxwritten_clean > 0 repeatedly, or
--      buffers_backend high relative to buffers_clean).  A high
--      buffers_backend / (buffers_clean + buffers_backend) ratio suggests
--      checkpoint tuning or connection pooling issues that can slow migration
--      DDL execution.
-- EXPECTED OUTPUT: buffers_backend_fsync = 0, checkpoint_sync_time low.
-- =============================================================================
SELECT
    checkpoints_timed,
    checkpoints_req,
    checkpoint_write_time,
    checkpoint_sync_time,
    buffers_checkpoint,
    buffers_clean,
    maxwritten_clean,
    buffers_backend,
    buffers_backend_fsync,
    buffers_alloc,
    stats_reset,
    CASE
        WHEN buffers_backend_fsync > 0
            THEN 'WARNING — backend-driven fsync detected, I/O subsystem under pressure'
        WHEN maxwritten_clean > 100
            THEN 'CAUTION — bgwriter hitting maxwritten_clean limit; consider increasing bgwriter_lru_maxpages'
        ELSE 'OK'
    END                  AS io_health
FROM pg_stat_bgwriter;


-- =============================================================================
-- SECTION 4 — Key WAL and replication settings
-- =============================================================================
-- WHY: wal_level must be 'logical' or 'replica' for Supabase Realtime and
--      continuous archiving to work.  max_wal_senders must be > 0 for
--      streaming replication.  archive_mode = 'on' or 'always' means WAL is
--      being archived to object storage (Supabase's PITR backup mechanism).
-- WARNING: wal_level = 'minimal' disables logical replication (Realtime breaks).
--          archive_mode = 'off' on a production database means no PITR.
-- EXPECTED OUTPUT: wal_level = logical, archive_mode = on, max_wal_senders >= 3.
-- =============================================================================
SELECT
    name,
    setting,
    unit,
    short_desc,
    CASE name
        WHEN 'wal_level' THEN
            CASE setting
                WHEN 'logical'  THEN 'OK — logical replication enabled'
                WHEN 'replica'  THEN 'OK — streaming replication enabled (Realtime needs logical)'
                WHEN 'minimal'  THEN 'CRITICAL — Realtime and logical replication disabled'
                ELSE 'UNKNOWN'
            END
        WHEN 'archive_mode' THEN
            CASE setting
                WHEN 'on'     THEN 'OK — WAL archiving active (PITR enabled)'
                WHEN 'always' THEN 'OK — WAL archiving on always (enhanced PITR)'
                WHEN 'off'    THEN 'WARNING — WAL archiving disabled, no PITR backups'
                ELSE 'UNKNOWN'
            END
        WHEN 'max_wal_senders' THEN
            CASE WHEN setting::int >= 3 THEN 'OK'
                 WHEN setting::int > 0  THEN 'CAUTION — low wal_senders, may limit replication slots'
                 ELSE                        'WARNING — max_wal_senders = 0, no streaming replication'
            END
        ELSE setting
    END AS health_note
FROM pg_settings
WHERE name IN ('wal_level', 'max_wal_senders', 'archive_mode', 'wal_keep_size',
               'max_slot_wal_keep_size', 'checkpoint_completion_target',
               'max_wal_size')
ORDER BY name;


-- =============================================================================
-- SECTION 5 — Long-running transactions (potential DDL blockers)
-- =============================================================================
-- WHY: Any open transaction holds locks on objects it has touched.  A migration
--      that runs DDL (ALTER TABLE, CREATE INDEX, etc.) must acquire an
--      ACCESS EXCLUSIVE lock on the target table.  If a transaction older than
--      ~5 minutes is still open, the migration will queue behind it and block
--      all subsequent connections to that table until the lock is granted.
-- WARNING: Any row here indicates a transaction that WILL delay migration DDL
--      on the tables it has locked.  Identify the pid and notify the application
--      team.  Consider pg_terminate_backend(pid) only after user approval.
-- EXPECTED OUTPUT: Zero rows (no long-running transactions > 5 minutes).
-- =============================================================================
SELECT
    pid,
    usename,
    application_name,
    state,
    wait_event_type,
    wait_event,
    now() - xact_start                  AS transaction_age,
    now() - state_change                AS state_age,
    left(query, 200)                    AS query_preview,
    CASE
        WHEN now() - xact_start > interval '30 minutes'
            THEN 'CRITICAL — transaction > 30 min, will block migration DDL'
        WHEN now() - xact_start > interval '10 minutes'
            THEN 'WARNING — transaction > 10 min, consider notifying app team'
        WHEN now() - xact_start > interval '5 minutes'
            THEN 'CAUTION — transaction > 5 min, monitor before running DDL'
        ELSE 'OK'
    END                                 AS risk_level
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '5 minutes'
  AND state != 'idle'
  AND pid <> pg_backend_pid()
ORDER BY transaction_age DESC;


-- =============================================================================
-- SECTION 6 — Table bloat signals (dead tuple ratio)
-- =============================================================================
-- WHY: Tables with n_dead_tup / n_live_tup > 0.2 (20%) have not been
--      autovacuumed recently enough.  Bloated tables inflate backup size,
--      slow sequential scans used during migration DDL planning, and can cause
--      lock escalation when VACUUM FULL runs concurrently with the migration.
-- WARNING: Any table with bloat_ratio > 0.5 and n_dead_tup > 10000 should
--      have VACUUM ANALYZE run before the migration batch.
-- EXPECTED OUTPUT: bloat_ratio < 0.2 for all high-traffic tables.
-- NOTE: n_dead_tup = 0 on tables that have never had UPDATE/DELETE is normal.
-- =============================================================================
SELECT
    schemaname,
    relname                AS table_name,
    n_live_tup,
    n_dead_tup,
    CASE
        WHEN n_live_tup = 0 THEN NULL
        ELSE round((n_dead_tup::numeric / NULLIF(n_live_tup, 0)) * 100, 1)
    END                    AS dead_pct,
    CASE
        WHEN n_live_tup = 0 AND n_dead_tup = 0
            THEN 'EMPTY'
        WHEN n_live_tup = 0
            THEN 'WARNING — all tuples dead, table never vacuumed after truncate'
        WHEN (n_dead_tup::numeric / NULLIF(n_live_tup, 0)) > 0.5 AND n_dead_tup > 10000
            THEN 'WARNING — bloat ratio > 50%, run VACUUM ANALYZE before migration'
        WHEN (n_dead_tup::numeric / NULLIF(n_live_tup, 0)) > 0.2 AND n_dead_tup > 1000
            THEN 'CAUTION — bloat ratio > 20%, schedule VACUUM ANALYZE'
        ELSE 'OK'
    END                    AS bloat_health,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 100
   OR n_live_tup > 5000
ORDER BY n_dead_tup DESC
LIMIT 30;


-- =============================================================================
-- SECTION 7 — Largest tables (backup window planning)
-- =============================================================================
-- WHY: The total backup window is dominated by the largest tables.  Knowing
--      the top 10 tables by size helps estimate how long a full backup will
--      take and which tables' DDL operations carry the highest lock risk.
-- EXPECTED OUTPUT: A ranked list used to prioritise migration scheduling.
-- =============================================================================
SELECT
    schemaname,
    relname                AS table_name,
    pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)))
                           AS total_size,
    pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)))
                           AS table_size,
    pg_size_pretty(
        pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))
        - pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))
    )                      AS index_size,
    n_live_tup             AS live_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) DESC
LIMIT 10;


-- =============================================================================
-- SECTION 8 — Blocking query chains (lock graph)
-- =============================================================================
-- WHY: A session can be WAITING for a lock held by another session.  If a
--      migration lands in this wait queue, it halts the entire table while the
--      blocker is running — potentially for hours.  This query surfaces all
--      active wait chains so the DBA can identify who is blocking whom.
-- WARNING: Any row here means there is an active lock conflict right now.
--      Do NOT start migration DDL until the blocking pid is confirmed idle or
--      the blocking query is a short-lived OLTP query expected to finish soon.
-- EXPECTED OUTPUT: Zero rows (no blocking chains active).
-- =============================================================================
SELECT
    blocked_locks.pid                    AS blocked_pid,
    blocked_activity.usename             AS blocked_user,
    blocking_locks.pid                   AS blocking_pid,
    blocking_activity.usename            AS blocking_user,
    blocked_activity.application_name   AS blocked_app,
    blocking_activity.application_name  AS blocking_app,
    now() - blocked_activity.xact_start AS blocked_wait_duration,
    left(blocked_activity.query, 200)   AS blocked_query,
    left(blocking_activity.query, 200)  AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
   AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
   AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
   AND blocking_locks.page    IS NOT DISTINCT FROM blocked_locks.page
   AND blocking_locks.tuple   IS NOT DISTINCT FROM blocked_locks.tuple
   AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
   AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
   AND blocking_locks.objid   IS NOT DISTINCT FROM blocked_locks.objid
   AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
   AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted
ORDER BY blocked_wait_duration DESC NULLS LAST;


-- =============================================================================
-- SECTION 9 — Summary notice
-- =============================================================================
-- WHY: The SQL editor does not raise implicit NOTICE messages for SELECT
--      results, so we emit an explicit DO-block to confirm completion.
-- HOW: Sections 1-8 above must all return zero WARNING/CRITICAL rows before
--      you proceed with migrations.
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE '=============================================================';
  RAISE NOTICE 'Backup health check complete — safe to proceed with migrations';
  RAISE NOTICE 'Project: shktyoxqhundlvkiwguu (prod)';
  RAISE NOTICE 'Review sections 1-8 for any WARNING / CRITICAL rows.';
  RAISE NOTICE 'If all sections show OK / zero rows: PROCEED.';
  RAISE NOTICE 'If any section shows WARNING or CRITICAL: STOP and resolve.';
  RAISE NOTICE '=============================================================';
END $$;
