import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS_ROOT = resolve(REPO_ROOT, 'supabase', 'migrations');
const baseline = readFileSync(
  resolve(MIGRATIONS_ROOT, '00000000000000_baseline_from_prod.sql'),
  'utf8',
);
const canonicalRepair = readFileSync(
  resolve(
    MIGRATIONS_ROOT,
    '20260620000900_fix_match_rag_chunks_drop_syllabus_version.sql',
  ),
  'utf8',
);
const closedQualityPredicate =
  /AND \(c\.quality_score IS NULL OR c\.quality_score >= p_min_quality\)/g;
const brokenQualityPredicate =
  /AND \(c\.quality_score IS NULL OR c\.quality_score >= p_min_quality\s*$/m;

function sqlBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing migration markers: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(start, end);
}

function activeMigrationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '_legacy') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return activeMigrationFiles(path);
    return entry.isFile() && entry.name.endsWith('.sql') ? [path] : [];
  });
}

describe('fresh-schema replay parser repairs', () => {
  it('restores only the six baseline predicates removed by 003ff05d', () => {
    const matchRagChunks = sqlBetween(
      baseline,
      'CREATE OR REPLACE FUNCTION "public"."match_rag_chunks"(',
      'COMMENT ON FUNCTION "public"."match_rag_chunks"(',
    );
    const matchRagChunksNcert = sqlBetween(
      baseline,
      'CREATE OR REPLACE FUNCTION "public"."match_rag_chunks_ncert"(',
      'COMMENT ON FUNCTION "public"."match_rag_chunks_ncert"(',
    );

    expect(baseline.match(/REPLAY-ONLY PARSER CORRECTION \(003ff05d\)/g)).toHaveLength(2);
    expect(matchRagChunks.match(closedQualityPredicate)).toHaveLength(2);
    expect(matchRagChunksNcert.match(closedQualityPredicate)).toHaveLength(4);
    expect(matchRagChunks).not.toMatch(brokenQualityPredicate);
    expect(matchRagChunksNcert).not.toMatch(brokenQualityPredicate);
  });

  it('restores only the two predicates in the already-applied canonical migration', () => {
    expect(canonicalRepair).toMatch(
      /this migration timestamp is already\r?\n-- recorded as applied in production/,
    );
    expect(canonicalRepair.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(canonicalRepair.match(closedQualityPredicate)).toHaveLength(2);
    expect(canonicalRepair).not.toMatch(brokenQualityPredicate);
  });

  it('finds no analogous unclosed p_min_quality predicate in active migration history', () => {
    const offenders = activeMigrationFiles(MIGRATIONS_ROOT).filter((file) =>
      brokenQualityPredicate.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
