-- A2: single chapter taxonomy read model.
--
-- chapters (551 rows), curriculum_topics (542 rows), and cbse_syllabus (1148
-- rows) each independently enumerate the same CBSE chapter list and are read
-- inconsistently across the app. This view unifies them into one read model.
--
-- Base table is `chapters`, not `curriculum_topics` — despite its name,
-- curriculum_topics is chapter-grained (verified: every (subject_id, grade,
-- chapter_number) group has exactly 1 row, never more), and it is missing 9
-- chapters that exist in `chapters` (5 subject/grade combinations, all
-- is_active = true there). Basing the view on chapters closes that gap.
--
-- Title prefers curriculum_topics.title over chapters.title where both
-- exist: 18 of 542 matched chapters disagree, all in Grade 7 Social
-- Studies, where chapters.title collapses several distinct chapters into
-- one repeated umbrella name (one instance is also garbled — "Tapestry O F
-- T H E Past") while curriculum_topics.title gives each its correct,
-- distinct name. For the 9 chapters-only rows there is no curriculum_topics
-- title to prefer, so chapters.title is used.
--
-- security_invoker ensures RLS on the underlying tables is evaluated for
-- the querying role rather than the view owner.
create or replace view public.curriculum_chapters_v
with (security_invoker = true) as
select
  coalesce(ct.id, ch.id) as id,
  ch.id as chapter_id,
  ct.id as topic_id,
  ch.subject_id,
  ch.subject_code,
  ch.grade,
  ch.chapter_number,
  coalesce(ct.title, ch.title) as title,
  coalesce(ct.title_hi, ch.title_hi) as title_hi,
  coalesce(ct.display_order, ch.display_order) as display_order,
  ch.is_active,
  ch.ncert_page_start,
  ch.ncert_page_end,
  cs.chunk_count,
  cs.is_in_scope,
  cs.rag_status
from public.chapters ch
left join public.curriculum_topics ct
  on ct.subject_id = ch.subject_id
  and ct.grade = ch.grade
  and ct.chapter_number = ch.chapter_number
left join public.cbse_syllabus cs
  on cs.subject_code = ch.subject_code
  and cs.grade = ch.grade
  and cs.chapter_number = ch.chapter_number;

comment on view public.curriculum_chapters_v is
  'Unified chapter read model over chapters (base) + curriculum_topics (title/display_order enrichment) + cbse_syllabus (RAG readiness). id = curriculum_topics.id where a matching topic row exists (preserves existing FK identity used by concept_mastery, concept_edges, and traverse_prerequisites), falling back to chapters.id only for the 9 chapters with no curriculum_topics row. See migration for full rationale.';
