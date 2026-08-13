import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * REG-399b — a release gate must be PROVABLY CAPABLE OF FAILING.
 *
 * ── SAME ROOT CAUSE AS REG-399a, DIFFERENT LAYER ────────────────────────────
 * The anon-EXECUTE hole (REG-399a) reached production and survived for months
 * because BOTH of its guards were structurally incapable of reporting it:
 *
 *   1. `REVOKE EXECUTE ... FROM anon` (no PUBLIC) is a statement that succeeds,
 *      reads authoritatively, and changes nothing. — pinned by REG-399a.
 *   2. The deploy pipeline's migration-parity step read the remote ledger with
 *          awk -F'|' 'NF>=2 { v=$2; gsub(/[^0-9]/,"",v); ... }'
 *      over `supabase migration list --linked`. The CLI renders each row with a
 *      LEADING pipe (`| local | remote | time |`), so under -F'|' the fields are
 *      $1="" $2=LOCAL $3=REMOTE $4=TIME. Field 2 is the LOCAL column. The step
 *      read the local migration set back out of the CLI's own output, called it
 *      "remote", and diffed local against itself. Both `comm` directions were
 *      empty BY CONSTRUCTION. — pinned here.
 *
 * Evidence it was a tautology and not merely lucky: four consecutive production
 * deploys printed exactly equal counts (580/580, 585/585, 587/587, 588/588)
 * while production's real ledger max was, and stayed, 20260814000011 with eight
 * committed versions absent from it. A P0 security migration was declared
 * shipped while being entirely absent from the database.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *   Part 1  the parity check reads the ledger by SQL, never by parsing rendered
 *           CLI output, and has explicit non-vacuity floors on BOTH sides.
 *   Part 2  a REGRESSION WITNESS that runs the ORIGINAL awk parser over a
 *           synthetic CLI table containing real drift and demonstrates it
 *           returns the LOCAL set — i.e. proves, by execution, that the old
 *           check could never fail. This is the non-vacuity proof: it shows the
 *           forbidden shape is genuinely blind, not merely ugly.
 *   Part 3  the live-database security assertion (`anon` holds no EXECUTE on
 *           the 7 student-data SECDEF RPCs) exists, fails closed, and treats a
 *           MISSING RPC as a failure rather than a silent pass.
 *   Part 4  both scripts are actually WIRED into the workflows and BLOCKING —
 *           a gate nobody runs is the same defect one more layer out.
 *
 * ── WHY PART 4 MATTERS MORE THAN IT LOOKS ───────────────────────────────────
 * REG-399a can only read a file. The behavioural proof that `anon` cannot
 * execute those RPCs in PRODUCTION is `assert-db-security-invariants.sh`
 * running against the live database on every deploy. If that step is unwired,
 * skipped, or `continue-on-error`, the invariant has no enforcement anywhere.
 * That is why the wiring is asserted here as a first-class property.
 *
 * No network. No database. Filesystem, YAML, and short-lived subprocesses only.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const LEDGER_SCRIPT_REL = '.github/scripts/verify-migration-ledger.sh';
const INVARIANTS_SCRIPT_REL = '.github/scripts/assert-db-security-invariants.sh';
const POOLER_SCRIPT_REL = '.github/scripts/supabase-pooler-url.py';

const PROD_WORKFLOW_REL = '.github/workflows/deploy-production.yml';
const STAGING_WORKFLOW_REL = '.github/workflows/deploy-staging.yml';
const SYNC_WORKFLOW_REL = '.github/workflows/sync-staging-migrations.yml';

