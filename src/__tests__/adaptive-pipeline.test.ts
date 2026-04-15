/**
 * Adaptive Pipeline Integrity Tests
 *
 * These are STRUCTURAL tests that verify the adaptive learning pipeline is
 * correctly wired. They do not need a real database -- they check that:
 *
 * 1. submitQuizResults() and processAdaptiveLearning() exist and are exported
 * 2. The quiz page calls both functions
 * 3. processAdaptiveLearning() calls the CME Edge Function record_response
 * 4. The submit_quiz_results RPC calls update_learner_state_post_quiz
 *
 * If any of these structural guarantees break, the adaptive learning pipeline
 * silently degrades -- questions stop adapting, mastery tracking stalls, and
 * spaced repetition scheduling freezes.
 *
 * See: ARCHITECTURAL CONTRACT comment in src/lib/supabase.ts
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Adaptive Pipeline Integrity', () => {
  // ---------------------------------------------------------------
  // 1. Exported function existence
  // ---------------------------------------------------------------
  it('submitQuizResults must be exported from supabase.ts', async () => {
    const supabaseLib = await import('@/lib/supabase');
    expect(typeof supabaseLib.submitQuizResults).toBe('function');
  });

  it('processAdaptiveLearning must be exported from supabase.ts', async () => {
    const supabaseLib = await import('@/lib/supabase');
    expect(typeof supabaseLib.processAdaptiveLearning).toBe('function');
  });

  // ---------------------------------------------------------------
  // 2. Quiz page wiring
  // ---------------------------------------------------------------
  it('quiz page must import and call submitQuizResults', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    expect(source).toContain('submitQuizResults');
  });

  it('quiz page must import and call processAdaptiveLearning', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    expect(source).toContain('processAdaptiveLearning');
  });

  it('quiz page must call processAdaptiveLearning AFTER submitQuizResults', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    const submitIndex = source.indexOf('submitQuizResults(');
    const adaptiveIndex = source.indexOf('processAdaptiveLearning(');
    expect(submitIndex).toBeGreaterThan(-1);
    expect(adaptiveIndex).toBeGreaterThan(-1);
    expect(adaptiveIndex).toBeGreaterThan(submitIndex);
  });

  // ---------------------------------------------------------------
  // 3. Client-side CME wiring (processAdaptiveLearning -> cme-engine)
  // ---------------------------------------------------------------
  it('processAdaptiveLearning must call cme-engine record_response', () => {
    const supabasePath = path.resolve('src/lib/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    // Extract the processAdaptiveLearning function body
    const funcStart = source.indexOf('export async function processAdaptiveLearning');
    expect(funcStart).toBeGreaterThan(-1);
    const funcBody = source.slice(funcStart, funcStart + 3000);
    expect(funcBody).toContain('record_response');
    expect(funcBody).toContain('cme-engine');
  });

  // ---------------------------------------------------------------
  // 4. Server-side RPC wiring (submit_quiz_results -> update_learner_state_post_quiz)
  // ---------------------------------------------------------------
  it('submit_quiz_results RPC must call update_learner_state_post_quiz', () => {
    // Check the latest migration that defines submit_quiz_results
    const migrationsDir = path.resolve('supabase/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    // Find migrations that contain submit_quiz_results
    let latestMigrationWithSubmitQuiz = '';
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      if (content.includes('CREATE OR REPLACE FUNCTION submit_quiz_results')) {
        latestMigrationWithSubmitQuiz = file;
      }
    }

    expect(latestMigrationWithSubmitQuiz).not.toBe('');
    const migrationContent = fs.readFileSync(
      path.join(migrationsDir, latestMigrationWithSubmitQuiz),
      'utf-8'
    );

    // The RPC must call update_learner_state_post_quiz for mastery updates
    expect(migrationContent).toContain('update_learner_state_post_quiz');

    // The call must be guarded by topic_id existence
    expect(migrationContent).toContain('v_q_topic_id IS NOT NULL');
  });

  // ---------------------------------------------------------------
  // 5. Fallback path awareness
  // ---------------------------------------------------------------
  it('submitQuizResults fallback must use atomic_quiz_profile_update', () => {
    const supabasePath = path.resolve('src/lib/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    // The fallback path after submit_quiz_results RPC fails
    expect(source).toContain('atomic_quiz_profile_update');
  });

  it('submitQuizResults must try submit_quiz_results RPC as primary path', () => {
    const supabasePath = path.resolve('src/lib/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    // The function body within submitQuizResults. Window widened from 500 to
    // 1000 chars — the function now has a dedup prelude + layered try/catch
    // wrappers that push the RPC call past the old 500-char cutoff. Intent of
    // the assertion is unchanged: the RPC call must appear in the function's
    // primary path, not in a deep fallback.
    const funcStart = source.indexOf('export async function submitQuizResults');
    expect(funcStart).toBeGreaterThan(-1);
    const funcBody = source.slice(funcStart, funcStart + 1000);
    // Primary path calls the full RPC (not the fallback)
    expect(funcBody).toContain("supabase.rpc('submit_quiz_results'");
  });

  // ---------------------------------------------------------------
  // 6. Adaptive failure monitoring
  // ---------------------------------------------------------------
  it('processAdaptiveLearning must report failures to ops events', () => {
    const supabasePath = path.resolve('src/lib/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    const funcStart = source.indexOf('export async function processAdaptiveLearning');
    expect(funcStart).toBeGreaterThan(-1);
    const funcBody = source.slice(funcStart, funcStart + 5000);
    // Must report to /api/client-error for observability
    expect(funcBody).toContain('/api/client-error');
    expect(funcBody).toContain('adaptive-pipeline');
  });

  // ---------------------------------------------------------------
  // 7. Architectural contract comment
  // ---------------------------------------------------------------
  it('submitQuizResults must have the architectural contract comment', () => {
    const supabasePath = path.resolve('src/lib/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    const funcStart = source.indexOf('export async function submitQuizResults');
    expect(funcStart).toBeGreaterThan(-1);
    // The contract comment should appear shortly before the function
    const preamble = source.slice(Math.max(0, funcStart - 2000), funcStart);
    expect(preamble).toContain('ARCHITECTURAL CONTRACT');
    expect(preamble).toContain('Layer 1');
    expect(preamble).toContain('Layer 2');
  });

  // ---------------------------------------------------------------
  // 8. Database: topic_id coverage (skip if no Supabase connection)
  // ---------------------------------------------------------------
  it('question_bank topic_id coverage must be >= 95% (requires Supabase)', async () => {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      // Skip in CI/local without Supabase -- the intent is documented
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { count: total } = await sb.from('question_bank').select('*', { count: 'exact', head: true });
    const { count: withTopicId } = await sb
      .from('question_bank')
      .select('*', { count: 'exact', head: true })
      .not('topic_id', 'is', null);

    if (total && total > 0 && withTopicId !== null) {
      const coverage = (withTopicId / total) * 100;
      expect(coverage).toBeGreaterThanOrEqual(95);
    }
  });
});