'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { colors, S } from '../../../_components/admin-styles';
import StatusBadge from '../../../_components/StatusBadge';

interface QuizSession {
  id: string;
  subject: string;
  grade: string;
  topic_title: string;
  total_questions: number;
  correct_answers: number;
  wrong_answers: number;
  score_percent: number;
  time_taken_seconds: number;
  difficulty_level: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

interface QuizResponse {
  id: string;
  question_id: string;
  selected_option: number | string;
  is_correct: boolean;
  time_spent_seconds?: number;
  time_spent?: number;
  bloom_level?: string;
  difficulty?: string;
  source?: string;
  created_at: string;
}

export default function ViewAsQuizzesPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [responses, setResponses] = useState<QuizResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/students/${studentId}/quiz-history`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Failed to load quiz history' }));
        setError(body.error || 'Failed to load quiz history');
        return;
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  const fetchResponses = useCallback(
    async (quizId: string) => {
      setLoadingResponses(true);
      setResponses([]);
      try {
        const res = await fetch(
          `/api/super-admin/students/${studentId}/quiz-history?quizId=${quizId}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const data = await res.json();
          setResponses(data.responses || []);
        }
      } catch {
        // Non-fatal
      } finally {
        setLoadingResponses(false);
      }
    },
    [studentId]
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSessionClick = (session: QuizSession) => {
    if (selectedId === session.id) {
      setSelectedId(null);
      setResponses([]);
    } else {
      setSelectedId(session.id);
      fetchResponses(session.id);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '\u2014';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
        Loading quiz history...
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

  return (
    <div>
      <h1 style={{ ...S.h1, fontSize: 18, marginBottom: 16 }}>Quiz History</h1>

      {sessions.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: colors.text3,
            fontSize: 13,
          }}
        >
          No quiz sessions found.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {sessions.map((session) => (
            <div key={session.id}>
              {/* Session header */}
              <button
                onClick={() => handleSessionClick(session)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background:
                    selectedId === session.id
                      ? colors.accentLight
                      : colors.bg,
                  border: `1px solid ${
                    selectedId === session.id
                      ? colors.accent
                      : colors.border
                  }`,
                  borderRadius:
                    selectedId === session.id ? '8px 8px 0 0' : 8,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: colors.text1,
                    }}
                  >
                    {session.topic_title || session.subject || 'Quiz'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: colors.text3,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginTop: 4,
                    }}
                  >
                    <span>{session.subject}</span>
                    <span>Grade {session.grade}</span>
                    <span>{session.difficulty_level || 'mixed'}</span>
                    <span>{formatDuration(session.time_taken_seconds)}</span>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color:
                        session.score_percent >= 80
                          ? colors.success
                          : session.score_percent >= 50
                          ? colors.warning
                          : colors.danger,
                    }}
                  >
                    {session.score_percent}%
                  </span>
                  <span style={{ fontSize: 12, color: colors.text3 }}>
                    {session.correct_answers}/{session.total_questions}
                  </span>
                  <StatusBadge
                    label={session.is_completed ? 'Completed' : 'Incomplete'}
                    variant={session.is_completed ? 'success' : 'warning'}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: colors.text3,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {new Date(session.created_at).toLocaleDateString()}
                  </span>
                </div>
              </button>

              {/* Expanded responses */}
              {selectedId === session.id && (
                <div
                  style={{
                    border: `1px solid ${colors.accent}`,
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: 16,
                    background: colors.surface,
                    maxHeight: 500,
                    overflowY: 'auto',
                  }}
                >
                  {loadingResponses && (
                    <div
                      style={{
                        textAlign: 'center',
                        color: colors.text3,
                        fontSize: 13,
                        padding: 12,
                      }}
                    >
                      Loading responses...
                    </div>
                  )}
                  {!loadingResponses && responses.length === 0 && (
                    <div
                      style={{
                        textAlign: 'center',
                        color: colors.text3,
                        fontSize: 13,
                        padding: 12,
                      }}
                    >
                      No individual responses found for this quiz.
                    </div>
                  )}
                  {responses.length > 0 && (
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
                            <th style={S.th}>#</th>
                            <th style={S.th}>Question ID</th>
                            <th style={S.th}>Selected</th>
                            <th style={S.th}>Correct</th>
                            <th style={S.th}>Time</th>
                            {responses.some((r) => r.bloom_level) && (
                              <th style={S.th}>Bloom&apos;s</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {responses.map((r, idx) => {
                            const timeSpent =
                              r.time_spent_seconds ?? r.time_spent;
                            return (
                              <tr key={r.id || idx}>
                                <td style={S.td}>{idx + 1}</td>
                                <td style={{ ...S.td, fontSize: 11 }}>
                                  <code>
                                    {typeof r.question_id === 'string'
                                      ? r.question_id.slice(0, 12)
                                      : r.question_id}
                                    ...
                                  </code>
                                </td>
                                <td style={S.td}>{r.selected_option}</td>
                                <td style={S.td}>
                                  <StatusBadge
                                    label={r.is_correct ? 'Correct' : 'Wrong'}
                                    variant={
                                      r.is_correct ? 'success' : 'danger'
                                    }
                                  />
                                </td>
                                <td style={S.td}>
                                  {timeSpent != null
                                    ? `${timeSpent}s`
                                    : '\u2014'}
                                </td>
                                {responses.some((r2) => r2.bloom_level) && (
                                  <td style={S.td}>
                                    {r.bloom_level || '\u2014'}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}