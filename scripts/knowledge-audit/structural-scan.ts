/**
 * scripts/knowledge-audit/structural-scan.ts
 *
 * v2 PURE deterministic cross-chunk scanner for the 12 STRUCTURAL chunk-pass
 * dimensions. Replaces the failed single-pass-LLM enumeration for everything
 * NCERT numbering conventions make exactly countable.
 *
 * WHY (Wave 1 pilot-gate failure, definitive diagnosis): gpt-4o-mini over
 * 20k-84k-token single-pass contexts returns near-empty skeletons (443-1017
 * output tokens), and strict "own line" prompt rules discard OCR-FLATTENED
 * structural markers. So: regex-extract + dedupe-BY-IDENTIFIER across ALL
 * chunks — overlap-safe by construction (the same "Fig. 4.1" stored 2-3x by
 * sliding-window chunking collapses to one identifier), and every pattern
 * matches INLINE (no line-boundary requirement except where genuinely needed,
 * i.e. exercise question numbering).
 *
 * Dimensions counted here (found_count is EXACT, not estimated):
 * - diagrams:        distinct "Fig./Figure N.M" identifiers
 * - captions:        distinct Fig N.M immediately followed by ":"/"." + text
 * - tables:          distinct "Table N.M"
 * - activities:      distinct "Activity N.M"
 * - examples:        distinct "Example N.M" plus bare "Example N"
 * - solved_examples: subset of examples with a solution marker nearby
 *                    ("Solution", "Sol.", "∴", "Answer:")
 * - exercises:       per-set line-start question-number continuity SUMMED
 *                    across sets (mid-chapter EXERCISE N.M, end-of-chapter
 *                    EXERCISES, Intext Questions, "Let us enhance our
 *                    learning") — machinery MOVED here from coverage.ts and
 *                    extended to be the found-counter, not just expected
 * - headings:        distinct "N.M Title" (inline) + conservative TitleCase
 *                    standalone lines
 * - subtopics:       distinct "N.M.K Title"
 * - summary:         distinct summary blocks (SUMMARY / "What have we learnt" /
 *                    "What you have learnt" / Points to Ponder), deduped by
 *                    following-text fingerprint (overlap-safe)
 * - keywords:        enumerable terms in Keywords / New Terms blocks
 * - pages:           distinct explicit page markers (normally none → 0)
 *
 * Also emits per-dimension SERIES METADATA ({dimension, majorsSeen}) consumed
 * by contamination.ts, and deterministic suspected_missing gap labels
 * (Fig 4.1 → 4.3 implies "Fig. 4.2 absent (numbering gap)").
 *
 * P13: outputs carry chunk IDs and short labels only — never chunk text.
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/structural-scan.test.ts.
 */

import {
  STRUCTURAL_DIMENSIONS,
  type AuditChunk,
  type ChunkPassDimension,
  type DimensionFinding,
  type StructuralDimension,
} from './dimensions';

// ─── Sanity ceilings (shared with coverage.ts expectations) ──────────────────

/** OCR junk like "Fig 4.2019" must never register as a series member. */
export const MAX_MINOR_INDEX = 99;
export const MAX_EXERCISE_QUESTION = 80;
const MAX_EVIDENCE_IDS = 5;
const MAX_GAP_LABELS_PER_DIMENSION = 10;
/** Window after an Example marker searched for a solution marker. */
const SOLUTION_WINDOW_CHARS = 2000;

// ─── Series regexes (INLINE — OCR-flattened text has no reliable newlines) ───

const FIG_RE = /\bFig(?:ure)?\.?\s*(\d{1,2})\.(\d{1,3})\b/gi;
const TABLE_RE = /\bTable\s+(\d{1,2})\.(\d{1,3})\b/gi;
const ACTIVITY_RE = /\bActivity\s+(\d{1,2})\.(\d{1,3})\b/gi;
const EXAMPLE_DOTTED_RE = /\bExample\s+(\d{1,2})\.(\d{1,3})\b/gi;
/** Bare "Example N" (old maths NCERT style) — must not re-match "Example N.M". */
const EXAMPLE_BARE_RE = /\bExample\s+(\d{1,3})\b(?!\.\d)/gi;
const SOLUTION_MARKER_RE = /\bSolution\b|\bSol\.(?=\s)|∴|\bAnswer\s*:/;

