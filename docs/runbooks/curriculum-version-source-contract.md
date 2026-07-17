# Curriculum Version Source — API Contract (Step 4a)

Monotonic, per-scope curriculum-content version source for the mobile offline
cache. DB side shipped in migration `20260717120000_curriculum_version_source.sql`.
This note is the contract the **backend** HTTP route and the **mobile** client
implement against. The route itself (`GET /api/v2/curriculum-version`) is owned by
backend and is NOT part of this migration.

## RPC

```
public.get_curriculum_versions(
  p_grade         text,               -- "6".."12" (P5 string; out-of-range -> empty scopes, never errors)
  p_subject_codes text[] DEFAULT NULL  -- explicit subject codes, or NULL = all subjects with content
) RETURNS jsonb
```

- SECURITY DEFINER, STABLE, `search_path = public`. Grants: `authenticated`, `service_role`.
- Reads only global, non-PII content-catalog metadata; returns only integer versions + a timestamp.

## Response JSON

```json
{
  "as_of": "2026-07-17T09:14:52Z",
  "scopes": {
    "science-8": 1752483291,
    "math-8": 1752399001
  }
}
```

- **`as_of`** — ISO-8601 UTC timestamp the versions were read at.
- **`scopes`** — map of `"<subject_code>-<grade>"` → **monotonic integer** (unix-epoch
  seconds; safe within JS `Number`). The key format aligns with the client cache key
  `chapters_<subject>_<grade>` (subject_code, then grade string).
- **Value semantics**: higher = newer content. The client stores the last value per
  scope and: `server > local` → purge + refetch that scope; `server == local` → serve
  cache instantly (+ background refresh); offline → serve cache within the 7-day
  stale window; else refuse. No static fallback.
- **"No content yet"** = `0`. Only ever `0` for a scope that never had content — once
  content has existed, deletes bump a watermark so the version stays `> 0`.
- **Empty-scope handling**: when `p_subject_codes` is given, EVERY requested code is
  echoed (0 when it has no content) so the client always gets a definitive answer per
  requested scope. When `p_subject_codes` is NULL, empty scopes are omitted to keep the
  app-start poll small.

## What each scope version covers

Version(subject_code, grade) = `floor(epoch of GREATEST(...))` over:
- `curriculum_topics` (the subjects→chapters→topics tree — same rows the mobile Learn
  tree reads), plus
- `rag_content_chunks` (the NCERT concept prose the mobile concept screen reads), plus
- a per-scope hard-delete watermark.

Monotonic under insert, edit, soft delete, AND hard delete (see the migration header
for the proof). Granularity is subject+grade. A subject+grade bump invalidates all of
that subject+grade's `chapters_*` / `topic_*` cache entries.

### Granularity: why subject+grade, and what changed under this doc

**Correction (2026-07-17).** An earlier revision of this section justified subject+grade
by claiming: *"the current client cache keys `topics_<chapterId>`/`topic_<topicId>` are
keyed by row UUID, not chapter number, so finer versions are not yet consumable."*
**That premise was true when written and is now false.** It is corrected here rather
than deleted, because *how* it went stale is the reusable signal: it was invalidated by
an unrelated mobile commit landing under a doc that never re-checked it. Both halves
were wrong by the time the migration shipped:

