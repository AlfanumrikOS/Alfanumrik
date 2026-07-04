/**
 * scripts/knowledge-audit/parse-semantic.ts
 *
 * v2 pure parser + cross-batch merger for the batched SEMANTIC LLM pass.
 * Replaces parse-response.ts (the v1 single-pass 22-dimension count parser,
 * retired with the v1 prompt after the pilot-gate failure).
 *
 * DESIGN: cross-batch dedupe of semantic COUNTS is impossible, so each batch
 * returns ITEMS — short labels (≤40 chars) naming each distinct instance found
 * in that batch — and the merge dedupes NORMALIZED labels in code. Counts are
 * therefore derived, never guessed:
 *   found_count(dim) = |distinct normalizeLabel(item) across all batches|
 *
 * Guarantees:
 * - Every SEMANTIC dimension present in the merged output (0-filled if absent).
 * - Items are strings only, trimmed, blank-dropped, length-capped; per-dim
 *   per-batch item cap prevents a runaway response from flooding memory.
 * - evidence_chunk_ids ⊆ the batch's input chunk ids (hallucinated ids
 *   DROPPED), capped at 5 after merge (P13: ids only).
 * - metadata_garbled ORs across batches; suspected_missing label-deduped.
 *
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/parse-semantic.test.ts.
 */

import { SEMANTIC_DIMENSIONS, type DimensionFinding, type SemanticDimension } from './dimensions';

export const MAX_LABEL_CHARS = 40;
const MAX_RAW_LABEL_CHARS = 80; // pre-normalization memory bound
const MAX_ITEMS_PER_DIMENSION_PER_BATCH = 200;
const MAX_EVIDENCE_IDS = 5;
const MAX_SUSPECTED_ENTRIES = 50;
const MAX_SUSPECTED_LABEL_CHARS = 200;

// ─── Tolerant JSON extraction (moved from parse-response.ts, unchanged) ──────

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

// ─── Label normalization (the cross-batch dedupe key) ────────────────────────

/**
 * Dedupe key for item labels: NFKC, lowercase, whitespace collapsed, wrapping
 * quote/bullet/punctuation stripped, capped at MAX_LABEL_CHARS. "Adaptation",
 * '  adaptation.' and '"ADAPTATION"' all collapse to "adaptation".
 */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`“”‘’•\-–—:;.,()[\]]+|[\s"'`“”‘’•\-–—:;.,()[\]]+$/g, '')
    .trim()
    .slice(0, MAX_LABEL_CHARS);
}

/** Normalize a label array: strings only, blanks dropped, capped, truncated. */
export function sanitizeLabelArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_SUSPECTED_ENTRIES)
    .map((s) => (s.length > MAX_SUSPECTED_LABEL_CHARS ? `${s.slice(0, MAX_SUSPECTED_LABEL_CHARS - 1)}…` : s));
}

// ─── Per-batch parse ──────────────────────────────────────────────────────────

export interface SemanticBatchFinding {
  items: string[];
  evidence_chunk_ids: string[];
}

export interface ParsedSemanticBatch {
  ok: true;
  dimensions: Record<SemanticDimension, SemanticBatchFinding>;
  metadataGarbled: boolean;
  suspectedMissing: string[];
}

export interface SemanticParseFailure {
  ok: false;
  error: string;
}

export type SemanticParseResult = ParsedSemanticBatch | SemanticParseFailure;

function sanitizeItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS_PER_DIMENSION_PER_BATCH)
    .map((s) => s.slice(0, MAX_RAW_LABEL_CHARS));
}

/**
 * Parse + validate one batch response.
 * @param raw           raw model text (may be fenced / have stray prose)
 * @param validChunkIds the chunk ids fed to THIS batch — foreign evidence ids
 *                      are dropped (defense against hallucinated evidence)
 */
export function parseSemanticBatchResponse(raw: string, validChunkIds: string[]): SemanticParseResult {
  const obj = extractJsonObject(raw);
  if (!obj) return { ok: false, error: `unparseable model response (len=${raw.length})` };

  const dimsRaw =
    obj.dimensions && typeof obj.dimensions === 'object' && !Array.isArray(obj.dimensions)
      ? (obj.dimensions as Record<string, unknown>)
      : // tolerate the model flattening dimensions to the top level
        obj;

  const validIds = new Set(validChunkIds);
  const dimensions = {} as Record<SemanticDimension, SemanticBatchFinding>;

  for (const dim of SEMANTIC_DIMENSIONS) {
    const entry = dimsRaw[dim];
    if (Array.isArray(entry)) {
      // tolerate the model returning a bare items array for a dimension
      dimensions[dim] = { items: sanitizeItems(entry), evidence_chunk_ids: [] };
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      dimensions[dim] = { items: [], evidence_chunk_ids: [] };
      continue;
    }
    const e = entry as Record<string, unknown>;
    const evidence = Array.isArray(e.evidence_chunk_ids)
      ? (e.evidence_chunk_ids as unknown[])
          .map((x) => String(x ?? '').trim())
          .filter((id) => id && validIds.has(id))
          .slice(0, MAX_EVIDENCE_IDS)
      : [];
    dimensions[dim] = { items: sanitizeItems(e.items), evidence_chunk_ids: evidence };
  }

  const metadataGarbled = obj.metadata_garbled === true || obj.metadata_garbled === 'true';
  const suspectedMissing = sanitizeLabelArray(obj.suspected_missing);

  return { ok: true, dimensions, metadataGarbled, suspectedMissing };
}

// ─── Cross-batch merge (label dedupe in code) ────────────────────────────────

export interface MergedSemanticPass {
  dimensions: Record<SemanticDimension, DimensionFinding>;
  metadataGarbled: boolean;
  suspectedMissing: string[];
}

export function mergeSemanticBatches(batches: ParsedSemanticBatch[]): MergedSemanticPass {
  const dimensions = {} as Record<SemanticDimension, DimensionFinding>;

  for (const dim of SEMANTIC_DIMENSIONS) {
    const seen = new Set<string>();
    const evidence: string[] = [];
    for (const batch of batches) {
      const finding = batch.dimensions[dim];
      if (!finding) continue;
      for (const item of finding.items) {
        const key = normalizeLabel(item);
        if (key) seen.add(key);
      }
      for (const id of finding.evidence_chunk_ids) {
        if (evidence.length < MAX_EVIDENCE_IDS && !evidence.includes(id)) evidence.push(id);
      }
    }
    dimensions[dim] = {
      found_count: seen.size,
      evidence_chunk_ids: evidence,
      notes: `semantic batch pass: ${seen.size} distinct items after label dedupe across ${batches.length} batch(es)`,
    };
  }

  const metadataGarbled = batches.some((b) => b.metadataGarbled);

  const suspectedSeen = new Map<string, string>(); // normalized → first original label
  for (const batch of batches) {
    for (const label of batch.suspectedMissing) {
      const key = normalizeLabel(label);
      if (key && !suspectedSeen.has(key)) suspectedSeen.set(key, label);
    }
  }
  const suspectedMissing = [...suspectedSeen.values()].slice(0, MAX_SUSPECTED_ENTRIES);

  return { dimensions, metadataGarbled, suspectedMissing };
}