/** Fresh regex per use — the module-level ones are /g. */
const fresh = (re: RegExp) => new RegExp(re.source, re.flags);

/**
 * Scan text for a numbered series like "Activity 4.1" / "Fig. 4.3" and return
 * the implied series size: group matches by MAJOR number (chapter), take the
 * major with the most matches (references to other chapters are minority
 * noise), and return the MAX minor index — numbering continuity means a gap
 * (4.1 → 4.3) still implies the book has at least 3 items.
 * Returns null when no dotted matches exist.
 * (Moved here from coverage.ts in v2 — coverage.ts re-exports it and still
 * uses it for expected-count derivation.)
 */
export function maxSeriesIndex(text: string, label: RegExp): number | null {
  const byMajor = new Map<number, number[]>();
  for (const m of text.matchAll(label)) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) continue;
    if (minor < 1 || minor > MAX_MINOR_INDEX) continue;
    const arr = byMajor.get(major) ?? [];
    arr.push(minor);
    byMajor.set(major, arr);
  }
  if (byMajor.size === 0) return null;
  let bestMajor: number[] | null = null;
  for (const arr of byMajor.values()) {
    if (!bestMajor || arr.length > bestMajor.length) bestMajor = arr;
  }
  return bestMajor ? Math.max(...bestMajor) : null;
}

// ─── Output shapes ────────────────────────────────────────────────────────────

/** Per-dimension series metadata: major → DISTINCT member count. */
export interface SeriesMeta {
  dimension: ChunkPassDimension;
  majorsSeen: Map<number, number>;
}

export interface StructuralScanResult {
  findings: Record<StructuralDimension, DimensionFinding>;
  /** Consumed by contamination.ts (foreign-major detection). */
  series: SeriesMeta[];
  /** Distinct summary blocks (≥2 is a contamination signal). */
  summaryBlockCount: number;
  /** Deterministic numbering-gap labels (labels only — P13). */
  suspectedMissing: string[];
}

// ─── Dotted-series accumulation (dedupe by identifier across ALL chunks) ─────

interface SeriesAccumulator {
  /** distinct identifiers, e.g. "4.1" (dotted) or "n3" (bare Example 3) */
  ids: Set<string>;
  byMajor: Map<number, Set<number>>;
  evidence: string[]; // ordered unique chunk ids
}

function newAccumulator(): SeriesAccumulator {
  return { ids: new Set(), byMajor: new Map(), evidence: [] };
}

function addMember(acc: SeriesAccumulator, major: number, minor: number, chunkId: string): void {
  if (minor < 1 || minor > MAX_MINOR_INDEX) return;
  acc.ids.add(`${major}.${minor}`);
  const set = acc.byMajor.get(major) ?? new Set<number>();
  set.add(minor);
  acc.byMajor.set(major, set);
  if (!acc.evidence.includes(chunkId)) acc.evidence.push(chunkId);
}

function scanDottedSeries(chunks: AuditChunk[], re: RegExp): SeriesAccumulator {
  const acc = newAccumulator();
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(re))) {
      const major = parseInt(m[1], 10);
      const minor = parseInt(m[2], 10);
      if (!Number.isFinite(major) || !Number.isFinite(minor)) continue;
      addMember(acc, major, minor, c.chunk_id);
    }
  }
  return acc;
}

// ─── Captions: Fig N.M immediately followed by ":" / "." + text ──────────────

function scanCaptions(chunks: AuditChunk[]): SeriesAccumulator {
  const acc = newAccumulator();
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(FIG_RE))) {
      const after = c.chunk_text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 6);
      if (!/^\s*[:.]\s*[A-Za-z]/.test(after)) continue;
      addMember(acc, parseInt(m[1], 10), parseInt(m[2], 10), c.chunk_id);
    }
  }
  return acc;
}

// ─── Examples + solved subset ─────────────────────────────────────────────────

interface ExampleScan {
  acc: SeriesAccumulator; // dotted + bare identifiers, unified evidence
  solvedIds: Set<string>;
  solvedEvidence: string[];
}

