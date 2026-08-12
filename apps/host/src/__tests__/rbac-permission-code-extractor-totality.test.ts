/**
 * META-GUARD: a conformance guard proves nothing if its EXTRACTOR is narrower
 * than the data it scans.
 *
 * ── THE LESSON THIS FILE ENCODES ────────────────────────────────────────────
 * `rbac-permission-code-drift-guard.test.ts` existed, was green at 71 tests, and
 * did not see the bug. `/api/student/engagement` authorized against
 * `'student.profile.read'` — a code granted to NO role, so it 403'd 100% of
 * students — and the guard stayed green because its extraction regex was
 * `[a-z_]+\.[a-z_]+`: exactly TWO segments, with a closing quote required
 * immediately after the second. A three-segment literal never matched. The guard
 * did not judge that code and pass it. **It never saw it.**
 *
 * That is a different and more dangerous failure than a missing test. A missing
 * test is visibly missing. A guard whose extractor silently skips a subset of
 * its input reports "0 violations" over a corpus it only partially read, and the
 * green tick is affirmative evidence of a safety property that was never
 * checked.
 *
 * The fix widened the regex to `[a-z_]+(?:\.[a-z_]+)+`. That closes THIS hole.
 * It does not close the CLASS: the next code shape nobody anticipated
 * (a digit, a hyphen, a template literal, a constant reference) would be
 * invisible again, and the guard would again be green.
 *
 * ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────
 * It compares the guard's STRICT extractor against a MAXIMALLY PERMISSIVE one
 * over the same corpus. The permissive extractor captures whatever sits in the
 * second argument of `authorizeRequest(request, …)` regardless of shape; the
 * strict one is the guard's own regex. If the strict extractor sees fewer call
 * sites than the permissive one, the guard has a blind spot — and this test
 * says exactly which call site it is, whether or not that call site is
 * currently buggy.
 *
 * In other words: the assertion is not "no orphan codes" (the drift guard owns
 * that). It is "the drift guard can SEE every code" — the precondition its
 * conclusion depends on, which nothing was checking.
 *
 * Also pinned: the widened pattern is genuinely load-bearing (the corpus really
 * does contain codes the old pattern could not match), and the guard file still
 * carries the widened pattern (so this meta-guard and the guard cannot drift).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_ROOT = path.join(REPO_ROOT, 'apps/host/src/app/api');
const GUARD_FILE = path.join(
  REPO_ROOT,
  'apps/host/src/__tests__/rbac-permission-code-drift-guard.test.ts',
);

/** MUST stay identical to CODE_SEGMENTS in the drift guard. Pinned below. */
const CODE_SEGMENTS = '[a-z_]+(?:\\.[a-z_]+)+';

/** The guard's STRICT extractor — the thing under test. */
const STRICT = new RegExp(
  `authorize(?:Request|SchoolAdmin)\\(\\s*request\\s*,\\s*['"](${CODE_SEGMENTS})['"]`,
  'g',
);

/**
 * MAXIMALLY PERMISSIVE extractor. Captures the second argument of every
 * `authorizeRequest(request, …)` / `authorizeSchoolAdmin(request, …)` call,
 * whatever it looks like — a quoted literal of ANY shape, a template literal, a
 * bare identifier, a call expression. This is the ground truth the strict
 * extractor is measured against.
 */
const PERMISSIVE = /authorize(?:Request|SchoolAdmin)\(\s*request\s*,\s*([^),]+)/g;

interface CallSite { file: string; raw: string }

/**
 * Strip comments before scanning. The doc comments in this tree quote
 * `authorizeRequest(request, <feature permission>)` in prose, and a scanner that
 * counts prose as a call site produces noise that trains readers to ignore it.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const ROUTE_FILES = walk(API_ROOT);

function collect(): { permissive: CallSite[]; strict: CallSite[] } {
  const permissive: CallSite[] = [];
  const strict: CallSite[] = [];

  for (const file of ROUTE_FILES) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');

    PERMISSIVE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PERMISSIVE.exec(src))) {
      permissive.push({ file: rel, raw: m[1].trim() });
    }

    STRICT.lastIndex = 0;
    while ((m = STRICT.exec(src))) {
      strict.push({ file: rel, raw: m[1] });
    }
  }
  return { permissive, strict };
}

const { permissive, strict } = collect();

/** A permissive hit whose argument is a plain quoted string literal — the only
 *  shape the strict extractor is expected to handle. */
