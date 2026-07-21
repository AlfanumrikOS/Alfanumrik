'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { Bone, CardListSkeleton, TeacherTableSkeleton } from '@alfanumrik/ui/Skeleton';
import { StatCard, BarChart, LineChart, DataTable } from '@alfanumrik/ui/admin-ui';
import type { Column } from '@alfanumrik/ui/admin-ui';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  // Build headers — always include apikey; add Bearer token when a session
  // exists so teacher-dashboard can authenticate the caller via JWT (P13).
  // Pattern mirrors src/app/teacher/page.tsx api() helper.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — request will be rejected by Edge Function */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

/* ─── Styles (Atlas warm theme) ─── */
const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--bg)',
  color: 'var(--text-1)',
  // fontFamily removed — global font-sans on <html> (globals.css) handles this
  padding: '24px 20px 80px',
  maxWidth: 900,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid var(--border)',
  marginBottom: 16,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  backgroundColor: 'var(--surface-1)',
  borderRadius: 12,
  padding: 4,
  marginBottom: 20,
  border: '1px solid var(--border)',
};


/* ─── Interfaces ─── */
interface OverviewStats {
  total_students?: number;
  avg_mastery?: number;
  avg_accuracy?: number;
  active_this_week?: number;
}

interface PerformerEntry {
  name?: string;
  student_name?: string;
  xp?: number;
  total_xp?: number;
  mastery?: number;
  reason?: string;
}

interface OverviewData {
  stats?: OverviewStats;
  mastery_distribution?: Record<string, number>;
  top_performers?: PerformerEntry[];
  needs_attention?: PerformerEntry[];
}

interface StudentListEntry {
  id?: string;
  student_id?: string;
  name?: string;
  student_name?: string;
}

interface SubjectMastery {
  subject?: string;
  name?: string;
  mastery?: number;
  percent?: number;
  level?: string;
}

interface StrengthWeaknessItem {
  topic?: string;
  name?: string;
}

interface RecommendationItem {
  text?: string;
  message?: string;
}

interface StudentProfile {
  xp?: number;
  total_xp?: number;
  streak?: number;
  current_streak?: number;
  accuracy?: number;
  avg_accuracy?: number;
  subjects?: SubjectMastery[];
  subject_mastery?: SubjectMastery[];
  strengths?: (string | StrengthWeaknessItem)[];
  weaknesses?: (string | StrengthWeaknessItem)[];
  recommendations?: string | (string | RecommendationItem)[];
  recommendation?: string;
}

interface WeeklyProgressEntry {
  label?: string;
  week?: string;
  progress?: number;
  percent?: number;
  completion?: number;
}

interface ImprovedStudent {
  name?: string;
  student_name?: string;
  improvement?: number;
  delta?: number;
}

interface TrendsData {
  weekly_progress?: WeeklyProgressEntry[];
  activity_heatmap?: number[][];
  most_improved?: ImprovedStudent[];
}

/* ─── Helpers ─── */
// Activity heatmap ramp — re-tuned for the warm (light) Atlas bg. The legacy
// blue ramp went light→dark which is invisible on cream; this accent ramp goes
// quiet→accent so denser cells read darker against the warm surface. Empty
// cells use the cream-3 surface token so they recede instead of glowing.
function heatCellColor(value: number): string {
  if (value >= 8) return '#C2410C';
  if (value >= 5) return '#E8581C';
  if (value >= 3) return '#F0883E';
  if (value >= 1) return '#F4B183';
  return '#EDE6DC';
}

