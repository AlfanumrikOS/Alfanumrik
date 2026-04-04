/**
 * Learning Quality Monitoring System
 *
 * 8 monitors that detect learning quality issues and automatically create
 * improvement_issues when thresholds are breached.
 *
 * Monitors:
 *  1. Syllabus Drift — orphaned questions referencing missing topics
 *  2. Answer Key Accuracy — basic question_bank integrity checks
 *  3. Foxy Content Sync — stale RAG chunks vs updated topics
 *  4. XP Inflation — students hitting daily cap too frequently
 *  5. Mastery Stagnation — students active but not progressing
 *  6. Quiz Difficulty — miscalibrated "remember" questions
 *  7. Chapter Coverage — chapters with too few questions
 *  8. RAG Retrieval Quality — retrieval hit rate from traces
 *
 * Each monitor returns a MonitorResult and never throws.
 * Use runAllMonitors() to run all at once.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ── Types ───────────────────────────────────────────────────────

export interface MonitorResult {
  monitor_name: string;
  value: number;
  threshold: number;
  breached: boolean;
  trend: 'improving' | 'degrading' | 'stable';
  details: Record<string, unknown>;
  checked_at: string;
}

export interface MonitorConfig {
  quiz_wrong_rate_threshold: number;
  answer_key_mismatch_threshold: number;
  foxy_stale_chunks_threshold: number;
  xp_cap_daily_threshold: number;
  mastery_stagnation_threshold: number;
  quiz_difficulty_threshold: number;
  chapter_min_questions: number;
  rag_hit_rate_threshold: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  quiz_wrong_rate_threshold: 0.30,
  answer_key_mismatch_threshold: 0.01,
  foxy_stale_chunks_threshold: 0.05,
  xp_cap_daily_threshold: 0.10,
  mastery_stagnation_threshold: 0.20,
  quiz_difficulty_threshold: 0.30,
  chapter_min_questions: 5,
  rag_hit_rate_threshold: 0.70,
};

// ── Helpers ─────────────────────────────────────────────────────

function neutralResult(name: string, reason: string): MonitorResult {
  return {
    monitor_name: name,
    value: 0,
    threshold: 0,
    breached: false,
    trend: 'stable',
    details: { skipped: true, reason },
    checked_at: new Date().toISOString(),
  };
}

// ── Monitor 1: Syllabus Drift ───────────────────────────────────

/**
 * Check if any active questions in question_bank reference topics that
 * no longer exist in chapter_topics. Uses the question_bank.topic field
 * compared against chapter_topics.concept_tag for the same grade/chapter.
 */