function quotedLiteral(raw: string): string | null {
  const m = raw.match(/^['"]([^'"]*)['"]$/);
  return m ? m[1] : null;
}

describe('RBAC drift guard — the extractor can SEE the whole corpus', () => {
  it('is not vacuous: the scan found route files and call sites', () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(100);
    expect(permissive.length).toBeGreaterThan(100);
    expect(strict.length).toBeGreaterThan(100);
  });

  it('every literal permission code in the tree is VISIBLE to the strict extractor', () => {
    const strictSeen = new Set(strict.map((s) => `${s.file}::${s.raw}`));

    const invisible = permissive
      .map((p) => ({ ...p, code: quotedLiteral(p.raw) }))
      .filter((p): p is CallSite & { code: string } => p.code !== null)
      .filter((p) => !strictSeen.has(`${p.file}::${p.code}`));

    expect(
      invisible.map((p) => `${p.file} → '${p.code}'`),
      invisible.length === 0
        ? ''
        : `EXTRACTOR BLIND SPOT — the RBAC drift guard's regex cannot match ` +
            `${invisible.length} permission-code literal(s) that are really in the tree. ` +
            `The guard will report ZERO violations for these call sites whether or not ` +
            `they are broken, exactly as it did for the three-segment orphan ` +
            `'student.profile.read'. Widen CODE_SEGMENTS in ` +
            `rbac-permission-code-drift-guard.test.ts (and the SQL-side extractors ` +
            `with it — both sides must move together) before trusting a green run:\n` +
            invisible.map((p) => `  • ${p.file} → '${p.code}'`).join('\n'),
    ).toEqual([]);
  });

  it('every literal code also SATISFIES the code shape the guard validates', () => {
    const shape = new RegExp(`^${CODE_SEGMENTS}$`);
    const malformed = permissive
      .map((p) => ({ ...p, code: quotedLiteral(p.raw) }))
      .filter((p): p is CallSite & { code: string } => p.code !== null)
      .filter((p) => !shape.test(p.code));

    expect(
      malformed.map((p) => `${p.file} → '${p.code}'`),
      `permission codes whose shape the guard's CODE_RE rejects (they would be ` +
        `dropped from the scan rather than flagged)`,
    ).toEqual([]);
  });

  /**
   * INDIRECT CALL SITES — the SAME blind-spot class, reached by indirection
   * rather than by regex narrowness.
   *
   * A handful of routes pass a module-level constant or a lookup-table value
   * instead of an inline literal. The drift guard's extractor matches on the
   * literal at the CALL SITE, so it cannot see these codes at all — they are
   * invisible for exactly the reason `student.profile.read` was, one level of
   * indirection removed. Found by this meta-guard on its first run
   * (2026-08-11); reported to backend/architect. They are NOT defects in
   * themselves (the codes below are all real and granted), but they ARE
   * unchecked, and an unchecked code is how the last one got in.
   *
   * The ledger bounds the debt: each entry names the file and the constant, and
   * the test RESOLVES the constant's literal value from the same file and holds
   * it to the same shape rule. A NEW indirect site fails the test.
   */
  interface IndirectSite {
    /** Route file containing the call. */
    file: string;
    /** Substring of the call's second argument that identifies this site. */
    expr: string;
    /** File the symbol's literal lives in (defaults to `file`). */
    declaredIn?: string;
    /** Symbol to resolve. `null` = no code is passed at all. */
    symbol: string | null;
    why: string;
  }

  const KNOWN_INDIRECT: IndirectSite[] = [
    {
      file: 'apps/host/src/app/api/school-admin/webhooks/route.ts',
      expr: 'PERMISSION', symbol: 'PERMISSION',
      why: 'module-level const reused by three handlers',
    },
    {
      file: 'apps/host/src/app/api/school-admin/staff/route.ts',
      expr: 'STAFF_PERMISSION', symbol: 'STAFF_PERMISSION',
      why: 'module-level const',
    },
    {
      file: 'apps/host/src/app/api/school-admin/integrations/install/route.ts',
      expr: 'PERMISSION', symbol: 'PERMISSION', why: 'module-level const',
    },
    {
      file: 'apps/host/src/app/api/school-admin/integrations/uninstall/route.ts',
      expr: 'PERMISSION', symbol: 'PERMISSION', why: 'module-level const',
    },
    {
      file: 'apps/host/src/app/api/school-admin/ai-assistant/route.ts',
      expr: 'PERMISSION', symbol: 'PERMISSION', why: 'module-level const',
    },
    {
      file: 'apps/host/src/app/api/payments/status/route.ts',
      expr: 'PERMISSIONS.PAYMENTS_SUBSCRIBE',
      declaredIn: 'packages/lib/src/rbac.ts',
      symbol: 'PAYMENTS_SUBSCRIBE',
      why: 'named constant from the RBAC registry itself',
    },
    {
      // Genuinely dynamic: `?feature=` → a CLOSED static Map → code. The
      // reachable codes are still statically knowable, which is why this is
      // ledgerable rather than a hole.
      file: 'apps/host/src/app/api/usage/daily/route.ts',
      expr: 'permission', symbol: 'FEATURE_PERMISSION',
      why: 'closed static feature→permission Map',
    },
    {
      // NO permission code is passed at all — the route authenticates only and
      // gates on hasAnyPermission() afterwards, because a single hard-required
      // code would break its mandated cross-student path. There is nothing for
      // the drift guard to resolve, and nothing for it to miss.
      file: 'apps/host/src/app/api/predict/outcome/route.ts',
      expr: 'undefined', symbol: null,
      why: 'auth-only call; permission enforced separately via hasAnyPermission',
    },
  ];

  it('every NON-literal second argument is a KNOWN, ledgered indirection', () => {
    // schoolAdminPermissionCode({off,on}) is legitimate and the drift guard has
    // dedicated extractors for BOTH arms, so it is not an indirection hole.
    const KNOWN_COMPUTED = [/schoolAdminPermissionCode\(/];

    const computed = permissive
      .filter((p) => quotedLiteral(p.raw) === null)
      .filter((p) => !KNOWN_COMPUTED.some((re) => re.test(p.raw)))
      .filter(
        (p) => !KNOWN_INDIRECT.some((s) => s.file === p.file && p.raw.includes(s.expr)),
      );

    expect(
      [...new Set(computed.map((p) => `${p.file} → ${p.raw}`))],
      `NEW route(s) authorize against a COMPUTED permission code the drift guard ` +
        `cannot statically resolve. A code the guard cannot READ is a code it cannot ` +
        `CHECK — the guard will stay green over it forever. Either inline the literal, ` +
        `or add the site to KNOWN_INDIRECT here so its resolved code is pinned.`,
    ).toEqual([]);
  });

  it('every ledgered indirect code resolves to a well-shaped literal', () => {
    const shape = new RegExp(`^${CODE_SEGMENTS}$`);
    const unresolved: string[] = [];

    for (const site of KNOWN_INDIRECT) {
      if (site.symbol === null) continue; // no code passed — nothing to resolve
      const rel = site.declaredIn ?? site.file;
      const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
      const name = site.symbol;

      const codes: string[] = [];
      //  const NAME = 'code';
      const asConst = src.match(new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*'([^']+)'`));
      if (asConst) codes.push(asConst[1]);
      //  NAME: 'code',      (registry object property)
      const asProp = src.match(new RegExp(`\\b${name}\\s*:\\s*'([^']+)'`));
      if (!asConst && asProp) codes.push(asProp[1]);
      //  new Map([[ 'key', 'code' ], …])
      if (codes.length === 0 && src.includes(`const ${name}`)) {
        codes.push(
          ...[...src.matchAll(/\[\s*'[^']+'\s*,\s*'([^']+)'\s*\]/g)].map((m) => m[1]),
        );
      }

      if (codes.length === 0) {
        unresolved.push(`${rel} → ${name} (could not resolve any literal)`);
        continue;
      }
      for (const code of codes) {
        if (!shape.test(code)) unresolved.push(`${rel} → ${name} = '${code}' (bad shape)`);
      }
    }

    expect(
      unresolved,
      `a ledgered indirect permission code no longer resolves to a readable literal — ` +
        `the ledger has gone stale and the code is now fully invisible`,
    ).toEqual([]);
  });

  it('the indirection ledger is small and every entry is still a real call site', () => {
    // Stale entries would silently widen the exemption. Each must still match a
    // permissive hit in its declared file.
    const stale = KNOWN_INDIRECT.filter(
      (s) => !permissive.some((p) => p.file === s.file && p.raw.includes(s.expr)),
    );
    expect(stale.map((s) => `${s.file} → ${s.expr}`)).toEqual([]);
    expect(KNOWN_INDIRECT.length).toBeLessThanOrEqual(12);
  });
});

