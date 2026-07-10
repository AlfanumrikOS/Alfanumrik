import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL_REL = 'scripts/historical-xp-inflation-quantification.sql';
const MANIFEST_REL = 'scripts/student-learning-readiness.json';

type ReadinessArtifact = {
  id: string;
  rcaItem: string;
  path: string;
  status: string;
  readinessRole: string;
  evidence: string[];
};

type ReadinessManifest = {
  remainingFollowUps: string[];
  artifacts: ReadinessArtifact[];
};

function resolveRepo(rel: string): string | null {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readRepo(rel: string): string {
  const path = resolveRepo(rel);
  expect(path, `${rel} should exist`).toBeTruthy();
  return readFileSync(path!, 'utf8').replace(/\r/g, '');
}

function executableSql(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('RCA-06 historical XP inflation quantification', () => {
  it('provides a read-only SQL artifact for the pre-clamp decision', () => {
    const raw = readRepo(SQL_REL);
    const exec = executableSql(raw);

    expect(raw).toContain('RCA-06');
    expect(raw).toContain('SLC-1-backfill');
    expect(raw).toContain('READ ONLY');
    expect(exec).toMatch(/\bWITH\b/i);
    expect(exec).toMatch(/\bSELECT\b/i);

    for (const forbidden of [
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
      /\bUPSERT\b/i,
      /\bMERGE\b/i,
      /\bALTER\b/i,
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bCREATE\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
    ]) {
      expect(exec, `forbidden SQL matched ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('quantifies the inflation dimensions needed for CEO/product-comms review', () => {
    const sql = readRepo(SQL_REL);

    for (const snippet of [
      'daily_over_cap',
      'duplicate_reference_ids',
      'cached_total_vs_ledger_delta',
      'student_impact_summary',
      'leaderboard_risk_sample',
      'xp_transactions',
      'quiz_sessions',
      'students.xp_total',
    ]) {
      expect(sql).toContain(snippet);
    }
  });

  it('links the quantification artifact from the student-learning readiness manifest', () => {
    const manifest = JSON.parse(readRepo(MANIFEST_REL)) as ReadinessManifest;
    const artifact = manifest.artifacts.find(
      (entry) => entry.id === 'slc1-historical-xp-quantification',
    );

    expect(artifact).toBeTruthy();
    expect(artifact?.rcaItem).toBe('RCA-06');
    expect(artifact?.path).toBe(SQL_REL);
    expect(artifact?.status).toBe('operator_gate');
    expect(artifact?.readinessRole).toContain('read-only');

    const followUps = manifest.remainingFollowUps.join('\n');
    expect(followUps).toContain('scripts/historical-xp-inflation-quantification.sql');

    const sql = readRepo(SQL_REL);
    for (const snippet of artifact?.evidence ?? []) {
      expect(sql, `missing evidence: ${snippet}`).toContain(snippet);
    }
  });
});