function scanExamples(chunks: AuditChunk[]): ExampleScan {
  const acc = newAccumulator();
  const solvedIds = new Set<string>();
  const solvedEvidence: string[] = [];
  for (const c of chunks) {
    // collect every example occurrence (dotted + bare) with its offset
    const occurrences: Array<{ id: string; index: number; major: number | null; minor: number | null }> = [];
    for (const m of c.chunk_text.matchAll(fresh(EXAMPLE_DOTTED_RE))) {
      const major = parseInt(m[1], 10);
      const minor = parseInt(m[2], 10);
      if (minor < 1 || minor > MAX_MINOR_INDEX) continue;
      occurrences.push({ id: `${major}.${minor}`, index: m.index ?? 0, major, minor });
    }
    for (const m of c.chunk_text.matchAll(fresh(EXAMPLE_BARE_RE))) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > MAX_MINOR_INDEX) continue;
      occurrences.push({ id: `n${n}`, index: m.index ?? 0, major: null, minor: null });
    }
    occurrences.sort((a, b) => a.index - b.index);
    for (let i = 0; i < occurrences.length; i++) {
      const occ = occurrences[i];
      if (occ.major !== null && occ.minor !== null) {
        addMember(acc, occ.major, occ.minor, c.chunk_id);
      } else {
        acc.ids.add(occ.id);
        if (!acc.evidence.includes(c.chunk_id)) acc.evidence.push(c.chunk_id);
      }
      // solved: a solution marker between this example and the next one
      const windowEnd = Math.min(
        i + 1 < occurrences.length ? occurrences[i + 1].index : c.chunk_text.length,
        occ.index + SOLUTION_WINDOW_CHARS,
      );
      const window = c.chunk_text.slice(occ.index, windowEnd);
      if (SOLUTION_MARKER_RE.test(window)) {
        solvedIds.add(occ.id);
        if (!solvedEvidence.includes(c.chunk_id)) solvedEvidence.push(c.chunk_id);
      }
    }
  }
  return { acc, solvedIds, solvedEvidence };
}

// ─── Headings (N.M inline) + subtopics (N.M.K) + conservative TitleCase ──────

const HEADING_RE = /\b(\d{1,2})\.(\d{1,2})(?!\.?\d)\s+([A-Z][A-Za-z])/g;
const SUBTOPIC_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?!\.?\d)\s+([A-Z])/g;
/**
 * Reject an N.M "heading" when it is actually a series label's number
 * ("Fig. 4.2 Shows..."), or the tail of a deeper number ("4.2.1" → "2.1").
 */
const SERIES_LABEL_LOOKBACK =
  /(?:fig(?:ure)?\.?|table|activity|example|exercises?|question|section|chapter|eq(?:n|uation)?\.?)\s*$|\d\.\s*$|\d\s*$/i;

function isSeriesLabelled(text: string, index: number): boolean {
  return SERIES_LABEL_LOOKBACK.test(text.slice(Math.max(0, index - 12), index));
}

const TITLE_STOPWORDS = new Set(['of', 'and', 'in', 'the', 'a', 'an', 'to', 'for', 'with', 'on', 'into', 'from', 'us', 'at', 'by']);
const EXCLUDED_TITLE_LINES =
  /^(summary|keywords?|new terms|exercises?|intext questions?|what (have we|you have) learnt\??|points to ponder|let us enhance our learning|notes for the teacher)$/i;

/**
 * Conservative TitleCase standalone-line heading heuristic (unnumbered heads):
 * 2-6 words, every word Capitalized or a stopword, no digits, no terminal
 * punctuation, ≤60 chars, not a known non-heading block label. Deduped by
 * normalized text. Deliberately strict — misses are cheaper than junk.
 */
function scanTitleCaseHeadings(chunks: AuditChunk[]): { keys: Set<string>; evidence: string[] } {
  const keys = new Set<string>();
  const evidence: string[] = [];
  for (const c of chunks) {
    for (const rawLine of c.chunk_text.split('\n')) {
      const line = rawLine.trim();
      if (line.length < 3 || line.length > 60) continue;
      if (/\d/.test(line)) continue;
      if (/[.?!,;:]$/.test(line)) continue;
      if (EXCLUDED_TITLE_LINES.test(line)) continue;
      const words = line.split(/\s+/);
      if (words.length < 2 || words.length > 6) continue;
      let caps = 0;
      let ok = true;
      for (const w of words) {
        if (/^[A-Z][A-Za-z-]*$/.test(w)) caps++;
        else if (TITLE_STOPWORDS.has(w.toLowerCase())) continue;
        else { ok = false; break; }
      }
      if (!ok || caps < 2) continue;
      const key = line.toLowerCase().replace(/\s+/g, ' ');
      if (!keys.has(key)) {
        keys.add(key);
        if (!evidence.includes(c.chunk_id)) evidence.push(c.chunk_id);
      }
    }
  }
  return { keys, evidence };
}