function readRepo(rel: string): string {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

/** Strip whole-line `#` comments so the scripts' long root-cause headers — which
 *  quote the forbidden awk parser verbatim — cannot satisfy or break an
 *  assertion about the ACTIVE shell body. */
function shellBody(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const LEDGER_SRC = readRepo(LEDGER_SCRIPT_REL);
const INVARIANTS_SRC = readRepo(INVARIANTS_SCRIPT_REL);
const LEDGER_BODY = shellBody(LEDGER_SRC);
const INVARIANTS_BODY = shellBody(INVARIANTS_SRC);

function hasCommand(cmd: string): boolean {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return !r.error;
}
const HAS_BASH = hasCommand('bash');
const HAS_AWK = hasCommand('awk');

// ───────────────────────────────────────────────────────────────────────────
// Part 1 — the parity check reads the LEDGER, not the CLI's rendering of it
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(LEDGER_SRC === '')('REG-399b Part 1: migration-parity check reads the real ledger', () => {
  it('the script exists', () => {
    expect(LEDGER_SRC).not.toBe('');
  });

  it('comment stripping worked (the header quotes the forbidden parser)', () => {
    expect(LEDGER_SRC).toMatch(/awk -F'\|'/);
    expect(LEDGER_BODY).not.toMatch(/awk/);
  });

  it('reads the remote set with a SQL SELECT against supabase_migrations.schema_migrations', () => {
    expect(LEDGER_BODY).toMatch(
      /SELECT\s+version\s+FROM\s+supabase_migrations\.schema_migrations/i,
    );
  });

  it('NEVER parses rendered `supabase migration list` output', () => {
    // The entire defect class in one assertion: rendered tables are a
    // presentation format, and their column order is not an API.
    expect(LEDGER_BODY).not.toMatch(/migration\s+list/);
    expect(LEDGER_BODY).not.toMatch(/-F'\|'/);
  });

  it('has a non-vacuity floor on BOTH sides — an empty side is a FAILURE, not agreement', () => {
    // "0 committed == 0 remote" is the shape a broken scan produces. It must
    // never be reported as parity.
    expect(LEDGER_BODY).toMatch(/\[\s*"\$LOCAL_COUNT"\s+-gt\s+0\s*\]\s*\|\|\s*fail/);
    expect(LEDGER_BODY).toMatch(/\[\s*"\$REMOTE_COUNT"\s+-gt\s+0\s*\]\s*\|\|\s*fail/);
  });

  it('compares SETS in both directions, and never decides parity from counts alone', () => {
    expect(LEDGER_BODY).toMatch(/comm\s+-23/);
    expect(LEDGER_BODY).toMatch(/comm\s+-13/);
    // Equal counts can hide a swap (one version added, one removed).
    expect(LEDGER_BODY).not.toMatch(/\$LOCAL_COUNT"?\s*(-eq|==|=)\s*"?\$REMOTE_COUNT/);
  });

  it('pins WHICH database it interrogated (a parity check on the wrong project passes for free)', () => {
    expect(LEDGER_BODY).toMatch(/EXPECTED_REF/);
    expect(LEDGER_BODY).toMatch(/FORBIDDEN_REF/);
    expect(LEDGER_BODY).toMatch(/supabase\/\.temp\/project-ref/);
  });

  it('excludes _legacy/ from the local scan via -maxdepth 1, matching the CLI’s own scope', () => {
    expect(LEDGER_BODY).toMatch(/-maxdepth\s+1/);
  });

  it('never echoes the database password or a full connection URL', () => {
    expect(LEDGER_BODY).not.toMatch(/echo[^\n]*\$DB_URL/);
    expect(LEDGER_BODY).not.toMatch(/echo[^\n]*SUPABASE_DB_PASSWORD/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 2 — REGRESSION WITNESS: prove the OLD parser could never fail
// ───────────────────────────────────────────────────────────────────────────
/**
 * The Supabase CLI's rendered ledger table, leading-pipe markdown form. The
 * fixture encodes REAL drift: 20260815000004 is committed locally and absent
 * from the remote ledger — exactly the production state on 2026-08-13.
 */
const CLI_TABLE_WITH_DRIFT = [
  '|        LOCAL        |        REMOTE       |     TIME (UTC)      |',
  '| ------------------- | ------------------- | ------------------- |',
  '| 20260814000011      | 20260814000011      | 2026-08-14 00:00:11 |',
  '| 20260815000004      |                     | 2026-08-15 00:00:04 |',
  '',
].join('\n');

/** The exact parser the deploy workflow used before 2026-08-13. */
const OLD_AWK = `NF>=2 { v=$2; gsub(/[^0-9]/, "", v); if (length(v) == 14) print v }`;
/** The same program reading the column it MEANT to read. */
const CORRECT_AWK = `NF>=2 { v=$3; gsub(/[^0-9]/, "", v); if (length(v) == 14) print v }`;

function runAwk(program: string, input: string): string[] {
  const r = spawnSync('awk', ['-F|', program], { input, encoding: 'utf8' });
  return (r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

describe.skipIf(!HAS_AWK)('REG-399b Part 2: the old parity parser is provably incapable of failing', () => {
  const LOCAL_SET = ['20260814000011', '20260815000004'];
  const TRUE_REMOTE_SET = ['20260814000011'];

  it('the fixture genuinely encodes drift (non-vacuity of the witness itself)', () => {
    // Reading field 3 — the column actually labelled REMOTE — shows the drift.
    // If this ever equals LOCAL_SET, the fixture is broken and every assertion
    // below would be meaningless.
    expect(runAwk(CORRECT_AWK, CLI_TABLE_WITH_DRIFT)).toEqual(TRUE_REMOTE_SET);
    expect(TRUE_REMOTE_SET).not.toEqual(LOCAL_SET);
  });

  it('the OLD parser returns the LOCAL column verbatim when asked for "remote"', () => {
    expect(runAwk(OLD_AWK, CLI_TABLE_WITH_DRIFT)).toEqual(LOCAL_SET);
  });

  it('so the old check compared the local set against itself — both diffs empty, drift invisible', () => {
    const parsedAsRemote = runAwk(OLD_AWK, CLI_TABLE_WITH_DRIFT);
    const committedNotRemote = LOCAL_SET.filter((v) => !parsedAsRemote.includes(v));
    const remoteNotCommitted = parsedAsRemote.filter((v) => !LOCAL_SET.includes(v));
    // This is the tautology, executed: eight genuinely-missing versions and the
    // check reports nothing.
    expect(committedNotRemote).toEqual([]);
    expect(remoteNotCommitted).toEqual([]);
    // …while the truth is that a version is missing from the remote ledger.
    expect(LOCAL_SET.filter((v) => !TRUE_REMOTE_SET.includes(v))).toEqual(['20260815000004']);
  });

  it('the replacement script contains no parser with this failure mode', () => {
    expect(LEDGER_BODY).not.toContain('$2');
    expect(LEDGER_BODY).not.toMatch(/gsub\(/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 3 — the live-DB security assertion (the REAL gate for REG-399a)
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(INVARIANTS_SRC === '')('REG-399b Part 3: live-database anon-EXECUTE assertion', () => {
  const EXPECTED_RPCS = [
    'get_student_snapshot',
    'get_student_notifications',
    'get_review_cards',
    'get_guardian_dashboard',
    'get_dashboard_data',
    'get_study_plan',
    'get_knowledge_gaps',
  ];

  it('asserts the privilege PostgreSQL actually evaluates before invoking a function', () => {
    // has_function_privilege(...) == false <=> the call is rejected with 42501.
    // Asserting the predicate is equivalent to asserting the 42501, with zero
    // risk of side effects on live production data.
    expect(INVARIANTS_BODY).toMatch(
      /has_function_privilege\(\s*'anon'\s*,\s*p\.oid\s*,\s*'EXECUTE'\s*\)/i,
    );
  });

  it('covers all 7 student-data RPCs, including the 4 confirmed live-exposed ones', () => {
    const listed = (INVARIANTS_SRC.match(/SECDEF_RPCS=\(([\s\S]*?)\)/) ?? [])[1] ?? '';
    const names = listed.split('\n').map((l) => l.trim()).filter((l) => /^[a-z0-9_]+$/.test(l));
    expect(names.sort()).toEqual([...EXPECTED_RPCS].sort());
  });

  it('enumerates EVERY overload from pg_proc — not one hardcoded signature', () => {
    // An anon-executable overload of a "revoked" function is the same hole.
    expect(INVARIANTS_BODY).toMatch(/FROM\s+pg_proc/i);
    expect(INVARIANTS_BODY).toMatch(/p\.proname\s+IN\s*\(/i);
  });

  it('NON-VACUITY: a listed RPC that is absent from the database FAILS, never passes silently', () => {
    // A gate that asserts nothing about a function that vanished is the exact
    // failure mode this whole entry exists to end.
    expect(INVARIANTS_BODY).toMatch(/WHERE\s+NOT\s+EXISTS/i);
    expect(INVARIANTS_BODY).toMatch(/if\s*\[\s*-n\s+"\$MISSING"\s*\]/);
    expect(INVARIANTS_BODY).toMatch(/Security-invariant list is out of sync/);
  });

  it('NON-VACUITY: an absent `anon` ROLE fails closed rather than asserting nothing', () => {
    expect(INVARIANTS_BODY).toMatch(/FROM\s+pg_roles\s+WHERE\s+rolname\s*=\s*'anon'/i);
    expect(INVARIANTS_BODY).toMatch(/cannot assert anon privileges\. FAIL-CLOSED/);
  });

  it('every failure path exits non-zero (an unreadable database is not a pass)', () => {
    expect(INVARIANTS_BODY).toMatch(/fail\(\)\s*\{[\s\S]*?exit\s+1/);
    expect(INVARIANTS_BODY).toMatch(/FAIL-CLOSED/);
  });

  it('does not echo the connection URL or password', () => {
    expect(INVARIANTS_BODY).not.toMatch(/echo[^\n]*\$DB_URL/);
    expect(INVARIANTS_BODY).not.toMatch(/echo[^\n]*SUPABASE_DB_PASSWORD/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 3b — BEHAVIOURAL: both scripts are invocable and fail closed
// ───────────────────────────────────────────────────────────────────────────
/**
 * These actually EXECUTE the scripts. Beyond the fail-closed contract they also
 * prove INVOCABILITY — a CRLF-terminated `.sh` (there is no `*.sh` rule in
 * `.gitattributes`, and `.github/scripts/verify-noop-deploy.sh` already carries
 * CRLF in this working tree) dies on `set -euo pipefail` with a completely
 * different message, which these exact-message assertions catch.
 */
describe.skipIf(!HAS_BASH)('REG-399b Part 3b: both gate scripts are invocable and fail closed', () => {
  function runScript(rel: string, env: Record<string, string>) {
    const r = spawnSync('bash', [join(REPO_ROOT, rel)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    return { status: r.status, combined: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  it.each([LEDGER_SCRIPT_REL, INVARIANTS_SCRIPT_REL])(
    '%s exits non-zero with no EXPECTED_REF',
    (rel) => {
      const r = runScript(rel, {});
      expect(r.status).not.toBe(0);
      expect(r.combined).toContain('EXPECTED_REF is required. FAIL-CLOSED.');
    },
  );

  it.each([LEDGER_SCRIPT_REL, INVARIANTS_SCRIPT_REL])(
    '%s exits non-zero with no SUPABASE_DB_PASSWORD',
    (rel) => {
      const r = runScript(rel, { EXPECTED_REF: 'abcdefghijklmnopqrst' });
      expect(r.status).not.toBe(0);
      expect(r.combined).toContain('SUPABASE_DB_PASSWORD is required. FAIL-CLOSED.');
    },
  );

  it.each([LEDGER_SCRIPT_REL, INVARIANTS_SCRIPT_REL])(
    '%s never reports success without a linked project (no supabase/.temp/project-ref)',
    (rel) => {
      const r = runScript(rel, {
        EXPECTED_REF: 'abcdefghijklmnopqrst',
        SUPABASE_DB_PASSWORD: 'not-a-real-password',
      });
      // Depending on whether psql is installed on this machine the script stops
      // at the psql check or at the project-ref check — both are FAIL-CLOSED.
      expect(r.status).not.toBe(0);
      expect(r.combined).toContain('FAIL-CLOSED');
      expect(r.combined).not.toMatch(/parity verified|no EXECUTE on any/i);
    },
  );

  it('the pooler-URL helper never prints the password on stdout', () => {
    // It is the only component that ever holds the password in a string.
    const src = readRepo(POOLER_SCRIPT_REL);
    expect(src).not.toBe('');
    const stdoutWrites = [...src.matchAll(/sys\.stdout\.write\(([\s\S]*?)\)\n/g)].map((m) => m[1]);
    expect(stdoutWrites.length).toBeGreaterThan(0);
    // The single stdout write is the URL itself (which necessarily embeds the
    // password); every diagnostic must go to stderr instead.
    expect(stdoutWrites).toHaveLength(1);
    expect(src).toMatch(/sys\.stderr\.write\("Pooler host/);
    expect(src).not.toMatch(/sys\.stdout\.write\([^)]*enc_pw[^)]*\)\s*$/m);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 4 — the gates are WIRED and BLOCKING
// ───────────────────────────────────────────────────────────────────────────
type WorkflowStep = { name?: string; run?: string; 'continue-on-error'?: boolean | string };
type Workflow = { jobs?: Record<string, { steps?: WorkflowStep[]; outputs?: Record<string, string> }> };

function loadWorkflow(rel: string): Workflow | null {
  const src = readRepo(rel);
  return src === '' ? null : (parseYaml(src) as Workflow);
}

function allSteps(wf: Workflow): WorkflowStep[] {
  return Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
}

describe('REG-399b Part 4: the parity + invariant gates are wired into the deploy workflows', () => {
  it.each([PROD_WORKFLOW_REL, STAGING_WORKFLOW_REL, SYNC_WORKFLOW_REL])(
    '%s invokes verify-migration-ledger.sh',
    (rel) => {
      const wf = loadWorkflow(rel);
      expect(wf, `${rel} not readable/parseable`).not.toBeNull();
      const steps = allSteps(wf!).filter((s) => (s.run ?? '').includes('verify-migration-ledger.sh'));
      expect(steps.length, `${rel} never runs the ledger parity script`).toBeGreaterThan(0);
      for (const s of steps) {
        expect(s['continue-on-error'], `${rel}: parity gate is non-blocking`).toBeFalsy();
      }
    },
  );

  it('deploy-production.yml runs the live-DB security assertion, blocking', () => {
    const wf = loadWorkflow(PROD_WORKFLOW_REL)!;
    const steps = allSteps(wf).filter((s) =>
      (s.run ?? '').includes('assert-db-security-invariants.sh'),
    );
    expect(steps.length, 'production deploy never asserts live-DB security invariants').toBe(1);
    expect(steps[0]['continue-on-error']).toBeFalsy();
  });

  it('the production release-completion gate REQUIRES db_security_invariants == verified', () => {
    const src = readRepo(PROD_WORKFLOW_REL);
    // The step writes its output ONLY on success, so empty != 'verified' and a
    // crashed/skipped/unrun step fails the release.
    expect(src).toMatch(/db_security_invariants:\s*\$\{\{\s*steps\.db-invariants\.outputs\.db_security_invariants\s*\}\}/);
    expect(src).toMatch(
      /require_equal\s+"Live DB security invariants"\s+"\$DB_SECURITY_INVARIANTS"\s+"verified"/,
    );
    expect(src).toMatch(
      /require_equal\s+"Migration history parity"\s+"\$MIGRATION_PARITY"\s+"verified"/,
    );
  });

  it('the parity/invariant steps run on BOTH paths, not only when migrations changed', () => {
    const wf = loadWorkflow(PROD_WORKFLOW_REL)!;
    for (const s of allSteps(wf)) {
      const run = s.run ?? '';
      if (run.includes('verify-migration-ledger.sh') || run.includes('assert-db-security-invariants.sh')) {
        // A frontend-only release must not be able to bypass database-state
        // verification: that is how a "no migrations changed" deploy shipped
        // green over an unpatched database.
        expect(
          (s as Record<string, unknown>).if,
          `${s.name}: gated behind a condition — a no-migration release would skip it`,
        ).toBeUndefined();
      }
    }
  });

  it('no workflow still inlines the old awk-based remote parse', () => {
    for (const rel of [PROD_WORKFLOW_REL, STAGING_WORKFLOW_REL, SYNC_WORKFLOW_REL]) {
      const wf = loadWorkflow(rel)!;
      for (const s of allSteps(wf)) {
        // `run:` bodies only — the YAML comments above them deliberately quote
        // the old parser as the root-cause record and must stay quotable.
        expect(s.run ?? '', `${rel} step "${s.name}" still parses the CLI table`).not.toMatch(
          /awk\s+-F'\|'/,
        );
      }
    }
  });

  it('a piped `supabase db push` cannot be masked by tee (pipefail + PIPESTATUS)', () => {
    // The Actions default shell is `bash -e {0}` — -e but NOT -o pipefail.
    // Without both, tee's exit 0 hides a failed push, which is how "Finished
    // supabase db push." was believed over an empty database.
    for (const rel of [PROD_WORKFLOW_REL, STAGING_WORKFLOW_REL, SYNC_WORKFLOW_REL]) {
      const wf = loadWorkflow(rel)!;
      // Match the INVOCATION, not the word: the migration-diff step's summary
      // prose also says "db push skipped".
      const pushSteps = allSteps(wf).filter((s) =>
        /^\s*supabase db push --linked/m.test(s.run ?? ''),
      );
      expect(pushSteps.length, `${rel} has no db push step`).toBeGreaterThan(0);
      for (const s of pushSteps) {
        expect(s.run!, `${rel}: push not protected by pipefail`).toMatch(/set -euo pipefail/);
        expect(s.run!, `${rel}: push exit code not read from PIPESTATUS`).toMatch(/PIPESTATUS\[0\]/);
      }
    }
  });
});
