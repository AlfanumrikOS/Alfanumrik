/**
 * /api/foxy — M5 extracted cognitive-context + learner-state loaders.
 *
 * H1 REFACTOR Step 5 (behavior-preserving). These functions were lifted
 * verbatim out of `src/app/api/foxy/route.ts`. They read the learner's
 * cognitive state via service-role Supabase I/O on the CME tables
 * (concept_mastery, knowledge_gaps, cme_error_log, student_skill_state,
 * quiz_responses ↔ question_misconceptions, wrong_answer_remediations), the
 * digital-twin snapshot/memory tables (learner_twin_snapshots /
 * learner_twin_memory), and the chapter topic-progression tables
 * (subjects / chapters / curriculum_topics). The route imports them and uses
 * them identically at the same call sites — zero behavior change.
 *
 * The query shapes, filters, fallback/empty handling, and the returned
 * `CognitiveContext` / `ChapterTopicProgress` / `TwinContext` assembly are
 * byte-identical to the originals (pinned by the route characterization tests
 * plus the cognitive / cold-start / lead-concept / progression tests), with
 * two deliberate post-extraction fixes: (a) the overdue-review query reads the
 * real SM-2 column `next_review_at` (timestamptz) instead of the ghost
 * `next_review_date` DATE column, and (b) `nextAction` is derived locally via
 * the pure `deriveNextAction` ladder instead of the retired cme-engine
 * `get_next_action` network call (which 401'd on every request).
 *
 * Shared types/values live in their existing homes: `CognitiveContext` +
 * `EMPTY_COGNITIVE_CONTEXT` come from `./constants` (M1); the digital-twin
 * builder + types come from `@/lib/learn/build-twin-context`; chapter parsing
 * comes from `@/lib/foxy/chapter-parser`; the pending-expectation type comes
 * from `@/lib/learn/foxy-expectations` — this module imports rather than
 * redefines.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseFoxyChapterNumber } from '@/lib/foxy/chapter-parser';
import type { OpenExpectation } from '@/lib/learn/foxy-expectations';
import {
  buildTwinContext,
  type TwinContext,
  type TwinMemoryHighlightInput,
  type TwinSnapshotInput,
} from '@/lib/learn/build-twin-context';
import { type CognitiveContext, EMPTY_COGNITIVE_CONTEXT } from './constants';

// ─── Phase 3 helper: classify lifecycle outcome of a prior open expectation ──

// Acknowledgment signals — Foxy explicitly accepted/closed the answer.
// English + Hinglish forms; Devanagari handled via Hindi keywords below.
const FOXY_ACK_PATTERNS: RegExp[] = [
  /\b(correct|right answer|exactly right|exactly|well done|good job|good work|nicely done|nice work|spot on|perfect)\b/i,
  /\b(bilkul sahi|bilkul|sahi|shabash|wah|ekdum sahi)\b/i,
  /\b(that's it|that is it|you got it|you've got it|you nailed it)\b/i,
  /\b(close|almost|not quite|partly right|partially correct|good try|nice try)\b/i,
  /\b(actually|the answer is|in fact)\b.{0,80}\b(is|are|equals?)\b/i,
];

const HINDI_ACK_RE = /(सही|बिल्कुल|शाबाश|बहुत बढ़िया|वाह)/;

/**
 * Classify what happened to a prior open expectation after Foxy's next reply.
 *   - 'answered'   → Foxy explicitly acknowledged / addressed the answer
 *   - 'abandoned'  → Foxy moved on with a new question and no acknowledgment
 *   - 'unresolved' → ambiguous; leave OPEN so we re-inject next turn
 *
 * Heuristic by design — we accept some misclassification because the safety
 * net is the 24h expires_at sweep. Tracked as `expectation_abandoned_rate`
 * for future tuning.
 */
// Progression expectation kinds whose ladder anchor must SURVIVE an ack-only
// reply (Part 2C). For 'choose_topic'/'next_topic' an acknowledgment alone
// ("Correct! / Bilkul sahi!") must NOT close the anchor — the student hasn't
// actually picked/engaged the next ladder step, so we keep the row OPEN
// ('unresolved') and re-inject it next turn. Other kinds keep the legacy
// ack → 'answered' behaviour.
const PROGRESSION_LIFECYCLE_KINDS = new Set<OpenExpectation['kind']>([
  'choose_topic',
  'next_topic',
]);