- **The concept path was never row-UUID-keyed — it was UNCACHED.** At `a20612b0^`,
  `getConceptV2` had no cache key at all, so it was invisible to the original survey.
  Step 5 (`a20612b0`) then cached it as `topic_<chapterId>` where `chapterId` is a
  chapter **NUMBER** (`int.tryParse`'d before the v2 call), not a row UUID. The
  premise was silently invalidated by a commit that wasn't about versioning.
- **The key format has since moved on.** The scope-collision fix (`b77bd47f`)
  namespaced it to `topic_<subject>_<grade>_<chapterId>` via `_contentCacheKey()` —
  because a bare chapter number repeats across scopes (math-8 ch3 and science-8 ch3
  both keyed `topic_3`).

**Consequence: the conclusion inverts for one path, not for all of them.** The concept
path's key is now exactly the `(subject, grade, chapter_number)` tuple a chapter-level
version would key on, so **chapter-level versioning IS now consumable there.** But the
cache surface is not uniform:

| Client path | Key (post-`b77bd47f`) | Chapter-level consumable? |
|---|---|---|
| `getConceptV2` (v2 NCERT concept) | `topic_<subject>_<grade>_<chapterNumber>` | **Yes** — key already carries chapter number |
| `getTopicContent` (legacy `topics` table) | `topic_<subject>_<grade>_<topicUUID>` | **No** — `id` is a row UUID; client cannot map topic → chapter without a lookup it does not cache |
| `getTopics` (topics list) | `topics_<chapterId>` (unscoped) | Moot — no screen calls it; see the collision warning in its docstring |

### Decision: subject+grade stays. Chapter-level is NOT recommended (yet).

This is a deliberate call, not an artifact of the stale premise above. Even though
chapter-level is now consumable for the concept path, it is **not** the right shipping
granularity:

1. **It would be consumable on only half the content surface.** `getTopicContent`
   remains row-UUID-keyed. Shipping a chapter-level axis the client can honor for
   concept text but not for legacy topic content means two invalidation regimes over
   the same content — coarse-but-uniform beats fine-but-split-brain.
2. **It costs the very thing the feature exists to save.** Scope entries per poll grow
   from ~1/subject to ~1/chapter (~15x; a 6-subject grade goes from ~6 entries to ~90)
   on an app-start poll over student-paid mobile data.
3. **It does not mitigate the dominant blast-radius risk.** A bulk
   `UPDATE curriculum_topics` bumps every chapter just as surely as it bumps every
   subject+grade (see below). Finer granularity buys nothing against the realistic
   worst case.
4. **Implementation cost is not confined to the RPC**: `chapter_number` must enter the
   aggregation key AND the hard-delete watermark key, `rag_content_chunks.chapter_number`
   must be reliable for every ingested chapter, and both clients need per-chapter
   version maps.

**Revisit trigger** (name it explicitly so the next reader doesn't re-litigate from
scratch): when the legacy `getTopicContent` path is retired and the v2 concept path is
the only content surface, chapter-level becomes *uniformly* consumable and reason (1)
disappears. Re-run this decision then, and re-verify the client keys at that moment
rather than trusting this table — that is precisely the failure this section documents.

## Operational: bulk-update blast radius (read before deploying)

**Any bulk `UPDATE curriculum_topics` bumps every affected scope's version, which the
fleet reads as "content changed" → purge + re-download, on student-paid mobile data.**
The version is derived from row timestamps, so it cannot distinguish a real content edit
from a metadata-only touch. A single unqualified `UPDATE curriculum_topics SET ...`
across all grades is therefore a **fleet-wide re-download of every subject+grade** —
paid for in student mobile data, concentrated in the minutes after the write.

The obvious trigger is a `source_version` backfill, but ANY of these do it: a column
addition with a non-NULL default that rewrites rows, a bulk re-tagging, a
`updated_at`-touching data migration, or a restore that rewrites timestamps.

Rules for any bulk write to `curriculum_topics`:
- **Batch it, don't do it in one statement** — a single transaction touching all grades
  bumps every scope at once and synchronizes the whole fleet into one re-download spike.
- **Scope it as narrowly as the change actually is.** If only grade 8 science changed,
  the `WHERE` clause must say so.
- **If the write is metadata-only and does NOT change what a student reads, do not let
  it touch the timestamp the version reads from** — otherwise the fleet pays real data
  for a no-op edit.
- **Prefer a low-traffic window** (India night, well before the app-start poll peak).
- Chapter-level versioning does **not** mitigate this — it just spreads the same bump
  across more keys.

## Auth / RBAC (recommended for backend's route)

- Called on app-start + learn-session-start by a signed-in student. Gate behind
  `authorizeRequest(request, 'study_plan.view', { requireStudentId: true })` — the same
  permission the sibling `/api/v2/learn/curriculum` and `/api/v2/learn/concept` routes
  use. Not anon.
- Recommended shape: derive the student's `grade` server-side (P5 string), pass the
  plan-gated subject codes (or NULL for all) as `p_subject_codes`, call the RPC via the
  admin client, wrap in the standard `v2Success` envelope. Version numbers are not
  sensitive, so plan-gating the payload is optional (it leaks nothing).

## Error / empty semantics

- Out-of-range/blank grade → `{ as_of, scopes: {} }` (never a 500 — a version poll must
  not break the client).
- No content anywhere for the grade → `{ as_of, scopes: {} }` (NULL codes) or per-code
  `0` (explicit codes).
- The RPC never returns content, PII, or row identifiers — only versions + `as_of`.