function scanHeadings(chunks: AuditChunk[]): { numbered: SeriesAccumulator; titleCase: { keys: Set<string>; evidence: string[] } } {
  const numbered = newAccumulator();
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(HEADING_RE))) {
      if (isSeriesLabelled(c.chunk_text, m.index ?? 0)) continue;
      addMember(numbered, parseInt(m[1], 10), parseInt(m[2], 10), c.chunk_id);
    }
  }
  return { numbered, titleCase: scanTitleCaseHeadings(chunks) };
}

function scanSubtopics(chunks: AuditChunk[]): { ids: Set<string>; byMajor: Map<number, Set<number>>; evidence: string[] } {
  const ids = new Set<string>();
  const byMajor = new Map<number, Set<number>>();
  const evidence: string[] = [];
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(SUBTOPIC_RE))) {
      if (isSeriesLabelled(c.chunk_text, m.index ?? 0)) continue;
      const major = parseInt(m[1], 10);
      const id = `${major}.${m[2]}.${m[3]}`;
      ids.add(id);
      const set = byMajor.get(major) ?? new Set<number>();
      set.add(parseInt(m[2], 10)); // section-level minor for series metadata
      byMajor.set(major, set);
      if (!evidence.includes(c.chunk_id)) evidence.push(c.chunk_id);
    }
  }
  return { ids, byMajor, evidence };
}

// ─── Summary blocks (fingerprint-deduped — overlap-safe) ─────────────────────

const SUMMARY_HEADER_RES = [
  /\bSUMMARY\b/g, // all-caps only — lowercase "in summary" prose must not fire
  /\b\d{1,2}\.\d{1,2}\s+Summary\b/g, // numbered "6.6 Summary"
  /\bWhat\s+have\s+we\s+learnt\b/gi,
  /\bWhat\s+you\s+have\s+learnt\b/gi,
  /\bPoints\s+to\s+Ponder\b/gi,
];

function normalizeFingerprint(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

function scanSummaryBlocks(chunks: AuditChunk[]): { count: number; evidence: string[] } {
  const fingerprints: string[] = [];
  const evidence: string[] = [];
  for (const c of chunks) {
    for (const re of SUMMARY_HEADER_RES) {
      for (const m of c.chunk_text.matchAll(fresh(re))) {
        const start = (m.index ?? 0) + m[0].length;
        const fp = normalizeFingerprint(c.chunk_text.slice(start, start + 80));
        if (fp.length < 8) continue; // header at a chunk tail — unusable window
        // prefix-tolerant dedupe: overlap copies may truncate the window
        const dup = fingerprints.some((f) => f.startsWith(fp) || fp.startsWith(f));
        if (dup) continue;
        fingerprints.push(fp);
        if (!evidence.includes(c.chunk_id)) evidence.push(c.chunk_id);
      }
    }
  }
  return { count: fingerprints.length, evidence };
}

// ─── Keywords blocks (enumerable terms) ──────────────────────────────────────

const KEYWORD_HEADER_RE = /\bK(?:EYWORDS?|eywords?)\b|\bNew\s+Terms\b|\bNEW\s+TERMS\b/g;
/** Where a keyword list stops: the next block header or a blank line. */
const KEYWORD_BLOCK_END_RE =
  /\bLet us enhance our learning\b|\bEXERCISES?\b|\bSUMMARY\b|\bIntext\s+Questions?\b|\bWhat\s+have\s+we\s+learnt\b|\bWhat\s+you\s+have\s+learnt\b|\bPoints\s+to\s+Ponder\b|\n\s*\n/i;

function scanKeywords(chunks: AuditChunk[]): { count: number; evidence: string[]; blocksSeen: number } {
  const terms = new Set<string>();
  const evidence: string[] = [];
  let blocksSeen = 0;
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(KEYWORD_HEADER_RE))) {
      blocksSeen++;
      let window = c.chunk_text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 600);
      const end = window.match(KEYWORD_BLOCK_END_RE);
      if (end && end.index !== undefined) window = window.slice(0, end.index);
      for (const rawTerm of window.split(/[/,;•|\n]/)) {
        const term = rawTerm.trim();
        if (term.length < 2 || term.length > 40) continue;
        if (!/^[A-Z]/.test(term)) continue;
        if (term.split(/\s+/).length > 4) continue;
        terms.add(term.toLowerCase());
      }
      if (!evidence.includes(c.chunk_id)) evidence.push(c.chunk_id);
    }
  }
  return { count: terms.size, evidence, blocksSeen };
}

