/**
 * Automated Issue Detection Engine
 *
 * Each detector is a pure function that queries Supabase and returns DetectedIssue[].
 * Detectors never throw -- they catch errors internally and return empty arrays on failure.
 *
 * Usage:
 *   import { runAllDetectors, persistDetectedIssues } from '@/lib/issue-detector';
 *   const { detected, errors } = await runAllDetectors();
 *   const newCount = await persistDetectedIssues(detected);
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ── Types ────────────────────────────────────────────────────────

export interface DetectedIssue {
  source: 'auto_detect';
  category: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  affected_users_count: number;
}

// ── Detector: Quiz Quality ───────────────────────────────────────

/**
 * Find questions with >30% wrong-answer rate across all students in the last 7 days.
 * Only flags questions with at least 10 attempts to avoid noise from small samples.
 */
export async function detectQuizQualityIssues(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch recent quiz responses with question_id and is_correct
    const { data: responses, error } = await supabase
      .from('quiz_responses')
      .select('question_id, is_correct')
      .gte('created_at', since7d)
      .not('question_id', 'is', null);

    if (error || !responses) {
      logger.warn('issue_detector_quiz_quality_query_failed', { error: error?.message });
      return [];
    }

    // Group by question_id and calculate wrong rate
    const questionStats = new Map<string, { total: number; wrong: number }>();
    for (const row of responses) {
      const qid = row.question_id as string;
      if (!qid) continue;
      const stats = questionStats.get(qid) || { total: 0, wrong: 0 };
      stats.total++;
      if (!row.is_correct) stats.wrong++;
      questionStats.set(qid, stats);
    }

    const issues: DetectedIssue[] = [];
    for (const [questionId, stats] of questionStats) {
      if (stats.total < 10) continue;
      const wrongRate = stats.wrong / stats.total;
      if (wrongRate > 0.3) {
        issues.push({
          source: 'auto_detect',
          category: 'quiz',
          title: `High wrong-answer rate on question ${questionId.slice(0, 8)}`,
          description: `Question ${questionId} has a ${Math.round(wrongRate * 100)}% wrong-answer rate across ${stats.total} attempts in the last 7 days. This may indicate a poorly worded question, incorrect correct answer, or topic coverage gap.`,
          severity: wrongRate > 0.7 ? 'high' : 'medium',
          evidence: { question_id: questionId, wrong_rate: Math.round(wrongRate * 100) / 100, total_attempts: stats.total, wrong_attempts: stats.wrong },
          affected_users_count: stats.total,
        });
      }
    }

    return issues;
  } catch (err) {
    logger.error('issue_detector_quiz_quality_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Foxy (AI) Failures ─────────────────────────────────

/**
 * Check ai_usage_stats for high error rates in the last 24 hours.
 * If total_errors / total_requests > 10%, flag it.
 */
export async function detectFoxyFailures(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ai_usage_stats')
      .select('total_requests, total_errors, function_name, hour_bucket')
      .gte('hour_bucket', since24h);

    if (error || !data) {
      logger.warn('issue_detector_foxy_failures_query_failed', { error: error?.message });
      return [];
    }

    // Aggregate by function_name
    const funcStats = new Map<string, { requests: number; errors: number }>();
    for (const row of data) {
      const fn = (row.function_name as string) || 'unknown';
      const stats = funcStats.get(fn) || { requests: 0, errors: 0 };
      stats.requests += Number(row.total_requests) || 0;
      stats.errors += Number(row.total_errors) || 0;
      funcStats.set(fn, stats);
    }

    const issues: DetectedIssue[] = [];
    for (const [funcName, stats] of funcStats) {
      if (stats.requests === 0) continue;
      const errorRate = stats.errors / stats.requests;
      if (errorRate > 0.1) {
        issues.push({
          source: 'auto_detect',
          category: 'rag',
          title: `High AI error rate for ${funcName}`,
          description: `${funcName} has a ${Math.round(errorRate * 100)}% error rate (${stats.errors}/${stats.requests} requests) in the last 24 hours.`,
          severity: errorRate > 0.3 ? 'critical' : 'high',
          evidence: { function_name: funcName, error_rate: Math.round(errorRate * 100) / 100, total_requests: stats.requests, total_errors: stats.errors },
          affected_users_count: stats.requests,
        });
      }
    }

    return issues;
  } catch (err) {
    logger.error('issue_detector_foxy_failures_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Auth Failures ──────────────────────────────────────

/**
 * Check auth_audit_log for failed login/signup events in the last 24 hours.
 * If failure rate > 5% of total auth events, create issue.
 */
export async function detectAuthFailures(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: events, error } = await supabase
      .from('auth_audit_log')
      .select('event_type')
      .gte('created_at', since24h);

    if (error || !events) {
      logger.warn('issue_detector_auth_failures_query_failed', { error: error?.message });
      return [];
    }

    const totalEvents = events.length;
    if (totalEvents < 20) return []; // Not enough data to be meaningful

    const failedEvents = events.filter(e =>
      ['login_failure', 'bootstrap_failure'].includes(e.event_type as string)
    );
    const failureRate = failedEvents.length / totalEvents;

    if (failureRate > 0.05) {
      return [{
        source: 'auto_detect',
        category: 'onboarding',
        title: 'Elevated auth failure rate',
        description: `Auth failure rate is ${Math.round(failureRate * 100)}% (${failedEvents.length}/${totalEvents} events) in the last 24 hours. This may indicate a login bug, credential issues, or a brute force attempt.`,
        severity: failureRate > 0.2 ? 'critical' : 'high',
        evidence: { failure_rate: Math.round(failureRate * 100) / 100, failed_events: failedEvents.length, total_events: totalEvents },
        affected_users_count: failedEvents.length,
      }];
    }

    return [];
  } catch (err) {
    logger.error('issue_detector_auth_failures_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Payment Failures ───────────────────────────────────

/**
 * Check payment_history for failed payments in the last 7 days.
 * If failed / total > 2%, create issue.
 */
export async function detectPaymentFailures(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: payments, error } = await supabase
      .from('payment_history')
      .select('status')
      .gte('created_at', since7d);

    if (error || !payments) {
      logger.warn('issue_detector_payment_failures_query_failed', { error: error?.message });
      return [];
    }

    const total = payments.length;
    if (total < 10) return []; // Not enough data

    const failed = payments.filter(p => p.status === 'failed').length;
    const failureRate = failed / total;

    if (failureRate > 0.02) {
      return [{
        source: 'auto_detect',
        category: 'payment',
        title: 'Elevated payment failure rate',
        description: `Payment failure rate is ${Math.round(failureRate * 100)}% (${failed}/${total} payments) in the last 7 days. This may indicate a payment gateway issue, UPI downtime, or card processing problems.`,
        severity: failureRate > 0.1 ? 'critical' : failureRate > 0.05 ? 'high' : 'medium',
        evidence: { failure_rate: Math.round(failureRate * 100) / 100, failed_payments: failed, total_payments: total },
        affected_users_count: failed,
      }];
    }

    return [];
  } catch (err) {
    logger.error('issue_detector_payment_failures_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Content Gaps ───────────────────────────────────────

/**
 * Find subjects/chapters with 0 questions in question_bank.
 * Joins through chapters and subjects tables.
 */
export async function detectContentGaps(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();

    // Get all active chapters with their subject info
    const { data: chapters, error: chapErr } = await supabase
      .from('chapters')
      .select('id, title, grade, chapter_number, subject_id, subjects(name)')
      .eq('is_active', true);

    if (chapErr || !chapters) {
      logger.warn('issue_detector_content_gaps_chapters_query_failed', { error: chapErr?.message });
      return [];
    }

    // Get distinct (subject, grade, chapter_number) from question_bank
    const { data: questionsData, error: qErr } = await supabase
      .from('question_bank')
      .select('subject, grade, chapter_number')
      .eq('is_active', true);

    if (qErr || !questionsData) {
      logger.warn('issue_detector_content_gaps_questions_query_failed', { error: qErr?.message });
      return [];
    }

    // Build a set of covered (subject, grade, chapter_number) combos
    const coveredSet = new Set<string>();
    for (const q of questionsData) {
      if (q.subject && q.grade && q.chapter_number !== null) {
        coveredSet.add(`${q.subject}|${q.grade}|${q.chapter_number}`);
      }
    }

    // Find chapters with no questions
    const gaps: Array<{ subject: string; grade: string; chapter: string; chapter_number: number }> = [];
    for (const ch of chapters) {
      const subjectName = (ch.subjects as { name?: string } | null)?.name || 'Unknown';
      const key = `${subjectName}|${ch.grade}|${ch.chapter_number}`;
      if (!coveredSet.has(key)) {
        gaps.push({
          subject: subjectName,
          grade: ch.grade as string,
          chapter: ch.title as string,
          chapter_number: ch.chapter_number as number,
        });
      }
    }

    if (gaps.length === 0) return [];

    return [{
      source: 'auto_detect',
      category: 'learning',
      title: `${gaps.length} chapters have zero questions`,
      description: `${gaps.length} active chapters have no questions in the question bank. Students studying these chapters will not be able to take quizzes.`,
      severity: gaps.length > 20 ? 'high' : 'medium',
      evidence: { gap_count: gaps.length, sample_gaps: gaps.slice(0, 10) },
      affected_users_count: 0,
    }];
  } catch (err) {
    logger.error('issue_detector_content_gaps_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Performance Degradation ────────────────────────────

/**
 * Check for elevated error rates by looking at recent error patterns.
 * Uses product_events table for error signals.
 */
export async function detectPerformanceDegradation(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Check product_events for error-type events in last hour vs last 24h
    const [recentRes, baselineRes] = await Promise.all([
      supabase
        .from('product_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'error')
        .gte('created_at', since1h),
      supabase
        .from('product_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'error')
        .gte('created_at', since24h),
    ]);

    const recentErrors = recentRes.count ?? 0;
    const totalErrors24h = baselineRes.count ?? 0;

    // If last hour's errors are more than 25% of 24h total, something is spiking
    if (totalErrors24h > 10 && recentErrors > 0) {
      const hourlyAvg = totalErrors24h / 24;
      const spike = recentErrors / hourlyAvg;

      if (spike > 3) {
        return [{
          source: 'auto_detect',
          category: 'performance',
          title: 'Error rate spike detected',
          description: `Error events in the last hour (${recentErrors}) are ${Math.round(spike)}x the 24-hour hourly average (${Math.round(hourlyAvg)}). This may indicate a system performance issue or deployment regression.`,
          severity: spike > 10 ? 'critical' : 'high',
          evidence: { recent_errors: recentErrors, hourly_average: Math.round(hourlyAvg * 10) / 10, spike_factor: Math.round(spike * 10) / 10, total_errors_24h: totalErrors24h },
          affected_users_count: recentErrors,
        }];
      }
    }

    return [];
  } catch (err) {
    logger.error('issue_detector_performance_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: Stale Content ──────────────────────────────────────

/**
 * Find topics in chapter_topics not updated in 90+ days that have
 * questions linked to them.
 */
export async function detectStaleContent(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const staleThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // chapter_topics does not have updated_at, so use created_at as a proxy
    const { data: staleTopics, error } = await supabase
      .from('chapter_topics')
      .select('id, title, concept_tag, chapter_id')
      .eq('is_active', true)
      .lte('created_at', staleThreshold);

    if (error || !staleTopics || staleTopics.length === 0) {
      if (error) logger.warn('issue_detector_stale_content_query_failed', { error: error.message });
      return [];
    }

    // Check which of these topics actually have questions (via concept_tag matching topic field)
    const conceptTags = staleTopics.map(t => t.concept_tag as string).filter(Boolean);
    if (conceptTags.length === 0) return [];

    const { data: questionsWithTopic, error: qErr } = await supabase
      .from('question_bank')
      .select('topic')
      .eq('is_active', true)
      .in('topic', conceptTags.slice(0, 100)); // Limit to avoid huge IN clause

    if (qErr || !questionsWithTopic) return [];

    const topicsWithQuestions = new Set(questionsWithTopic.map(q => q.topic as string));
    const staleWithQuestions = staleTopics.filter(t => topicsWithQuestions.has(t.concept_tag as string));

    if (staleWithQuestions.length === 0) return [];

    return [{
      source: 'auto_detect',
      category: 'learning',
      title: `${staleWithQuestions.length} topics not updated in 90+ days`,
      description: `${staleWithQuestions.length} topics with active questions have not been updated in over 90 days. Content may be outdated or need a review cycle.`,
      severity: 'low',
      evidence: {
        stale_count: staleWithQuestions.length,
        sample_topics: staleWithQuestions.slice(0, 10).map(t => ({ id: t.id, title: t.title, concept_tag: t.concept_tag })),
      },
      affected_users_count: 0,
    }];
  } catch (err) {
    logger.error('issue_detector_stale_content_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Detector: XP Anomalies ───────────────────────────────────────

/**
 * Find students who hit the daily XP cap (200) every day for 7+
 * consecutive days. This may indicate automated play or gaming behavior.
 */
export async function detectXpAnomalies(): Promise<DetectedIssue[]> {
  try {
    const supabase = getSupabaseAdmin();
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Fetch daily_activity for the last 14 days with XP data
    const { data: activities, error } = await supabase
      .from('daily_activity')
      .select('student_id, activity_date, xp_earned')
      .gte('activity_date', since14d)
      .gte('xp_earned', 200) // Only rows where they hit/exceeded the cap
      .order('student_id')
      .order('activity_date', { ascending: true });

    if (error || !activities) {
      logger.warn('issue_detector_xp_anomalies_query_failed', { error: error?.message });
      return [];
    }

    // Group by student and find consecutive 200+ XP days
    const studentDays = new Map<string, string[]>();
    for (const row of activities) {
      const sid = row.student_id as string;
      if (!studentDays.has(sid)) studentDays.set(sid, []);
      studentDays.get(sid)!.push(row.activity_date as string);
    }

    const anomalousStudents: string[] = [];
    for (const [studentId, dates] of studentDays) {
      // Find longest consecutive streak
      let maxStreak = 1;
      let currentStreak = 1;
      const sorted = dates.sort();

      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1]);
        const curr = new Date(sorted[i]);
        const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
        if (diffDays === 1) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 1;
        }
      }

      if (maxStreak >= 7) {
        anomalousStudents.push(studentId);
      }
    }

    if (anomalousStudents.length === 0) return [];

    return [{
      source: 'auto_detect',
      category: 'quiz',
      title: `${anomalousStudents.length} students with suspicious XP patterns`,
      description: `${anomalousStudents.length} student(s) hit the daily XP cap (200 XP) for 7+ consecutive days. This may indicate automated play, gaming, or anti-cheat evasion.`,
      severity: anomalousStudents.length > 10 ? 'high' : 'medium',
      evidence: {
        anomalous_student_count: anomalousStudents.length,
        sample_student_ids: anomalousStudents.slice(0, 5),
      },
      affected_users_count: anomalousStudents.length,
    }];
  } catch (err) {
    logger.error('issue_detector_xp_anomalies_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return [];
  }
}

// ── Main Runner ──────────────────────────────────────────────────

/**
 * Run all detectors in parallel. Each detector catches its own errors.
 * Returns the combined results and any error messages.
 */
export async function runAllDetectors(): Promise<{ detected: DetectedIssue[]; errors: string[] }> {
  const detectors = [
    { name: 'quiz_quality', fn: detectQuizQualityIssues },
    { name: 'foxy_failures', fn: detectFoxyFailures },
    { name: 'auth_failures', fn: detectAuthFailures },
    { name: 'payment_failures', fn: detectPaymentFailures },
    { name: 'content_gaps', fn: detectContentGaps },
    { name: 'performance_degradation', fn: detectPerformanceDegradation },
    { name: 'stale_content', fn: detectStaleContent },
    { name: 'xp_anomalies', fn: detectXpAnomalies },
  ];

  const errors: string[] = [];
  const allIssues: DetectedIssue[] = [];

  const results = await Promise.allSettled(detectors.map(d => d.fn()));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      allIssues.push(...result.value);
    } else {
      const errMsg = `Detector ${detectors[i].name} failed: ${result.reason}`;
      errors.push(errMsg);
      logger.error('issue_detector_runner_failure', { detector: detectors[i].name, error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)) });
    }
  }

  logger.info('issue_detector_run_complete', {
    total_detected: allIssues.length,
    detector_errors: errors.length,
    detectors_run: detectors.length,
  });

  return { detected: allIssues, errors };
}

// ── Persist Function ─────────────────────────────────────────────

/**
 * Insert detected issues into improvement_issues table.
 * Deduplicates by title: if an open issue with the same title exists,
 * increment its recurrence_count instead of creating a duplicate.
 *
 * Returns the count of new issues created.
 */
export async function persistDetectedIssues(issues: DetectedIssue[]): Promise<number> {
  if (issues.length === 0) return 0;

  const supabase = getSupabaseAdmin();
  let newCount = 0;

  for (const issue of issues) {
    try {
      // Check for existing open issue with same title
      const { data: existing, error: lookupErr } = await supabase
        .from('improvement_issues')
        .select('id, recurrence_count')
        .eq('title', issue.title)
        .in('status', ['open', 'investigating', 'recommendation_pending', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (lookupErr) {
        logger.warn('issue_detector_persist_lookup_failed', { title: issue.title, error: lookupErr.message });
        continue;
      }

      if (existing) {
        // Increment recurrence_count on existing issue
        const { error: updateErr } = await supabase
          .from('improvement_issues')
          .update({
            recurrence_count: (existing.recurrence_count as number || 1) + 1,
            evidence: issue.evidence,
            affected_users_count: issue.affected_users_count,
          })
          .eq('id', existing.id);

        if (updateErr) {
          logger.warn('issue_detector_persist_update_failed', { id: existing.id, error: updateErr.message });
        }
      } else {
        // Insert new issue
        const { error: insertErr } = await supabase
          .from('improvement_issues')
          .insert({
            source: issue.source,
            category: issue.category,
            title: issue.title,
            description: issue.description,
            severity: issue.severity,
            evidence: issue.evidence,
            affected_users_count: issue.affected_users_count,
            recurrence_count: 1,
          });

        if (insertErr) {
          logger.warn('issue_detector_persist_insert_failed', { title: issue.title, error: insertErr.message });
        } else {
          newCount++;
        }
      }
    } catch (err) {
      logger.error('issue_detector_persist_error', { title: issue.title, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  logger.info('issue_detector_persist_complete', { total_input: issues.length, new_issues: newCount });

  return newCount;
}
