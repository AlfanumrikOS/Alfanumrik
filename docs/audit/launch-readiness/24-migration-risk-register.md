# 24 — Migration & Production-Mutation Risk Register

**Status:** PLANNING ONLY. No execution authorized. Every row below is a PROPOSED action pending separate CEO approval — nothing in this register has been run.

| Packet | Proposed DB/Infra Action | Lock/Downtime Risk | Data-Mutation Risk | Reversibility | Notes |
|---|---|---|---|---|---|
| 1 (P0-01) | None — read-only verification queries only | None | None | N/A | Zero-risk, could run immediately even before formal execution approval since it's read-only |
| 2 (P1-01) | Column-level ACL migration on `question_bank` (`REVOKE ALL` + `GRANT SELECT (allowlist)`), modeled on the proven `20260814000020` precedent | Brief `ACCESS EXCLUSIVE` on the grant statement — metadata-only, fast, low risk at current table size | None — grants/revokes don't touch row data | Trivially reversible (re-grant `SELECT` unconditionally) | **The real risk is NOT the migration — it's sequencing.** If applied before mobile adoption clears, it's a live outage for the installed app base, not a database risk. Must not ship until the mobile-adoption gate (Packet 2's Unresolved Decision) is explicitly cleared. |
| 3 (P1-02) | Possible `npm run ncert:embed` backfill (additive UPDATE on NULL `embedding` columns only) if step-1 query confirms a coverage gap | Low — should be batched/rate-limited since it calls the live Voyage API per chunk; no expected lock contention at 27,778-row scale | Low — additive only, does not modify existing non-NULL embeddings or any other column | N/A — additive, no meaningful rollback need | Any retrieval-parameter tuning (fetch-pool size, cosine floor) that might follow should be behind an easily-revertible config value, not hardcoded, and should go through the eval-harness gate before being considered final |
| 4 (P1-03) | GitHub ruleset settings change (add "CI Gate" to required checks) | None — not a database action | None | Trivially reversible (remove from required list) | No migration involved at all |
| 5 (P1-04) | Single `INSERT` into `notification_channels` (via existing admin UI, not raw SQL) + attach to existing `alert_rules.channel_ids` | None | Low — purely additive, does not modify or remove the existing CEO-email channel | Trivially reversible (deactivate channel via UI) | No migration file needed — uses existing, already-deployed admin tooling |
| 6 (P1-05) | Single-file code change to `webhook-dispatcher/index.ts` (remove `?token=` fallback, resolve bearer-priority ordering) | None | None | Trivial revert | Must verify `daily-cron`'s actual trigger path continues working post-fix, given the incidental bearer-priority bug interacts with this change |
| 7 (P1-06) | Single-file code change to `streak-guardian/route.ts` (add `idempotency_key`, switch `.insert()` → `.upsert()`) | None | None — the `idempotency_key` column and unique index already exist (added by `20260505100100`); this is a write-path behavior change, not a schema change | Trivial revert | No migration needed — schema already supports this |
| 8 (P1-07) | IF revoking: `REVOKE EXECUTE ON FUNCTION match_rag_chunks_ncert(...) FROM authenticated` + update `db-function-live-grant-verifier.test.ts` manifest in the same change | Brief `ACCESS EXCLUSIVE` on the function, metadata-only | None | Trivially reversible (re-grant) | **Gated on the Packet 8 risk-acceptance decision — do not draft this migration until that decision is made** |
| 9 (P1-08) | No schema/migration — code-only changes to error-handling in 3 (or more, scope-dependent) files | None | None | Trivial per-file revert | Scope-dependent on Packet 9's decision |
| 10 (VULN-D1/D2/D3) | No schema/migration — application-layer code changes reusing existing `checkApiRateLimit` + already-provisioned Upstash | None | None | Trivial per-file revert; the rate-limit helper itself fails open to an in-memory fallback if Upstash is unreachable, so the fix cannot itself cause an availability outage via infra failure | No new infrastructure, no new credentials |
| 11 (P-01 + P2-04) | No schema/migration — code-only changes to `select()` column lists in 5 (+3 pending investigation) route files | None | None | Trivial per-file revert | Purely a read-projection change; does not alter row-level filtering/RLS logic |

---

## Items Explicitly Excluded From This Register (per CEO prohibitions)

The following actions were considered during research but are **explicitly out of scope** for any packet in this remediation-planning phase, per the CEO's authorization:

- Editing any already-applied migration
- Creating a parallel roster, role, mastery, event, or RAG system
- Dropping `class_students` or `class_enrollments`
- Any XP or mastery bulk backfill
- Normalizing production grade data in bulk
- Re-embedding or migrating vectors
- Undeploying any Edge Function (including the undocumented ones surfaced in `21-dependency-graph-and-reclassified-risks.md` §B3 — recovery/documentation only was recommended, not removal)
- Replacing the active RAG path
- Any destructive, production-load, replay, restore, or deletion test

Where research surfaced a finding that would naturally lead toward one of these actions (e.g., Edge Function drift, the feature-flag rollback question, the RAG chunk-store vector-dimension split), the corresponding packet or register entry recommends **investigation, documentation, or an explicit decision request only** — never the prohibited action itself.

---

## Overall Risk Summary

**None of the 12 packets, as scoped, require a schema migration with meaningful lock/downtime/data-mutation risk**, with two narrow exceptions:
1. **Packet 2 (P1-01)'s column ACL** — the migration itself is low-risk (metadata-only), but the *sequencing* against mobile-app adoption carries real product-availability risk if done prematurely.
2. **Packet 3 (P1-02)'s possible embedding backfill** — low risk, additive-only, but should be rate-limited given live API calls.

Every other packet is either a settings change, an additive insert via existing tooling, or an application-code change with no schema involvement. This is a materially lower-risk remediation set than the CEO's authorization language anticipated for "migration and implementation sequence" — most items in this launch-blocking set are not migrations at all.
