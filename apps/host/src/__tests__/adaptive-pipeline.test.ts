/**
 * Adaptive Pipeline Integrity Tests
 *
 * These are STRUCTURAL tests that verify the adaptive learning pipeline is
 * correctly wired. They do not need a real database -- they check that:
 *
 * 1. submitQuizResults() exists and is exported; processAdaptiveLearning()
 *    stays DELETED (tracker E1, 2026-08-05 — the client-side CME fan-out was
 *    dead code; cme-engine is tombstoned and adaptive state is server-side)
 * 2. The quiz page calls submitQuizResults
 * 3. No client-side cme-engine wiring remains in supabase.ts
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
import { hasSupabaseIntegrationEnv } from './helpers/integration';

describe('Adaptive Pipeline Integrity', () => {
  // ---------------------------------------------------------------
  // 1. Exported function existence
  // ---------------------------------------------------------------
  it('submitQuizResults must be exported from supabase.ts', async () => {
    const supabaseLib = await import('@alfanumrik/lib/supabase');
    expect(typeof supabaseLib.submitQuizResults).toBe('function');
  });

  it('processAdaptiveLearning stays DELETED from supabase.ts (tracker E1)', async () => {
    // Flipped 2026-08-05: the client-side "Layer 2" CME fan-out had zero live
    // callers and wrote the RETIRED cme_concept_state store. Re-adding it
    // would resurrect a client-side mastery write path — must stay gone.
    const supabaseLib = (await import('@alfanumrik/lib/supabase')) as Record<string, unknown>;
    expect(supabaseLib.processAdaptiveLearning).toBeUndefined();
    expect(supabaseLib.getCmeNextAction).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // 2. Quiz page wiring
  // ---------------------------------------------------------------
  it('quiz page must import and call submitQuizResults', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    expect(source).toContain('submitQuizResults');
  });

  it('quiz page must use assembleQuiz for guaranteed question counts', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    expect(source).toContain('assembleQuiz');
  });

  it('adaptive learning is handled server-side via atomic_quiz_profile_update RPC', () => {
    const quizPath = path.resolve('src/app/quiz/page.tsx');
    const source = fs.readFileSync(quizPath, 'utf-8');
    // processAdaptiveLearning was removed from the client — CME mastery is now
    // updated server-side via the atomic RPC. Verify the comment documents this.
    expect(source).toContain('CME mastery state is updated server-side');
  });

  // ---------------------------------------------------------------
  // 3. No client-side CME wiring remains (tracker E1, 2026-08-05)
  // ---------------------------------------------------------------
  it('supabase.ts carries no cme-engine fetch-out or client mastery fan-out', () => {
    const supabasePath = path.resolve('../../packages/lib/src/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    expect(source).not.toContain('export async function processAdaptiveLearning');
    expect(source).not.toContain('functions/v1/cme-engine');
    expect(source).not.toContain("action: 'record_response'");
  });

  // ---------------------------------------------------------------
  // 4. Server-side RPC wiring (submit_quiz_results -> update_learner_state_post_quiz)
  // ---------------------------------------------------------------
  it('submit_quiz_results RPC must call update_learner_state_post_quiz', () => {
    // Section 10 cleanup (2026-05-03): pre-baseline migrations were moved
    // to `supabase/migrations/_legacy/timestamped/`. Search both roots.
    const migrationsDirs = [
      path.resolve('supabase/migrations'),
      path.resolve('supabase/migrations/_legacy/timestamped'),
    ].filter((d) => fs.existsSync(d));

    // Find latest migration (across both dirs) that contains submit_quiz_results
    let latestMigrationWithSubmitQuiz = '';
    let latestMigrationDir = '';
    for (const migrationsDir of migrationsDirs) {
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        if (content.includes('CREATE OR REPLACE FUNCTION submit_quiz_results')) {
          // Track the lexicographically latest file across all dirs.
          if (file > latestMigrationWithSubmitQuiz) {
            latestMigrationWithSubmitQuiz = file;
            latestMigrationDir = migrationsDir;
          }
        }
      }
    }

    expect(latestMigrationWithSubmitQuiz).not.toBe('');
    const migrationContent = fs.readFileSync(
      path.join(latestMigrationDir, latestMigrationWithSubmitQuiz),
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
    const supabasePath = path.resolve('../../packages/lib/src/supabase.ts');
    const source = fs.readFileSync(supabasePath, 'utf-8');
    // The fallback path after submit_quiz_results RPC fails
    expect(source).toContain('atomic_quiz_profile_update');
  });

  it('submitQuizResults must try submit_quiz_results RPC as primary path', () => {
    const supabasePath = path.resolve('../../packages/lib/src/supabase.ts');
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
  // 6. Adaptive failure monitoring — retired with processAdaptiveLearning
  //    (tracker E1, 2026-08-05). Server-side RPC failures surface through
  //    submitQuizResults' own logged fallback chain (test 5 above); there is
  //    no client-side CME fan-out left to monitor.
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // 7. Architectural contract comment
  // ---------------------------------------------------------------
  it('submitQuizResults must have the architectural contract comment', () => {
    const supabasePath = path.resolve('../../packages/lib/src/supabase.ts');
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
  // 8. Live data quality: topic_id coverage (explicit opt-in)
  // ---------------------------------------------------------------
  // Use the same placeholder-aware integration helper that the migration
  // suite uses (see helpers/integration.ts). CI sets placeholder env vars
  // to satisfy validateServerEnv at boot, which would previously cause this
  // test to attempt a network call to placeholder.supabase.co and time out.
  // P0-D launch fix: hard-skip when env is placeholders.
  const itIfIntegration =
    hasSupabaseIntegrationEnv() && process.env.RUN_LIVE_DATA_QUALITY === '1'
      ? it
      : it.skip;
  itIfIntegration('question_bank topic_id coverage must be >= 95% (requires Supabase)', async () => {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
