/**
 * SRS quiz-review helpers — Foxy North-Star Phase 0 (F2 + F3 + F4).
 *
 * Single source for the "due quiz-wrong-answer cards" query + selection logic
 * shared by:
 *   - the /quiz?mode=srs deep-link consumer (apps/host quiz page) — CONTENT
 *   - the dashboard SRS lane — COUNT
 * so the lane count and the quiz content can never disagree (F3 short-term
 * fix; full store unification is Phase 3). The COUNT consumer was originally
 * the DailyRhythmQueue component, deleted in the 2026-08 orphan consolidation;
 * the shared-source rule below binds whatever renders the lane next.
 *
 * Also owns:
 *   - the SM-2 quality mapping for auto-grading SRS cards after a quiz
 *     submit (F2). The grade endpoint (/api/learner/review/grade) only
 *     accepts quality ∈ {0, 3, 4, 5} — the exact set QuickRecallSection's
 *     rating buttons expose (packages/ui/src/refresh/QuickRecallSection.tsx).
 *     Correct answers map to 5 (<10s) or 4; wrong answers ALWAYS map to
 *     quality 0 — the only failure value in the endpoint set. SM-2 defines
 *     quality >= 3 as successful recall, so emitting 3 for a wrong answer
 *     would count as a correct review and advance the interval (1→6),
 *     corrupting the schedule for failed cards. Quality 3 stays in the
 *     SrsQuality union because the flashcard UI legitimately sends it; the
 *     auto-mapper just never emits it.
 *   - the batched question→topic→mastery lookup for classifyError (F4).
 *
 * NO SM-2 math lives here (no-duplicate rule): the /api/learner/review/grade
 * endpoint owns ease/interval updates; this module only maps outcomes to a
 * quality and POSTs to the existing endpoint with QuickRecallSection's exact
 * request contract.
 *
 * Client-safe: no supabase-admin import. Callers pass an RLS-scoped client.
 */

import { buildSrsDueQuery, type SrsQueryClient } from './srs-predicate';

/** Minimal structural view of the supabase-js client used here. */
type QueryClient = SrsQueryClient;

export interface SrsDueCard {
  id: string;
  source_id: string | null;
  subject: string | null;
}

/**
 * Due quiz-wrong-answer cards for a student — THE query both the quiz
 * deep-link and the dashboard lane count must use (F3 agreement contract):
 * own active cards, source 'quiz_wrong_answer', a resolvable question_bank
 * source_id, next_review_date <= today, earliest due first, capped at 50.
 *
 * Delegates to buildSrsDueQuery (single source of the predicate; see
 * packages/lib/src/learn/srs-predicate.ts) so the browser/client, RLS
 * server, and cron paths cannot drift apart.
 */
export async function fetchSrsDueQuizCards(
  client: QueryClient,
  studentId: string,
  opts: { subject?: string | null } = {},
): Promise<SrsDueCard[]> {
  const { data } = await buildSrsDueQuery(client, studentId, {
    subject: opts.subject ?? null,
    // Existing behavior: id/source_id/subject projection, capped at 50.
    columns: 'id, source_id, subject',
    limit: 50,
  });
  return (data ?? []) as SrsDueCard[];
}

export interface SrsReviewSet {
  /** Session subject: the URL-provided one, else the earliest-due card's. */
  subject: string | null;
  /** Unique question_bank ids to serve, due order preserved, capped. */
  questionIds: string[];
  /** question_bank id → spaced_repetition_cards id (first card wins). */
  cardIdByQuestionId: Record<string, string>;
}

/**
 * Reduce due cards to the review set a quiz session can serve. A quiz has a
 * single subject — honor the explicit filter when present, else use the
 * earliest-due card's subject. Dedupe source_ids (same question may back
 * multiple cards; first/earliest-due card receives the grade).
 */
export function selectSrsReviewSet(
  cards: SrsDueCard[],
  opts: { subject?: string | null; cap: number },
): SrsReviewSet {
  const subject = opts.subject ?? cards.find((c) => c.subject)?.subject ?? null;
  const questionIds: string[] = [];
  const cardIdByQuestionId: Record<string, string> = {};
  if (!subject) return { subject: null, questionIds, cardIdByQuestionId };
  for (const c of cards) {
    if (c.subject !== subject || !c.source_id) continue;
    if (!(c.source_id in cardIdByQuestionId)) {
      cardIdByQuestionId[c.source_id] = c.id;
      questionIds.push(c.source_id);
    }
    if (questionIds.length >= opts.cap) break;
  }
  return { subject, questionIds, cardIdByQuestionId };
}

