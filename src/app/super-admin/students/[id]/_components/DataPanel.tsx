'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../../_components/AdminShell';
import StatusBadge from '../../../_components/StatusBadge';
import { colors, S } from '../../../_components/admin-styles';
import SubjectMasteryGrid from './SubjectMasteryGrid';
import NotesThread from './NotesThread';

/* ---------- response shape from /api/super-admin/students/[id]/profile ---------- */
interface StudentRecord {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  grade: string;
  board: string;
  language_preference: string;
  xp_total: number;
  streak_days: number;
  is_active: boolean;
  account_status: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
  [key: string]: unknown;
}

interface KnowledgeGap {
  id: string;
  topic_id: string;
  gap_type: string;
  severity: string;
  description: string;
  detected_at: string;
  is_resolved: boolean;
}

interface QuizSession {
  id: string;
  subject: string;
  topic_title: string;
  score_percent: number;
  total_questions: number;
  correct_answers: number;
  difficulty_level: string;
  time_taken_seconds: number;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

interface ChatSession {
  id: string;
  subject: string;
  title: string;
  message_count: number;
  created_at: string;
}

interface ParentLink {
  guardian_id: string;
  status: string;
  guardians: { id: string; name: string; email: string; phone: string } | null;
}

interface ClassLink {
  class_id: string;
  classes: { id: string; name: string; grade: string; section: string } | null;
}

interface Subscription {
  plan_id: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

interface OpsEvent {
  id: string;
  occurred_at: string;
  category: string;
  source: string;
  severity: string;
  message: string;
}

interface ProfileData {
  student: StudentRecord;
  subjectMastery: Record<string, { topics: number; avgMastery: number }>;
  knowledgeGaps: KnowledgeGap[];
  bloomDistribution: Record<string, number>;
  recentQuizzes: QuizSession[];
  recentChats: ChatSession[];
  dailyUsage: unknown[];
  parentLinks: ParentLink[];
  classLinks: ClassLink[];
  subscription: Subscription | null;
  opsEvents: OpsEvent[];
}

interface DataPanelProps {
  studentId: string;
}

/* ---------- severity color helper ---------- */
function severityVariant(severity: string): 'danger' | 'warning' | 'info' | 'neutral' {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

export default function DataPanel({ studentId }: DataPanelProps) {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await apiFetch(
        `/api/super-admin/students/${studentId}/profile`
      );
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to fetch student' }));
        setError(body.error || 'Failed to fetch student data');
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch student data');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, studentId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
        Loading student data...
      </div>
    );
  }

