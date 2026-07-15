// eval/teacher-skills/harness/rubric-schema.ts
//
// Teacher-skills eval harness — rubric CSV TYPES + a PURE parser/validator.
// No I/O, no DB, no LLM, no network. Offline dev/CI tooling ONLY — NEVER
// imported by production / client code (same posture as eval/rag/harness/*,
// the house pattern pinned by REG-140).
//
// The rubric CSVs (eval/teacher-skills/rubrics/*.csv) are adapted from the
// Apache-2.0 "Agent Skills for K-12 Teachers" eval rubrics (vendored verbatim
// under eval/teacher-skills/vendor/ with LICENSE + NOTICE + PROVENANCE.md).
// Column schema is the upstream one, unchanged:
//
//   ID,Bucket,Criterion,What pass requires,Notes,Conditional
//
// Local extension: lines starting with '#' (at line start, outside any quoted
// field) are comments — used to carry each adapted file's Apache-2.0 §4(b)
// modification notice in-file, since CSV has no native comment syntax.
//
// PII / synthetic-only posture (structural): this harness evaluates ONLY
// synthetic fixtures. `scanForPiiKeys` (mirroring eval/rag/harness/
// golden-schema.ts) recursively rejects any artifact carrying a PII-shaped
// key, and the harness has NO Supabase client anywhere — it cannot read
// student_* / quiz_* / profiles tables even by mistake.

import { z } from 'zod';

// ─── Canonical constants ─────────────────────────────────────────────────────

/** P5 grade strings "6".."12" — mirrors eval/rag/harness/golden-schema.ts. */
export const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type Grade = (typeof GRADES)[number];

/** The exact upstream header row (order and spelling are the contract). */
export const RUBRIC_HEADER = [
  'ID',
  'Bucket',
  'Criterion',
  'What pass requires',
  'Notes',
  'Conditional',
] as const;

/**
 * Bucket letters: upstream P/R/O/M plus the Alfanumrik-additions bucket 'A'
 * (A1/A2a/A2b in ncert-lesson-planning.csv). The letter is derived from the
 * first character of the Bucket column ("P — Pedagogy" → 'P').
 */
export const BUCKET_LETTERS = ['P', 'R', 'O', 'M', 'A'] as const;
export type BucketLetter = (typeof BUCKET_LETTERS)[number];

/**
 * PII-shaped keys that must NEVER appear in any evaluated artifact (P13).
 * Byte-identical to eval/rag/harness/golden-schema.ts PII_FORBIDDEN_KEYS.
 */
export const PII_FORBIDDEN_KEYS = [
  'student_id',
  'user_id',
  'session_id',
  'email',
  'phone',
] as const;

// ─── Zod schema ──────────────────────────────────────────────────────────────

export const RubricCriterionSchema = z.object({
  /** Unique criterion id, e.g. "P4a", "QZ-P6b", "A1". */
  id: z.string().min(1),
  /** Bucket column text, e.g. "P — Pedagogy". First char must be a known letter. */
  bucket: z.string().min(1),
  /** Short criterion name. */
  criterion: z.string().min(1),
  /** The scoreable pass condition — the text the LLM judge scores against. */
  passRequires: z.string().min(1),
  /** Rationale / provenance notes (may be empty). */
  notes: z.string(),
  /** Non-empty = criterion applies only when the artifact declares this condition tag. */
  conditional: z.string(),
});

export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export interface Rubric {
  /** Rubric name = CSV basename without extension, e.g. "quiz-generation". */
  name: string;
  criteria: RubricCriterion[];
}

export type RubricParseResult =
  | { ok: true; value: Rubric }
  | { ok: false; errors: string[] };

// ─── Pure CSV parser (RFC-4180-ish + '#' comment lines) ──────────────────────

/**
 * Parse CSV text into rows of fields. Handles quoted fields with embedded
 * commas, embedded newlines, and doubled-quote escapes. Skips (a) lines whose
 * first non-consumed character at record start is '#' (comment lines — only
 * recognized at record boundaries, never inside a quoted field) and (b) fully
 * empty lines. Pure; never throws on well-formed input; unterminated quotes
 * are reported by the caller via a trailing-state flag.
 */
