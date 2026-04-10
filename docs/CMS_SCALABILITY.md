# CMS Scalability Architecture — 100K Users

## Current State Assessment

### What's Already Solid
- **Indexing**: 30+ indexes on content tables covering grade/subject/status/difficulty composite patterns
- **Partial indexes**: `WHERE is_active = true` on hot paths reduces scan size
- **Composite indexes**: `(grade, subject, chapter_number)` covers primary query patterns
- **Connection management**: Singleton Supabase service client in `admin-auth.ts` and `supabase-admin.ts`
- **In-memory cache**: `src/lib/cache.ts` with TTL, hit counting, auto-cleanup
- **Rate limiting**: Upstash Redis distributed rate limiter already deployed
- **RLS**: Row-level security on all tables — DB-enforced authorization
- **Soft deletes**: `deleted_at` column on content tables prevents data loss

### Gaps to Address for 100K Scale

| Gap | Current | Target | Priority |
|-----|---------|--------|----------|
| Cache layer | In-memory (per-instance) | Upstash Redis (distributed) | HIGH |
| Background jobs | Synchronous in-request | Task queue + edge function workers | HIGH |
| Media storage | Not implemented | Supabase Storage buckets | MEDIUM |
| Content CDN | Direct DB reads | Cached responses + stale-while-revalidate | HIGH |
| Version cleanup | Unlimited history | Retention policy (keep last N) | LOW |
| Bulk operations | One-at-a-time REST | Batch RPC functions | MEDIUM |
| Full-text search | ILIKE pattern matching | `tsvector` + GIN index | MEDIUM |
| Event bus | Direct audit log insert | Queue-based event capture | LOW |

## Architecture Plan

### 1. Caching Strategy (Upstash Redis)

Already have `@upstash/redis` installed and configured for rate limiting.
Extend for CMS content caching:

```
Cache Keys:
- cms:topics:{grade}:{subject_id}     → Topic list for student view (TTL: 5min)
- cms:questions:{grade}:{subject}      → Question list for quiz (TTL: 5min)
- cms:stats                            → CMS dashboard stats (TTL: 1min)
- cms:subjects                         → Subject catalog (TTL: 30min)
- cms:hierarchy:{grade}:{subject_id}   → Topic tree (TTL: 5min)

Invalidation:
- On topic create/update/transition → invalidate cms:topics:{grade}:*
- On question create/update → invalidate cms:questions:{grade}:*
- On any mutation → invalidate cms:stats
```

### 2. Background Workers (Supabase Edge Functions)

Use existing `task_queue` table + `queue-consumer` edge function:

```
Job Types:
- cms.bulk_publish     → Publish multiple topics/questions at once
- cms.bulk_archive     → Archive old content
- cms.version_cleanup  → Prune old versions (keep last 20 per entity)
- cms.reindex_search   → Rebuild search vectors
- cms.export_content   → Generate CSV/JSON exports for large datasets
- cms.validate_links   → Check for broken prerequisite references
```

### 3. Media Storage (Supabase Storage)

```
Buckets:
- cms-media/          → Images, diagrams, PDFs for content
  - topics/{topic_id}/
  - questions/{question_id}/

Access:
- Public read for published content
- Admin write via service role
- Size limit: 10MB per file
- Supported: PNG, JPG, SVG, PDF, MP4
```

### 4. Database Optimization

#### Full-Text Search (replace ILIKE)
```sql
-- Add tsvector columns
ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(title_hi, ''))
  ) STORED;

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(question_text, '') || ' ' || coalesce(explanation, ''))
  ) STORED;

CREATE INDEX idx_topics_search ON curriculum_topics USING GIN (search_vector);
CREATE INDEX idx_questions_search ON question_bank USING GIN (search_vector);
```

#### Batch Operations (RPC)
```sql
-- Bulk status transition
CREATE FUNCTION bulk_transition_status(
  p_table TEXT, p_ids UUID[], p_new_status TEXT, p_actor_id UUID
) RETURNS INTEGER ...

-- Efficient question count by filters
CREATE FUNCTION question_count_by_filters(
  p_grade TEXT, p_subject TEXT, p_status TEXT
) RETURNS INTEGER ...
```

#### Version Retention
```sql
-- Keep only last 20 versions per entity
DELETE FROM cms_item_versions
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY entity_type, entity_id
      ORDER BY version_number DESC
    ) as rn FROM cms_item_versions
  ) ranked WHERE rn > 20
);
```

### 5. Connection Pooling

Supabase provides PgBouncer at port 6543 for connection pooling.
- Transaction mode for serverless (Vercel edge/lambda)
- Already used via Supabase JS client defaults
- For direct connections: use `?pgbouncer=true` parameter

### 6. Content Delivery at Scale

```
Student reads content:
  Browser → Vercel Edge → Check Redis cache
    HIT  → Return cached (< 5ms)
    MISS → Query Supabase → Store in Redis (TTL 5min) → Return

Admin updates content:
  Admin UI → CMS API → authorizeAdmin() → Update DB
    → Invalidate Redis cache keys
    → Create version snapshot (async if large)
    → Log audit entry
    → Return success
```

### 7. Projected Load at 100K Users

| Metric | Estimate | Strategy |
|--------|----------|----------|
| Daily active users | ~15,000 | Redis cache for hot content |
| Quiz sessions/day | ~5,000 | question_bank indexed, cached |
| Topic reads/day | ~50,000 | Cached at edge, 5min TTL |
| Chat sessions/day | ~3,000 | Rate limited per student |
| Admin operations/day | ~100 | Direct DB, no cache needed |
| Content updates/month | ~500 | Version snapshots, async cleanup |

### 8. What NOT to Build Yet

- GraphQL (REST + cache is sufficient for current patterns)
- Custom search engine (tsvector + GIN is enough until 1M+ rows)
- Multi-region replication (Supabase handles this at their tier)
- Real-time CMS collaboration (admin-only, low concurrency)
- Custom CDN (Vercel Edge + Redis is enough)

## Implementation Priority

1. **NOW**: Add Redis cache to CMS API hot paths (topics, questions, stats)
2. **NOW**: Add full-text search indexes (tsvector + GIN)
3. **SOON**: Add bulk operations RPCs for admin workflows
4. **SOON**: Set up Supabase Storage bucket for media
5. **LATER**: Version retention cleanup job
6. **LATER**: Content export worker
7. **LATER**: Event bus for analytics capture

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Redis unavailable | Low | Fallback to in-memory cache (already coded) |
| Version table bloat | Medium | Retention policy (keep last 20) |
| Large topic trees | Low | Parent_topic_id index, cached hierarchy |
| Question bank > 100K | Medium | Composite indexes cover all query patterns |
| Concurrent admin edits | Low | Version snapshots prevent data loss |
| Media storage costs | Low | 10MB limit, admin-only uploads |