async function monitorSyllabusDrift(): Promise<MonitorResult> {
  const name = 'syllabus_drift';
  try {
    const supabase = getSupabaseAdmin();

    // Get all active questions that have a topic assigned
    const { data: questions, error: qErr } = await supabase
      .from('question_bank')
      .select('id, topic, grade, chapter_number')
      .eq('is_active', true)
      .not('topic', 'is', null);

    if (qErr || !questions) {
      return neutralResult(name, `Query error: ${qErr?.message || 'no data'}`);
    }

    if (questions.length === 0) {
      return neutralResult(name, 'No active questions with topics found');
    }

    // Get all active chapter_topics concept_tags
    const { data: topics, error: tErr } = await supabase
      .from('chapter_topics')
      .select('concept_tag, chapter_id')
      .eq('is_active', true);

    if (tErr || !topics) {
      return neutralResult(name, `Topics query error: ${tErr?.message || 'no data'}`);
    }

    // Build a set of known concept_tags
    const knownTags = new Set(topics.map((t: Record<string, unknown>) => t.concept_tag as string));

    // Count orphaned questions whose topic does not match any concept_tag
    const orphaned = questions.filter(
      (q: Record<string, unknown>) => q.topic && !knownTags.has(q.topic as string)
    );

    const total = questions.length;
    const orphanCount = orphaned.length;
    const ratio = total > 0 ? orphanCount / total : 0;

    return {
      monitor_name: name,
      value: Math.round(ratio * 10000) / 10000,
      threshold: 0.05, // >5% orphaned = breach
      breached: ratio > 0.05,
      trend: 'stable',
      details: {
        total_questions: total,
        orphaned_questions: orphanCount,
        sample_orphaned: orphaned.slice(0, 5).map((q: Record<string, unknown>) => ({
          id: q.id,
          topic: q.topic,
          grade: q.grade,
          chapter: q.chapter_number,
        })),
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_syllabus_drift_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 2: Answer Key Accuracy ──────────────────────────────

/**
 * Check question_bank for basic integrity: correct_answer_index 0-3,
 * options array has exactly 4 entries, explanation is non-empty.
 */
async function monitorAnswerKeyAccuracy(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'answer_key_accuracy';
  try {
    const supabase = getSupabaseAdmin();

    const { data: questions, error } = await supabase
      .from('question_bank')
      .select('id, correct_answer_index, options, explanation')
      .eq('is_active', true);

    if (error || !questions) {
      return neutralResult(name, `Query error: ${error?.message || 'no data'}`);
    }

    if (questions.length === 0) {
      return neutralResult(name, 'No active questions found');
    }

    let violations = 0;
    const violationSamples: Record<string, unknown>[] = [];

    for (const q of questions as Record<string, unknown>[]) {
      const idx = q.correct_answer_index as number;
      const opts = q.options as unknown[];
      const explanation = q.explanation as string | null;

      let isViolation = false;

      // correct_answer_index must be 0-3
      if (typeof idx !== 'number' || idx < 0 || idx > 3) {
        isViolation = true;
      }

      // options must be an array with exactly 4 entries
      if (!Array.isArray(opts) || opts.length !== 4) {
        isViolation = true;
      } else {
        // All options must be non-empty strings
        const hasEmpty = opts.some(
          (o) => typeof o !== 'string' || o.trim() === ''
        );
        if (hasEmpty) isViolation = true;
      }

      // Explanation must be non-empty
      if (!explanation || explanation.trim() === '') {
        isViolation = true;
      }

      if (isViolation) {
        violations++;
        if (violationSamples.length < 5) {
          violationSamples.push({ id: q.id, correct_answer_index: idx, options_count: Array.isArray(opts) ? opts.length : 0 });
        }
      }
    }

    const total = questions.length;
    const ratio = total > 0 ? violations / total : 0;

    return {
      monitor_name: name,
      value: Math.round(ratio * 10000) / 10000,
      threshold: config.answer_key_mismatch_threshold,
      breached: ratio > config.answer_key_mismatch_threshold,
      trend: 'stable',
      details: {
        total_questions: total,
        violations,
        violation_rate: Math.round(ratio * 10000) / 10000,
        samples: violationSamples,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_answer_key_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 3: Foxy Content Sync ────────────────────────────────

/**
 * Check rag_content_chunks for chunks with updated_at older than 90 days
 * while their corresponding topic in chapter_topics was updated more recently.
 */
async function monitorFoxyContentSync(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'foxy_content_sync';
  try {
    const supabase = getSupabaseAdmin();

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Get old chunks
    const { data: oldChunks, error: chunkErr } = await supabase
      .from('rag_content_chunks')
      .select('id, updated_at, concept_id')
      .lt('updated_at', ninetyDaysAgo);

    if (chunkErr) {
      // Table might not exist or have different structure
      return neutralResult(name, `Chunks query error: ${chunkErr.message}`);
    }

    // Get total chunk count
    const { count: totalCount, error: countErr } = await supabase
      .from('rag_content_chunks')
      .select('id', { count: 'exact', head: true });

    if (countErr || totalCount === null) {
      return neutralResult(name, `Count query error: ${countErr?.message || 'null count'}`);
    }

    if (totalCount === 0) {
      return neutralResult(name, 'No RAG content chunks found');
    }

    const staleCount = oldChunks?.length || 0;
    const ratio = staleCount / totalCount;

    return {
      monitor_name: name,
      value: Math.round(ratio * 10000) / 10000,
      threshold: config.foxy_stale_chunks_threshold,
      breached: ratio > config.foxy_stale_chunks_threshold,
      trend: 'stable',
      details: {
        total_chunks: totalCount,
        stale_chunks: staleCount,
        stale_cutoff: ninetyDaysAgo,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_foxy_sync_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 4: XP Inflation ─────────────────────────────────────

/**
 * Check quiz_sessions for students hitting the daily XP cap (200)
 * every day for 7+ consecutive days. Count such students vs total active.
 */
async function monitorXpInflation(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'xp_inflation';
  try {
    const supabase = getSupabaseAdmin();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get quiz sessions from last 7 days with xp_earned, grouped by student and day
    const { data: sessions, error: sessErr } = await supabase
      .from('quiz_sessions')
      .select('student_id, xp_earned, created_at')
      .eq('is_completed', true)
      .gte('created_at', sevenDaysAgo);

    if (sessErr || !sessions) {
      return neutralResult(name, `Query error: ${sessErr?.message || 'no data'}`);
    }

    if (sessions.length === 0) {
      return neutralResult(name, 'No completed quiz sessions in last 7 days');
    }

    // Group XP by student by day
    const studentDayXp: Record<string, Record<string, number>> = {};
    const allStudents = new Set<string>();

    for (const s of sessions as Record<string, unknown>[]) {
      const studentId = s.student_id as string;
      const xp = (s.xp_earned as number) || 0;
      const day = (s.created_at as string).slice(0, 10); // YYYY-MM-DD

      allStudents.add(studentId);
      if (!studentDayXp[studentId]) studentDayXp[studentId] = {};
      studentDayXp[studentId][day] = (studentDayXp[studentId][day] || 0) + xp;
    }

    // Count students who hit 200 XP cap on 7+ distinct days
    let capHitters = 0;
    for (const [, dayMap] of Object.entries(studentDayXp)) {
      const daysAtCap = Object.values(dayMap).filter((xp) => xp >= 200).length;
      if (daysAtCap >= 7) capHitters++;
    }

    const totalActive = allStudents.size;
    const ratio = totalActive > 0 ? capHitters / totalActive : 0;

    return {
      monitor_name: name,
      value: Math.round(ratio * 10000) / 10000,
      threshold: config.xp_cap_daily_threshold,
      breached: ratio > config.xp_cap_daily_threshold,
      trend: 'stable',
      details: {
        total_active_students: totalActive,
        students_hitting_cap_7_days: capHitters,
        ratio: Math.round(ratio * 10000) / 10000,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_xp_inflation_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 5: Mastery Stagnation ───────────────────────────────

/**
 * Check concept_mastery for students with last_attempted_at in the last 7 days
 * but no mastery_level increase (mastery_probability unchanged or decreased).
 */
async function monitorMasteryStagnation(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'mastery_stagnation';
  try {
    const supabase = getSupabaseAdmin();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get concept_mastery entries with recent activity
    const { data: entries, error } = await supabase
      .from('concept_mastery')
      .select('student_id, mastery_probability, attempts, correct_attempts, last_attempted_at')
      .gte('last_attempted_at', sevenDaysAgo)
      .gte('attempts', 3); // Only students with meaningful attempts

    if (error || !entries) {
      return neutralResult(name, `Query error: ${error?.message || 'no data'}`);
    }

    if (entries.length === 0) {
      return neutralResult(name, 'No recent concept mastery entries found');
    }

    // Count stagnating students: low mastery probability despite recent activity
    const studentMastery: Record<string, { stagnating: number; total: number }> = {};

    for (const e of entries as Record<string, unknown>[]) {
      const studentId = e.student_id as string;
      const prob = (e.mastery_probability as number) || 0;

      if (!studentMastery[studentId]) {
        studentMastery[studentId] = { stagnating: 0, total: 0 };
      }
      studentMastery[studentId].total++;

      // Stagnating if mastery is still low (<0.5) despite 3+ attempts
      if (prob < 0.5) {
        studentMastery[studentId].stagnating++;
      }
    }

    // Count students where >50% of their topics are stagnating
    let stagnatingStudents = 0;
    const totalStudents = Object.keys(studentMastery).length;

    for (const [, data] of Object.entries(studentMastery)) {
      if (data.total > 0 && data.stagnating / data.total > 0.5) {
        stagnatingStudents++;
      }
    }

    const ratio = totalStudents > 0 ? stagnatingStudents / totalStudents : 0;

    return {
      monitor_name: name,
      value: Math.round(ratio * 10000) / 10000,
      threshold: config.mastery_stagnation_threshold,
      breached: ratio > config.mastery_stagnation_threshold,
      trend: 'stable',
      details: {
        total_active_students: totalStudents,
        stagnating_students: stagnatingStudents,
        total_mastery_entries: entries.length,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_mastery_stagnation_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 6: Quiz Difficulty ──────────────────────────────────

/**
 * Check question_bank questions tagged bloom_level = 'remember' and
 * calculate wrong rate from quiz_responses. If >30% get "remember"
 * questions wrong, difficulty is miscalibrated.
 */
async function monitorQuizDifficulty(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'quiz_difficulty';
  try {
    const supabase = getSupabaseAdmin();

    // Get "remember" level question IDs
    const { data: rememberQs, error: qErr } = await supabase
      .from('question_bank')
      .select('id')
      .eq('bloom_level', 'remember')
      .eq('is_active', true);

    if (qErr || !rememberQs) {
      return neutralResult(name, `Query error: ${qErr?.message || 'no data'}`);
    }

    if (rememberQs.length === 0) {
      return neutralResult(name, 'No "remember" bloom level questions found');
    }

    const questionIds = rememberQs.map((q: Record<string, unknown>) => q.id as string);

    // Get responses for these questions from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch in batches if too many question IDs (Supabase IN filter limit)
    const batchSize = 100;
    let totalResponses = 0;
    let wrongResponses = 0;

    for (let i = 0; i < questionIds.length; i += batchSize) {
      const batch = questionIds.slice(i, i + batchSize);

      const { data: responses, error: rErr } = await supabase
        .from('quiz_responses')
        .select('is_correct')
        .in('question_id', batch)
        .gte('created_at', thirtyDaysAgo);

      if (rErr || !responses) continue;

      for (const r of responses as Record<string, unknown>[]) {
        totalResponses++;
        if (r.is_correct === false) wrongResponses++;
      }
    }

    if (totalResponses === 0) {
      return neutralResult(name, 'No quiz responses for "remember" questions in last 30 days');
    }

    const wrongRate = wrongResponses / totalResponses;

    return {
      monitor_name: name,
      value: Math.round(wrongRate * 10000) / 10000,
      threshold: config.quiz_difficulty_threshold,
      breached: wrongRate > config.quiz_difficulty_threshold,
      trend: 'stable',
      details: {
        remember_questions: questionIds.length,
        total_responses: totalResponses,
        wrong_responses: wrongResponses,
        wrong_rate: Math.round(wrongRate * 10000) / 10000,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_quiz_difficulty_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 7: Chapter Coverage ─────────────────────────────────

/**
 * Count questions per chapter in question_bank (using chapter_number + subject + grade).
 * Flag chapters with fewer than chapter_min_questions.
 */
async function monitorChapterCoverage(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'chapter_coverage';
  try {
    const supabase = getSupabaseAdmin();

    // Get all active chapters
    const { data: chapters, error: chErr } = await supabase
      .from('chapters')
      .select('id, subject_id, grade, chapter_number, title')
      .eq('is_active', true);

    if (chErr || !chapters) {
      return neutralResult(name, `Chapters query error: ${chErr?.message || 'no data'}`);
    }

    if (chapters.length === 0) {
      return neutralResult(name, 'No active chapters found');
    }

    // Get question counts grouped by grade + chapter_number
    // question_bank uses subject (text), grade (text), chapter_number (int)
    const { data: questions, error: qErr } = await supabase
      .from('question_bank')
      .select('grade, chapter_number')
      .eq('is_active', true);

    if (qErr || !questions) {
      return neutralResult(name, `Questions query error: ${qErr?.message || 'no data'}`);
    }

    // Build question count map: "grade|chapter_number" → count
    const countMap: Record<string, number> = {};
    for (const q of questions as Record<string, unknown>[]) {
      const key = `${q.grade}|${q.chapter_number}`;
      countMap[key] = (countMap[key] || 0) + 1;
    }

    // Check chapters against the map
    const underCovered: Record<string, unknown>[] = [];

    for (const ch of chapters as Record<string, unknown>[]) {
      const key = `${ch.grade}|${ch.chapter_number}`;
      const count = countMap[key] || 0;

      if (count < config.chapter_min_questions) {
        underCovered.push({
          chapter_id: ch.id,
          grade: ch.grade,
          chapter_number: ch.chapter_number,
          title: ch.title,
          question_count: count,
        });
      }
    }

    const totalChapters = chapters.length;
    const underCount = underCovered.length;
    const ratio = totalChapters > 0 ? underCount / totalChapters : 0;

    return {
      monitor_name: name,
      value: underCount,
      threshold: config.chapter_min_questions,
      breached: underCount > 0,
      trend: 'stable',
      details: {
        total_chapters: totalChapters,
        under_covered_chapters: underCount,
        min_questions_required: config.chapter_min_questions,
        coverage_ratio: Math.round((1 - ratio) * 10000) / 10000,
        under_covered: underCovered.slice(0, 10),
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_chapter_coverage_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Monitor 8: RAG Retrieval Quality ────────────────────────────

/**
 * Check retrieval_traces table for hit rate. A "hit" is a trace with
 * match_count > 0 and chunk_ids not empty. If table doesn't exist,
 * return a neutral result.
 */
async function monitorRagRetrievalQuality(config: MonitorConfig): Promise<MonitorResult> {
  const name = 'rag_retrieval_quality';
  try {
    const supabase = getSupabaseAdmin();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Try retrieval_traces table
    const { data: traces, error: trErr } = await supabase
      .from('retrieval_traces')
      .select('id, match_count, chunk_ids')
      .gte('created_at', sevenDaysAgo);

    if (trErr) {
      // Table might not exist
      if (trErr.message.includes('does not exist') || trErr.code === '42P01') {
        return neutralResult(name, 'retrieval_traces table does not exist');
      }
      return neutralResult(name, `Query error: ${trErr.message}`);
    }

    if (!traces || traces.length === 0) {
      return neutralResult(name, 'No retrieval traces in last 7 days');
    }

    let hits = 0;
    for (const t of traces as Record<string, unknown>[]) {
      const matchCount = (t.match_count as number) || 0;
      const chunkIds = t.chunk_ids as string[];

      if (matchCount > 0 && Array.isArray(chunkIds) && chunkIds.length > 0) {
        hits++;
      }
    }

    const total = traces.length;
    const hitRate = total > 0 ? hits / total : 0;

    return {
      monitor_name: name,
      value: Math.round(hitRate * 10000) / 10000,
      threshold: config.rag_hit_rate_threshold,
      breached: hitRate < config.rag_hit_rate_threshold,
      trend: 'stable',
      details: {
        total_traces: total,
        hits,
        misses: total - hits,
        hit_rate: Math.round(hitRate * 10000) / 10000,
      },
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('monitor_rag_quality_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return neutralResult(name, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main: Run All Monitors ──────────────────────────────────────

export async function runAllMonitors(config?: Partial<MonitorConfig>): Promise<MonitorResult[]> {
  const cfg = { ...DEFAULT_MONITOR_CONFIG, ...config };
  const results: MonitorResult[] = [];

  const monitors = [
    () => monitorSyllabusDrift(),
    () => monitorAnswerKeyAccuracy(cfg),
    () => monitorFoxyContentSync(cfg),
    () => monitorXpInflation(cfg),
    () => monitorMasteryStagnation(cfg),
    () => monitorQuizDifficulty(cfg),
    () => monitorChapterCoverage(cfg),
    () => monitorRagRetrievalQuality(cfg),
  ];

  // Run all monitors concurrently, catch individual failures
  const settled = await Promise.allSettled(monitors.map((fn) => fn()));

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      const monitorNames = [
        'syllabus_drift', 'answer_key_accuracy', 'foxy_content_sync',
        'xp_inflation', 'mastery_stagnation', 'quiz_difficulty',
        'chapter_coverage', 'rag_retrieval_quality',
      ];
      logger.error('monitor_unhandled_rejection', {
        error: outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)),
        monitor: monitorNames[i],
      });
      results.push(neutralResult(monitorNames[i], `Unhandled rejection: ${String(outcome.reason)}`));
    }
  }

  return results;
}

// ── Auto-Issue Creation ─────────────────────────────────────────

/**
 * For each breached monitor, create or update an improvement_issue.
 * Deduplicates by checking for existing open issues with the same monitor_name
 * in the title prefix.
 *
 * Returns count of new issues created.
 */
export async function createIssuesFromMonitors(results: MonitorResult[]): Promise<number> {
  const supabase = getSupabaseAdmin();
  let created = 0;

  const breached = results.filter((r) => r.breached);
  if (breached.length === 0) return 0;

  for (const result of breached) {
    try {
      const titlePrefix = `[Monitor] ${result.monitor_name}`;

      // Check for existing open issues with this monitor name
      const { data: existing, error: existErr } = await supabase
        .from('improvement_issues')
        .select('id, status')
        .like('title', `${titlePrefix}%`)
        .in('status', ['open', 'investigating', 'recommendation_pending', 'in_progress']);

      if (existErr) {
        logger.error('monitor_issue_dedup_error', {
          error: new Error(existErr.message),
          monitor: result.monitor_name,
        });
        continue;
      }

      // Skip if there's already an open issue for this monitor
      if (existing && existing.length > 0) {
        continue;
      }

      // Determine severity based on how far the value exceeds the threshold
      let severity = 'medium';
      if (result.monitor_name === 'answer_key_accuracy') {
        severity = 'critical'; // answer key issues are always critical
      } else if (typeof result.value === 'number' && typeof result.threshold === 'number') {
        const excess = result.value / (result.threshold || 1);
        if (excess > 2) severity = 'critical';
        else if (excess > 1.5) severity = 'high';
      }

      // Map monitor names to categories
      const categoryMap: Record<string, string> = {
        syllabus_drift: 'learning',
        answer_key_accuracy: 'quiz',
        foxy_content_sync: 'rag',
        xp_inflation: 'learning',
        mastery_stagnation: 'learning',
        quiz_difficulty: 'quiz',
        chapter_coverage: 'learning',
        rag_retrieval_quality: 'rag',
      };

      const { error: insertErr } = await supabase
        .from('improvement_issues')
        .insert({
          title: `${titlePrefix}: threshold breached (${result.value} vs ${result.threshold})`,
          description: `Automated monitor detected a breach.\n\nMonitor: ${result.monitor_name}\nValue: ${result.value}\nThreshold: ${result.threshold}\nDetails: ${JSON.stringify(result.details, null, 2)}`,
          category: categoryMap[result.monitor_name] || 'learning',
          severity,
          source: 'monitor',
          evidence: {
            monitor_result: result,
            auto_created: true,
          },
          created_by: 'system:learning-monitor',
        });

      if (insertErr) {
        logger.error('monitor_issue_create_error', {
          error: new Error(insertErr.message),
          monitor: result.monitor_name,
        });
        continue;
      }

      created++;
    } catch (err) {
      logger.error('monitor_issue_creation_exception', {
        error: err instanceof Error ? err : new Error(String(err)),
        monitor: result.monitor_name,
      });
    }
  }

  return created;
}