export function parseCsv(text: string): { rows: string[][]; error: string | null } {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let atRecordStart = true;
  let inComment = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty records (e.g. trailing newline).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    atRecordStart = true;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }

    if (atRecordStart && ch === '#' && !inQuotes) {
      inComment = true;
      continue;
    }
    if (ch !== '\r') atRecordStart = false;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (inQuotes) {
    return { rows, error: 'unterminated quoted field at end of input' };
  }
  // Flush a final record with no trailing newline.
  if (field.length > 0 || row.length > 0) pushRow();

  return { rows, error: null };
}

// ─── Rubric validator ────────────────────────────────────────────────────────

/** Derive the bucket letter from a Bucket column value ("P — Pedagogy" → 'P'). */
export function bucketLetter(bucket: string): BucketLetter | null {
  const letter = bucket.trim().charAt(0).toUpperCase();
  return (BUCKET_LETTERS as readonly string[]).includes(letter)
    ? (letter as BucketLetter)
    : null;
}

/**
 * Parse + validate one rubric CSV document into a typed Rubric. Never throws.
 * Enforces: exact upstream header, per-row Zod shape, known bucket letter,
 * unique criterion ids, at least one criterion.
 */
export function parseRubricCsv(name: string, text: string): RubricParseResult {
  const errors: string[] = [];
  const { rows, error } = parseCsv(text);
  if (error) return { ok: false, errors: [`CSV parse error: ${error}`] };

  if (rows.length === 0) return { ok: false, errors: ['rubric CSV is empty'] };

  const header = rows[0];
  if (
    header.length !== RUBRIC_HEADER.length ||
    RUBRIC_HEADER.some((h, i) => header[i]?.trim() !== h)
  ) {
    return {
      ok: false,
      errors: [
        `header must be exactly "${RUBRIC_HEADER.join(',')}" (got "${header.join(',')}")`,
      ],
    };
  }

  const criteria: RubricCriterion[] = [];
  const seenIds = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const path = `row ${r + 1}`;
    if (cells.length !== RUBRIC_HEADER.length) {
      errors.push(`${path}: expected ${RUBRIC_HEADER.length} fields, got ${cells.length}`);
      continue;
    }
    const candidate = {
      id: cells[0].trim(),
      bucket: cells[1].trim(),
      criterion: cells[2].trim(),
      passRequires: cells[3].trim(),
      notes: cells[4].trim(),
      conditional: cells[5].trim(),
    };
    const parsed = RubricCriterionSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${path} (${candidate.id || '?'}): ${issue.path.join('.')} ${issue.message}`);
      }
      continue;
    }
    if (bucketLetter(parsed.data.bucket) === null) {
      errors.push(
        `${path} (${parsed.data.id}): bucket "${parsed.data.bucket}" must start with one of {${BUCKET_LETTERS.join(', ')}}`,
      );
      continue;
    }
    if (seenIds.has(parsed.data.id)) {
      errors.push(`${path}: duplicate criterion id "${parsed.data.id}" — ids must be unique`);
      continue;
    }
    seenIds.add(parsed.data.id);
    criteria.push(parsed.data);
  }

  if (criteria.length === 0 && errors.length === 0) {
    errors.push('rubric has no criteria rows');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { name, criteria } };
}

// ─── P13 PII structural scan (mirrors eval/rag/harness/golden-schema.ts) ─────

const PII_KEY_SET: ReadonlySet<string> = new Set<string>(PII_FORBIDDEN_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively scan an artifact for any forbidden PII-shaped key (P13). Returns
 * a dotted path per hit. Walks objects AND array elements so a forbidden key
 * cannot hide inside an array. An artifact with ANY hit is rejected before it
 * is evaluated — and is NEVER sent to the LLM judge.
 */
export function scanForPiiKeys(node: unknown, path = ''): string[] {
  const errors: string[] = [];
  const walk = (n: unknown, p: string): void => {
    if (Array.isArray(n)) {
      n.forEach((el, i) => walk(el, `${p}[${i}]`));
      return;
    }
    if (isPlainObject(n)) {
      for (const key of Object.keys(n)) {
        const childPath = p ? `${p}.${key}` : key;
        if (PII_KEY_SET.has(key)) {
          errors.push(`PII-shaped key "${key}" found at ${childPath}`);
        }
        walk(n[key], childPath);
      }
    }
  };
  walk(node, path);
  return errors;
}
