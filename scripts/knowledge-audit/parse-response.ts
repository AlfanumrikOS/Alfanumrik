/**
 * scripts/knowledge-audit/parse-response.ts
 *
 * Pure, tolerant parser for the chunk-pass audit model response.
 *
 * Guarantees on success:
 * - ALL 31 dimensions present in the output map (absent ones filled with
 *   found_count 0 + an explanatory note — the 9 scan-lane dimensions are never
 *   requested from the model, so they always arrive here as 0-filled and are
 *   later OVERWRITTEN by the question_bank / generated-content scans).
 * - found_count is a clamped non-negative integer (NaN/negative/float → fixed
 *   with a note).
 * - evidence_chunk_ids is a subset of the input chunk ids (foreign ids are
 *   DROPPED with a note — defense against hallucinated evidence), capped at 5.
 * - notes never carry chunk text longer than a short label (truncated).
 * - chapter-level contamination fields (content_contaminated /
 *   contamination_evidence) are normalized alongside metadata_garbled —
 *   defaulting to false / [] when the model omits them.
 *
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/parse-response.test.ts.
 */

import { ALL_DIMENSIONS, type Dimension, type DimensionFinding } from './dimensions';

const MAX_EVIDENCE_IDS = 5;
const MAX_NOTE_CHARS = 300;
const MAX_SUSPECTED_ENTRIES = 50;
const MAX_SUSPECTED_LABEL_CHARS = 200;

export interface ParsedAudit {
  ok: true;
  dimensions: Record<Dimension, DimensionFinding>;
  metadataGarbled: boolean;
  /** Chapter mixes foreign-chapter/book content (count-as-is + flag, never abstain). */
  contentContaminated: boolean;
  /** Short labels only (e.g. "second SUMMARY block") — never passage text (P13). */
  contaminationEvidence: string[];
  suspectedMissing: string[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParsedAudit | ParseFailure;

/** Tolerant JSON extraction: strip markdown fences, take outermost {...}. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  let txt = raw.trim();
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(txt.slice(start, end + 1));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clampCount(v: unknown): { count: number; note: string | null } {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return { count: 0, note: 'found_count missing/non-numeric; defaulted to 0' };
  if (n < 0) return { count: 0, note: `found_count ${n} negative; clamped to 0` };
  if (!Number.isInteger(n)) return { count: Math.floor(n), note: `found_count ${n} non-integer; floored` };
  return { count: n, note: null };
}

function truncateNote(s: string): string {
  return s.length > MAX_NOTE_CHARS ? `${s.slice(0, MAX_NOTE_CHARS - 1)}…` : s;
}

/**
 * Parse + validate the model response.
 * @param raw          raw model text (may be fenced / have stray prose)
 * @param validChunkIds the chunk ids that were fed to the model — evidence ids
 *                      not in this set are dropped (with a note)
 */
export function parseAuditResponse(raw: string, validChunkIds: string[]): ParseResult {
  const obj = extractJsonObject(raw);
  if (!obj) return { ok: false, error: `unparseable model response (len=${raw.length})` };

  const dimsRaw =
    obj.dimensions && typeof obj.dimensions === 'object' && !Array.isArray(obj.dimensions)
      ? (obj.dimensions as Record<string, unknown>)
      : // tolerate the model flattening dimensions to the top level
        obj;

  const validIds = new Set(validChunkIds);
  const dimensions = {} as Record<Dimension, DimensionFinding>;

  for (const dim of ALL_DIMENSIONS) {
    const entry = dimsRaw[dim];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      dimensions[dim] = {
        found_count: 0,
        evidence_chunk_ids: [],
        notes: 'absent from model response; defaulted to 0',
      };
      continue;
    }
    const e = entry as Record<string, unknown>;
    const notes: string[] = [];

    const { count, note: countNote } = clampCount(e.found_count);
    if (countNote) notes.push(countNote);

    let evidence: string[] = [];
    if (Array.isArray(e.evidence_chunk_ids)) {
      const asStrings = (e.evidence_chunk_ids as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean);
      const kept = asStrings.filter((id) => validIds.has(id));
      const dropped = asStrings.length - kept.length;
      if (dropped > 0) notes.push(`dropped ${dropped} foreign evidence id(s)`);
      if (kept.length > MAX_EVIDENCE_IDS) notes.push(`evidence capped at ${MAX_EVIDENCE_IDS} (had ${kept.length})`);
      evidence = kept.slice(0, MAX_EVIDENCE_IDS);
    }

    const modelNote = typeof e.notes === 'string' && e.notes.trim() ? [e.notes.trim()] : [];
    dimensions[dim] = {
      found_count: count,
      evidence_chunk_ids: evidence,
      notes: truncateNote([...modelNote, ...notes].join(' | ')),
    };
  }

  const metadataGarbled = obj.metadata_garbled === true || obj.metadata_garbled === 'true';
  const contentContaminated = obj.content_contaminated === true || obj.content_contaminated === 'true';

  const suspectedMissing = sanitizeLabelArray(obj.suspected_missing);
  const contaminationEvidence = sanitizeLabelArray(obj.contamination_evidence);

  return { ok: true, dimensions, metadataGarbled, contentContaminated, contaminationEvidence, suspectedMissing };
}

/** Normalize a label array: strings only, blanks dropped, capped, truncated. */
function sanitizeLabelArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_SUSPECTED_ENTRIES)
    .map((s) => (s.length > MAX_SUSPECTED_LABEL_CHARS ? `${s.slice(0, MAX_SUSPECTED_LABEL_CHARS - 1)}…` : s));
}
