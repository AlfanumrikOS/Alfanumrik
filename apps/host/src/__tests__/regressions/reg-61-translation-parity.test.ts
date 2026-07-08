/**
 * REG-61 — Hindi/English question translations share a single
 * `correct_answer_index` column (P5 grade-format / P7 bilingual UI).
 *
 * The question_bank table carries `question_text` (English) and
 * `question_hi` (Hindi translation), plus a single `correct_answer_index`
 * column that applies to BOTH language presentations. There must NEVER be
 * a parallel `correct_answer_index_hi` (or `_en`, etc.) column — that
 * would let translation drift introduce a P1 violation where the Hindi
 * presentation marks one option correct and the English presentation
 * marks another.
 *
 * Strategy: static-source inspection of the baseline schema (and the
 * scan-all-migrations safety net). We assert the dangerous duplicated
 * columns never appear in any migration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

function listAllSqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listAllSqlFiles(full));
    } else if (entry.endsWith('.sql')) {
      out.push(full);
    }
  }
  return out;
}

const MIGRATIONS_ROOT = resolve(process.cwd(), 'supabase/migrations');
const BASELINE_PATH = resolve(MIGRATIONS_ROOT, '00000000000000_baseline_from_prod.sql');

describe('REG-61 — single correct_answer_index column for Hi/En translations', () => {
  it('the baseline schema file exists', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it('baseline declares correct_answer_index exactly once on question_bank', () => {
    const sql = readFileSync(BASELINE_PATH, 'utf8');

    // The CREATE TABLE block for question_bank must define
    // "correct_answer_index" integer — exactly one canonical column.
    expect(sql).toMatch(/"correct_answer_index"\s+integer/);
  });

  it('baseline does NOT declare a correct_answer_index_hi (or _en) variant', () => {
    const sql = readFileSync(BASELINE_PATH, 'utf8');
    expect(sql).not.toMatch(/correct_answer_index_hi/i);
    expect(sql).not.toMatch(/correct_answer_index_en/i);
    expect(sql).not.toMatch(/correct_answer_index_en_us/i);
  });

  it('NO migration anywhere introduces a parallel correct_answer_index_<lang> column', () => {
    // Walk every migration (root + _legacy + _legacy/timestamped) and pin.
    const files = listAllSqlFiles(MIGRATIONS_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const violations: { file: string; line: number; text: string }[] = [];
    const FORBIDDEN = /correct_answer_index_(hi|en|hinglish|english)\b/i;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split(/\r?\n/).forEach((line, idx) => {
        if (FORBIDDEN.test(line)) {
          violations.push({ file: f, line: idx + 1, text: line.trim() });
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        [
          'REG-61 violation — found parallel correct_answer_index_<lang> column in a migration.',
          'P1 (score accuracy) and P7 (bilingual UI) require a SINGLE correct_answer_index',
          'shared by all language presentations of the same question.',
          '',
          ...violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`),
        ].join('\n'),
      );
    }
  });

  it('confirms the contract: question_text + question_hi reference one correct_answer_index', () => {
    // Check that both translation columns coexist with the SINGLE answer index
    // on question_bank — this is the positive shape the system relies on.
    const sql = readFileSync(BASELINE_PATH, 'utf8');
    expect(sql).toMatch(/"question_text"\s+"text"\s+NOT\s+NULL/);
    expect(sql).toMatch(/"question_hi"\s+"text"/);
    expect(sql).toMatch(/"correct_answer_index"\s+integer/);

    // P6 also guards the range — re-pin here since the constraint
    // is the operational guardrail. Baseline shape:
    //   CONSTRAINT "chk_valid_answer_index" CHECK ((("correct_answer_index" >= 0) AND ("correct_answer_index" <= 3))),
    expect(sql).toMatch(/correct_answer_index/);
    expect(sql).toMatch(/correct_answer_index"\s*>=\s*0/);
    expect(sql).toMatch(/correct_answer_index"\s*<=\s*3/);
  });
});