// ─── Pages (explicit markers only — never estimated) ─────────────────────────

const PAGE_MARKER_RE = /\[\s*page\s+(\d{1,4})\s*\]|\bPage\s+(\d{1,4})\b/g;

function scanPages(chunks: AuditChunk[]): { count: number; evidence: string[] } {
  const pages = new Set<number>();
  const evidence: string[] = [];
  for (const c of chunks) {
    for (const m of c.chunk_text.matchAll(fresh(PAGE_MARKER_RE))) {
      const n = parseInt(m[1] ?? m[2], 10);
      if (!Number.isFinite(n) || n < 1) continue;
      pages.add(n);
      if (!evidence.includes(c.chunk_id)) evidence.push(c.chunk_id);
    }
  }
  return { count: pages.size, evidence };
}

// ─── Exercises (moved from coverage.ts; found-counter + expected) ────────────

/** Is this chunk plausibly part of an exercise / question-set block? */
export function isExerciseChunk(c: AuditChunk): boolean {
  if (c.content_type && /exercise|question/i.test(c.content_type)) return true;
  return (
    /\bEXERCISES?\b/i.test(c.chunk_text.slice(0, 400)) ||
    /\bExercises\b/.test(c.chunk_text) ||
    /\bIntext\s+Questions?\b/i.test(c.chunk_text) ||
    /\bLet us enhance our learning\b/i.test(c.chunk_text)
  );
}

/**
 * Question-set header: mid-chapter "Exercise N.M", end-of-chapter "Exercises" /
 * "Let us enhance our learning", or NCERT "Intext Questions".
 */
const SET_HEADER_RE = /\bEXERCISES?\b(?:\s+(\d{1,2}\.\d{1,3}))?|\bIntext\s+Questions?\b|\bLet us enhance our learning\b/i;

function setKeyForHeader(m: RegExpMatchArray): string {
  if (m[1]) return `exercise ${m[1]}`;
  const label = m[0].toLowerCase();
  if (label.includes('intext')) return 'intext questions';
  if (label.includes('enhance')) return 'let us enhance our learning';
  return 'exercises';
}

export interface ExerciseScanResult {
  /** set key → raw line-start question numbers seen (may repeat via overlap) */
  sets: Map<string, number[]>;
  evidence: string[];
}

/**
 * Scan exercise-flagged chunks for question sets. Sets are keyed by header
 * label so overlap-duplicated chunks MERGE into one set. Question numbering is
 * the ONE place a line-start requirement is genuinely needed (a "42." mid-prose
 * must not count) — everything else in this module matches inline.
 */
export function scanExerciseSets(chunks: AuditChunk[]): ExerciseScanResult {
  const exerciseChunks = chunks.filter(isExerciseChunk);
  const sets = new Map<string, number[]>();
  const evidence = exerciseChunks.map((c) => c.chunk_id);
  const exerciseText = exerciseChunks.map((c) => c.chunk_text).join('\n');
  if (!exerciseText) return { sets, evidence };

  let currentKey = 'default';
  for (const line of exerciseText.split('\n')) {
    const header = line.match(SET_HEADER_RE);
    if (header) {
      currentKey = setKeyForHeader(header);
      if (!sets.has(currentKey)) sets.set(currentKey, []);
      continue;
    }
    const q = line.match(/^\s{0,4}(\d{1,2})[.)]\s+/);
    if (!q) continue;
    const n = parseInt(q[1], 10);
    if (n < 1 || n > MAX_EXERCISE_QUESTION) continue;
    const arr = sets.get(currentKey) ?? [];
    arr.push(n);
    sets.set(currentKey, arr);
  }
  return { sets, evidence };
}

