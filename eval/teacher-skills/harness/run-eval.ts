// eval/teacher-skills/harness/run-eval.ts
//
// Teacher-skills eval harness — the PURE assembler (house pattern: same role
// as eval/rag/harness/run-eval.ts). Takes INJECTED deps — the parsed rubric,
// the artifacts, the deterministic-check map, and an optional judge fn — and
// assembles per-artifact results. NO I/O, no DB, no LLM, no network, no env
// reads: the ONLY place real deps get wired is cli.ts.
//
// ── Evaluation order per artifact ────────────────────────────────────────────
//   1. P13 GATE: recursive PII-shaped-key scan (scanForPiiKeys). ANY hit →
//      the artifact is verdict REVIEW immediately, NO criterion is evaluated,
//      and the artifact is NEVER serialized into a judge prompt. Synthetic-
//      fixtures-only is enforced structurally, not by convention.
//   2. Per criterion:
//      - Conditional non-empty and not declared by the artifact → skipped-conditional.
//      - Deterministic check registered → mechanical verdict (authoritative
//        both ways; never sent to the judge — REG-54 oracle pattern).
//      - M-bucket criterion with no chat response on the fixture → skipped-no-chat-response.
//      - Otherwise → queued for the LLM judge.
//   3. Judge: absent (--judge off) → queued criteria are `not-judged`.
//      Present → ONE call per artifact; malformed output → `judge-error` for
//      every queued criterion (REVIEW, never a crash — the judge fn itself
//      never throws).
//
// ── Verdict: PASS | REVIEW (per artifact — no aggregate-only score) ──────────
// PASS requires EVERY criterion to be status `pass` or legitimately skipped
// (skipped-conditional / skipped-no-chat-response), with at least one `pass`.
// Anything else — a fail, a judge-error, a not-judged criterion, a PII gate
// hit — is REVIEW. The same philosophy as the RAG harness's INCONCLUSIVE: you
// cannot declare PASS on a measurement you did not complete. A --judge off
// run of a rubric that has LLM criteria therefore can NEVER produce PASS.
//
// Offline dev/CI tooling only — NEVER imported by production / client code.

import type { Rubric, RubricCriterion } from './rubric-schema';
import { bucketLetter, scanForPiiKeys } from './rubric-schema';
import type { DeterministicCheck } from './deterministic-checks';
import type { CriterionJudgement, JudgeCriterion } from './judge';

// ─── Injected dependency shapes ──────────────────────────────────────────────

/** One artifact under evaluation (a parsed synthetic fixture). */
export interface EvalArtifact {
  /** Stable id, e.g. the fixture filename. */
  id: string;
  /** The artifact body (already JSON-parsed). */
  artifact: unknown;
  /** Optional final chat response (M-bucket criteria are judged against it). */
  chatResponse?: string | null;
  /** Condition tags this artifact declares (matches rubric `Conditional`). */
  conditions?: string[];
}

/**
 * The injected judge: judges the queued criteria for one artifact, returning
 * per-criterion judgements, or `null` when the judge produced malformed
 * output. `null` (not a throw) is the malformed-output contract — cli.ts
 * adapts judgeArtifact's {ok:false} to null.
 */
export type InjectedJudge = (
  criteria: JudgeCriterion[],
  artifactJson: string,
  chatResponse: string | null,
) => Promise<CriterionJudgement[] | null>;

export interface RunEvalDeps {
  rubric: Rubric;
  artifacts: EvalArtifact[];
  /** criterionId → deterministic check, for THIS rubric (may be empty). */
  deterministicChecks: Readonly<Record<string, DeterministicCheck>>;
  /** null = --judge off. */
  judge: InjectedJudge | null;
}

// ─── Result shapes ───────────────────────────────────────────────────────────

export type CriterionStatus =
  | 'pass'
  | 'fail'
  | 'skipped-conditional'
  | 'skipped-no-chat-response'
  | 'not-judged'
  | 'judge-error';

export type CriterionMethod = 'deterministic' | 'judge' | null;

export interface CriterionOutcome {
  id: string;
  bucket: string;
  criterion: string;
  method: CriterionMethod;
  status: CriterionStatus;
  explanation: string;
}

export type ArtifactVerdict = 'PASS' | 'REVIEW';

export interface ArtifactResult {
  artifactId: string;
  verdict: ArtifactVerdict;
  reasons: string[];
  /** Empty when the P13 gate rejected the artifact before evaluation. */
  criteria: CriterionOutcome[];
  /** Non-empty iff the P13 PII-shaped-key gate fired. */
  piiGateErrors: string[];
}

export interface TeacherEvalRun {
  rubricName: string;
  judgeEnabled: boolean;
  artifacts: ArtifactResult[];
}

// ─── Verdict helper (exported for tests) ─────────────────────────────────────

const OK_STATUSES: ReadonlySet<CriterionStatus> = new Set([
  'pass',
  'skipped-conditional',
  'skipped-no-chat-response',
]);

