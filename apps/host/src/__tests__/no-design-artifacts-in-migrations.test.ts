import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * P0 incident regression (2026-08-23 18:11 UTC): a design artifact was applied
 * to PRODUCTION because it lived in an auto-applying directory.
 *
 * `supabase/migrations/20260823154500_..._DESIGN_ONLY.sql` carried a header
 * stating, in capitals, that it had NOT been applied to any environment and
 * must not be `supabase db push`-ed. It was written as an assessment-only
 * design document. The next `supabase db push --linked --include-all` swept it
 * up in version order and applied it to production anyway, silently executing
 *
 *   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 *     REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
 *
 * THE ROOT CAUSE IS A CATEGORY ERROR, NOT A TYPO. A comment is advisory;
 * `supabase/migrations/` is not. A file that says "do not run me" while sitting
 * in a directory where everything is run is a contradiction that no tool in the
 * chain could see. This test makes that contradiction fail at PR time.
 *
 * The remedy is NEVER "delete the marker text" — that would leave a genuinely
 * un-reviewed design artifact auto-applying in silence, which is strictly
 * worse. The remedy is to MOVE the file to `docs/runbooks/`, where this repo
 * already keeps 8 `*.DOWN.sql` rollback scripts.
 *
 * ── WHY THIS FILE IS AT THE TOP OF src/__tests__/ AND NOT IN migrations/ ──
 * `src/__tests__/migrations/**` is the LIVE-DB INTEGRATION lane: it is excluded
 * from the normal per-PR lane in `vitest.config.ts` (INTEGRATION_TEST_PATTERNS)
 * and only runs under `test:integration` with real Supabase credentials. This
 * guard is a pure filesystem scan needing no database, and — more to the point
 * — it must run in the lane that actually gates merges. Placing it beside
 * `no-bom-in-migrations.test.ts` would have read as the natural home and would
 * have quietly kept it out of every PR run. Same deliberate placement, and same
 * reason, as `purchase-streak-freeze-coin-source.test.ts`.
 *
 * Three layers, mirroring `no-bom-in-migrations.test.ts`:
 *   1. Durable corpus scan of the real directory.
 *   2. The detector is non-vacuous (it fires on known-bad synthetic inputs).
 *   3. `scripts/lint-migrations.js` still carries the rule, so the PR-time gate
 *      cannot be silently lost. That matters more than usual here: as of
 *      2026-08-23 the "Lint migrations" workflow is NOT a ruleset-required
 *      status check, so THIS TEST is the layer that actually blocks a merge.
 */

const MIGRATIONS_DIR = 'supabase/migrations';
const LINTER_FILE = 'scripts/lint-migrations.js';

/** The one file grandfathered in the linter. See GRANDFATHER block below. */
const GRANDFATHERED = [
  '20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql',
];

/** Vitest may run with cwd at the repo root or at `apps/host/`. */
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

const MIGRATIONS_ABS = resolveRepo(MIGRATIONS_DIR);

// ── The detector, kept deliberately in lockstep with scripts/lint-migrations.js ──
//
// Calibrated against all 618 top-level migrations before shipping. Patterns that
// were REJECTED for being unusable, recorded so nobody "helpfully" re-adds them:
//   - bare /DO NOT/          → 151 files.
//   - /DO NOT APPLY/         → 8 files, all ordinary prose ("they do not apply
//                              to other migrations").
//   - /DO NOT RUN/           → 9 files ("do NOT run more often than...").
// Worse than noisy, /DO NOT APPLY/ INVERTS meaning on
// 20260821070000_create_v_xp_ledger_drift.sql, whose header reads "DO NOT APPLY
// IT WITH `apply_migration`" — that file MUST be applied, just via db push.

const FILENAME_MARKER_RE =
  /(?:^|_)(DESIGN_ONLY|DO_NOT_APPLY|DO_NOT_RUN|DO_NOT_DEPLOY|DO_NOT_MERGE|NOT_APPLIED|DRAFT|WIP|TODO|SCRATCH|TEMPLATE|EXAMPLE|SAMPLE)(?:_|\.)/;

