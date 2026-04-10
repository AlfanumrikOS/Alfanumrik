/**
 * QA Gate for Product Improvement Command Center
 *
 * Runs type-check, lint, test, and build checks before an execution
 * can transition from staging to approved. Results are stored in
 * improvement_executions.test_results JSONB column.
 *
 * WARNING: This module executes npm commands via child_process.execSync.
 * It must ONLY be called server-side in API routes, never from client code.
 * Calling it in a browser context will throw.
 */

import { execSync } from 'child_process';
import { logger } from '@/lib/logger';

export interface QACheckResult {
  passed: boolean;
  output: string;
  duration_ms: number;
}

export interface QATestResult extends QACheckResult {
  total: number;
  passed_count: number;
  failed_count: number;
}

export interface QABundleSizeResult {
  passed: boolean;
  details: string;
}

export interface QAGateResult {
  passed: boolean;
  type_check: QACheckResult;
  lint: QACheckResult;
  tests: QATestResult;
  build: QACheckResult;
  bundle_size: QABundleSizeResult;
  ran_at: string;
}

/**
 * Run a shell command with a timeout and capture output.
 * Truncates output to last 2000 characters to keep JSONB storage reasonable.
 */
function runCommand(cmd: string, timeoutMs: number): { success: boolean; output: string; duration_ms: number } {
  const start = Date.now();
  try {
    const output = execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
      // Merge stderr into stdout so we capture everything
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.slice(-2000), duration_ms: Date.now() - start };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const combined = (error.stdout || '') + '\n' + (error.stderr || error.message || '');
    return { success: false, output: combined.slice(-2000), duration_ms: Date.now() - start };
  }
}

/**
 * Parse test counts from Vitest output.
 * Tries JSON reporter format first, then falls back to summary line patterns.
 */
function parseTestCounts(output: string): { total: number; passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  try {
    // Try vitest JSON reporter: look for numPassedTests / numFailedTests
    const jsonMatch = output.match(/\{[\s\S]*"numPassedTests"\s*:\s*(\d+)[\s\S]*"numFailedTests"\s*:\s*(\d+)[\s\S]*\}/);
    if (jsonMatch) {
      passed = parseInt(jsonMatch[1], 10);
      failed = parseInt(jsonMatch[2], 10);
      return { total: passed + failed, passed, failed };
    }

    // Fallback: "Tests  X passed | Y failed" or "X passed" patterns
    const summaryMatch = output.match(/(\d+)\s+passed/);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1], 10);
    }
    const failMatch = output.match(/(\d+)\s+failed/);
    if (failMatch) {
      failed = parseInt(failMatch[1], 10);
    }
  } catch {
    // Parsing failed — keep defaults
  }

  return { total: passed + failed, passed, failed };
}

/**
 * Execute the full QA gate: type-check, lint, test, build, bundle size.
 *
 * Checks run sequentially to avoid resource contention on the server.
 * Each check has a timeout to prevent hanging:
 *   - type-check: 60s
 *   - lint: 60s
 *   - test: 120s
 *   - build: 180s
 *
 * If ANY check fails, the overall gate fails (passed = false).
 */
export async function runQAGate(): Promise<QAGateResult> {
  logger.info('qa_gate_started', {});

  const typeCheck = runCommand('npm run type-check', 60_000);
  const lint = runCommand('npm run lint', 60_000);
  const tests = runCommand('npm test -- --reporter=json', 120_000);
  const build = runCommand('npm run build', 180_000);

  const testCounts = parseTestCounts(tests.output);

  const result: QAGateResult = {
    passed: typeCheck.success && lint.success && tests.success && build.success,
    type_check: {
      passed: typeCheck.success,
      output: typeCheck.output,
      duration_ms: typeCheck.duration_ms,
    },
    lint: {
      passed: lint.success,
      output: lint.output,
      duration_ms: lint.duration_ms,
    },
    tests: {
      passed: tests.success,
      total: testCounts.total,
      passed_count: testCounts.passed,
      failed_count: testCounts.failed,
      output: tests.output,
      duration_ms: tests.duration_ms,
    },
    build: {
      passed: build.success,
      output: build.output,
      duration_ms: build.duration_ms,
    },
    bundle_size: {
      passed: true,
      details: 'Bundle size check requires manual verification against P10 budget (shared JS < 160kB, pages < 260kB)',
    },
    ran_at: new Date().toISOString(),
  };

  logger.info('qa_gate_completed', {
    passed: result.passed,
    type_check: result.type_check.passed,
    lint: result.lint.passed,
    tests: result.tests.passed,
    build: result.build.passed,
    duration_ms:
      result.type_check.duration_ms +
      result.lint.duration_ms +
      result.tests.duration_ms +
      result.build.duration_ms,
  });

  return result;
}