/* ─── Tab 1: Class Overview ─── */
function ClassOverviewTab({ data, isHi }: { data: OverviewData | null; isHi: boolean }) {
  const stats = data?.stats || {};
  const distribution = data?.mastery_distribution || {};
  const topPerformers: PerformerEntry[] = data?.top_performers || [];
  const needsAttention: PerformerEntry[] = data?.needs_attention || [];

  const statItems = [
    { label: tt(isHi, 'Total Students', 'कुल छात्र'), value: stats.total_students ?? 0, color: '#E8581C' },
    { label: tt(isHi, 'Average Mastery', 'औसत मास्टरी'), value: `${stats.avg_mastery ?? 0}%`, color: '#7C3AED' },
    { label: tt(isHi, 'Average Accuracy', 'औसत सटीकता'), value: `${stats.avg_accuracy ?? 0}%`, color: '#059669' },
    { label: tt(isHi, 'Active This Week', 'इस सप्ताह सक्रिय'), value: stats.active_this_week ?? 0, color: '#D97706' },
  ];

  const masteryLevels = [
    { key: 'mastered', label: tt(isHi, 'Mastered', 'माहिर'), color: '#16A34A' },
    { key: 'proficient', label: tt(isHi, 'Proficient', 'कुशल'), color: '#7C3AED' },
    { key: 'familiar', label: tt(isHi, 'Familiar', 'परिचित'), color: '#E8581C' },
    { key: 'developing', label: tt(isHi, 'Developing', 'विकासशील'), color: '#D97706' },
    { key: 'not_started', label: tt(isHi, 'Not Started', 'शुरू नहीं हुआ'), color: '#7D7264' },
  ];

  return (
    <div>
      {/* Stats Cards — shared admin-ui StatCard primitive (P10: no new deps, already bundled). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {statItems.map((s, i) => (
          <StatCard key={i} label={s.label} value={s.value} accentColor={s.color} />
        ))}
      </div>

      {/* Mastery Distribution — score-band distribution rendered as a bar chart
          (shared admin-ui BarChart) instead of ad-hoc progress bars. Values are
          rendered verbatim from get_class_overview's mastery_distribution
          (T8 real BKT mastery) — never recomputed client-side. */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 14px' }}>{tt(isHi, 'Mastery Distribution', 'मास्टरी वितरण')}</h3>
        <BarChart
          series={[
            {
              name: tt(isHi, 'Students (%)', 'छात्र (%)'),
              data: masteryLevels.map((lvl) => ({ x: lvl.label, y: distribution[lvl.key] ?? 0 })),
            },
          ]}
          yLabel="%"
          height={220}
          emptyLabel={tt(isHi, 'No mastery data yet', 'अभी तक कोई मास्टरी डेटा नहीं')}
        />
      </div>

      {/* Top Performers & Needs Attention */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div style={cardStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>{tt(isHi, 'Top 5 Performers', 'शीर्ष 5 प्रदर्शक')}</h3>
          {topPerformers.length === 0 ? (
            <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No data available yet.', 'अभी तक कोई डेटा उपलब्ध नहीं।')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topPerformers.slice(0, 5).map((s: PerformerEntry, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: 'var(--orange)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#1A1207' }}>{s.name || s.student_name}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--orange)' }}>{s.xp ?? s.total_xp ?? 0} XP</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>{tt(isHi, 'Needs Attention', 'ध्यान देने योग्य')}</h3>
          {needsAttention.length === 0 ? (
            <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'All students are on track!', 'सभी छात्र सही दिशा में हैं!')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {needsAttention.slice(0, 5).map((s: PerformerEntry, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 8, borderLeft: '3px solid #EF4444' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#1A1207' }}>{s.name || s.student_name}</span>
                  <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>{s.reason || `${s.mastery ?? 0}% mastery`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab 2: Student Analysis ─── */
function StudentAnalysisTab({ students, teacherId, isHi }: { students: StudentListEntry[]; teacherId: string; isHi: boolean }) {
  const [selectedId, setSelectedId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filtered = students.filter((s: StudentListEntry) =>
    (s.name || s.student_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const loadProfile = useCallback(async (studentId: string) => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('get_student_report', { teacher_id: teacherId, student_id: studentId });
      setProfile(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load student data');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    if (selectedId) loadProfile(selectedId);
  }, [selectedId, loadProfile]);

  // Normalized rows for the shared DataTable primitive — the student list has
  // no mastery/accuracy fields (get_students_list only returns id + name), so
  // the table is a browsable, sortable drill-in list; per-student numbers are
  // fetched (and rendered) only after a row is selected, same as before.
  const tableRows = filtered.map((s: StudentListEntry) => ({
    id: String(s.id || s.student_id || ''),
    name: s.name || s.student_name || tt(isHi, 'Student', 'छात्र'),
  }));
  const studentColumns: Column<{ id: string; name: string }>[] = [
    { key: 'name', label: tt(isHi, 'Student', 'छात्र') },
  ];

  return (
    <div>
      {/* Search & Select */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>{tt(isHi, 'Select Student', 'छात्र चुनें')}</h3>
        <input
          type="text"
          placeholder={tt(isHi, 'Search students...', 'छात्र खोजें...')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--surface-2)', border: '1px solid #EDE6DC', borderRadius: 8, color: '#1A1207', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <DataTable
          columns={studentColumns}
          data={tableRows}
          keyField="id"
          onRowClick={(row) => setSelectedId(row.id)}
          emptyMessage={tt(isHi, 'No students found', 'कोई छात्र नहीं मिला')}
          className="max-h-[240px] overflow-y-auto"
        />
      </div>

      {loading && (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tt(isHi, 'Loading student data…', 'छात्र डेटा लोड हो रहा है…')}</span>
          <CardListSkeleton count={4} />
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && profile && (
        <div>
          {/* Performance Cards — shared StatCard primitive. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: tt(isHi, 'Total XP', 'कुल XP'), value: profile.xp ?? profile.total_xp ?? 0, color: '#E8581C' },
              { label: tt(isHi, 'Streak', 'स्ट्रीक'), value: `${profile.streak ?? profile.current_streak ?? 0} ${tt(isHi, 'days', 'दिन')}`, color: '#D97706' },
              { label: tt(isHi, 'Accuracy', 'सटीकता'), value: `${profile.accuracy ?? profile.avg_accuracy ?? 0}%`, color: '#059669' },
            ].map((s, i) => (
              <StatCard key={i} label={s.label} value={s.value} accentColor={s.color} />
            ))}
          </div>

          {/* Subject-wise Mastery — rendered via the shared BarChart primitive.
              Values (mastery.percent) come verbatim from get_student_report
              (T8 real BKT mastery) — never recomputed client-side (P1/P2). */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 14px' }}>{tt(isHi, 'Subject-wise Mastery', 'विषयवार मास्टरी')}</h3>
            {(profile.subjects || profile.subject_mastery || []).length === 0 ? (
              <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No subject data available.', 'कोई विषय डेटा उपलब्ध नहीं।')}</p>
            ) : (
              <BarChart
                series={[
                  {
                    name: tt(isHi, 'Mastery %', 'मास्टरी %'),
                    data: (profile.subjects || profile.subject_mastery || []).map((subj: SubjectMastery) => ({
                      x: subj.subject || subj.name || '',
                      y: subj.mastery ?? subj.percent ?? 0,
                    })),
                  },
                ]}
                yLabel="%"
                height={220}
              />
            )}
          </div>

          {/* Strengths & Weaknesses */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#16A34A', margin: '0 0 10px' }}>{tt(isHi, 'Strengths', 'मज़बूत पक्ष')}</h3>
              {(profile.strengths || []).length === 0 ? (
                <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No strengths identified yet.', 'अभी तक कोई मज़बूत पक्ष पहचाना नहीं गया।')}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {(profile.strengths || []).map((s: string | StrengthWeaknessItem, i: number) => (
                    <li key={i} style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 4 }}>
                      {typeof s === 'string' ? s : s.topic || s.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#EF4444', margin: '0 0 10px' }}>{tt(isHi, 'Weaknesses', 'कमज़ोर पक्ष')}</h3>
              {(profile.weaknesses || []).length === 0 ? (
                <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No weaknesses identified.', 'कोई कमज़ोर पक्ष नहीं पहचाना गया।')}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {(profile.weaknesses || []).map((w: string | StrengthWeaknessItem, i: number) => (
                    <li key={i} style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 4 }}>
                      {typeof w === 'string' ? w : w.topic || w.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {(profile.recommendations || profile.recommendation) && (() => {
            const recs = profile.recommendations || profile.recommendation;
            return (
              <div style={{ ...cardStyle, borderLeft: '3px solid var(--orange)' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--orange)', margin: '0 0 8px' }}>{tt(isHi, 'Recommendations', 'सुझाव')}</h3>
                {typeof recs === 'string' ? (
                  <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                    {recs}
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                    {(recs as (string | RecommendationItem)[]).map((r: string | RecommendationItem, i: number) => (
                      <li key={i} style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 4 }}>
                        {typeof r === 'string' ? r : r.text || r.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {!loading && !error && !profile && selectedId === '' && (
        <div style={{ textAlign: 'center', padding: 40, color: '#A89B86', fontStyle: 'italic' }}>
          {tt(isHi, 'Select a student above to view their detailed analysis.', 'विस्तृत विश्लेषण देखने के लिए ऊपर छात्र चुनें।')}
        </div>
      )}
    </div>
  );
}

/* ─── Tab 3: Trends ─── */
function TrendsTab({ data, isHi }: { data: TrendsData | null; isHi: boolean }) {
  const weeklyProgress: WeeklyProgressEntry[] = data?.weekly_progress || [];
  const activityHeatmap: number[][] = data?.activity_heatmap || [];
  const mostImproved: ImprovedStudent[] = data?.most_improved || [];

  const dayLabels = isHi
    ? ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekLabels = isHi
    ? ['सप्ताह 1', 'सप्ताह 2', 'सप्ताह 3', 'सप्ताह 4']
    : ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

  const heatmapGrid: number[][] = activityHeatmap;

  return (
    <div>
      {/* Weekly Progress — rendered via the shared LineChart primitive. Values
          come verbatim from get_class_trends' weekly_progress rollup. */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 14px' }}>{tt(isHi, 'Weekly Progress', 'साप्ताहिक प्रगति')}</h3>
        {weeklyProgress.length === 0 ? (
          <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No weekly progress data yet.', 'अभी तक कोई साप्ताहिक प्रगति डेटा नहीं।')}</p>
        ) : (
          <LineChart
            series={[
              {
                name: tt(isHi, 'Progress %', 'प्रगति %'),
                data: weeklyProgress.slice(0, 4).map((w: WeeklyProgressEntry, i: number) => ({
                  x: w.label || w.week || (isHi ? `सप्ताह ${i + 1}` : `Week ${i + 1}`),
                  y: w.progress ?? w.percent ?? w.completion ?? 0,
                })),
              },
            ]}
            yLabel="%"
            height={220}
          />
        )}
      </div>

      {/* Activity Heatmap */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 14px' }}>{tt(isHi, 'Activity Heatmap', 'गतिविधि हीटमैप')}</h3>
        {heatmapGrid.length > 0 ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }} />
                    {dayLabels.map((d) => (
                      <th key={d} style={{ color: '#7D7264', fontSize: 11, fontWeight: 500, textAlign: 'center', padding: '0 2px' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapGrid.map((row, wi) => (
                    <tr key={wi}>
                      <td style={{ color: '#7D7264', fontSize: 11, fontWeight: 500, paddingRight: 8 }}>{weekLabels[wi] || (isHi ? `स. ${wi + 1}` : `Wk ${wi + 1}`)}</td>
                      {row.map((val: number, di: number) => (
                        <td key={di}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              backgroundColor: heatCellColor(val),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 700,
                              // Dark ink on the warm ramp reads at every density
                              // (white washed out on the lighter low-density cells).
                              color: val > 0 ? '#1A1207' : '#A89B86',
                            }}
                            title={`${dayLabels[di]}, ${weekLabels[wi]}: ${val} ${tt(isHi, 'activities', 'गतिविधियां')}`}
                          >
                            {val > 0 ? val : ''}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: '#7D7264', alignItems: 'center' }}>
              <span>{tt(isHi, 'Less', 'कम')}</span>
              {[0, 1, 3, 5, 8].map((v) => (
                <div key={v} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: heatCellColor(v) }} />
              ))}
              <span>{tt(isHi, 'More', 'अधिक')}</span>
            </div>
          </>
        ) : (
          <div style={{ borderRadius: 8, border: '1px dashed #EDE6DC', backgroundColor: 'var(--surface-2)', padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', margin: 0 }}>
              {tt(isHi, 'No activity data yet', 'अभी तक कोई गतिविधि डेटा नहीं')}
            </p>
            <p style={{ fontSize: 12, color: '#7D7264', marginTop: 4, marginBottom: 0 }}>
              {tt(isHi,
                'The heatmap will appear here after students complete quizzes.',
                'छात्रों के क्विज़ पूरा करने के बाद हीटमैप यहाँ दिखाई देगा।')}
            </p>
          </div>
        )}
      </div>

      {/* Most Improved */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A1207', margin: '0 0 12px' }}>{tt(isHi, 'Most Improved Students', 'सबसे अधिक सुधार वाले छात्र')}</h3>
        {mostImproved.length === 0 ? (
          <p style={{ color: '#A89B86', fontStyle: 'italic', fontSize: 13 }}>{tt(isHi, 'No improvement data available yet.', 'अभी तक कोई सुधार डेटा उपलब्ध नहीं।')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mostImproved.map((s: ImprovedStudent, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'var(--surface-2)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: '#059669', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#1A1207' }}>{s.name || s.student_name}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>+{s.improvement ?? s.delta ?? 0}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function TeacherReportsPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<'overview' | 'student' | 'trends'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [studentsList, setStudentsList] = useState<StudentListEntry[]>([]);
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Load data
  const loadData = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const [overview, students, trends] = await Promise.all([
        api('get_class_overview', { teacher_id: teacherId }),
        api('get_students_list', { teacher_id: teacherId }),
        api('get_class_trends', { teacher_id: teacherId }),
      ]);
      setOverviewData(overview);
      setStudentsList(students?.students || students || []);
      setTrendsData(trends);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Loading state — shared warm-cream report skeleton.
  if (authLoading || (loading && !error)) {
    return (
      <div
        style={pageStyle}
        role="status"
        aria-busy="true"
        aria-label={tt(isHi, 'Loading reports…', 'रिपोर्ट लोड हो रही हैं…')}
      >
        <span className="sr-only">{tt(isHi, 'Loading reports…', 'रिपोर्ट लोड हो रही हैं…')}</span>
        <div style={{ paddingTop: 16, marginBottom: 20 }}>
          <Bone width={200} height={28} />
        </div>
        <TeacherTableSkeleton rows={8} />
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: tt(isHi, 'Class Overview', 'कक्षा अवलोकन') },
    { id: 'student' as const, label: tt(isHi, 'Student Analysis', 'छात्र विश्लेषण') },
    { id: 'trends' as const, label: tt(isHi, 'Trends', 'रुझान') },
  ];

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)' }}>
        <div>
          <button
            onClick={() => router.push('/teacher')}
            style={{ background: 'rgba(232,88,28,0.12)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1207', margin: 0 }}>{tt(isHi, 'Performance Reports', 'प्रदर्शन रिपोर्ट')}</h1>
          <p style={{ fontSize: 14, color: '#7D7264', margin: '4px 0 0' }}>
            {tt(isHi, 'Student performance analytics and insights', 'छात्र प्रदर्शन विश्लेषण और जानकारी')}
          </p>
        </div>
        <button
          onClick={loadData}
          style={{ padding: '8px 16px', background: 'transparent', color: 'var(--orange)', border: '1px solid var(--orange)', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          {tt(isHi, 'Refresh', 'रिफ्रेश')}
        </button>
      </header>

      {/* Error Banner */}
      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)', textAlign: 'center', fontSize: 14, marginBottom: 16 }}>
          {error}
          <button
            onClick={loadData}
            style={{ display: 'block', margin: '10px auto 0', padding: '6px 16px', backgroundColor: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            {tt(isHi, 'Retry', 'पुनः प्रयास')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={tabBarStyle}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '10px 8px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              backgroundColor: tab === t.id ? 'var(--orange)' : 'transparent',
              color: tab === t.id ? '#fff' : '#7D7264',
              transition: 'all 0.2s ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && <SectionErrorBoundary section="Class Overview Tab"><ClassOverviewTab data={overviewData} isHi={isHi} /></SectionErrorBoundary>}
      {tab === 'student' && <SectionErrorBoundary section="Student Analysis Tab"><StudentAnalysisTab students={studentsList} teacherId={teacherId} isHi={isHi} /></SectionErrorBoundary>}
      {tab === 'trends' && <SectionErrorBoundary section="Trends Tab"><TrendsTab data={trendsData} isHi={isHi} /></SectionErrorBoundary>}
      
    </div>
  );
}