export function verdictFor(outcomes: CriterionOutcome[], piiGateErrors: string[]): {
  verdict: ArtifactVerdict;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (piiGateErrors.length > 0) {
    return {
      verdict: 'REVIEW',
      reasons: [
        `P13 gate: artifact carries PII-shaped keys and was NOT evaluated (${piiGateErrors.join('; ')})`,
      ],
    };
  }
  let passCount = 0;
  for (const o of outcomes) {
    if (o.status === 'pass') passCount++;
    if (!OK_STATUSES.has(o.status)) {
      reasons.push(`${o.id}: ${o.status}${o.explanation ? ` — ${o.explanation}` : ''}`);
    }
  }
  if (reasons.length === 0 && passCount > 0) return { verdict: 'PASS', reasons: [] };
  if (passCount === 0 && reasons.length === 0) {
    return { verdict: 'REVIEW', reasons: ['no criterion was actually evaluated'] };
  }
  return { verdict: 'REVIEW', reasons };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

function toJudgeCriterion(c: RubricCriterion): JudgeCriterion {
  return { id: c.id, bucket: c.bucket, criterion: c.criterion, passRequires: c.passRequires };
}

/**
 * Evaluate every artifact against the rubric. Pure assembly over injected
 * deps; performs no file/DB writes (the caller persists via report.ts).
 * Never throws on artifact-level problems — they become REVIEW verdicts.
 */
export async function runEval(deps: RunEvalDeps): Promise<TeacherEvalRun> {
  const { rubric, artifacts, deterministicChecks, judge } = deps;
  const results: ArtifactResult[] = [];

  for (const item of artifacts) {
    // 1. P13 gate — before ANY evaluation and before ANY serialization for the judge.
    const piiGateErrors = scanForPiiKeys(item.artifact);
    if (piiGateErrors.length > 0) {
      const v = verdictFor([], piiGateErrors);
      results.push({
        artifactId: item.id,
        verdict: v.verdict,
        reasons: v.reasons,
        criteria: [],
        piiGateErrors,
      });
      continue;
    }

    const conditions = new Set(item.conditions ?? []);
    const chatResponse = item.chatResponse ?? null;
    const outcomes: CriterionOutcome[] = [];
    const judgeQueue: RubricCriterion[] = [];

    // 2. Classify each criterion.
    for (const c of rubric.criteria) {
      const base = { id: c.id, bucket: c.bucket, criterion: c.criterion };

      if (c.conditional.length > 0 && !conditions.has(c.conditional)) {
        outcomes.push({
          ...base,
          method: null,
          status: 'skipped-conditional',
          explanation: `conditional "${c.conditional}" not declared by artifact — skipped (not failed)`,
        });
        continue;
      }

      const det = deterministicChecks[c.id];
      if (det !== undefined) {
        const r = det(item.artifact);
        outcomes.push({
          ...base,
          method: 'deterministic',
          status: r.pass ? 'pass' : 'fail',
          explanation: r.explanation,
        });
        continue;
      }

      if (bucketLetter(c.bucket) === 'M' && (chatResponse === null || chatResponse.length === 0)) {
        outcomes.push({
          ...base,
          method: null,
          status: 'skipped-no-chat-response',
          explanation: 'M-bucket criterion but the fixture carries no chat response — skipped',
        });
        continue;
      }

      judgeQueue.push(c);
    }

    // 3. Judge the queue (or mark not-judged).
    if (judgeQueue.length > 0) {
      if (judge === null) {
        for (const c of judgeQueue) {
          outcomes.push({
            id: c.id,
            bucket: c.bucket,
            criterion: c.criterion,
            method: 'judge',
            status: 'not-judged',
            explanation: 'LLM judge disabled (--judge off) — criterion not evaluated',
          });
        }
      } else {
        const artifactJson = JSON.stringify(item.artifact, null, 2);
        const judgements = await judge(judgeQueue.map(toJudgeCriterion), artifactJson, chatResponse);
        const byId = new Map<string, CriterionJudgement>();
        if (judgements !== null) for (const j of judgements) byId.set(j.id, j);
        for (const c of judgeQueue) {
          const j = judgements === null ? undefined : byId.get(c.id);
          if (j === undefined) {
            outcomes.push({
              id: c.id,
              bucket: c.bucket,
              criterion: c.criterion,
              method: 'judge',
              status: 'judge-error',
              explanation:
                judgements === null
                  ? 'judge output malformed — criterion unevaluated (REVIEW, not a crash)'
                  : 'judge omitted this criterion id from its output',
            });
          } else {
            outcomes.push({
              id: c.id,
              bucket: c.bucket,
              criterion: c.criterion,
              method: 'judge',
              status: j.pass ? 'pass' : 'fail',
              explanation: j.explanation,
            });
          }
        }
      }
    }

    // Preserve rubric order in the outcome list.
    const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
    outcomes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const v = verdictFor(outcomes, []);
    results.push({
      artifactId: item.id,
      verdict: v.verdict,
      reasons: v.reasons,
      criteria: outcomes,
      piiGateErrors: [],
    });
  }

  return {
    rubricName: rubric.name,
    judgeEnabled: judge !== null,
    artifacts: results,
  };
}
