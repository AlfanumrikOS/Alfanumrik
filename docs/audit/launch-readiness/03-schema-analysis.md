# 03 — Schema Analysis (Table-by-Table)

**Audit date:** 2026-08-29/30
**Evidence source:** Schema analysis agent (completed)
**Source files:** `apps/host/src/types/database.types.ts` (1,050,577 bytes), 632 migration files, `supabase/config.toml`

---

## 1. Scale

| Metric | Count |
|--------|-------|
| Tables (public schema) | 427 |
| Views | 26 |
| RPC functions | 450 |
| Enums | 2 (`account_deletion_status`, `data_erasure_status`) |
| CREATE INDEX statements | ~1,585 across all migrations |
| RLS policies in migrations | ~1,568 |
| Tables with RLS enabled | 427 (100% — live-verified) |
| Permanent table drops | 0 (house rule enforced) |

---

## 2. Table Inventory by Domain

| Domain | Table Count | Notes |
|--------|-------------|-------|
| Auth / Users | 15 | `users`, `user_roles`, `roles`, `permissions`, `role_permissions`, auth events |
| Students | 34 | `students` (63 cols), 33 satellite tables |
| Teachers | 10 | `teachers` (31 cols), links, notes, analytics |
| Schools / Classes | 28 | `schools` (43 cols), `classes`, `class_students`, `class_enrollments`, admin tables |
| Quizzes / Assessments | 34 | `question_bank` (103 cols), `quiz_sessions`, `concept_mastery` (56 cols) |
| Content / Curriculum | 55 | Subjects, chapters, CBSE syllabus, NCERT, learning paths |
| RAG / Knowledge | 13 | `rag_content_chunks` (56 cols), documents, sources, query logs |
| Foxy / AI | 31 | `foxy_sessions`, `foxy_chat_messages`, AI logs, alfabot, mol |
| Gamification / XP | 15 | `xp_transactions`, `achievements`, `competitions`, leaderboard |
| Payments / Billing | 11 | `payment_history`, `subscription_plans`, `coupons`, invoices |
| Parents / Guardians | 5 | `guardians`, links, cheers, reports |
| WhatsApp | 9 | Identity, sessions, message log, consent |
| Admin | 6 | `admin_users`, audit, impersonation |
| Analytics / Tracking | 19 | Events, KPI contracts, metrics |
| System / Infrastructure | 64 | Feature flags, agents, queues, events, security, backups |
| Study / Pedagogy | ~30 | Study plans, remediation, loops, assignments |

---

## 3. Critical Schema Anomalies

### SCHEMA-01 (P2): `class_students` vs `class_enrollments` — Duplicate Tables

Both tables store the student-to-class relationship:

| | `class_students` | `class_enrollments` |
|--|--|--|
| Columns | 7 (includes `roll_number`) | 6 (includes `enrolled_at`) |
| RLS policies | 7 | 5 |
| Inbound FKs from other tables | 0 | 0 |

Neither is referenced by other tables via FK. This is the TSB-4 item in the Known Risks register (CEO-gated — irreversible DROP when consolidated).

### SCHEMA-02 (P2): `concept_mastery` vs `concept_mastery_score` — Parallel Mastery Systems

| | `concept_mastery` (56 cols) | `concept_mastery_score` (36 cols) |
|--|--|--|
| FK strategy | `topic_id` (UUID) | `concept_code` (text) |
| Model | BKT + SM-2 parameters | Score decomposition, difficulty ladder, exam readiness |
| Generation | Gen 1 mastery engine | Gen 2 mastery engine |

Both track student concept-level mastery with incompatible FK strategies and scoring models.

### SCHEMA-03 (P3): Triple Alert Table Split

Three alert configuration tables coexist: `alert_rules`, `legacy_alert_rules`, `school_alert_rules`. Only `school_alert_rules` has a `school_id` FK (tenant-scoped). The first two appear to be successive versions of the same concept.

### SCHEMA-04 (P3): `api_rate_limits` vs `api_rate_limits_v2`

Both exist in the baseline, neither dropped. The v2 adds one column.

### SCHEMA-05 (P3): Vestigial `users`/`comments`/`posts` Tables

- `public.users`: 4 columns, integer PK — not Supabase `auth.users`. Likely prototype remnant.
- `comments` (5 cols), `posts` (6 cols): reference `public.users` via integer FK.
- No application code appears to write to these tables.

---

## 4. Wide Tables

| Table | Columns | Assessment |
|-------|---------|------------|
| `question_bank` | 103 | IRT, CMS workflow, hints, NCERT, verification, embeddings — consider vertical partitioning |
| `learning_loop_state` | 66 | Flat `p1_*` through `p8_*` phase columns instead of normalized child table |
| `students` | 63 | Profile + subscription + gamification + deletion state; `school_name`/`school_code` denormalized alongside `school_id` FK |
| `concept_mastery` | 56 | BKT + SM-2 + error tracking + review scheduling — cohesive enough |
| `rag_content_chunks` | 56 | Content + metadata + embeddings + quality — reasonable for content store |

