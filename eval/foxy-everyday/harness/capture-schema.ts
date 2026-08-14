// eval/foxy-everyday/harness/capture-schema.ts
//
// Everyday-example rubric — the RESPONSE-CAPTURE file contract. Pure types +
// validator, no I/O. Offline tooling; never imported by production code.
//
// ── Why a capture file at all ────────────────────────────────────────────────
// The judge scores GENERATED ANSWERS, so something has to produce them. Two
// lanes, both offline from this harness's point of view:
//
//   A. REPLAY (default, and the only lane this repo can run today):
//      an operator captures the raw Foxy responses for the case set — once with
//      ff_foxy_everyday_examples_v1 OFF (the control arm) and once ON (the
//      treatment arm) — into two capture files, then runs the harness against
//      them. The harness itself makes ZERO generation calls. This is what keeps
//      the tool honest about spend: only the judge costs tokens.
//
//   B. INJECTED GENERATE: `runEverydayEval` accepts an optional `generate`
//      transport seam with the same shape the B1 runner uses for `retrieve`. A
//      caller with a live environment can wire it; this harness never embeds a
//      transport, never holds an endpoint URL, and never deploys anything.
//
// ── The flag-state field is the whole INCONCLUSIVE mechanism ─────────────────
// `flag.observed_state` is a THREE-state field: true | false | 'unknown'. It is
// REQUIRED. A capture whose flag state is 'unknown' (or whose observed state
// disagrees with the arm it claims to be) can never be read as PASS — the
// verdict is INCONCLUSIVE. This is deliberate: a prompt-flag experiment where
// you cannot prove which prompt produced the text is not a measurement, it is an
// anecdote. The operator records the state they OBSERVED (e.g. from the
// feature_flags row, or from a request-trace field), plus how they observed it.
//
// P13: a capture file carries only case ids and raw model text. The recursive
// PII-key ban from case-schema.ts is applied to the whole document — a stray
// identifier in a captured response is exactly the leak that ban exists for.

import { scanForPiiKeys } from './case-schema';

/** Which arm a capture file belongs to. */
export const ARMS = ['on', 'off'] as const;
export type Arm = (typeof ARMS)[number];

/**
 * Observed production flag state at capture time. `'unknown'` is a legal value
 * and is the ONLY honest thing to write when the operator did not verify it —
 * it forces INCONCLUSIVE rather than inviting a guess.
 */
export type ObservedFlagState = boolean | 'unknown';

export interface CaptureFlagMeta {
  /** Flag name, e.g. 'ff_foxy_everyday_examples_v1'. */
  name: string;
  /** true | false | 'unknown'. REQUIRED. */
  observed_state: ObservedFlagState;
  /** ISO timestamp of the observation. */
  observed_at: string;
  /**
   * HOW it was observed, in free text — e.g. "feature_flags row read via
   * service-role SELECT at 2026-08-13T09:02Z" or "gen_ctx.everyday_examples
   * echoed in the response trace". An empty source is treated as 'unknown'.
   */
  source: string;
}

/** One captured response. */
export interface CapturedResponse {
  /** Must match an `EverydayCase.id` in the case set. */
  case_id: string;
  /**
   * The RAW model output as the pipeline returned it (the strict-JSON
   * FoxyResponse string). Absent/empty ONLY when `transport_error` is set.
   */
  raw_response?: string;
  /**
   * Set when the response was never obtained (timeout, 5xx, abort). A case with
   * a transport error is UNSEEN -> INCONCLUSIVE. It is NOT a failure: "we saw it
   * and it was broken" (malformed JSON) is a FAIL; "we never saw it" is not
   * something the rubric is entitled to score.
   */
  transport_error?: string;
}

/** The capture document for ONE arm. */
export interface EverydayCapture {
  version: string;
  arm: Arm;
  /** The case-set version these responses were generated against. */
  case_set_version: string;
  captured_at: string;
  flag: CaptureFlagMeta;
  /** Free-text provenance: environment, model, pipeline path, operator notes. */
  notes: string;
  responses: CapturedResponse[];
}

export type CaptureValidation =
  | { ok: true; value: EverydayCapture }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Does the capture's observed flag state MATCH the arm it claims to be?
 *   arm 'on'  requires observed_state === true
 *   arm 'off' requires observed_state === false
 * Anything else (including 'unknown', and including a blank `source`) returns
 * false and forces INCONCLUSIVE. PURE.
 */
export function flagStateMatchesArm(capture: EverydayCapture): boolean {
  if (typeof capture.flag?.source !== 'string' || capture.flag.source.trim().length === 0) {
    return false;
  }
  if (capture.flag.observed_state === 'unknown') return false;
  return capture.arm === 'on'
    ? capture.flag.observed_state === true
    : capture.flag.observed_state === false;
}

/** Pure validator. Never throws. */
export function validateCapture(doc: unknown): CaptureValidation {
  const errors: string[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['capture root must be an object'] };
  }

  // P13 first, over the whole document including every captured response.
  scanForPiiKeys(doc, '', errors);

  if (typeof doc.version !== 'string' || doc.version.length === 0) {
    errors.push('version must be a non-empty string');
  }
  if (!(ARMS as readonly string[]).includes(doc.arm as string)) {
    errors.push(`arm must be one of {${ARMS.join(', ')}} (got ${JSON.stringify(doc.arm)})`);
  }
  if (typeof doc.case_set_version !== 'string' || doc.case_set_version.length === 0) {
    errors.push('case_set_version must be a non-empty string');
  }
  if (typeof doc.captured_at !== 'string') errors.push('captured_at must be a string date');

  if (!isPlainObject(doc.flag)) {
    errors.push('flag must be present and an object (flag state is REQUIRED)');
  } else {
    if (typeof doc.flag.name !== 'string' || doc.flag.name.length === 0) {
      errors.push('flag.name must be a non-empty string');
    }
    const st = doc.flag.observed_state;
    if (st !== true && st !== false && st !== 'unknown') {
      errors.push(
        "flag.observed_state must be true | false | 'unknown' — it is REQUIRED; an absent " +
          "flag state is not the same as 'unknown' and is not accepted",
      );
    }
    if (typeof doc.flag.observed_at !== 'string') {
      errors.push('flag.observed_at must be a string date');
    }
    if (typeof doc.flag.source !== 'string') errors.push('flag.source must be a string');
  }

  if (!Array.isArray(doc.responses)) {
    errors.push('responses must be an array');
  } else {
    doc.responses.forEach((r, i) => {
      const path = `responses[${i}]`;
      if (!isPlainObject(r)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof r.case_id !== 'string' || r.case_id.length === 0) {
        errors.push(`${path}.case_id must be a non-empty string`);
      }
      const hasRaw = typeof r.raw_response === 'string' && r.raw_response.length > 0;
      const hasErr = typeof r.transport_error === 'string' && r.transport_error.length > 0;
      if (!hasRaw && !hasErr) {
        errors.push(
          `${path} must carry either a non-empty raw_response or a transport_error — an ` +
            'empty record is indistinguishable from a silently dropped case',
        );
      }
    });

    const seen = new Set<string>();
    doc.responses.forEach((r, i) => {
      if (isPlainObject(r) && typeof r.case_id === 'string') {
        if (seen.has(r.case_id)) {
          errors.push(`responses[${i}].case_id "${r.case_id}" is a duplicate`);
        } else {
          seen.add(r.case_id);
        }
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: doc as unknown as EverydayCapture };
}