/** A set is reliable when its numbering starts near 1 (min ≤ 2). */
function reliableSets(scan: ExerciseScanResult): Array<[string, number[]]> {
  return [...scan.sets.entries()].filter(([, nums]) => nums.length > 0 && Math.min(...nums) <= 2);
}

/**
 * EXPECTED chapter question count: per-set numbering continuity — SUM of
 * per-set MAXIMA across reliable sets (each set restarts at 1). Unchanged v1
 * semantics; the implementation moved here from coverage.ts (which re-exports).
 */
export function deriveExpectedExercises(chunks: AuditChunk[]): number | null {
  const reliable = reliableSets(scanExerciseSets(chunks));
  if (reliable.length === 0) return null;
  return reliable.reduce((sum, [, nums]) => sum + Math.max(...nums), 0);
}

/**
 * FOUND question count (v2): SUM of per-set DISTINCT question numbers actually
 * present. found ≤ expected by construction; truncation (1,2,3,7 observed)
 * shows up as found 4 / expected 7 instead of being silently equal.
 */
export function countFoundExerciseQuestions(chunks: AuditChunk[]): { found: number; perSet: Map<string, number> } {
  const reliable = reliableSets(scanExerciseSets(chunks));
  const perSet = new Map<string, number>();
  let found = 0;
  for (const [key, nums] of reliable) {
    const distinct = new Set(nums).size;
    perSet.set(key, distinct);
    found += distinct;
  }
  return { found, perSet };
}

// ─── Gap labels (deterministic suspected_missing) ─────────────────────────────

