'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { colors, S } from '../../../_components/admin-styles';

interface MasteryRecord {
  topic_id: string;
  mastery_probability: number;
  mastery_level: string;
  attempts: number;
  correct_attempts: number;
  confidence_score: number | null;
  bloom_mastery: unknown;
  updated_at: string;
  curriculum_topics: {
    title: string;
    subject_id: string;
    subjects: { code: string } | null;
  } | null;
}

interface TopicRecord {
  id: string;
  title: string;
  title_hi: string | null;
  grade: string;
  difficulty_level: string;
  chapter_number: number;
  subject_id: string;
  subjects: { code: string } | null;
}

interface QuizRecord {
  id: string;
  subject: string;
  score_percent: number;
  total_questions: number;
  correct_answers: number;
  difficulty_level: string;
  completed_at: string | null;
  created_at: string;
}

export default function ViewAsProgressPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const [mastery, setMastery] = useState<MasteryRecord[]>([]);
  const [topics, setTopics] = useState<TopicRecord[]>([]);
  const [recentQuizzes, setRecentQuizzes] = useState<QuizRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/students/${studentId}/progress`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Failed to load progress' }));
        setError(body.error || 'Failed to load progress');
        return;
      }
      const data = await res.json();
      setMastery(data.mastery || []);
      setTopics(data.topics || []);
      setRecentQuizzes(data.recentQuizzes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
        Loading progress data...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: colors.danger,
          background: colors.dangerLight,
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  // Group mastery by subject
  const bySubject: Record<
    string,
    { subjectCode: string; items: MasteryRecord[] }
  > = {};
  for (const m of mastery) {
    const code = m.curriculum_topics?.subjects?.code || 'unknown';
    if (!bySubject[code]) bySubject[code] = { subjectCode: code, items: [] };
    bySubject[code].items.push(m);
  }

  const subjectEntries = Object.entries(bySubject).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div>
      <h1 style={{ ...S.h1, fontSize: 18, marginBottom: 16 }}>
        Progress &amp; Mastery
      </h1>

      {/* Summary stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div style={{ ...S.card, textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>
            {mastery.length}
          </div>
          <div style={{ fontSize: 11, color: colors.text3 }}>Topics Practiced</div>
        </div>
        <div style={{ ...S.card, textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>
            {topics.length}
          </div>
          <div style={{ fontSize: 11, color: colors.text3 }}>Curriculum Topics</div>
        </div>
        <div style={{ ...S.card, textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>
            {subjectEntries.length}
          </div>
          <div style={{ fontSize: 11, color: colors.text3 }}>Subjects</div>
        </div>
        <div style={{ ...S.card, textAlign: 'center', padding: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>
            {recentQuizzes.length}
          </div>
          <div style={{ fontSize: 11, color: colors.text3 }}>Recent Quizzes</div>
        </div>
      </div>

      {/* Per-subject mastery tables */}
      {subjectEntries.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: colors.text3,
            fontSize: 13,
          }}
        >
          No mastery data available yet.
        </div>
      ) : (
        subjectEntries.map(([code, group]) => {
          // Sort by mastery descending
          const sorted = [...group.items].sort(
            (a, b) => b.mastery_probability - a.mastery_probability
          );

          return (
            <div key={code} style={{ ...S.card, marginBottom: 16 }}>
              <h2
                style={{
                  ...S.h2,
                  textTransform: 'capitalize',
                  marginBottom: 8,
                }}
              >
                {code} ({sorted.length} topics)
              </h2>
              <div
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'auto',
                }}
              >
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Topic</th>
                      <th style={S.th}>Mastery</th>
                      <th style={S.th}>Level</th>
                      <th style={S.th}>Attempts</th>
                      <th style={S.th}>Accuracy</th>
                      <th style={S.th}>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((m) => {
                      const accuracy =
                        m.attempts > 0
                          ? Math.round((m.correct_attempts / m.attempts) * 100)
                          : 0;
                      return (
                        <tr key={m.topic_id}>
                          <td style={S.td}>
                            {m.curriculum_topics?.title || m.topic_id}
                          </td>
                          <td style={S.td}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  width: 60,
                                  height: 6,
                                  background: colors.surface,
                                  borderRadius: 3,
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    width: `${Math.round(
                                      m.mastery_probability * 100
                                    )}%`,
                                    height: '100%',
                                    background: '#7C3AED',
                                    borderRadius: 3,
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>
                                {Math.round(m.mastery_probability * 100)}%
                              </span>
                            </div>
                          </td>
                          <td style={S.td}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: colors.surface,
                                color: colors.text2,
                              }}
                            >
                              {m.mastery_level || '\u2014'}
                            </span>
                          </td>
                          <td style={S.td}>{m.attempts}</td>
                          <td
                            style={{
                              ...S.td,
                              fontWeight: 600,
                              color:
                                accuracy >= 80
                                  ? colors.success
                                  : accuracy >= 50
                                  ? colors.warning
                                  : colors.danger,
                            }}
                          >
                            {accuracy}%
                          </td>
                          <td style={{ ...S.td, fontSize: 12, color: colors.text3 }}>
                            {new Date(m.updated_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}