import { describe, it, expect } from 'vitest';

/**
 * Pre-rollout checklist script — smoke test (Phase 4 Task 4-prep-D).
 *
 * Imports each check function from the script and asserts each returns
 * `pass: true` on the current worktree state. If any check fails, the test
 * output includes the failure detail so the developer can see which part of
 * the pre-rollout checklist is broken.
 *
 * The script itself is exit-code-based for ops use; these tests are the
 * automated guardrail that keeps Phase 4 code-side prep green over time.
 */

import {
  ALL_CHECKS,
  runAllChecks,
  checkPhase14MigrationsPresent,
  checkGroundedAnswerEdgeFunction,
  checkVerifyQuestionBankEdgeFunction,
  checkCoverageAuditEdgeFunction,
  checkPromptTemplates,
  checkConfigFilesPresent,
  checkEslintRulesRegistered,
  checkOperationalRunbooks,
  checkRolloutSequenceRunbook,
  checkSuperAdminAccessMigration,
  checkPostHandlers,
  checkQuizResponseShuffleMap,
  checkQuizPushSites,
} from '../../scripts/pre-rollout-checklist';

describe('pre-rollout checklist — individual checks', () => {
  it('all Phase 1-4 migrations present', () => {
    const r = checkPhase14MigrationsPresent();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('grounded-answer Edge Function present and calls Deno.serve', () => {
    const r = checkGroundedAnswerEdgeFunction();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('verify-question-bank Edge Function present', () => {
    const r = checkVerifyQuestionBankEdgeFunction();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('coverage-audit Edge Function present', () => {
    const r = checkCoverageAuditEdgeFunction();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('4 prompt templates present (foxy, ncert-solver, quiz-gen, verifier)', () => {
    const r = checkPromptTemplates();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('web + deno config files present', () => {
    const r = checkConfigFilesPresent();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('eslint ai-boundary rules registered', () => {
    const r = checkEslintRulesRegistered();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('5 operational runbooks present', () => {
    const r = checkOperationalRunbooks();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('rollout-sequence runbook present with Day 1 + rollback sections', () => {
    const r = checkRolloutSequenceRunbook();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('super_admin.access seed migration present', () => {
    const r = checkSuperAdminAccessMigration();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('POST handlers wired on verification-queue + ai-issues', () => {
    const r = checkPostHandlers();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('QuizResponse.shuffle_map field declared', () => {
    const r = checkQuizResponseShuffleMap();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });

  it('quiz page has 5 shuffle_map push sites (P1 fix)', () => {
    const r = checkQuizPushSites();
    expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });
});

describe('pre-rollout checklist — runAllChecks()', () => {
  it('returns allPass=true on current worktree', () => {
    const { results, allPass } = runAllChecks();
    const failed = results.filter((r) => !r.pass);
    expect(
      allPass,
      `Failed checks:\n${failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n')}`,
    ).toBe(true);
    // And the count matches ALL_CHECKS
    expect(results).toHaveLength(ALL_CHECKS.length);
  });

  it('exports the expected number of checks (14)', () => {
    // Sanity: if checks are added/removed, this test forces an intentional
    // decision rather than an accidental drift.
    expect(ALL_CHECKS).toHaveLength(14);
  });
});