function gapLabels(dimLabel: string, byMajor: Map<number, Set<number>>, nativeMajor: number): string[] {
  const minors = byMajor.get(nativeMajor);
  if (!minors || minors.size === 0) return [];
  const max = Math.max(...minors);
  const missing: number[] = [];
  for (let i = 1; i <= max; i++) if (!minors.has(i)) missing.push(i);
  return missing
    .slice(0, MAX_GAP_LABELS_PER_DIMENSION)
    .map((i) => `${dimLabel} ${nativeMajor}.${i} absent (numbering gap)`);
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

const capEvidence = (ids: string[]) => ids.slice(0, MAX_EVIDENCE_IDS);

function toMajorsCount(byMajor: Map<number, Set<number>>): Map<number, number> {
  return new Map([...byMajor.entries()].map(([major, minors]) => [major, minors.size]));
}

/**
 * Run the full deterministic scan. Input chunks may overlap arbitrarily —
 * every count is dedupe-by-identifier. chapterNumber anchors gap detection
 * (native major); foreign majors are still COUNTED (count-as-is posture) and
 * reported via series metadata for contamination.ts to judge.
 */
export function runStructuralScan(chunks: AuditChunk[], chapterNumber: number): StructuralScanResult {
  const diagrams = scanDottedSeries(chunks, FIG_RE);
  const tables = scanDottedSeries(chunks, TABLE_RE);
  const activities = scanDottedSeries(chunks, ACTIVITY_RE);
  const captions = scanCaptions(chunks);
  const examples = scanExamples(chunks);
  const headings = scanHeadings(chunks);
  const subtopics = scanSubtopics(chunks);
  const summary = scanSummaryBlocks(chunks);
  const keywords = scanKeywords(chunks);
  const pages = scanPages(chunks);
  const exerciseScan = scanExerciseSets(chunks);
  const exercisesFound = countFoundExerciseQuestions(chunks);
  const exercisesExpected = deriveExpectedExercises(chunks);

  const det = (detail: string) => `deterministic structural scan: ${detail}`;
  const perSetNote = [...exercisesFound.perSet.entries()].map(([k, n]) => `${k}=${n}`).join(', ');

  const findings: Record<StructuralDimension, DimensionFinding> = {
    pages: {
      found_count: pages.count,
      evidence_chunk_ids: capEvidence(pages.evidence),
      notes: det(pages.count === 0 ? 'no explicit page markers in chunk text' : `${pages.count} distinct page markers`),
    },
    headings: {
      found_count: headings.numbered.ids.size + headings.titleCase.keys.size,
      evidence_chunk_ids: capEvidence([...headings.numbered.evidence, ...headings.titleCase.evidence]),
      notes: det(`${headings.numbered.ids.size} numbered N.M headings + ${headings.titleCase.keys.size} TitleCase-line headings`),
    },
    subtopics: {
      found_count: subtopics.ids.size,
      evidence_chunk_ids: capEvidence(subtopics.evidence),
      notes: det(`${subtopics.ids.size} distinct N.M.K subtopic numbers`),
    },
    examples: {
      found_count: examples.acc.ids.size,
      evidence_chunk_ids: capEvidence(examples.acc.evidence),
      notes: det(`${examples.acc.ids.size} distinct Example identifiers (dotted N.M + bare N)`),
    },
    solved_examples: {
      found_count: examples.solvedIds.size,
      evidence_chunk_ids: capEvidence(examples.solvedEvidence),
      notes: det(`${examples.solvedIds.size} examples with a solution marker nearby`),
    },
    exercises: {
      found_count: exercisesFound.found,
      evidence_chunk_ids: capEvidence(exerciseScan.evidence),
      notes: det(
        `sum of per-set distinct question numbers${perSetNote ? ` (${perSetNote})` : ''}` +
          (exercisesExpected !== null ? `; continuity expects ${exercisesExpected}` : ''),
      ),
    },
    activities: {
      found_count: activities.ids.size,
      evidence_chunk_ids: capEvidence(activities.evidence),
      notes: det(`${activities.ids.size} distinct Activity N.M`),
    },
    tables: {
      found_count: tables.ids.size,
      evidence_chunk_ids: capEvidence(tables.evidence),
      notes: det(`${tables.ids.size} distinct Table N.M`),
    },
    diagrams: {
      found_count: diagrams.ids.size,
      evidence_chunk_ids: capEvidence(diagrams.evidence),
      notes: det(`${diagrams.ids.size} distinct Fig./Figure N.M`),
    },
    captions: {
      found_count: captions.ids.size,
      evidence_chunk_ids: capEvidence(captions.evidence),
      notes: det(`${captions.ids.size} distinct Fig N.M with ":"/"." caption text`),
    },
    summary: {
      found_count: summary.count,
      evidence_chunk_ids: capEvidence(summary.evidence),
      notes: det(`${summary.count} distinct summary blocks (fingerprint-deduped)`),
    },
    keywords: {
      found_count: keywords.count,
      evidence_chunk_ids: capEvidence(keywords.evidence),
      notes: det(
        keywords.blocksSeen === 0
          ? 'no Keywords/New Terms block'
          : `${keywords.count} distinct terms across ${keywords.blocksSeen} block occurrence(s)`,
      ),
    },
  };

  // Series metadata for contamination (majors → distinct member counts).
  const exerciseMajors = new Map<number, Set<number>>();
  for (const key of exerciseScan.sets.keys()) {
    const m = key.match(/^exercise (\d{1,2})\.(\d{1,3})$/);
    if (!m) continue;
    const major = parseInt(m[1], 10);
    const set = exerciseMajors.get(major) ?? new Set<number>();
    set.add(parseInt(m[2], 10));
    exerciseMajors.set(major, set);
  }
  const series: SeriesMeta[] = [
    { dimension: 'diagrams', majorsSeen: toMajorsCount(diagrams.byMajor) },
    { dimension: 'tables', majorsSeen: toMajorsCount(tables.byMajor) },
    { dimension: 'activities', majorsSeen: toMajorsCount(activities.byMajor) },
    { dimension: 'examples', majorsSeen: toMajorsCount(examples.acc.byMajor) },
    { dimension: 'headings', majorsSeen: toMajorsCount(headings.numbered.byMajor) },
    { dimension: 'subtopics', majorsSeen: toMajorsCount(subtopics.byMajor) },
    { dimension: 'exercises', majorsSeen: toMajorsCount(exerciseMajors) },
  ];

  const suspectedMissing = [
    ...gapLabels('Fig.', diagrams.byMajor, chapterNumber),
    ...gapLabels('Activity', activities.byMajor, chapterNumber),
    ...gapLabels('Table', tables.byMajor, chapterNumber),
    ...gapLabels('Example', examples.acc.byMajor, chapterNumber),
  ];

  // Exhaustiveness guard: every structural dimension has a finding.
  for (const d of STRUCTURAL_DIMENSIONS) {
    if (!findings[d]) throw new Error(`structural scan missing dimension ${d}`);
  }

  return { findings, series, summaryBlockCount: summary.count, suspectedMissing };
}