export function classifyExpectationLifecycle(
  assistantReply: string,
  prior: OpenExpectation,
): 'answered' | 'abandoned' | 'unresolved' {
  const text = (assistantReply ?? '').trim();
  if (!text) return 'unresolved';

  const ack = FOXY_ACK_PATTERNS.some((re) => re.test(text)) || HINDI_ACK_RE.test(text);

  // Did Foxy ask a new question? "-> " marker is the strongest signal.
  // Any `?` in the reply is a weaker signal.
  const hasArrowPrompt = /^->\s+/m.test(text);
  const hasAnyQuestion = text.includes('?');

  // Progression ladder anchors (choose_topic / next_topic): an ack-only reply
  // does NOT close the ladder. Keep it OPEN ('unresolved') so the next turn
  // re-anchors and the chapter progression is never silently dropped.
  if (PROGRESSION_LIFECYCLE_KINDS.has(prior.kind)) {
    return 'unresolved';
  }

  if (ack) {
    // Acknowledged: counts as answered even if a new question follows.
    return 'answered';
  }
  if (hasArrowPrompt || hasAnyQuestion) {
    // New question without acknowledgment → Foxy moved on.
    return 'abandoned';
  }
  // No acknowledgment, no new question. Could be a clarifying statement
  // mid-thread — leave open.
  return 'unresolved';
}

// ─── CME next-action priority ladder (local, pure) ──────────────────────────
//
// Replaces the retired network call to the cme-engine Edge Function
// `get_next_action` (which authenticated with a service-role key against a
// user-JWT `auth.getUser()` check → 401 on every call, silently swallowed, so
// nextAction was ALWAYS null; it also read `cme_concept_state`, a table with
// no remaining writer). Derives the same recommendation locally from data
// loadCognitiveContext already loads, mirroring cme-engine's documented
// 5-priority order (supabase/functions/cme-engine/index.ts selectNextAction):
//   (1) prerequisite / knowledge gap      → 'remediate'
//   (2) forgetting risk (overdue review)  → 'revise'
//   (3) repeated conceptual errors (>=3)  → 're_teach'
//   (4) next unmastered concept           → 'practice' / 'challenge'
//   (5) nothing actionable                → null (the prompt's cold-start /
//       consolidation rails handle the no-signal case — exam-prep default)
//
// Pure over already-loaded data — no I/O. Output shape is exactly
// CognitiveContext['nextAction'] so route.ts (cme_action_log insert,
// foxy_sessions.last_cme_action, audit details) and prompt-sections.ts
// (selectLeadConcept step 3, RECOMMENDED ACTION block) need no changes.

export interface NextActionInputs {
  /** Unresolved knowledge gaps (loadCognitiveContext shape). */
  knowledgeGaps: Array<{ target: string; prerequisite: string; gapType: string }>;
  /** Overdue reviews (next_review_at <= now); mastery is the 0-100 integer. */
  revisionDue: Array<{ title: string; lastReviewed: string; mastery: number }>;
  /** 30d cme_error_log counts by error_type. */
  recentErrors: Array<{ errorType: string; count: number }>;
  /** Subject-filtered concept_mastery rows: title + raw mastery_probability (0-1). */
  masteryTopics: Array<{ title: string; masteryProbability: number }>;
}

// Mirrors cme-engine selectNextAction cutoffs: >=3 conceptual errors triggers
// re-teach; mastery_mean < 0.6 → practice; < 0.85 → challenge; >= 0.85 mastered.
const RETEACH_CONCEPTUAL_ERROR_MIN = 3;
const NEXT_CONCEPT_PRACTICE_THRESHOLD = 0.6;
const NEXT_CONCEPT_MASTERED_THRESHOLD = 0.85;