const BODY_MARKER_RES: ReadonlyArray<readonly [string, RegExp]> = [
  ['DO NOT ... db push', /\bDO\s+NOT\s+(?:EVER\s+)?[`'"]*(?:supabase\s+)?db[\s_-]?push\b/i],
  ['DO NOT MOVE THIS FILE INTO', /\bDO\s+NOT\s+MOVE\s+THIS\s+FILE\s+INTO\b/i],
  ['THIS FILE HAS NOT BEEN APPLIED', /\bTHIS\s+FILE\s+(?:HAS\s+)?NOT\s+BEEN\s+APPLIED\b/i],
  ['NOT A MIGRATION', /\bNOT\s+A\s+MIGRATION\b/i],
  ['DO NOT MERGE / DO NOT DEPLOY', /\bDO\s+NOT\s+(?:MERGE|DEPLOY)\b/i],
  // Negative lookahead drops `..._DESIGN_ONLY.sql` filename CITATIONS, which
  // are legitimate — the remediation migration must be able to name the file
  // it is reversing.
  ['DESIGN ONLY body marker', /\bDESIGN[_\s-]ONLY\b(?!\.sql)/i],
];

const ALLOW_MARKER_RE = /--\s*lint:allow-design-marker\b/i;

function findMarkers(baseName: string, raw: string): string[] {
  const hits: string[] = [];
  const fn = FILENAME_MARKER_RE.exec(baseName);
  // Filename markers are NOT opt-out-able.
  if (fn) hits.push(`filename segment "${fn[1]}"`);
  if (!ALLOW_MARKER_RE.test(raw)) {
    for (const [name, re] of BODY_MARKER_RES) if (re.test(raw)) hits.push(`body "${name}"`);
  }
  return hits;
}

describe('migrations: no "do not apply me" design artifacts in an auto-applying directory', () => {
  it('locates the real supabase/migrations directory', () => {
    expect(MIGRATIONS_ABS).not.toBeNull();
  });

  // Top-level *.sql only — same scope as scripts/lint-migrations.js.
  const sqlFiles: string[] = MIGRATIONS_ABS
    ? fs
        .readdirSync(MIGRATIONS_ABS, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.sql'))
        .map((e) => e.name)
        .sort()
    : [];

  it('scans a non-trivial number of migration files (guards against a broken glob)', () => {
    // Non-vacuity: 618 top-level .sql files at the time this test was written.
    // A directory read that silently returned 0-2 entries would make the scan
    // below pass for the wrong reason.
    expect(sqlFiles.length).toBeGreaterThan(100);
  });

  it('no migration declares that it must not be applied', () => {
    const offenders = sqlFiles
      .filter((n) => !GRANDFATHERED.includes(n))
      .map((n) => {
        const raw = fs.readFileSync(path.join(MIGRATIONS_ABS as string, n), 'utf-8');
        const markers = findMarkers(n, raw);
        return markers.length > 0 ? `${n} → ${markers.join('; ')}` : null;
      })
      .filter((x): x is string => x !== null);

    // Named offenders in the failure message so the fix is obvious. The fix is
    // to MOVE the file to docs/runbooks/, not to delete the marker.
    expect(offenders).toEqual([]);
  });

  /**
   * GRANDFATHER BLOCK.
   *
   * The 2026-08-23 offender cannot simply be removed: it acquired a production
   * `schema_migrations` ledger row when it was applied, and both `supabase db
   * push` and `.github/scripts/verify-migration-ledger.sh` key off that row.
   * Deleting or renaming it makes the ledger verifier report
   * REMOTE_NOT_COMMITTED and abort the next production deploy. It is frozen in
   * place, not endorsed.
   *
   * The list must stay at exactly one entry. A second entry would mean a second
   * design artifact reached production — the incident recurring, not a lint
   * problem to be silenced.
   */
  describe('grandfathered exception is exactly one frozen file', () => {
    it('contains only the 2026-08-23 incident file', () => {
      expect(GRANDFATHERED).toEqual([
        '20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql',
      ]);
    });

    it('that file still exists (if it were removed, the ledger check would break)', () => {
      expect(resolveRepo(`${MIGRATIONS_DIR}/${GRANDFATHERED[0]}`)).not.toBeNull();
    });

    it('and it really would be flagged if it were not grandfathered', () => {
      // Pins that the exemption is load-bearing rather than vestigial.
      const raw = readFile(`${MIGRATIONS_DIR}/${GRANDFATHERED[0]}`);
      expect(findMarkers(GRANDFATHERED[0], raw).length).toBeGreaterThan(0);
    });

    it('the linter carries the identical single-entry grandfather list', () => {
      const linter = readFile(LINTER_FILE);
      expect(linter).toContain('DESIGN_MARKER_GRANDFATHERED');
      // Exactly one quoted .sql filename inside the array literal.
      const arr = /DESIGN_MARKER_GRANDFATHERED\s*=\s*\[([\s\S]*?)\]/.exec(linter);
      expect(arr).not.toBeNull();
      const entries = (arr as RegExpExecArray)[1].match(/'[^']*\.sql'/g) ?? [];
      expect(entries).toEqual([`'${GRANDFATHERED[0]}'`]);
    });
  });

  /**
   * Pins the DETECTOR, not the corpus. Without these, a detector broken to
   * always return [] would make the scan above pass vacuously — which is
   * precisely how the original incident stayed invisible.
   */
  describe('detector is non-vacuous', () => {
    it('flags a do-not-apply marker in the FILENAME even when the body is clean', () => {
      expect(findMarkers('20260901000000_thing_DESIGN_ONLY.sql', 'CREATE TABLE x();')).toHaveLength(
        1,
      );
      expect(findMarkers('20260901000000_thing_DRAFT.sql', 'CREATE TABLE x();')).toHaveLength(1);
    });

    it('flags a do-not-apply marker in the BODY even when the filename is innocuous', () => {
      // The sneaky case: nothing about the name suggests a problem.
      expect(
        findMarkers('20260901000000_some_feature.sql', '-- DO NOT `supabase db push` this.'),
      ).toHaveLength(1);
      expect(
        findMarkers('20260901000000_some_feature.sql', '-- This is NOT A MIGRATION.'),
      ).toHaveLength(1);
      expect(
        findMarkers('20260901000000_some_feature.sql', '-- THIS FILE HAS NOT BEEN APPLIED anywhere.'),
      ).toHaveLength(1);
    });

    it('the opt-out marker suppresses BODY rules but NEVER a filename marker', () => {
      const optOut = '-- lint:allow-design-marker\n-- NOT A MIGRATION\n';
      // Body rule: suppressed. A remediation migration must be able to quote
      // the phrases while documenting the incident.
      expect(findMarkers('20260901000000_ok.sql', optOut)).toEqual([]);
      // Filename rule: not suppressible.
      expect(findMarkers('20260901000000_x_DESIGN_ONLY.sql', optOut)).toHaveLength(1);
    });

    it('does not fire on ordinary prose that merely contains "do not"', () => {
      expect(
        findMarkers('20260901000000_a.sql', '-- these policies do not apply to other migrations'),
      ).toEqual([]);
      expect(findMarkers('20260901000000_b.sql', '-- do NOT run more often than hourly')).toEqual([]);
      // Cross-references to OTHER migrations must not trip the "THIS FILE" rule.
      expect(findMarkers('20260901000000_c.sql', '-- If M1 has not been applied, raise.')).toEqual(
        [],
      );
    });

    it('does not fire on 20260821070000, which says "DO NOT APPLY IT WITH `apply_migration`"', () => {
      // Inverted meaning: that file MUST be applied, just not via the MCP tool.
      // A naive /DO NOT APPLY/ rule would flag it and be actively wrong.
      const name = '20260821070000_create_v_xp_ledger_drift.sql';
      expect(findMarkers(name, readFile(`${MIGRATIONS_DIR}/${name}`))).toEqual([]);
    });

    it('does not fire on a filename CITATION of the offender', () => {
      // The remediation migration names the file it reverses; that must be legal.
      const cite = `-- Partial reversal of ${GRANDFATHERED[0]}.`;
      expect(findMarkers('20260824010000_restore_default_privileges_template.sql', cite)).toEqual(
        [],
      );
    });
  });

  /**
   * Source-level pin on scripts/lint-migrations.js so the PR-time gate cannot be
   * silently dropped.
   */
  describe('CI linter carries the design-artifact rule', () => {
    const linter = readFile(LINTER_FILE);

    it('scripts/lint-migrations.js exists', () => {
      expect(linter.length).toBeGreaterThan(0);
    });

    it('defines and wires in the detector', () => {
      expect(linter).toMatch(/function\s+findDesignArtifactMarkers\s*\(/);
      // Actually called from lintFile(), not merely defined and exported.
      const lintFileStart = linter.indexOf('function lintFile');
      expect(lintFileStart).toBeGreaterThan(-1);
      expect(linter.slice(lintFileStart)).toContain('findDesignArtifactMarkers(');
    });

    it('blocks rather than warns, and the linter can still exit non-zero', () => {
      const lintFileStart = linter.indexOf('function lintFile');
      const callIdx = linter.indexOf('findDesignArtifactMarkers(', lintFileStart);
      expect(callIdx).toBeGreaterThan(-1);
      // The branch returns a FAILING status, not a warning.
      expect(linter.slice(callIdx, callIdx + 1200)).toMatch(/status:\s*['"]fail['"]/);
      expect(linter).toMatch(/process\.exit\(1\)/);
    });

    it('tells the author to MOVE the file, not to delete the marker', () => {
      // The whole point. "Delete the marker" would silence the guard while
      // leaving an unreviewed artifact auto-applying.
      const lintFileStart = linter.indexOf('function lintFile');
      const callIdx = linter.indexOf('findDesignArtifactMarkers(', lintFileStart);
      const branch = linter.slice(callIdx, callIdx + 1600);
      expect(branch).toMatch(/MOVE the file/i);
      expect(branch).toMatch(/docs\/runbooks/);
      expect(branch).toMatch(/not just delete the marker/i);
    });

    it('runs the design-artifact rule BEFORE the body-content rules', () => {
      // "Wrong directory" outranks "your SQL body is wrong": reporting a
      // placeholder finding on a file that should not be here at all buries
      // the real problem.
      const lintFileStart = linter.indexOf('function lintFile');
      const designIdx = linter.indexOf('findDesignArtifactMarkers(', lintFileStart);
      const strippedIdx = linter.indexOf('stripComments(raw)', lintFileStart);
      expect(designIdx).toBeGreaterThan(-1);
      expect(strippedIdx).toBeGreaterThan(-1);
      expect(designIdx).toBeLessThan(strippedIdx);
    });
  });
});
