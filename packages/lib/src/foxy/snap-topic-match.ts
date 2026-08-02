/**
 * snap-topic-match — REAL, deterministic topic-matching heuristic for screen
 * 10 "Snap a doubt" (`/foxy/snap`, `ff_foxy_snap_v1`).
 *
 * This is the ONLY piece of "detection" in the Snap a doubt flow that is not a
 * placeholder. Given a block of already-extracted question text (typed by the
 * student today — see SnapDoubt.tsx for what's real vs placeholder) and the
 * list of `curriculum_topics` the student is actually enrolled in, it scores
 * each topic by word overlap against the topic's own title and returns the
 * single best match above a confidence floor, or `null` if nothing clears it.
 *
 * Pure, synchronous, no I/O — easy to unit test and safe to run on every
 * keystroke/selection without a network round trip. The topic list itself
 * comes from the shared, RLS/plan-gated `GET /api/v2/learn/curriculum` route
 * (which internally reads `apps/host/src/lib/curriculum/cached-taxonomy.ts` —
 * see `use-snap-curriculum-topics.ts` for the fetch). No new query was
 * invented for this screen; this module only scores what that route returns.
 *
 * NOT a scoring/XP/mastery mechanism (P1/P2 do not apply) — it only decides
 * which `/foxy?...` deep link to construct. If a future reviewer wants a
 * stronger match (embeddings, RAG), that is an assessment/ai-engineer call;
 * this heuristic is intentionally simple and fully deterministic so it never
 * needs a model call just to route a "Explain / Steps / Hint" button.
 */

export interface SnapCurriculumTopic {
  id: string;
  title: string;
  titleHi: string | null;
  chapterNumber: number | null;
  subjectCode: string;
  subjectName: string;
}

export interface SnapTopicMatch {
  topic: SnapCurriculumTopic;
  /** 0..1 — fraction of the topic title's own significant words found in the question text. */
  confidence: number;
}

// A match must cover at least this fraction of the topic title's own
// significant words to be surfaced. Below this, "no confident match" is more
// honest than guessing.
export const SNAP_MATCH_CONFIDENCE_FLOOR = 0.34;

// Small, generic stopword list — just enough to stop "find", "what", "the",
// "of" etc. from inflating overlap counts. Not a linguistic NLP pass.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'is', 'are', 'was',
  'were', 'with', 'find', 'what', 'how', 'solve', 'calculate', 'define',
  'explain', 'give', 'value', 'if', 'this', 'that', 'these', 'those', 'by',
  'from', 'at', 'as', 'it', 'its', 'be', 'or', 'so', 'than', 'then',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Best topic match for `text` among `topics`, or `null` when either the text
 * has no significant tokens or nothing clears `SNAP_MATCH_CONFIDENCE_FLOOR`.
 */
export function matchTopicFromText(
  text: string,
  topics: SnapCurriculumTopic[],
): SnapTopicMatch | null {
  const questionTokens = new Set(tokenize(text));
  if (questionTokens.size === 0) return null;

  let best: SnapTopicMatch | null = null;
  for (const topic of topics) {
    if (!topic.title) continue;
    const topicTokens = tokenize(topic.title);
    if (topicTokens.length === 0) continue;

    const overlap = topicTokens.filter((t) => questionTokens.has(t)).length;
    if (overlap === 0) continue;

    const confidence = Math.min(1, overlap / topicTokens.length);
    if (!best || confidence > best.confidence) {
      best = { topic, confidence };
    }
  }

  if (!best || best.confidence < SNAP_MATCH_CONFIDENCE_FLOOR) return null;
  return best;
}