export function deriveNextAction(
  input: NextActionInputs,
): { actionType: string; conceptName: string; reason: string } | null {
  // (1) Prerequisite / knowledge gap — remediate the prerequisite when named,
  // else the gap's target concept.
  const gap = input.knowledgeGaps.find(
    (g) => ((g.prerequisite || g.target) ?? '').trim().length > 0,
  );
  if (gap) {
    return {
      actionType: 'remediate',
      conceptName: (gap.prerequisite || gap.target).trim(),
      reason: 'Prerequisite gap needs remediation before advancing',
    };
  }

  // (2) Forgetting risk — overdue review, weakest mastery first; tie-break on
  // oldest next_review_at (ISO strings compare lexicographically).
  const overdue = [...input.revisionDue]
    .filter((r) => r.title.trim().length > 0)
    .sort((a, b) => a.mastery - b.mastery || a.lastReviewed.localeCompare(b.lastReviewed))[0];
  if (overdue) {
    return {
      actionType: 'revise',
      conceptName: overdue.title,
      reason: 'Previously learned concept fading — revision needed',
    };
  }

  // Unmastered concepts, lowest mastery first (defensive sort — callers pass
  // rows already ordered ascending by mastery_probability).
  const unmastered = input.masteryTopics
    .filter(
      (t) => t.title.trim().length > 0 && t.masteryProbability < NEXT_CONCEPT_MASTERED_THRESHOLD,
    )
    .sort((a, b) => a.masteryProbability - b.masteryProbability);

  // (3) Repeated conceptual errors → re-teach the weakest known concept.
  const conceptual = input.recentErrors.find((e) => e.errorType === 'conceptual');
  if (conceptual && conceptual.count >= RETEACH_CONCEPTUAL_ERROR_MIN && unmastered.length > 0) {
    return {
      actionType: 're_teach',
      conceptName: unmastered[0].title,
      reason: 'Repeated conceptual errors — needs a different explanation approach',
    };
  }

  // (4) Next unmastered concept — lowest mastery_probability below threshold.
  if (unmastered.length > 0) {
    const next = unmastered[0];
    return next.masteryProbability < NEXT_CONCEPT_PRACTICE_THRESHOLD
      ? {
          actionType: 'practice',
          conceptName: next.title,
          reason: 'Partially learned — needs more practice',
        }
      : {
          actionType: 'challenge',
          conceptName: next.title,
          reason: 'Approaching mastery — increasing difficulty',
        };
  }

  // (5) No actionable signal → null (exam-prep / cold-start rails apply).
  return null;
}

// ─── Helper: load cognitive context from CME tables ─────────────────────────

