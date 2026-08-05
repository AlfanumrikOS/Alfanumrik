/**
 * Alfanumrik — Transfer-evidence detection (Foxy North-Star Phase 3, D12).
 *
 * PURE module — no I/O. Callers (the daily-cron transfer step, backend
 * parallel) load yesterday's correct responses grouped by topic, the
 * `concept_edges` rows with edge_type='transfer', and the student's
 * concept_mastery for the SOURCE side of those edges, then hand everything
 * to `detectTransferEvidence()`.
 *
 * Pedagogy rule (assessment-owned): a correct answer on topic T counts as
 * TRANSFER evidence when there is a transfer edge F → T and the student's
 * mastery on the SOURCE topic F is already solid
 * (mastery_probability ≥ TRANSFER_SOURCE_MASTERY_MIN = 0.7 — the same 0.7
 * "solid" threshold used across the facade; below that, a correct answer on
 * T is more plausibly independent learning than transfer, so we stay quiet).
 * Emitted records are EVIDENCE ONLY — they never write mastery directly
 * (E6: mastery is written solely by update_learner_state_post_quiz).
 */

export const TRANSFER_SOURCE_MASTERY_MIN = 0.7;

export interface TransferEdge {
  fromTopicId: string;
  toTopicId: string;
  /** concept_edges.edge_type — only 'transfer' edges participate. */
  edgeType: string;
}

/** Yesterday's correct responses, grouped by topic. */
export interface TopicCorrectCount {
  topicId: string;
  correctCount: number;
}

/** Source-side mastery snapshot (concept_mastery.mastery_probability). */
export interface SourceMastery {
  topicId: string;
  masteryProbability: number;
}

export interface TransferEvidenceRecord {
  studentId: string;
  /** Topic the student succeeded on (the transfer TARGET). */
  topicId: string;
  /** Already-mastered topic the skill plausibly transferred FROM. */
  fromTopicId: string;
}

export interface DetectTransferInput {
  studentId: string;
  correctByTopic: TopicCorrectCount[];
  transferEdges: TransferEdge[];
  sourceMastery: SourceMastery[];
}

// ── Batch evaluator (cron consumer shape) ───────────────────────────────────
// The daily transfer step (build-twin-snapshots cron) processes MANY students
// in one pass and needs the mastery value + subject echoed back for the
// `record_transfer_evidence` RPC and the `learner.transfer_evidence` event
// payload (sourceTopicId/targetTopicId/sourceMastery/subjectCode). Same
// pedagogy rule, same TRANSFER_SOURCE_MASTERY_MIN — this is a second ENTRY
// POINT, not a second rule. `detectTransferEvidence` below stays the minimal
// single-student shape.

/** One correct response mapped to its topic (caller pre-filters to correct). */
export interface CorrectResponseRef {
  studentId: string;
  topicId: string;
  subjectCode: string | null;
}

export interface EvaluateTransferInput {
  correctResponses: CorrectResponseRef[];
  /** Transfer edges only (caller filters edge_type='transfer'); an
   *  `edgeType` field, when present, is re-checked defensively. */
  transferEdges: Array<{ fromTopicId: string; toTopicId: string; edgeType?: string }>;
  /** Mastery lookup for (studentId, sourceTopicId); null = no evidence. */
  sourceMastery: (studentId: string, topicId: string) => number | null;
}

export interface TransferEvidenceOutcome {
  studentId: string;
  sourceTopicId: string;
  targetTopicId: string;
  subjectCode: string | null;
  /** The source-concept mastery that qualified the transfer (>= 0.7). */
  sourceMastery: number;
}

export function evaluateTransferEvidence(input: EvaluateTransferInput): TransferEvidenceOutcome[] {
  // succeeded (student, topic) pairs + first-seen subject per pair
  const subjectByKey = new Map<string, string | null>();
  const topicsByStudent = new Map<string, Set<string>>();
  for (const r of input.correctResponses) {
    const key = `${r.studentId}:${r.topicId}`;
    if (!subjectByKey.has(key)) subjectByKey.set(key, r.subjectCode);
    let set = topicsByStudent.get(r.studentId);
    if (!set) {
      set = new Set();
      topicsByStudent.set(r.studentId, set);
    }
    set.add(r.topicId);
  }

  const out: TransferEvidenceOutcome[] = [];
  const seen = new Set<string>();
  for (const [studentId, succeeded] of topicsByStudent) {
    for (const edge of input.transferEdges) {
      if (edge.edgeType !== undefined && edge.edgeType !== 'transfer') continue;
      if (edge.fromTopicId === edge.toTopicId) continue;
      if (!succeeded.has(edge.toTopicId)) continue;
      const mastery = input.sourceMastery(studentId, edge.fromTopicId);
      if (
        mastery === null ||
        !Number.isFinite(mastery) ||
        mastery < TRANSFER_SOURCE_MASTERY_MIN
      ) {
        continue;
      }
      const dedupeKey = `${studentId}:${edge.toTopicId}:${edge.fromTopicId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        studentId,
        sourceTopicId: edge.fromTopicId,
        targetTopicId: edge.toTopicId,
        subjectCode: subjectByKey.get(`${studentId}:${edge.toTopicId}`) ?? null,
        sourceMastery: mastery,
      });
    }
  }
  return out;
}

export function detectTransferEvidence(input: DetectTransferInput): TransferEvidenceRecord[] {
  const masteredSources = new Map<string, number>();
  for (const m of input.sourceMastery) {
    if (
      Number.isFinite(m.masteryProbability) &&
      m.masteryProbability >= TRANSFER_SOURCE_MASTERY_MIN
    ) {
      masteredSources.set(m.topicId, m.masteryProbability);
    }
  }

  const succeededTopics = new Set<string>();
  for (const t of input.correctByTopic) {
    if (t.correctCount >= 1) succeededTopics.add(t.topicId);
  }

  const out: TransferEvidenceRecord[] = [];
  const seen = new Set<string>(); // dedupe (topicId, fromTopicId) pairs
  for (const edge of input.transferEdges) {
    if (edge.edgeType !== 'transfer') continue;
    if (edge.fromTopicId === edge.toTopicId) continue; // defensive; schema forbids
    if (!succeededTopics.has(edge.toTopicId)) continue;
    if (!masteredSources.has(edge.fromTopicId)) continue;
    const key = `${edge.toTopicId}:${edge.fromTopicId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      studentId: input.studentId,
      topicId: edge.toTopicId,
      fromTopicId: edge.fromTopicId,
    });
  }
  return out;
}