describe('RBAC drift guard — the widened pattern is load-bearing, not cosmetic', () => {
  /** The pre-fix, two-segment-only extractor, reconstructed verbatim. */
  const LEGACY = /authorize(?:Request|SchoolAdmin)\(\s*request\s*,\s*['"]([a-z_]+\.[a-z_]+)['"]/g;

  it('the corpus really contains codes the OLD extractor could not match', () => {
    let legacyCount = 0;
    for (const file of ROUTE_FILES) {
      // Comment-stripped, exactly like the strict scan — otherwise the two
      // counts are taken over different corpora and the comparison is noise.
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      LEGACY.lastIndex = 0;
      while (LEGACY.exec(src)) legacyCount += 1;
    }
    expect(
      strict.length,
      'widening the regex changed nothing — either the corpus has no multi-segment ' +
        'codes any more (then simplify deliberately) or this meta-guard is measuring ' +
        'the wrong thing',
    ).toBeGreaterThan(legacyCount);
  });

  it('a three-segment code is matched by the new extractor and missed by the old', () => {
    const synthetic = "const auth = await authorizeRequest(request, 'super_admin.subjects.manage');";
    STRICT.lastIndex = 0;
    LEGACY.lastIndex = 0;
    expect(STRICT.exec(synthetic)?.[1]).toBe('super_admin.subjects.manage');
    expect(LEGACY.exec(synthetic)).toBeNull();
  });
});

describe('RBAC drift guard — this meta-guard cannot drift from the guard', () => {
  const guardSrc = fs.readFileSync(GUARD_FILE, 'utf8');

  it('the guard still declares the widened CODE_SEGMENTS pattern', () => {
    expect(
      guardSrc,
      'the drift guard no longer carries the widened segment pattern this meta-guard ' +
        'is written against — they have drifted apart',
    ).toContain("const CODE_SEGMENTS = '[a-z_]+(?:\\\\.[a-z_]+)+'");
  });

  it('the guard builds ALL FOUR extractors from that one constant', () => {
    // The route-side and the three SQL-side extractors must move together: had
    // only the route side been widened, every granted three-segment code would
    // have become a FALSE POSITIVE instead of an invisible one.
    const uses = guardSrc.match(/\$\{CODE_SEGMENTS\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });

  it('no extractor in the guard still hardcodes the two-segment shape', () => {
    const stragglers = [...guardSrc.matchAll(/\[a-z_\]\+\\?\.\[a-z_\]\+/g)]
      .map((m) => m[0]);
    // Two deliberate occurrences remain: the reconstructed LEGACY pattern used
    // to DEMONSTRATE the old blind spot. Anything beyond that is a live
    // extractor that was missed when the others were widened.
    expect(
      stragglers.length,
      `${stragglers.length} two-segment-only pattern(s) remain in the drift guard. ` +
        `If one of them is still a live extractor, it has the original blind spot.`,
    ).toBeLessThanOrEqual(2);
  });
});
