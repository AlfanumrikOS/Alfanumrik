/**
 * Learning Quality Monitors API
 *
 * Returns learning quality metrics: quiz accuracy, content coverage,
 * mastery progression, and Bloom's taxonomy distribution.
 *
 * Uses session-based admin auth (authorizeAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ── Types ────────────────────────────────────────────────────────

interface SubjectAccuracy {
  subject: string;
  avg_score: number;
  total_sessions: number;
}

interface ContentGap {
  subject: string;
  chapter: string;
  topic: string;
}

interface LearningQualityResponse {
  quiz_accuracy: {
    overall_avg: number;
    by_subject: SubjectAccuracy[];
  };
  content_coverage: {
    total_topics: number;
    topics_with_questions: number;
    coverage_percent: number;
    gaps: ContentGap[];
  };
  mastery_progression: {
    improving: number;
    stagnant: number;
    declining: number;
  };
  blooms_distribution: {
    by_level: Record<string, number>;
  };
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const supabase = getSupabaseAdmin();

  try {
    const [quizAccuracy, contentCoverage, masteryProgression, bloomsDistribution] = await Promise.all([
      getQuizAccuracy(supabase),
      getContentCoverage(supabase),
      getMasteryProgression(supabase),
      getBloomsDistribution(supabase),
    ]);

    const data: LearningQualityResponse = {
      quiz_accuracy: quizAccuracy,
      content_coverage: contentCoverage,
      mastery_progression: masteryProgression,
      blooms_distribution: bloomsDistribution,
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('learning_quality_api_error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ── Quiz Accuracy ────────────────────────────────────────────────

async function getQuizAccuracy(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<{
  overall_avg: number;
  by_subject: SubjectAccuracy[];
}> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sessions, error } = await supabase
    .from('quiz_sessions')
    .select('subject, score_percent')
    .eq('is_completed', true)
    .gte('created_at', since30d)
    .not('score_percent', 'is', null);

  if (error || !sessions || sessions.length === 0) {
    if (error) logger.warn('learning_quality_quiz_accuracy_query_failed', { error: error.message });
    return { overall_avg: 0, by_subject: [] };
  }

  // Overall average
  const totalScore = sessions.reduce((sum: number, s: Record<string, unknown>) => sum + (Number(s.score_percent) || 0), 0);
  const overallAvg = Math.round((totalScore / sessions.length) * 10) / 10;

  // By subject
  const subjectMap = new Map<string, { total: number; count: number }>();
  for (const s of sessions) {
    const subject = (s.subject as string) || 'Unknown';
    const entry = subjectMap.get(subject) || { total: 0, count: 0 };
    entry.total += Number(s.score_percent) || 0;
    entry.count++;
    subjectMap.set(subject, entry);
  }

  const bySubject: SubjectAccuracy[] = Array.from(subjectMap.entries())
    .map(([subject, stats]) => ({
      subject,
      avg_score: Math.round((stats.total / stats.count) * 10) / 10,
      total_sessions: stats.count,
    }))
    .sort((a, b) => b.total_sessions - a.total_sessions);

  return { overall_avg: overallAvg, by_subject: bySubject };
}

// ── Content Coverage ─────────────────────────────────────────────

async function getContentCoverage(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<{
  total_topics: number;
  topics_with_questions: number;
  coverage_percent: number;
  gaps: ContentGap[];
}> {
  // Get all active topics with their chapter and subject info
  const { data: topics, error: topicErr } = await supabase
    .from('chapter_topics')
    .select('id, title, concept_tag, chapter_id, chapters(title, subjects(name))')
    .eq('is_active', true);

  if (topicErr || !topics) {
    if (topicErr) logger.warn('learning_quality_content_coverage_topics_failed', { error: topicErr.message });
    return { total_topics: 0, topics_with_questions: 0, coverage_percent: 0, gaps: [] };
  }

  const totalTopics = topics.length;
  if (totalTopics === 0) {
    return { total_topics: 0, topics_with_questions: 0, coverage_percent: 100, gaps: [] };
  }

  // Get distinct topics from question_bank
  const { data: questionTopics, error: qErr } = await supabase
    .from('question_bank')
    .select('topic')
    .eq('is_active', true);

  if (qErr) {
    logger.warn('learning_quality_content_coverage_questions_failed', { error: qErr.message });
    return { total_topics: totalTopics, topics_with_questions: 0, coverage_percent: 0, gaps: [] };
  }

  const coveredTags = new Set<string>();
  for (const q of questionTopics || []) {
    if (q.topic) coveredTags.add(q.topic as string);
  }

  const gaps: ContentGap[] = [];
  let topicsWithQuestions = 0;

  for (const topic of topics) {
    const tag = topic.concept_tag as string;
    if (coveredTags.has(tag)) {
      topicsWithQuestions++;
    } else {
      const chapter = topic.chapters as { title?: string; subjects?: { name?: string } | null } | null;
      gaps.push({
        subject: chapter?.subjects?.name || 'Unknown',
        chapter: chapter?.title || 'Unknown',
        topic: topic.title as string,
      });
    }
  }

  // Limit gaps to 50
  const coveragePercent = Math.round((topicsWithQuestions / totalTopics) * 1000) / 10;

  return {
    total_topics: totalTopics,
    topics_with_questions: topicsWithQuestions,
    coverage_percent: coveragePercent,
    gaps: gaps.slice(0, 50),
  };
}

// ── Mastery Progression ──────────────────────────────────────────

async function getMasteryProgression(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<{
  improving: number;
  stagnant: number;
  declining: number;
}> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Get concept_mastery records updated in the last 7 days
  const { data: masteryRecords, error } = await supabase
    .from('concept_mastery')
    .select('student_id, mastery_level, mastery_probability, updated_at, created_at')
    .gte('updated_at', since7d);

  if (error || !masteryRecords) {
    if (error) logger.warn('learning_quality_mastery_query_failed', { error: error.message });
    return { improving: 0, stagnant: 0, declining: 0 };
  }

  // Group by student and assess overall trend
  const studentMastery = new Map<string, { current: number[]; hasOlderData: boolean }>();

  for (const record of masteryRecords) {
    const sid = record.student_id as string;
    const prob = Number(record.mastery_probability) || 0;
    const createdAt = new Date(record.created_at as string).getTime();
    const updatedAt = new Date(record.updated_at as string).getTime();

    if (!studentMastery.has(sid)) {
      studentMastery.set(sid, { current: [], hasOlderData: false });
    }
    const entry = studentMastery.get(sid)!;
    entry.current.push(prob);

    // If the record existed before the 7-day window (created before, updated recently),
    // it indicates progression
    if (updatedAt - createdAt > 7 * 24 * 60 * 60 * 1000) {
      entry.hasOlderData = true;
    }
  }

  // Also check which students had concept_mastery records from before 7 days ago
  // but that were NOT updated recently (stagnant)
  const { data: olderRecords, error: olderErr } = await supabase
    .from('concept_mastery')
    .select('student_id', { count: 'exact', head: true })
    .lt('updated_at', since7d);

  // Get unique stagnant students (have old records but none updated recently)
  const activeStudentIds = new Set(studentMastery.keys());

  const { data: stagnantStudents, error: stagnantErr } = await supabase
    .from('concept_mastery')
    .select('student_id')
    .lt('updated_at', since7d);

  let stagnantCount = 0;
  if (!stagnantErr && stagnantStudents) {
    const stagnantIds = new Set<string>();
    for (const r of stagnantStudents) {
      const sid = r.student_id as string;
      if (!activeStudentIds.has(sid)) {
        stagnantIds.add(sid);
      }
    }
    stagnantCount = stagnantIds.size;
  }

  // Classify active students: improving vs declining
  // A student is improving if their average mastery_probability is above 0.5,
  // declining if they have older data and low probability
  let improving = 0;
  let declining = 0;

  for (const [, data] of studentMastery) {
    const avg = data.current.reduce((a, b) => a + b, 0) / data.current.length;
    if (avg >= 0.5) {
      improving++;
    } else if (data.hasOlderData) {
      declining++;
    } else {
      // New learner, not enough data to classify as declining
      improving++; // They are at least active
    }
  }

  return { improving, stagnant: stagnantCount, declining };
}

// ── Bloom's Distribution ─────────────────────────────────────────

async function getBloomsDistribution(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<{
  by_level: Record<string, number>;
}> {
  const { data: questions, error } = await supabase
    .from('question_bank')
    .select('bloom_level')
    .eq('is_active', true);

  if (error || !questions) {
    if (error) logger.warn('learning_quality_blooms_query_failed', { error: error.message });
    return { by_level: {} };
  }

  const byLevel: Record<string, number> = {};
  for (const q of questions) {
    const level = (q.bloom_level as string) || 'unknown';
    byLevel[level] = (byLevel[level] || 0) + 1;
  }

  return { by_level: byLevel };
}
