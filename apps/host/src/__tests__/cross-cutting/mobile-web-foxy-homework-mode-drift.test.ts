/**
 * REG-436 [mobile ↔ server / academic integrity] — the Scan & Solve "Understand
 * it with Foxy" CTA must keep reaching the homework Socratic ladder.
 *
 * THE DEFECT CLASS THIS EXISTS FOR — a SILENT downgrade, not a crash.
 * `apps/host/src/app/api/foxy/route.ts` resolves the request mode as:
 *
 *     const requestedMode =
 *       typeof body.mode === 'string' && VALID_MODES.includes(body.mode)
 *         ? body.mode
 *         : 'learn';
 *
 * An unrecognised mode is NOT rejected — it is silently rewritten to `learn`.
 * So a one-character typo in the mobile literal (`'homwork'`), or a server-side
 * rename/removal of `homework` from `VALID_MODES`, does not produce an error,
 * a 4xx, or a log line. It produces a Foxy that quietly goes back to answering
 * a photographed assigned problem end-to-end. That is the exact academic-
 * integrity hole REG-432 closed, re-opening through the transport layer
 * instead of the prompt layer.
 *
 * WHY THIS TEST LIVES IN THE HOST SUITE AND NOT IN `mobile/test/`.
 * `.github/workflows/mobile-ci.yml` is path-filtered:
 *
 *     on: {pull_request: {paths: ['mobile/**', 'openapi/v2.json',
 *                                 '.github/workflows/mobile-ci.yml']}}
 *
 * A PR that renames the mode server-side touches NONE of those paths, so the
 * Flutter suite never runs and a Dart-side widget test — however well written —
 * is structurally incapable of catching that direction of drift. This suite
 * runs on every PR, so it catches BOTH directions: the Dart typo and the
 * server-side rename. A Dart widget test is still worth having for the tap
 * behaviour itself; it is a complement to this file, not a substitute.
 *
 * SCOPE / OWNERSHIP. Read-only. Parses real source on both sides and imports
 * the real `MODE_DIRECTIVES`. It pins the CONTRACT between the two surfaces; it
 * does not assert the ladder's wording (REG-432 owns that, against the RENDERED
 * prompt) and does not re-test the web snap CTA mapping (REG-432 / the snap
 * flag-gate suite own that).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODE_DIRECTIVES } from '@alfanumrik/lib/foxy/prompt-sections';
import { VALID_MODES } from '@/app/api/foxy/_lib/constants';

/** Read a repo-root-relative path whether vitest runs from apps/host or root. */
function repoRead(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  return existsSync(fromHost)
    ? readFileSync(fromHost, 'utf8')
    : readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const SCAN_SCREEN = 'mobile/lib/ui/screens/scan_solve/scan_solve_result_screen.dart';
const FOXY_ROUTE = 'apps/host/src/app/api/foxy/route.ts';

const scanSrc = repoRead(SCAN_SCREEN);
const routeSrc = repoRead(FOXY_ROUTE);

/**
 * The mode literal the Scan & Solve CTA actually pushes.
 *
 * Anchored on the `'mode': '<x>'` entry of the params map built in the
 * "Understand it with Foxy" button's onPressed. Deliberately parsed rather than
 * asserted with `toContain('homework')` — a containment check would pass on the
 * word appearing anywhere in the file's (extensive) explanatory comments, which
 * is precisely the vacuous-pass trap here, since those comments discuss both
 * `homework` AND `doubt` at length.
 */
function scanCtaMode(): string {
  // Strip line comments first so the doc-comment prose cannot be parsed as code.
  const code = scanSrc
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
  const m = /'mode':\s*'([a-z_]+)'/.exec(code);
  expect(m, `no "'mode': '<x>'" entry found in ${SCAN_SCREEN} (parse anchor moved?)`).not.toBeNull();
  return m![1];
}

/** Comment-stripped source, so doc prose can never satisfy a code assertion. */
function scanCode(): string {
  return scanSrc
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

/**
 * The slice of the Foxy CTA running from its `'mode':` entry to the end of the
 * FIRST `context.push(...)` that follows it.
 *
 * Exists because this screen has more than one push-with-params site, so any
 * file-wide assertion about the transport can be satisfied by a sibling CTA
 * while the one under test is broken.
 */
function ctaWindow(): string {
  const code = scanCode();
  const start = code.indexOf("'mode':");
  expect(start, 'no "\'mode\':" entry found (parse anchor moved?)').toBeGreaterThan(-1);
  const push = code.indexOf('context.push(', start);
  expect(push, 'no context.push after the mode entry (CTA restructured?)').toBeGreaterThan(-1);
  const end = code.indexOf(';', push);
  expect(end).toBeGreaterThan(-1);
  return code.slice(start, end + 1);
}

describe('REG-436 — mobile Scan & Solve → Foxy mode contract', () => {
  it('the parse anchor is real (non-vacuity guard)', () => {
    // If the CTA or its params map is restructured, every assertion below would
    // silently stop testing anything. Fail loudly instead.
    expect(scanSrc).toContain('context.push(');
    expect(scanSrc.length).toBeGreaterThan(1_000);
    expect(routeSrc.length).toBeGreaterThan(1_000);
  });

  it('the Scan & Solve CTA pushes mode=homework, NOT doubt', () => {
    // The academic-integrity choice itself. `doubt` selects the direct-answer
    // template; on a PHOTOGRAPHED assigned problem that is the outsourcing path.
    expect(scanCtaMode()).toBe('homework');
    expect(scanCtaMode()).not.toBe('doubt');
  });

  it('the pushed route really carries the mode as a query parameter, on the /chat push', () => {
    // Pins the transport, not just the literal: the mode has to end up in the
    // deep link. A params map that is built and then not passed to the push
    // would satisfy the literal assertion above and still ship `learn`.
    //
    // SCOPED DELIBERATELY. This screen has TWO `context.push(Uri(...
    // queryParameters: params))` call sites — the Foxy CTA (`/chat`) and a
    // "similar questions" CTA (`/quiz`) — each with its OWN local `params`.
    // A file-wide regex here passes even when the Foxy CTA is decoupled from
    // its map, because the /quiz site still matches. (Confirmed empirically:
    // the first draft of this test did exactly that and had to be rewritten.)
    // So the window runs from the mode literal to the NEXT push only.
    const window = ctaWindow();
    expect(window).toMatch(/queryParameters:\s*params/);
    expect(window).toMatch(/path:\s*'\/chat'/);
  });

  it('the mode the CTA sends survives the server whitelist (cross-repo drift guard)', () => {
    // THE load-bearing assertion. This is the one that catches a server-side
    // rename, which mobile CI cannot see at all.
    expect(VALID_MODES).toContain(scanCtaMode());
  });

  it('the server fallback for an unknown mode really is SILENT — which is why the above matters', () => {
    // Anti-vacuity for the whitelist assertion: if the route ever started
    // REJECTING unknown modes, a drift would surface as a visible 4xx and the
    // guard above would be far less critical. It does not — it rewrites to
    // 'learn' with no error. Pinned so that changing this forces a re-read of
    // this whole file's rationale.
    const clean = routeSrc.replace(/\/\/[^\n]*/g, '');
    expect(clean).toMatch(/VALID_MODES\.includes\(body\.mode\)\s*\?\s*body\.mode\s*:\s*'learn'/);
  });

  it('the mode maps to a NON-EMPTY MODE_DIRECTIVES entry (a valid mode is not enough)', () => {
    // `homework` could be in VALID_MODES and still be inert: the route reads
    // `MODE_DIRECTIVES[mode] ?? ''`, so a missing key degrades silently to no
    // directive at all — a `doubt`-shaped direct answer under a `homework`
    // label. Passing the whitelist is necessary but not sufficient.
    const directive = MODE_DIRECTIVES[scanCtaMode()];
    expect(directive, `MODE_DIRECTIVES has no "${scanCtaMode()}" key`).toBeDefined();
    expect(typeof directive).toBe('string');
    expect(directive.trim().length).toBeGreaterThan(0);
  });

  it('that directive is the Socratic ladder, not some other override', () => {
    // Identity check on the behaviour the CTA is relying on. Kept to two stable
    // structural markers — REG-432 owns the full wording pins against the
    // RENDERED prompt, and duplicating them here would create a second place to
    // update on every copy edit.
    const directive = MODE_DIRECTIVES[scanCtaMode()];
    expect(directive).toMatch(/HOMEWORK/i);
    expect(directive).toMatch(/final answer/i);
  });
});