export async function loadCognitiveContext(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null = null,
): Promise<CognitiveContext> {
  void grade; // reserved for future grade-scoped mastery lookups
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;

    // Resolve chapter id when caller passed a chapter (number or title) so we
    // can scope the per-LO skill query down to that chapter; otherwise fall
    // back to the subject-wide weakest LOs.
    let chapterId: string | null = null;
    if (chapter && subjectId) {
      try {
        const chapterNum = parseFoxyChapterNumber(chapter);
        let chQuery = supabaseAdmin
          .from('chapters')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('grade', grade);
        if (chapterNum !== null) {
          chQuery = chQuery.eq('chapter_number', chapterNum);
        } else {
          chQuery = chQuery.ilike('title', chapter);
        }
        const { data: chRow } = await chQuery.limit(1).maybeSingle();
        chapterId = chRow?.id ?? null;
      } catch {
        // Non-fatal — fall back to subject-wide LO scope.
      }
    }

    const [masteryRes, gapsRes, revisionRes, errorsRes, loSkillsRes, misconceptionsRes] = await Promise.all([
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, mastery_level, attempts, topic_id, curriculum_topics(title, subject_id)')
        .eq('student_id', studentId)
        .order('mastery_probability', { ascending: true })
        .limit(30),

      supabaseAdmin
        .from('knowledge_gaps')
        .select('topic_id, prerequisite_topic_id, gap_type, is_resolved, description, curriculum_topics!knowledge_gaps_topic_id_fkey(title), prereq:curriculum_topics!knowledge_gaps_prerequisite_topic_id_fkey(title)')
        .eq('student_id', studentId)
        .eq('is_resolved', false)
        .limit(5),

      // Overdue reviews: use next_review_at (timestamptz — the column the real
      // SM-2 scheduler writes), NOT next_review_date (a ghost DATE column with
      // a CURRENT_DATE + 1 default that nothing updates).
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, next_review_at, topic_id, curriculum_topics(title)')
        .eq('student_id', studentId)
        .not('next_review_at', 'is', null)
        .lte('next_review_at', new Date().toISOString())
        .order('next_review_at', { ascending: true })
        .limit(5),

      supabaseAdmin
        .from('cme_error_log')
        .select('error_type')
        .eq('student_id', studentId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // Phase 2: per-LO BKT skill state (top 10 weakest by p_know). Joined to
      // learning_objectives so we can render the LO statement + chapter scope.
      // chapter_id filter is applied client-side after the join because the
      // PostgREST !inner join requires the filter on the joined alias.
      (() => {
        let q = supabaseAdmin
          .from('student_skill_state')
          .select('p_know, p_slip, theta, learning_objectives!inner(code, statement, chapter_id, chapters!inner(subject_id))')
          .eq('student_id', studentId)
          .order('p_know', { ascending: true })
          .limit(50);
        if (chapterId) {
          q = q.eq('learning_objectives.chapter_id', chapterId);
        } else if (subjectId) {
          q = q.eq('learning_objectives.chapters.subject_id', subjectId);
        }
        return q;
      })(),

      // Phase 2: recent (30d) wrong-answer misconceptions for this student.
      // Join quiz_responses → question_misconceptions on
      // (question_id, distractor_index = selected_option). Filter is_correct=false.
      // We pull both the misconception code/label and the remediation text
      // from the wrong_answer_remediations cache (best-effort).
      supabaseAdmin
        .from('quiz_responses')
        .select('question_id, selected_option, is_correct, created_at, question_misconceptions!inner(misconception_code, misconception_label, distractor_index, remediation_chunk_id)')
        .eq('student_id', studentId)
        .eq('is_correct', false)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(200),
    ]);

    const subjectMastery = (masteryRes.data ?? []).filter((m: any) => {
      if (!subjectId) return true;
      return m.curriculum_topics?.subject_id === subjectId;
    });

    const weakTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) < 0.6)
      .slice(0, 5)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
        attempts: m.attempts ?? 0,
      }));

    const strongTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) >= 0.8)
      .slice(-3)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
      }));

    const knowledgeGaps = (gapsRes.data ?? []).map((g: any) => ({
      target: g.curriculum_topics?.title ?? g.description ?? '',
      prerequisite: g.prereq?.title ?? '',
      gapType: g.gap_type ?? '',
    }));

    const revisionDue = (revisionRes.data ?? []).map((r: any) => ({
      title: r.curriculum_topics?.title ?? 'Unknown',
      lastReviewed: r.next_review_at ?? '',
      mastery: Math.round((r.mastery_probability ?? 0) * 100),
    }));

    const errorCounts: Record<string, number> = {};
    for (const e of errorsRes.data ?? []) {
      errorCounts[e.error_type] = (errorCounts[e.error_type] || 0) + 1;
    }
    const recentErrors = Object.entries(errorCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    // Phase 2: Process per-LO skill state — keep at most 10 weakest LOs.
    // The PostgREST !inner join filter on chapters.subject_id may not narrow
    // perfectly when chapterId is null (PostgREST sometimes ignores nested
    // filters silently); we double-filter client-side as a defense.
    // PostgREST returns nested joins as either an object (when the FK is
    // unique) or an array (when ambiguous). We normalize both shapes.
    type LoSkillRow = {
      p_know: number | string | null;
      p_slip: number | string | null;
      theta: number | string | null;
      learning_objectives:
        | {
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }
        | Array<{
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }>
        | null;
    };
    const loSkillsRaw = (loSkillsRes.data ?? []) as unknown as LoSkillRow[];
    const loSkills = loSkillsRaw
      .map((row) => {
        const lo = Array.isArray(row.learning_objectives)
          ? row.learning_objectives[0]
          : row.learning_objectives;
        if (!lo) return null;
        const chap = Array.isArray(lo.chapters) ? lo.chapters[0] : lo.chapters;
        return {
          row,
          loCode: lo.code,
          loStatement: lo.statement,
          chapterIdForRow: lo.chapter_id,
          subjectIdForRow: chap?.subject_id ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .filter((entry) => {
        if (chapterId) return entry.chapterIdForRow === chapterId;
        if (subjectId) return entry.subjectIdForRow === subjectId;
        return true;
      })
      .slice(0, 10)
      .map((entry) => ({
        loCode: entry.loCode,
        loStatement: entry.loStatement,
        pKnow: Number(entry.row.p_know ?? 0),
        pSlip: Number(entry.row.p_slip ?? 0),
        theta: Number(entry.row.theta ?? 0),
      }));

    // Phase 2: Process recent misconceptions — keep ones where the student's
    // selected_option matches the curated distractor_index, group by code,
    // count occurrences, take top 3, then enrich with cached remediation text.
    type MisconceptionJoinRow = {
      question_id: string;
      selected_option: number | null;
      question_misconceptions:
        | {
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }
        | Array<{
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }>
        | null;
    };
    const misconceptionRaw = (misconceptionsRes.data ?? []) as unknown as MisconceptionJoinRow[];
    const misconceptionAgg: Record<string, { code: string; label: string; count: number; questionIds: Set<string> }> = {};
    for (const row of misconceptionRaw) {
      const qm = Array.isArray(row.question_misconceptions)
        ? row.question_misconceptions
        : (row.question_misconceptions ? [row.question_misconceptions] : []);
      for (const m of qm) {
        if (m.distractor_index !== row.selected_option) continue;
        if (!misconceptionAgg[m.misconception_code]) {
          misconceptionAgg[m.misconception_code] = {
            code: m.misconception_code,
            label: m.misconception_label,
            count: 0,
            questionIds: new Set<string>(),
          };
        }
        misconceptionAgg[m.misconception_code].count += 1;
        misconceptionAgg[m.misconception_code].questionIds.add(row.question_id);
      }
    }
    const topMisconceptions = Object.values(misconceptionAgg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Enrich with remediation text. Best-effort lookup against the
    // wrong_answer_remediations cache for the question_ids that produced each
    // misconception. If no cached remediation exists, leave the field empty
    // (the prompt template handles empty gracefully).
    const recentMisconceptions: CognitiveContext['recentMisconceptions'] = [];
    for (const m of topMisconceptions) {
      let remediationText = '';
      try {
        const qIds = Array.from(m.questionIds);
        if (qIds.length > 0) {
          const { data: remRows } = await supabaseAdmin
            .from('wrong_answer_remediations')
            .select('remediation_text')
            .in('question_id', qIds)
            .limit(1);
          remediationText = remRows?.[0]?.remediation_text ?? '';
        }
      } catch {
        // non-fatal — empty remediation is acceptable
      }
      recentMisconceptions.push({
        code: m.code,
        label: m.label,
        count: m.count,
        remediationText: remediationText.slice(0, 200),
      });
    }

    // P13: do not log misconception code/label paired with student_id. Only
    // log a redacted preview (counts only, no codes/labels) for ops.
    if (recentMisconceptions.length > 0) {
      logger.info('foxy_misconception_context_loaded', {
        // intentionally NO studentId in this log line
        misconceptionCount: recentMisconceptions.length,
        topCount: recentMisconceptions[0]?.count ?? 0,
      });
    }

    const avgMastery = subjectMastery.length > 0
      ? subjectMastery.reduce((s: number, m: any) => s + (m.mastery_probability ?? 0), 0) / subjectMastery.length
      : 0.5;
    const masteryLevel: CognitiveContext['masteryLevel'] =
      avgMastery < 0.4 ? 'low' : avgMastery < 0.7 ? 'medium' : 'high';

    // CME next-action — derived locally from the signals loaded above (see
    // deriveNextAction). No network call: the old cme-engine `get_next_action`
    // fetch 401'd on every request (service-role key vs user-JWT auth) and read
    // the writer-less cme_concept_state table. Fail-soft: any error leaves
    // nextAction null and Foxy works without a recommendation.
    let nextAction: CognitiveContext['nextAction'] = null;
    try {
      nextAction = deriveNextAction({
        knowledgeGaps,
        revisionDue,
        recentErrors,
        masteryTopics: subjectMastery.map((m: any) => ({
          title: m.curriculum_topics?.title ?? '',
          masteryProbability: m.mastery_probability ?? 0,
        })),
      });
    } catch {
      // non-fatal — Foxy still works without next-action
    }

    return {
      weakTopics,
      strongTopics,
      knowledgeGaps,
      revisionDue,
      recentErrors,
      nextAction,
      masteryLevel,
      loSkills,
      recentMisconceptions,
    };
  } catch (err) {
    logger.warn('foxy_cognitive_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return EMPTY_COGNITIVE_CONTEXT;
  }
}

// ─── Helper: load digital-twin context (Slice 1, flag-gated) ─────────────────
//
// Reads the student's most-recent learner_twin_snapshots row plus the most
// recent learner_twin_memory highlights and folds them into a compact, PII-free
// TwinContext (see src/lib/learn/build-twin-context.ts). CALLED ONLY when
// ff_digital_twin_v1 is ON — when OFF the route never invokes this, so there is
// no extra DB round-trip and behavior is byte-identical to today.
//
// Best-effort: any failure returns null so Foxy continues exactly as before.
// P13: selects IDs + numbers + enum codes only; never names / emails / phones.
export async function loadTwinContextForFoxy(studentId: string): Promise<TwinContext | null> {
  try {
    const { data: snapRow } = await supabaseAdmin
      .from('learner_twin_snapshots')
      .select(
        'snapshot_date, mastery_by_topic, decay_state, dominant_error_types, misconception_cluster_ids, cohort_percentile',
      )
      .eq('student_id', studentId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapRow) return null;

    let highlights: TwinMemoryHighlightInput[] = [];
    try {
      const { data: memRows } = await supabaseAdmin
        .from('learner_twin_memory')
        .select('summary_code, concept_topic_id, misconception_id')
        .eq('student_id', studentId)
        .order('occurred_at', { ascending: false })
        .limit(10);
      highlights = (memRows ?? []) as TwinMemoryHighlightInput[];
    } catch {
      // Non-fatal — snapshot alone is enough to build context.
    }

    return buildTwinContext(snapRow as TwinSnapshotInput, highlights);
  } catch (err) {
    logger.warn('foxy_twin_snapshot_load_failed', {
      // P13: no studentId at warn-level here.
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Helper: chapter topic-progression context (Part 2B) ─────────────────────
//
// Computes the chapter's ORDERED topic list + the student's position + the
// next unmastered topic, so Foxy can lead the student topic-to-topic instead
// of guessing. Reuses curriculum_topics (display_order) + concept_mastery —
// the same tables loadCognitiveContext already touches. Server-side
// (supabaseAdmin) twin of getChapterTopics/getNextTopics (which are RLS
// client-side); we query directly so this works on the service-role path.
//
// Best-effort: any failure returns an empty progression (all-null) so the
// prompt section is empty and Foxy behaves exactly as before. NEVER fabricates
// a next topic — `nextTopic` is null unless a real unmastered ordered topic
// exists.
export interface ChapterTopicProgress {
  /** Ordered topic titles for (subject, grade, chapter) by display_order. */
  orderedTopics: string[];
  /** The topic the student is currently on (highest-ordered with any mastery), or null. */
  currentTopic: string | null;
  /** The next unmastered ordered topic (the ladder target), or null. */
  nextTopic: string | null;
  /** curriculum_topics.id of nextTopic when known (for expectation meta). */
  nextTopicId: string | null;
}

export const EMPTY_TOPIC_PROGRESS: ChapterTopicProgress = {
  orderedTopics: [],
  currentTopic: null,
  nextTopic: null,
  nextTopicId: null,
};

// Mastery threshold above which a topic counts as "mastered" for the purpose
// of advancing the ladder. Mirrors the 0.6 weak/strong cut used throughout
// loadCognitiveContext so the progression view is consistent with the rest of
// the cognitive context.
const TOPIC_MASTERED_THRESHOLD = 0.6;

export async function loadChapterTopicProgress(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null,
): Promise<ChapterTopicProgress> {
  // No chapter → no ordered ladder to compute.
  if (!chapter) return EMPTY_TOPIC_PROGRESS;
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;
    if (!subjectId) return EMPTY_TOPIC_PROGRESS;

    const chapterNum = parseFoxyChapterNumber(chapter);

    // Ordered topics for this chapter. curriculum_topics.grade is stored
    // without a "Grade " prefix (see loadCognitiveContext); normalise.
    let topicsQuery = supabaseAdmin
      .from('curriculum_topics')
      .select('id, title, display_order')
      .eq('subject_id', subjectId)
      .eq('grade', grade)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(50);
    if (chapterNum !== null) {
      topicsQuery = topicsQuery.eq('chapter_number', chapterNum);
    }
    const { data: topicRows } = await topicsQuery;
    const topics = (topicRows ?? []) as Array<{
      id: string;
      title: string;
      display_order: number | null;
    }>;
    if (topics.length === 0) return EMPTY_TOPIC_PROGRESS;

    // Mastery for these topic ids (per-topic mastery_probability).
    const topicIds = topics.map((t) => t.id);
    const masteryByTopic = new Map<string, number>();
    try {
      const { data: masteryRows } = await supabaseAdmin
        .from('concept_mastery')
        .select('topic_id, mastery_probability')
        .eq('student_id', studentId)
        .in('topic_id', topicIds);
      for (const m of (masteryRows ?? []) as Array<{
        topic_id: string;
        mastery_probability: number | null;
      }>) {
        masteryByTopic.set(m.topic_id, m.mastery_probability ?? 0);
      }
    } catch {
      // Non-fatal — treat all topics as unmastered if mastery read fails.
    }

    const orderedTopics = topics.map((t) => t.title);

    // currentTopic = the LAST ordered topic the student has touched (any
    // mastery row), so Foxy knows where they are. nextTopic = the FIRST ordered
    // topic that is not yet mastered (>= threshold). Never fabricated.
    let currentTopic: string | null = null;
    let nextTopic: string | null = null;
    let nextTopicId: string | null = null;
    for (const t of topics) {
      const mastery = masteryByTopic.get(t.id);
      if (mastery !== undefined) currentTopic = t.title;
      if (nextTopic === null && (mastery ?? 0) < TOPIC_MASTERED_THRESHOLD) {
        nextTopic = t.title;
        nextTopicId = t.id;
      }
    }

    return { orderedTopics, currentTopic, nextTopic, nextTopicId };
  } catch (err) {
    logger.warn('foxy_topic_progress_failed', {
      error: err instanceof Error ? err.message : String(err),
      // P13: no studentId at warn level beyond the existing convention.
      subject,
    });
    return EMPTY_TOPIC_PROGRESS;
  }
}

/**
 * Render the chapter topic-progression prompt section (Part 2B). Empty string
 * when there's no ordered ladder (template-safe). Injects:
 *   "Topics in this chapter (in order): A; B; C. The student is on X.
 *    The next topic to teach is Y."
 * NEVER invents a next topic — when nextTopic is null we say the chapter is
 * complete rather than guessing.
 */
export function buildTopicProgressSection(p: ChapterTopicProgress): string {
  if (p.orderedTopics.length === 0) return '';
  const lines: string[] = [
    '=== CHAPTER PROGRESSION (lead the student topic-to-topic, in order) ===',
    `Topics in this chapter (in order): ${p.orderedTopics.join('; ')}.`,
  ];
  if (p.currentTopic) {
    lines.push(`The student is currently on: ${p.currentTopic}.`);
  }
  if (p.nextTopic) {
    lines.push(
      `The NEXT topic to teach is: ${p.nextTopic}. When the student shows understanding of the current topic, proactively advance to "${p.nextTopic}" and end with ONE Socratic check question on it — do NOT ask a yes/no "shall we move on?"; advance by teaching plus a thinking question.`,
    );
  } else {
    lines.push(
      'The student has worked through all listed topics in this chapter — consolidate, then suggest the next chapter or a mixed review. Do NOT invent a new topic that is not in the list above.',
    );
  }
  return lines.join('\n');
}