---

## 5. Index Coverage

### 5.1 Well-Indexed Tables
- `question_bank`: 30+ indexes (B-tree composites, GIN FTS, HNSW vector, dedup UNIQUE constraints, IRT/CMS/verification partial indexes)
- `quiz_sessions`: 12+ indexes (student+date, student+subject, idempotency UNIQUE)
- `concept_mastery`: 15+ indexes (student, topic, concept, mastery_level, next_review_at)

### 5.2 Over-Indexed Tables (write performance cost)

**`rag_content_chunks`:** 4 duplicate indexes — **2 redundant HNSW + 2 redundant GIN FTS**
- `idx_rag_chunks_embedding_hnsw` AND `rag_content_chunks_embedding_hnsw_idx` — remove one
- `idx_rag_chunks_search` AND `idx_rag_chunks_search_vector` — remove one

**`payment_history`:** 3 indexes on `razorpay_payment_id` — the UNIQUE partial index subsumes the other two btree indexes

### 5.3 Missing Indexes

| Table | Missing | Impact |
|-------|---------|--------|
| `payment_history` | Index on `status` column | Admin payment status queries will seq-scan |
| `xp_transactions` | Standalone `created_at` index | Admin time-range queries can't use composite indexes efficiently |

### 5.4 Index Type Distribution

| Type | Count | Usage |
|------|-------|-------|
| B-tree | ~1,500+ | Standard lookups |
| GIN | ~15+ | Full-text search, trigram, JSONB |
| HNSW | 4 | Vector similarity (question_bank, rag_content_chunks) |
| BRIN | 1 | `audit_logs.created_at` (append-only) |
| Hash | 1 | `response_cache.cache_key` |

---

## 6. FK Reference Graph (Top Targets)

| Target Table | Inbound FK Count |
|-------------|-----------------|
| `students` | 119 |
| `auth.users` | 31 |
| `schools` | 16 |
| `curriculum_topics` | 11 |
| `classes` | 8 |
| `teachers` | 8 |
| `subjects` | 7 |
| `question_bank` | 5 |

---

## 7. Type Consistency

- **Grade fields:** 267 grade columns across all tables — ALL typed as `string` in generated types. The 8 numeric matches are legitimate range bounds (`min_grade`/`max_grade` on non-student tables) or non-grade numeric fields.
- **`unknown`-typed columns:** 6 instances (`tsvector`, `inet`, `name`, `tstzrange`) — expected Supabase codegen limitation, no action needed.
- **Integer PKs in `users`/`comments`/`posts`:** Vestigial — these 3 tables have integer PKs instead of UUIDs.
- **Nullable mismatches:** Several in hand-written `packages/lib/src/types.ts` vs generated types — documented in `02-schema-sot-drift.md`.

---

## 8. Supabase Configuration (config.toml)

| Setting | Value |
|---------|-------|
| Project ref | shktyoxqhundlvkiwguu |
| PostgreSQL version | 17 (prod: PG 17.6) |
| JWT expiry | 3600s |
| Refresh token rotation | ON |
| Storage file size limit | 50 MiB |
| Extensions | `vector` (pgvector), `pg_trgm` |
| `daily-cron` verify_jwt | `false` (by design) |
| Email confirmations | OFF (local dev only) |

---

## 9. Findings Register (Schema-Specific)

| ID | Severity | Finding | Phase |
|----|----------|---------|-------|
| SCHEMA-01 | P2 | `class_students` vs `class_enrollments` duplicate tables — consolidation CEO-gated (TSB-4) | Phase 8 |
| SCHEMA-02 | P2 | `concept_mastery` vs `concept_mastery_score` — parallel mastery systems with incompatible FK strategies | Phase 5 |
| SCHEMA-03 | P2 | 4 duplicate indexes on `rag_content_chunks` (2 HNSW + 2 GIN FTS) costing write performance | Phase 7 |
| SCHEMA-04 | P2 | 3 redundant indexes on `payment_history.razorpay_payment_id` | Phase 7 |
| SCHEMA-05 | P2 | `payment_history` missing index on `status` column | Phase 7 |
| SCHEMA-06 | P2 | `xp_transactions` missing standalone `created_at` index | Phase 7 |
| SCHEMA-07 | P3 | `learning_loop_state` (66 cols) uses flat `p1_*`–`p8_*` phase columns — denormalized | Phase 8 |
| SCHEMA-08 | P3 | Triple alert table split (`alert_rules` / `legacy_alert_rules` / `school_alert_rules`) | Phase 7 |
| SCHEMA-09 | P3 | Vestigial `users`/`comments`/`posts` tables with integer PKs | Phase 7 |
| SCHEMA-10 | P3 | `api_rate_limits` vs `api_rate_limits_v2` — two versions coexist | Phase 7 |
