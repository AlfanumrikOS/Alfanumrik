# 11 — Performance & Capacity

**Audit date:** 2026-08-29
**Evidence source:** Limited — no dedicated performance agent was run. Data from architecture docs and cross-references.

---

## 1. Design Targets (from ARCHITECTURE.md)

| Metric | Target |
|--------|--------|
| Concurrent students | 5,000+ |
| Database indexing | BRIN + B-tree indexes on high-cardinality tables |
| Connection pooling | Supabase PgBouncer (transaction mode) |
| CDN | Vercel Edge Network (global) |
| Region | bom1 (Mumbai) — optimized for India |
| Bundle budget | Three-layer gate with vacuity detection |

## 2. Known Performance Considerations

| Component | Notes |
|-----------|-------|
| Quiz submission | Atomic SQL RPC — single round-trip to DB; no N+1 |
| Foxy AI responses | OpenAI API latency (~1-3s for gpt-4o-mini); streaming enabled |
| RAG retrieval | pgvector HNSW index; hybrid vector + FTS with RRF fusion |
| Cron jobs | Staggered across hours to avoid DB contention |
| Redis caching | RBAC role cache with taint-invalidation |
| Session cleanup | Daily cron removes expired sessions |
| Cache warming | Nightly pre-warm of Redis caches |

## 3. Findings

No P0/P1 performance findings identified. Known P3 items:

| ID | Severity | Finding |
|----|----------|---------|
| P3-16 | P3 | Edge Function cold start times not measured — no baseline |
| P2-22 | P2 | RAG embedding cache has no TTL — unbounded growth |

## 4. Data Gaps

A full performance audit would include:
- Load testing at target concurrency (5,000 students)
- Database query plan analysis for top-20 queries
- Bundle size audit with per-route analysis
- Time-to-interactive measurements per critical page
- Connection pool saturation testing
- Edge Function cold start benchmarking
- Memory/CPU profiling under sustained load

**Note:** Per the audit operating rules, no load tests were run against production.

## 5. Gate Verdict

**CONDITIONAL GO** — Architecture is designed for scale (BRIN indexes, connection pooling, CDN, regional deployment). No performance testing was performed per audit constraints.
