# Runbook: Extension-out-of-public Migration (DEFERRED)

**Date authored:** 2026-05-09
**Branch context:** `fix/supabase-advisors-tier1`
**Advisor:** Supabase database linter `0014_extension_in_public` (WARN)
**Decision:** **DEFERRED — do not apply in the Tier-1 advisor series.**

## TL;DR

The Supabase database linter flags 4 extensions installed in the `public` schema:

1. `vector` (pgvector — RAG embeddings)
2. `pg_trgm` (trigram similarity, full-text search)
3. `dblink` (cross-database linking)
4. `postgres_fdw` (foreign data wrapper)

Moving them with `ALTER EXTENSION ... SET SCHEMA extensions` is the documented
fix, but a dependency audit on production project `shktyoxqhundlvkiwguu` shows
the move would touch hundreds of dependent objects and break references that
are already hardcoded against `public.<extension_object>` in baseline schema
artifacts. The 50-dependent abort threshold (set by the human operator for the
Tier-1 advisor sweep) is exceeded on `vector` alone by ~5x. This runbook
documents the audit, captures the migration draft for posterity, and
prescribes the safer path: a maintenance-window operation with full backup,
staging dry-run, and follow-up baseline regeneration.

## Audit results (source of truth: `pg_depend` on prod project shktyoxqhundlvkiwguu, 2026-05-09)

### Total dependent objects per extension

| Extension      | Total `pg_depend` rows | Risk band    |
| -------------- | ---------------------- | ------------ |
| `vector`       | **237**                | HIGH         |
| `pg_trgm`      | 47                     | MEDIUM       |
| `dblink`       | 44                     | MEDIUM-LOW   |
| `postgres_fdw` | 6                      | LOW          |

> Threshold for in-sweep migration was 50 dependents. `vector` alone is 4.7x
> over. Sweep aborts.

### Tables with `vector`-typed columns (would migrate transparently if `extensions` is in search_path)

| Schema   | Table               | Column      | Type             |
| -------- | ------------------- | ----------- | ---------------- |
| `public` | `question_bank`     | `embedding` | `vector(1024)`   |
| `public` | `rag_content_chunks`| `embedding` | `vector(1024)`   |
| `public` | `textbook_chunks`   | `embedding` | `vector(1536)`   |

Columns currently report `type_schema = public`. Postgres re-resolves the type
on `ALTER EXTENSION SET SCHEMA`; rows are not rewritten, but every cached
plan and any baseline diff that captured the schema name is invalidated.

### HNSW vector indexes (would be silently rebuilt or invalidated)

- `public.question_bank.question_bank_embedding_hnsw_idx` (hnsw, vector_cosine_ops)
- `public.rag_content_chunks.rag_content_chunks_embedding_hnsw_idx` (hnsw, vector_cosine_ops)
- `public.rag_content_chunks.idx_rag_chunks_embedding_hnsw` (hnsw, vector_cosine_ops)

### `pg_trgm` GIN indexes (use `gin_trgm_ops`)

- `public.rag_content_chunks.idx_rag_chunks_topic_trgm`
- `public.rag_content_chunks.idx_rag_chunks_concept_trgm`

(Other GIN indexes use built-in `tsvector` ops, not pg_trgm.)

### User-defined RPC functions referencing `vector` operators/types (7)

These power foxy-tutor, ncert-solver, and the quiz pipeline. All run in
`public` and use unqualified `vector`/`<=>`/`vector_cosine_ops`:

- `public.match_rag_chunks(...)`
- `public.match_rag_chunks_ncert(...)`
- `public.search_rag_chunks(...)`
- `public.hybrid_rag_search(...)`
- `public.fast_rag_search(...)`
- `public.fast_rag_search_v2(...)`
- `public.select_quiz_questions_rag(...)`

After the move they keep working *only* because the database default
`search_path` already resolves to:

```
"$user", public, extensions
```

(Verified live on prod via `SHOW search_path`.) Anything that relies on
`pg_get_functiondef()` output containing `public.vector` / `public.gin_trgm_ops`
will see the literal change, which is the failure mode below.

## Why this is more than a one-line ALTER