/** The only quality values /api/learner/review/grade accepts (zod-pinned). */
export type SrsQuality = 0 | 3 | 4 | 5;

/**
 * Outcome → SM-2 quality (F2). Correct → 4/5 by speed; wrong → ALWAYS 0.
 * SM-2 treats quality >= 3 as successful recall, so 0 is the only failure
 * value in the endpoint's accepted set {0,3,4,5} — the auto-mapper must never
 * emit 3 for a wrong answer (it would advance the interval for a failed card).
 */
export function srsQualityForResponse(isCorrect: boolean, timeSpentSec: number): SrsQuality {
  if (isCorrect) return timeSpentSec < 10 ? 5 : 4;
  return 0;
}

/**
 * Fire-and-forget SM-2 grading of SRS cards after a quiz submit (F2).
 *
 * Request contract copied EXACTLY from QuickRecallSection.rateCard()
 * (packages/ui/src/refresh/QuickRecallSection.tsx:108): POST
 * /api/learner/review/grade, JSON `{ cardId, quality }`, same-origin
 * credentials. The endpoint owns the SM-2 math — never re-implement it here.
 *
 * Never throws and never awaited by callers — quiz submit latency is
 * unaffected. Each card is graded at most once per invocation (responses are
 * already one-per-question upstream).
 */
export function gradeSrsCardsFireAndForget(params: {
  cardIdByQuestionId: Record<string, string>;
  responses: Array<{ question_id: string; is_correct: boolean; time_spent: number }>;
  fetchImpl?: typeof fetch;
}): void {
  const doFetch = params.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return;
  const graded = new Set<string>();
  for (const r of params.responses) {
    const cardId = params.cardIdByQuestionId[r.question_id];
    if (!cardId || graded.has(cardId)) continue;
    graded.add(cardId);
    const quality = srsQualityForResponse(r.is_correct === true, r.time_spent ?? 0);
    try {
      void doFetch('/api/learner/review/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cardId, quality }),
      }).catch(() => {
        /* fire-and-forget: the card simply stays due */
      });
    } catch {
      /* fire-and-forget */
    }
  }
}

/**
 * Batched question → topic → mastery lookup (F4). One question_bank read
 * (id → topic_id) + one concept_mastery read (topic_id → mastery_probability),
 * both via the caller's RLS-scoped client. Returns question_id → mastery for
 * questions whose topic HAS a concept_mastery row; callers apply the explicit
 * 0.5 fallback for absent entries (topic never practiced / no topic_id).
 *
 * Best-effort: any failure returns {} so classifyError degrades to the same
 * 0.5 default it hardcoded before — never blocks quiz start.
 */
export async function fetchTopicMasteryByQuestionId(
  client: QueryClient,
  studentId: string,
  questionIds: string[],
): Promise<Record<string, number>> {
  try {
    const uniqueIds = Array.from(new Set(questionIds.filter(Boolean)));
    if (uniqueIds.length === 0) return {};

    const { data: qbRows } = await client
      .from('question_bank')
      .select('id, topic_id')
      .in('id', uniqueIds);
    const topicByQid: Record<string, string> = {};
    for (const row of (qbRows ?? []) as Array<{ id: string; topic_id: string | null }>) {
      if (row.topic_id) topicByQid[row.id] = row.topic_id;
    }
    const topicIds = Array.from(new Set(Object.values(topicByQid)));
    if (topicIds.length === 0) return {};

    const { data: cmRows } = await client
      .from('concept_mastery')
      .select('topic_id, mastery_probability')
      .eq('student_id', studentId)
      .in('topic_id', topicIds);
    const masteryByTopic: Record<string, number> = {};
    for (const row of (cmRows ?? []) as Array<{ topic_id: string; mastery_probability: unknown }>) {
      const m = Number(row.mastery_probability);
      if (Number.isFinite(m)) masteryByTopic[row.topic_id] = m;
    }

    const out: Record<string, number> = {};
    for (const [qid, topicId] of Object.entries(topicByQid)) {
      if (topicId in masteryByTopic) out[qid] = masteryByTopic[topicId];
    }
    return out;
  } catch {
    return {};
  }
}
