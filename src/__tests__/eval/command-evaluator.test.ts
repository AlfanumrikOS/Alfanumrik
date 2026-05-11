import { describe, it, expect } from 'vitest';
import { buildVerdict } from '../../../eval/_lib/command-evaluator';

/**
 * Unit test for the command-wrapper evaluator's pure verdict logic.
 *
 * We don't shell out here — that's what the per-evaluator scripts do.
 * What we pin down is the bridge: given (config, spawn result),
 * does buildVerdict() emit the right contract-shaped EvaluationVerdict?
 *
 * Specifically:
 *   - exit 0 → 'pass', blocking flag propagates
 *   - exit non-zero → 'fail'
 *   - notes is truncated to the tail of combined output
 *   - evidence contains command/args/exit_code/duration
 *   - task_id / cycle_id pass through cleanly
 */

const baseCfg = {
  evaluator: 'unit_tests' as const,
  command: 'npm',
  args: ['test'],
  blocking: true,
};

describe('command-evaluator — buildVerdict', () => {
  it('emits pass on exit 0', () => {
    const v = buildVerdict(baseCfg, null, null, {
      status: 0,
      stdout: 'All tests passed (42)',
      stderr: '',
      durationMs: 1234,
    });
    expect(v.verdict).toBe('pass');
    expect(v.blocking).toBe(true);
    expect(v.evaluator).toBe('unit_tests');
    expect(v.evidence.exit_code).toBe(0);
    expect(v.evidence.duration_ms).toBe(1234);
    expect(v.evidence.command).toBe('npm');
    expect(v.evidence.args).toEqual(['test']);
  });

  it('emits fail on exit non-zero', () => {
    const v = buildVerdict(baseCfg, null, null, {
      status: 1,
      stdout: '',
      stderr: 'FAIL src/foo.test.ts > bar > baz',
      durationMs: 999,
    });
    expect(v.verdict).toBe('fail');
    expect(v.evidence.exit_code).toBe(1);
    expect(v.notes).toContain('FAILED with exit code 1');
    expect(v.notes).toContain('FAIL src/foo.test.ts');
  });

  it('emits fail when the spawn was killed (status null)', () => {
    const v = buildVerdict(baseCfg, null, null, {
      status: null,
      stdout: '',
      stderr: 'killed by signal',
      durationMs: 50,
    });
    expect(v.verdict).toBe('fail');
    expect(v.notes).toContain('(killed)');
  });

  it('takes the tail-N-lines when output exceeds line cap but not char cap', () => {
    // 200 short lines. Each is ~20 chars, so tail-50 = ~1000 chars, well
    // under NOTES_MAX_CHARS (3800). Line truncation should kick in; the
    // char-truncation marker should NOT appear.
    const longBody = Array.from({ length: 200 }, (_, i) => `short-line-${i}`).join('\n');
    const lastLineMarker = 'THIS-IS-THE-LAST-LINE';
    const v = buildVerdict(baseCfg, null, null, {
      status: 1,
      stdout: `${longBody}\n${lastLineMarker}`,
      stderr: '',
      durationMs: 1,
    });
    expect(v.notes).toContain(lastLineMarker);
    // Earliest lines dropped by the 50-line tail.
    expect(v.notes).not.toContain('short-line-0\n');
    // No char-cap marker because we're under 3800 chars.
    expect(v.notes).not.toMatch(/output truncated/);
  });

  it('adds the truncation marker when even the tail-50-lines exceeds the char cap', () => {
    // Each line ~120 chars wide. tail-50 ≈ 6000 chars, well over 3800.
    const wide = 'x'.repeat(120);
    const longBody = Array.from({ length: 200 }, (_, i) => `${i}:${wide}`).join('\n');
    const lastLineMarker = 'THIS-IS-THE-LAST-LINE';
    const v = buildVerdict(baseCfg, null, null, {
      status: 1,
      stdout: `${longBody}\n${lastLineMarker}`,
      stderr: '',
      durationMs: 1,
    });
    expect(v.notes).toContain(lastLineMarker);
    expect(v.notes).toMatch(/output truncated/);
    // Notes itself must stay close to contract maxLength=4000.
    expect(v.notes.length).toBeLessThan(4100);
  });

  it('echoes task_id and cycle_id when provided', () => {
    const v = buildVerdict(
      baseCfg,
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      { status: 0, stdout: 'ok', stderr: '', durationMs: 10 },
    );
    expect(v.task_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(v.cycle_id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('propagates blocking=false correctly', () => {
    const v = buildVerdict(
      { ...baseCfg, blocking: false },
      null,
      null,
      { status: 1, stdout: '', stderr: 'oops', durationMs: 10 },
    );
    expect(v.verdict).toBe('fail');
    expect(v.blocking).toBe(false);
  });

  it('falls back to "(no output)" when the command was silent', () => {
    const v = buildVerdict(baseCfg, null, null, {
      status: 0,
      stdout: '',
      stderr: '',
      durationMs: 5,
    });
    expect(v.notes).toContain('(no output)');
  });
});