The codebase already has scar tissue from prior `public.<ext_object>` issues:

- `.github/workflows/schema-reproducibility-fix.yml` (lines 187-292) explicitly
  patches schema dumps that emit `public.vector(N)`, `public.vector_cosine_ops`,
  and `public.gin_trgm_ops` — and notes that fresh DBs install these into
  `extensions`, not `public`, causing
  `ERROR: type "public.vector" does not exist (SQLSTATE 42704)` on replay.
- `scripts/reorder-baseline.mjs` (1420-2770) contains rules to strip
  `public.gin_trgm_ops` from index DDL because CI run 25269714566 hit
  `operator class "public.gin_trgm_ops" does not exist`.

These are **fixing the inverse problem** — code dumped against prod (where
extensions are in `public`) failing to replay against fresh DBs (where the
Supabase template installs them into `extensions`). Running
`ALTER EXTENSION ... SET SCHEMA extensions` on prod is the long-term fix that
makes prod look like a fresh DB and lets the strip rules become no-ops, but it
also rewrites every captured `public.vector` reference under the hood. Before
flipping this we want a baseline regeneration and a green CI replay against
the post-move state.

## What the migration would have looked like

Drafted but **not committed** to `supabase/migrations/`:

```sql
-- supabase/migrations/20260516030000_move_extensions_out_of_public.sql
CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION vector       SET SCHEMA extensions;
ALTER EXTENSION dblink       SET SCHEMA extensions;
ALTER EXTENSION postgres_fdw SET SCHEMA extensions;
ALTER EXTENSION pg_trgm      SET SCHEMA extensions;

-- Already true on prod (verified), included for fresh-DB parity.
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
```

The `ALTER DATABASE` line is **idempotent on prod** but requires DB owner
privileges; in some Supabase plans it is restricted from migration runners and
must be applied via the dashboard SQL editor as `postgres` role.

## Specific risks if we ship it inside the Tier-1 sweep

1. **Cached plans for `vector` columns** in long-lived connections may keep
   resolving to `public.vector` until restart. Symptom: intermittent
   `type "public.vector" does not exist` until pgbouncer/server restart.
2. **Baseline schema diff** (`scripts/reorder-baseline.mjs`) regenerates
   index DDL using *current* operator-class schema. After the move, dumps
   contain `extensions.gin_trgm_ops` instead of `public.gin_trgm_ops`. Any
   CI job that compares against a previously committed baseline file will
   fail until the baseline is regenerated — and the existing strip rules
   in `reorder-baseline.mjs` may then strip the *correct* `extensions.`
   qualifier, regressing fresh-DB replay. Both files need a coordinated
   update.
3. **Edge functions** (`foxy-tutor`, `ncert-solver`, `quiz-generator`,
   `quiz-generator-v2`, `cme-engine`) call the 7 RAG RPCs above. These
   continue to work via search_path resolution but should be smoke-tested
   end-to-end immediately after the move (they exercise the HNSW indexes
   and trigram filters).
4. **HNSW indexes are not rebuilt by `ALTER EXTENSION SET SCHEMA`** but
   their operator-class reference is rewritten. Postgres has had bugs in
   this area on older versions; verify `pg_amop` rows resolve to
   `extensions.vector_cosine_ops` post-move.
5. **`dblink_connect_u`** is SECURITY DEFINER and superuser-restricted. If
   any logical replication / cron uses it, audit grants after the move.
6. **`postgres_fdw` foreign servers** survive the move but `\des` output
   format changes; any monitoring dashboard parsing it needs review (low
   probability — we have no FDW servers configured today, only the 6
   extension-internal dependencies).

## Prescribed plan (when we do this)

This is a maintenance-window operation, not a sweep migration. Sequencing:

### Phase A — Pre-flight (in staging)

1. **Take a logical backup of the staging Postgres DB.**
2. Dry-run the migration on staging (`supabase db push` after creating the
   migration file). Capture `\dx` and `pg_get_indexdef` for every vector/trgm
   index before and after.
3. Run the full vitest suite + Playwright E2E + edge-function smoke tests
   (`foxy-tutor`, `ncert-solver`, `quiz-generator`, `quiz-generator-v2`,
   `cme-engine`) against staging.