  /* ---------- 404 ---------- */
  if (notFound) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 14 }}>
        Student not found.
      </div>
    );
  }

  /* ---------- Error ---------- */
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

  if (!data) return null;

  const { student: s } = data;
  const level = Math.floor((s.xp_total || 0) / 500);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* 1. Profile card */}
      <div style={S.card}>
        <h2 style={S.h2}>Profile</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {[
            { label: 'Name', value: s.name },
            { label: 'Email', value: s.email },
            { label: 'Grade', value: s.grade },
            { label: 'Board', value: s.board },
            { label: 'Language', value: s.language_preference || 'en' },
            {
              label: 'Joined',
              value: new Date(s.created_at).toLocaleDateString(),
            },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: colors.text3 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: colors.text1 }}>
                {value || '\u2014'}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <StatusBadge
            label={s.is_active !== false ? 'Active' : 'Banned'}
            variant={s.is_active !== false ? 'success' : 'danger'}
          />
          <StatusBadge
            label={s.onboarding_completed ? 'Onboarded' : 'Onboarding pending'}
            variant={s.onboarding_completed ? 'success' : 'warning'}
          />
          {s.account_status && (
            <StatusBadge label={s.account_status} variant="neutral" />
          )}
        </div>
      </div>

      {/* 2. Subscription card */}
      <div style={S.card}>
        <h2 style={S.h2}>Subscription</h2>
        {data.subscription ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: colors.text3 }}>Plan</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1 }}>
                {data.subscription.plan_id || 'free'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.text3 }}>Status</div>
              <StatusBadge
                label={data.subscription.status || 'unknown'}
                variant={data.subscription.status === 'active' ? 'success' : 'warning'}
              />
            </div>
            {data.subscription.expires_at && (
              <div>
                <div style={{ fontSize: 11, color: colors.text3 }}>Expires</div>
                <div style={{ fontSize: 13, color: colors.text1 }}>
                  {new Date(data.subscription.expires_at).toLocaleDateString()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No subscription (free plan)
          </div>
        )}
      </div>

      {/* 3. Learning snapshot */}
      <div style={S.card}>
        <h2 style={S.h2}>Learning Snapshot</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
          }}
        >
          {[
            { label: 'XP', value: s.xp_total || 0 },
            { label: 'Level', value: level },
            { label: 'Streak', value: `${s.streak_days || 0}d` },
            { label: 'Quizzes', value: data.recentQuizzes.length },
            {
              label: 'Avg Score',
              value:
                data.recentQuizzes.length > 0
                  ? `${Math.round(
                      data.recentQuizzes.reduce(
                        (sum, q) => sum + (q.score_percent || 0),
                        0
                      ) / data.recentQuizzes.length
                    )}%`
                  : '\u2014',
            },
            {
              label: 'Last Active',
              value: s.last_active_at
                ? new Date(s.last_active_at).toLocaleDateString()
                : '\u2014',
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                padding: 10,
                background: colors.surface,
                borderRadius: 6,
                border: `1px solid ${colors.borderLight}`,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.text1 }}>
                {value}
              </div>
              <div style={{ fontSize: 11, color: colors.text3 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Subject mastery */}
      <div style={S.card}>
        <h2 style={S.h2}>Subject Mastery</h2>
        <SubjectMasteryGrid mastery={data.subjectMastery} />
      </div>

      {/* 5. Knowledge gaps */}
      <div style={S.card}>
        <h2 style={S.h2}>Knowledge Gaps</h2>
        {data.knowledgeGaps.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No active knowledge gaps detected.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {data.knowledgeGaps.map((gap) => (
              <li
                key={gap.id}
                style={{
                  fontSize: 13,
                  color: colors.text1,
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                <span style={{ fontWeight: 500 }}>{gap.description}</span>
                <span style={{ fontSize: 11, color: colors.text3, marginLeft: 8 }}>
                  ({gap.gap_type} / {gap.severity})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. Bloom's distribution */}
      <div style={S.card}>
        <h2 style={S.h2}>Bloom&apos;s Distribution</h2>
        {Object.keys(data.bloomDistribution).length === 0 ? (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No Bloom&apos;s level data available yet.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(data.bloomDistribution)
              .sort(([, a], [, b]) => b - a)
              .map(([level, count]) => (
                <div
                  key={level}
                  style={{
                    padding: '8px 14px',
                    background: colors.surface,
                    borderRadius: 6,
                    border: `1px solid ${colors.borderLight}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: colors.text1,
                    }}
                  >
                    {count}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.text3,
                      textTransform: 'capitalize',
                    }}
                  >
                    {level}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 7. Recent quizzes */}
      <div style={S.card}>
        <h2 style={S.h2}>Recent Quizzes</h2>
        {data.recentQuizzes.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No quizzes taken yet.
          </div>
        ) : (
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
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Subject</th>
                  <th style={S.th}>Topic</th>
                  <th style={S.th}>Score</th>
                  <th style={S.th}>Questions</th>
                </tr>
              </thead>
              <tbody>
                {data.recentQuizzes.map((q) => (
                  <tr key={q.id}>
                    <td style={{ ...S.td, fontSize: 12 }}>
                      {new Date(q.created_at).toLocaleDateString()}
                    </td>
                    <td style={S.td}>{q.subject || '\u2014'}</td>
                    <td style={S.td}>{q.topic_title || '\u2014'}</td>
                    <td
                      style={{
                        ...S.td,
                        fontWeight: 600,
                        color:
                          q.score_percent >= 80
                            ? colors.success
                            : q.score_percent >= 50
                            ? colors.warning
                            : colors.danger,
                      }}
                    >
                      {q.score_percent}%
                    </td>
                    <td style={S.td}>
                      {q.correct_answers}/{q.total_questions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 8. Recent Foxy chats */}
      <div style={S.card}>
        <h2 style={S.h2}>Recent Foxy Chats</h2>
        {data.recentChats.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No Foxy chat sessions yet.
          </div>
        ) : (
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
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Subject</th>
                  <th style={S.th}>Title</th>
                  <th style={S.th}>Messages</th>
                </tr>
              </thead>
              <tbody>
                {data.recentChats.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...S.td, fontSize: 12 }}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td style={S.td}>{c.subject || '\u2014'}</td>
                    <td style={S.td}>{c.title || '\u2014'}</td>
                    <td style={S.td}>{c.message_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 9. Ops events */}
      <div style={S.card}>
        <h2 style={S.h2}>Ops Events</h2>
        {data.opsEvents.length === 0 ? (
          <div style={{ fontSize: 13, color: colors.text3 }}>
            No ops events for this student.
          </div>
        ) : (
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
                  <th style={S.th}>Time</th>
                  <th style={S.th}>Category</th>
                  <th style={S.th}>Severity</th>
                  <th style={S.th}>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.opsEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(ev.occurred_at).toLocaleString()}
                    </td>
                    <td style={S.td}>{ev.category}</td>
                    <td style={S.td}>
                      <StatusBadge
                        label={ev.severity}
                        variant={severityVariant(ev.severity)}
                      />
                    </td>
                    <td
                      style={{
                        ...S.td,
                        maxWidth: 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ev.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 10. Relationships */}
      <div style={S.card}>
        <h2 style={S.h2}>Relationships</h2>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text2,
              marginBottom: 6,
            }}
          >
            Parent / Guardian Links
          </div>
          {data.parentLinks.length === 0 ? (
            <div style={{ fontSize: 13, color: colors.text3 }}>
              No parent links.
            </div>
          ) : (
            data.parentLinks.map((pl) => (
              <div
                key={pl.guardian_id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: `1px solid ${colors.borderLight}`,
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500, color: colors.text1 }}>
                  {pl.guardians?.name || '\u2014'}
                </span>
                <span style={{ color: colors.text3, fontSize: 12 }}>
                  {pl.guardians?.email || ''}
                </span>
                <StatusBadge
                  label={pl.status}
                  variant={pl.status === 'approved' ? 'success' : 'warning'}
                />
              </div>
            ))
          )}
        </div>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text2,
              marginBottom: 6,
            }}
          >
            Class / Teacher Links
          </div>
          {data.classLinks.length === 0 ? (
            <div style={{ fontSize: 13, color: colors.text3 }}>
              Not enrolled in any class.
            </div>
          ) : (
            data.classLinks.map((cl) => (
              <div
                key={cl.class_id}
                style={{
                  padding: '6px 0',
                  borderBottom: `1px solid ${colors.borderLight}`,
                  fontSize: 13,
                  color: colors.text1,
                }}
              >
                {cl.classes?.name || '\u2014'} (Grade {cl.classes?.grade || '?'}
                {cl.classes?.section ? `, Section ${cl.classes.section}` : ''})
              </div>
            ))
          )}
        </div>
      </div>

      {/* 11. Support notes */}
      <div style={S.card}>
        <h2 style={S.h2}>Support Notes</h2>
        <NotesThread studentId={studentId} />
      </div>
    </div>
  );
}