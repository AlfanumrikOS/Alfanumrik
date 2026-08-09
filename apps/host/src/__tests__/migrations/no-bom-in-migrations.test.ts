import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deploy-blocker regression (2026-08-09): UTF-8 BOM in a migration file.
 *
 * Incident: `supabase/migrations/20260814000000_answer_key_oracle_closure_and_v1_gate.sql`
 * was committed with a leading UTF-8 BOM (bytes EF BB BF). PostgreSQL has no
 * concept of a byte-order mark — it parses those bytes as a token — so
 * `supabase db push` aborted the ENTIRE migration chain in the production
 * deploy job with:
 *
 *   ERROR: syntax error at or near "<BOM>" (SQLSTATE 42601)
 *   At statement: 0
 *
 * The BOM was invisible to every existing check: Node's
 * `fs.readFileSync(path, 'utf8')` silently retains it as U+FEFF, git renders it
 * as a zero-width mark, and the migration linter stripped comments before
 * matching. This test therefore reads raw Buffers — the only representation in
 * which the BOM is actually detectable.
 *
 * Three layers of guard:
 *   1. No migration under supabase/migrations/*.sql starts with a BOM (durable
 *      scan of the real directory — fails loudly if anyone reintroduces one).
 *   2. Named witness: the specific file from this incident is clean.
 *   3. scripts/lint-migrations.js still carries the BOM rule, so the CI linter
 *      cannot silently lose the PR-time gate and push detection back to deploy.
 */

const MIGRATIONS_DIR = 'supabase/migrations';
const WITNESS_FILE = '20260814000000_answer_key_oracle_closure_and_v1_gate.sql';
const LINTER_FILE = 'scripts/lint-migrations.js';

/**
 * Vitest may run with cwd at the repo root or at `apps/host/`; migrations and
 * scripts live at the repo ROOT in either case. Same helper shape as the
 * sibling `answer-key-oracle-closure.test.ts`.
 */
function resolveRepo(rel: string): string | null {
  for (const c of [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readFile(rel: string): string {
  const resolved = resolveRepo(rel);
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf-8');
}

/** Raw bytes — required: a utf8 read would hide the BOM behind U+FEFF. */
function readBuffer(abs: string): Buffer {
  return fs.readFileSync(abs);
}

function hasUtf8Bom(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

const MIGRATIONS_ABS = resolveRepo(MIGRATIONS_DIR);

describe('migrations: no UTF-8 BOM (Postgres 42601 deploy blocker)', () => {
  it('locates the real supabase/migrations directory', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
  });

  // Top-level *.sql only — the same scope as scripts/lint-migrations.js
  // (`_legacy/` and other subdirectories are excluded).
  const sqlFiles: string[] = MIGRATIONS_ABS
    ? fs
        .readdirSync(MIGRATIONS_ABS, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.sql'))
        .map((e) => e.name)
        .sort()
    : [];

  it('scans a non-trivial number of migration files (guards against a broken glob)', () => {
    // Non-vacuity: the chain had 568 top-level .sql files at the time of the
    // incident. A directory read that silently returns 0-2 entries would make
    // the BOM assertion below pass for the wrong reason.
    expect(sqlFiles.length).toBeGreaterThan(100);
  });

  it('no migration file begins with a UTF-8 BOM (EF BB BF)', () => {
    const offenders = sqlFiles.filter((name) =>
      hasUtf8Bom(readBuffer(path.join(MIGRATIONS_ABS as string, name))),
    );
    // Named offenders in the failure message so the fix is obvious.
    expect(offenders).toEqual([]);
  });

  it('the sanity check itself detects a BOM when one is present', () => {
    // Pins the detector, not the corpus: if hasUtf8Bom() were ever broken to
    // always return false, the scan above would pass vacuously.
    expect(hasUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x2d, 0x2d]))).toBe(true);
    expect(hasUtf8Bom(Buffer.from('-- Migration: x', 'utf8'))).toBe(false);
  });

  describe('named witness: 20260814000000_answer_key_oracle_closure_and_v1_gate.sql', () => {
    const witnessAbs = resolveRepo(`${MIGRATIONS_DIR}/${WITNESS_FILE}`);

    it('exists', () => {
      expect(witnessAbs).not.toBeNull();
    });

    it('does not start with a UTF-8 BOM', () => {
      const buf = readBuffer(witnessAbs as string);
      expect(buf.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
    });

    it('starts with the ASCII SQL comment marker', () => {
      const buf = readBuffer(witnessAbs as string);
      expect(buf.subarray(0, 3).toString('utf8')).toBe('-- ');
      expect(buf.readUInt8(0)).toBe(0x2d);
    });
  });

  describe('CI linter carries the BOM rule', () => {
    const linter = readFile(LINTER_FILE);

    it('scripts/lint-migrations.js exists', () => {
      expect(linter.length).toBeGreaterThan(0);
    });

    it('defines a BOM detection rule over raw bytes', () => {
      expect(linter).toMatch(/function\s+findBomFiles\s*\(/);
      // Must compare bytes, not a decoded string, or the BOM is invisible.
      expect(linter).toMatch(/0xef/i);
      expect(linter).toMatch(/0xbb/i);
      expect(linter).toMatch(/0xbf/i);
    });

    it('invokes the rule from main() and fails the build', () => {
      expect(linter).toMatch(/findBomFiles\(files\)/);
      const idx = linter.indexOf('const bomFiles = findBomFiles(files)');
      expect(idx).toBeGreaterThan(-1);
      // The guard must exit non-zero, not merely warn.
      expect(linter.slice(idx, idx + 1600)).toMatch(/process\.exit\(1\)/);
    });

    it('explains the 42601 failure mode in the offender message', () => {
      expect(linter).toMatch(/42601/);
      expect(linter).toMatch(/db push/i);
    });
  });
});
