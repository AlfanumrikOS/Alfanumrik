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
for the proof). Granularity is subject+grade (the client's minimum). A subject+grade
bump invalidates all of that subject+grade's `chapters_*`, `topics_*`, `topic_*` cache
entries. Chapter/topic-level versioning is a documented future extension (add
`chapter_number` to the aggregation + watermark key) — not shipped, because the current
client cache keys `topics_<chapterId>`/`topic_<topicId>` are keyed by row UUID, not
chapter number, so finer versions are not yet consumable.

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