4. Regenerate the schema baseline:
   - Run `scripts/reorder-baseline.mjs` against staging.
   - Inspect the diff for `public.vector` -> `extensions.vector` and
     `public.gin_trgm_ops` -> `extensions.gin_trgm_ops` rewrites.
   - Update the strip rules in `reorder-baseline.mjs` so they no longer
     strip the `extensions.` qualifier from fresh-DB dumps (they should
     have been targeting `public.` only — verify and tighten).
5. Re-run `schema-reproducibility-fix.yml` against the new baseline. The
   workflow should now be a no-op (or its purpose should evolve to enforce
   `extensions.` qualifiers, not strip `public.` ones).
6. Run advisor lint on staging — `extension_in_public` should disappear.

### Phase B — Production maintenance window

1. Announce 30-minute maintenance window. Disable cron (`daily-cron`,
   `queue-consumer`, `session-guard`) via Supabase dashboard.
2. Take a fresh logical backup. Confirm restore-tested in last 30 days.
3. Apply the migration via Supabase SQL editor as `postgres` role:
   ```sql
   CREATE SCHEMA IF NOT EXISTS extensions;
   ALTER EXTENSION vector       SET SCHEMA extensions;
   ALTER EXTENSION pg_trgm      SET SCHEMA extensions;
   ALTER EXTENSION dblink       SET SCHEMA extensions;
   ALTER EXTENSION postgres_fdw SET SCHEMA extensions;
   ```
4. Restart pgbouncer / connection poolers to flush cached plans.
5. Smoke-test foxy-tutor, ncert-solver, quiz-generator end-to-end.
6. Verify advisor: `extension_in_public` should be RESOLVED.
7. Re-enable cron.
8. Commit the migration file (as a no-op marker for fresh DBs that already
   install extensions into `extensions`) plus the baseline regeneration in
   the same PR.

### Hot-fix if anything breaks

Worst case: extension stays in `extensions`, but search_path is reverted to
include `public` first so unqualified references resolve. Already true on
prod by default — risk is functions/views with explicit `SET search_path`
overrides. Quick fix:

```sql
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
```

Full revert (only if catastrophic):

```sql
ALTER EXTENSION vector       SET SCHEMA public;
ALTER EXTENSION pg_trgm      SET SCHEMA public;
ALTER EXTENSION dblink       SET SCHEMA public;
ALTER EXTENSION postgres_fdw SET SCHEMA public;
```

## Why we are deferring (summary)

- **237 dependents on `vector` alone** — exceeds the 50-object threshold for
  in-sweep migrations by ~5x.
- **Existing CI workarounds** (`schema-reproducibility-fix.yml`,
  `scripts/reorder-baseline.mjs`) are tightly coupled to the
  current `public.<ext_object>` reality. Moving the extensions without
  coordinating those workarounds will flip CI failures from one direction
  to the other.
- **Solo-developer cadence** — Pradeep ships solo. A maintenance window
  with backup + staging dry-run + baseline regeneration is a
  multi-day item, not a sweep migration.
- **Advisor severity is WARN, not ERROR.** No security / RLS / data-integrity
  consequence; only schema hygiene + advisor cleanliness.

## Action items (parked, not committed in this branch)

- [ ] Schedule a maintenance window (target: next quiet weekend; 1 hour).
- [ ] Pre-flight in staging using Phase A above.
- [ ] Update `scripts/reorder-baseline.mjs` strip rules to target only
      `public.gin_trgm_ops` / `public.vector_cosine_ops` (verify they
      already do — they should not strip `extensions.` qualifiers).
- [ ] Land the migration file + baseline regeneration in a dedicated PR
      separate from any other advisor work.
- [ ] After production move: re-run advisor and confirm
      `extension_in_public` is gone for all four extensions.

## References

- Supabase advisor: <https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public>
- pgvector + Supabase managed schemas: <https://supabase.com/docs/guides/database/extensions/pgvector>
- `pg_extension` / `pg_depend` audit queries used to produce this runbook live in this document above.
