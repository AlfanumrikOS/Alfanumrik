'use client';

/**
 * AtlasTeacher — Editorial Atlas redesign of the teacher classroom.
 *
 * Headlines (per MULTI_ROLE_REDESIGN.md §5.3):
 *   - The classroom heatmap IS the page (not a tab).
 *   - Left rail: "needs me" students. Right rail: today's actions + live poll.
 *   - Killed: the dark-cockpit `#0B1120` palette. The warm cream is the brand.
 *
 * Data: same teacher-dashboard Edge Function as the legacy surface
 * (`get_dashboard`, `get_heatmap`, `get_alerts`, `launch_poll`,
 * `close_poll`, `resolve_alert`). The redesign is purely a chrome/IA
 * change — no new server endpoints needed.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  supabase,
  supabaseUrl as SUPABASE_URL,
  supabaseAnonKey as SUPABASE_ANON,
} from '@/lib/supabase';
import { BottomNav } from '@/components/ui';
import {
  AtlasShell,
  AtlasCard,
  AtlasPill,
  AtlasButton,
  AtlasIcon,
} from '@/components/atlas';
import type { HeatmapData, HeatmapCell, HeatmapRow, RiskAlert } from '@/lib/types';

interface DashboardClass {
  id: string;
  name: string;
  student_count: number;
  avg_mastery?: number;
}
interface DashboardStats {
  total_students: number;
  active_alerts: number;
  critical_alerts: number;
  active_assignments: number;
}
interface DashboardData {
  teacher?: { name: string };
  classes?: DashboardClass[];
  stats?: DashboardStats;
}
interface PollData { poll_id: string; question_text?: string; response_count?: number; }
interface PollResults { accuracy_pct: number; }

async function api(action: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* fall through */ }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) throw new Error(`teacher-dashboard ${action} → ${res.status}`);
  return res.json();
}

export default function AtlasTeacher() {
  const router = useRouter();
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [poll, setPoll] = useState<PollData | null>(null);
  const [pollDraft, setPollDraft] = useState({ q: '', opts: ['', '', '', ''], correctIdx: 0 });
  const [pollResults, setPollResults] = useState<PollResults | null>(null);
  const [loading, setLoading] = useState(true);

  const teacherId = teacher?.id ?? '';
  const cls = dash?.classes?.[0];
  const t = (en: string, hi: string) => (isHi ? hi : en);

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const load = useCallback(async () => {
    if (!teacherId) { setLoading(false); return; }
    setLoading(true);
    try {
      const d = await api('get_dashboard', { teacher_id: teacherId });
      setDash(d);
      const firstClassId = d?.classes?.[0]?.id;
      if (firstClassId) {
        const [h, a] = await Promise.all([
          api('get_heatmap', { teacher_id: teacherId, class_id: firstClassId, subject: 'math' }),
          api('get_alerts',  { teacher_id: teacherId, class_id: firstClassId }),
        ]);
        setHeatmap(h);
        setAlerts(a.alerts || []);
      }
    } catch (err) {
      console.error('AtlasTeacher load:', err);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { load(); }, [load]);

  const resolveAlert = async (id: string) => {
    await api('resolve_alert', { teacher_id: teacherId, alert_id: id });
    setAlerts(prev => prev.filter(x => x.id !== id));
  };

  const launchPoll = async () => {
    if (!pollDraft.q.trim() || !cls?.id) return;
    const data = await api('launch_poll', {
      teacher_id: teacherId,
      class_id: cls.id,
      question_text: pollDraft.q,
      options: pollDraft.opts.filter(o => o.trim()),
      correct_index: pollDraft.correctIdx,
      question_type: 'mcq',
      time_limit: 60,
    });
    setPoll(data);
    setPollResults(null);
  };

  const closePoll = async () => {
    if (!poll?.poll_id) return;
    const data = await api('close_poll', { teacher_id: teacherId, poll_id: poll.poll_id });
    setPollResults(data);
    setPoll(null);
  };

  // ─── Loading + empty states ────────────────────────────────────────────
  if (loading) {
    return (
      <AtlasShell variant="classroom" greeting={t('Loading classroom…', 'कक्षा लोड हो रही है…')}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div
            className="w-10 h-10 border-[3px] rounded-full animate-spin"
            style={{ borderColor: 'var(--cream-3)', borderTopColor: 'var(--accent)' }}
          />
        </div>
        <BottomNav />
      </AtlasShell>
    );
  }
  if (!teacher) {
    return (
      <AtlasShell variant="classroom">
        <AtlasCard style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22, marginBottom: 8 }}>
            {t('Setting up your teacher account', 'आपका शिक्षक खाता सेट हो रहा है')}
          </h2>
          <p style={{ color: 'var(--ink-3)', marginBottom: 16 }}>
            {t('Please refresh in a moment. If this persists, sign out and back in.', 'कृपया रिफ्रेश करें। यदि बना रहे तो साइन आउट करके फिर लॉग इन करें।')}
          </p>
          <AtlasButton variant="primary" onClick={() => window.location.reload()}>
            {t('Refresh', 'रिफ्रेश')}
          </AtlasButton>
        </AtlasCard>
        <BottomNav />
      </AtlasShell>
    );
  }
  if (!cls) {
    return (
      <AtlasShell variant="classroom">
        <AtlasCard style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22, marginBottom: 8 }}>
            {t('Welcome to your classroom', 'आपकी कक्षा में स्वागत है')}
          </h2>
          <p style={{ color: 'var(--ink-3)', maxWidth: '40ch', margin: '0 auto 16px' }}>
            {t('Create your first class to start tracking student progress.', 'छात्रों की प्रगति ट्रैक करने के लिए अपनी पहली कक्षा बनाएँ।')}
          </p>
          <AtlasButton variant="primary" onClick={() => router.push('/teacher/classes')}>
            {t('Create a class', 'कक्षा बनाएँ')}
          </AtlasButton>
        </AtlasCard>
        <BottomNav />
      </AtlasShell>
    );
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');
  const mediumAlerts   = alerts.filter(a => a.severity === 'medium' || a.severity === 'low');

  return (
    <AtlasShell
      variant="classroom"
      greeting={dash?.teacher?.name ?? t('Teacher', 'शिक्षक')}
      actions={
        <AtlasButton variant="ghost" icon="refresh" iconPosition="left" onClick={load}>
          {t('Refresh', 'रिफ्रेश')}
        </AtlasButton>
      }
    >
      {/* ─── Class bar ─── */}
      <AtlasCard
        style={{
          display: 'flex', alignItems: 'center', gap: 18,
          padding: '16px 22px', marginBottom: 24,
        }}
        compact
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 18, borderRight: '1px solid var(--line)' }}>
          <AtlasIcon name="chevron-down" />
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 19, letterSpacing: '-0.01em' }}>
              {cls.name}
            </div>
            <div className="atlas-tabnum" style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-display)' }}>
              {cls.student_count} {t('students', 'छात्र')}
              {cls.avg_mastery != null && (
                <> · {t('avg mastery', 'औसत महारत')} {cls.avg_mastery}%</>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {['All', 'Forces', 'Motion', 'Light', 'Heat', 'Sound'].map((s, i) => (
            <button
              key={s}
              aria-pressed={i === 0}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--line)',
                background: i === 0 ? 'var(--ink)' : 'transparent',
                color: i === 0 ? 'var(--cream)' : 'var(--ink-3)',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <AtlasPill tone="teal">{t('Week 9 · May 11', 'सप्ताह 9 · मई 11')}</AtlasPill>
      </AtlasCard>

      {/* ─── Three-column stage ─── */}
      <div
        className="atlas-teacher-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '240px 1fr 280px',
          gap: 20,
        }}
      >
        {/* LEFT RAIL — at-risk students */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <AtlasCard compact>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 17 }}>
              {t('Needs you', 'सहायता चाहिए')}
            </h3>
            <p className="atlas-eyebrow" style={{ marginBottom: 14 }}>
              {criticalAlerts.length} {t('of', 'में से')} {dash?.stats?.total_students ?? cls.student_count} {t('students', 'छात्र')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {criticalAlerts.length === 0 ? (
                <div
                  style={{
                    padding: 14,
                    background: 'var(--green-soft)',
                    border: '1px solid rgba(31,122,76,0.18)',
                    borderRadius: 10,
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    color: '#1F7A4C',
                  }}
                >
                  <AtlasIcon name="check" size={14} strokeWidth={2} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  {t('All students on track', 'सभी छात्र सही दिशा में')}
                </div>
              ) : (
                criticalAlerts.slice(0, 4).map(a => (
                  <RiskRow key={a.id} alert={a} onResolve={() => resolveAlert(a.id)} isHi={isHi} />
                ))
              )}
            </div>
          </AtlasCard>

          {mediumAlerts.length > 0 && (
            <AtlasCard compact>
              <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 17 }}>
                {t('Watch this week', 'इस सप्ताह नज़र रखें')}
              </h3>
              <p className="atlas-eyebrow" style={{ marginBottom: 14 }}>
                {mediumAlerts.length} {t('students', 'छात्र')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {mediumAlerts.slice(0, 4).map(a => (
                  <RiskRow key={a.id} alert={a} onResolve={() => resolveAlert(a.id)} isHi={isHi} />
                ))}
              </div>
            </AtlasCard>
          )}
        </aside>

        {/* CENTER — the heatmap */}
        <article>
          <AtlasCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 19 }}>
                  {t('Class mastery map', 'कक्षा महारत नक्शा')}
                </h3>
                <p className="atlas-eyebrow" style={{ margin: '4px 0 0' }}>
                  {t('Bayesian estimate · updated just now', 'अनुमान · अभी अद्यतन')}
                </p>
              </div>
              <HeatmapLegend />
            </div>
            <Heatmap data={heatmap} isHi={isHi} />
          </AtlasCard>
        </article>

        {/* RIGHT RAIL — actions + live poll */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <AtlasCard compact>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 17 }}>
              {t("Today's actions", 'आज की क्रियाएँ')}
            </h3>
            <p className="atlas-eyebrow" style={{ marginBottom: 14 }}>{t('One tap each', 'एक टैप')}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ActionRow
                icon="send"
                primary
                title={t('Launch quick poll', 'त्वरित पोल लॉन्च')}
                sub={t('Test the room in 60 seconds', '60 सेकंड में जाँचें')}
                onClick={() => document.getElementById('atlas-poll-card')?.scrollIntoView({ behavior: 'smooth' })}
              />
              <ActionRow
                icon="document"
                title={t('Assign revision quiz', 'रिवीज़न क्विज़ दें')}
                sub={`${criticalAlerts.length || 6} ${t('students targeted', 'छात्र चुने गए')}`}
                onClick={() => router.push('/teacher/assignments')}
              />
              <ActionRow
                icon="message"
                title={t("Message at-risk parents", 'अभिभावकों को संदेश')}
                sub={t('Pre-drafted by Foxy', 'Foxy द्वारा तैयार')}
                onClick={() => router.push('/teacher/students')}
              />
              <ActionRow
                icon="edit"
                title={t('Add class note', 'क्लास नोट जोड़ें')}
                sub={t('Visible to co-teachers', 'सह-शिक्षकों को दिखेगा')}
                onClick={() => router.push('/teacher/classes')}
              />
            </div>
          </AtlasCard>

          {/* Live poll composer / status */}
          <AtlasCard id="atlas-poll-card" tone={poll ? 'teal' : 'paper'} compact>
            {!poll && !pollResults && (
              <>
                <h3 style={{ margin: '0 0 12px', fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 17 }}>
                  {t('Quick poll', 'त्वरित पोल')}
                </h3>
                <input
                  type="text"
                  placeholder={t('Type your question…', 'अपना प्रश्न लिखें…')}
                  value={pollDraft.q}
                  onChange={e => setPollDraft(d => ({ ...d, q: e.target.value }))}
                  style={inputStyle()}
                />
                {pollDraft.opts.map((o, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <input
                      type="radio"
                      name="correct"
                      checked={pollDraft.correctIdx === i}
                      onChange={() => setPollDraft(d => ({ ...d, correctIdx: i }))}
                    />
                    <input
                      type="text"
                      placeholder={`${t('Option', 'विकल्प')} ${String.fromCharCode(65 + i)}`}
                      value={o}
                      onChange={e => {
                        const next = [...pollDraft.opts];
                        next[i] = e.target.value;
                        setPollDraft(d => ({ ...d, opts: next }));
                      }}
                      style={{ ...inputStyle(), margin: 0, flex: 1 }}
                    />
                  </div>
                ))}
                <AtlasButton variant="primary" onClick={launchPoll} icon="send" iconPosition="left">
                  {t('Launch to class', 'कक्षा में भेजें')}
                </AtlasButton>
              </>
            )}
            {poll && !pollResults && (
              <>
                <div
                  className="atlas-pill atlas-pill-teal"
                  style={{ marginBottom: 8 }}
                >
                  <span
                    aria-hidden="true"
                    className="atlas-pulse"
                    style={{ width: 8, height: 8, borderRadius: '50%', background: '#1F7A4C' }}
                  />
                  {t('Live · just started', 'सक्रिय · अभी शुरू')}
                </div>
                <p
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontWeight: 500,
                    fontSize: 16,
                    lineHeight: 1.3,
                    margin: '8px 0 14px',
                    color: 'var(--teal-deep)',
                  }}
                >
                  {poll.question_text || pollDraft.q}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                  <strong
                    className="atlas-tabnum"
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontWeight: 500,
                      fontSize: 30,
                      color: 'var(--teal-deep)',
                    }}
                  >
                    {poll.response_count ?? 0}
                  </strong>
                  <small style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--ink-3)' }}>
                    {t(`of ${cls.student_count} responded`, `${cls.student_count} में से ने जवाब दिया`)}
                  </small>
                </div>
                <AtlasButton variant="ink" onClick={closePoll}>
                  {t('Close poll', 'पोल बंद करें')}
                </AtlasButton>
              </>
            )}
            {pollResults && (
              <>
                <p
                  style={{
                    fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 22,
                    color: 'var(--green)', margin: 0,
                  }}
                >
                  <span className="atlas-tabnum">{pollResults.accuracy_pct}%</span> {t('correct', 'सही')}
                </p>
                <AtlasButton
                  variant="ghost"
                  onClick={() => {
                    setPollResults(null);
                    setPollDraft({ q: '', opts: ['', '', '', ''], correctIdx: 0 });
                  }}
                  style={{ marginTop: 10 }}
                >
                  {t('New question', 'नया प्रश्न')}
                </AtlasButton>
              </>
            )}
          </AtlasCard>
        </aside>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 1140px){.atlas-teacher-grid{grid-template-columns:1fr !important;}}`,
        }}
      />

      <BottomNav />
    </AtlasShell>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--cream)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    color: 'var(--ink)',
    fontSize: 13,
    fontFamily: 'var(--font-display)',
    outline: 'none',
    marginBottom: 8,
    boxSizing: 'border-box',
  };
}

const SEV_BORDER: Record<string, string> = {
  critical: '#C32E2E',
  high:     '#C32E2E',
  medium:   '#C9831A',
  low:      'var(--accent)',
};
const SEV_LABEL_COLOR: Record<string, string> = {
  critical: '#C32E2E',
  high:     '#C32E2E',
  medium:   '#C9831A',
  low:      'var(--accent)',
};

function RiskRow({ alert, onResolve, isHi }: { alert: RiskAlert; onResolve: () => void; isHi: boolean }) {
  const initial = (alert.title?.charAt(0) || '?').toUpperCase();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: 10,
        background: 'var(--cream)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${SEV_BORDER[alert.severity] ?? 'var(--accent)'}`,
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), #C9831A)',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 13,
        }}
      >
        {initial}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--ink)', lineHeight: 1.25 }}>
          {alert.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.3, marginTop: 2 }}>
          {alert.description}
        </div>
      </div>
      <button
        onClick={onResolve}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: '1px solid var(--line-mid)',
          borderRadius: 8,
          padding: '4px 8px',
          cursor: 'pointer',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: SEV_LABEL_COLOR[alert.severity] ?? 'var(--ink-3)',
        }}
        aria-label={isHi ? 'हल करें' : 'Resolve'}
      >
        {isHi ? 'हल' : alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
      </button>
    </div>
  );
}

function ActionRow({
  icon, title, sub, primary, onClick,
}: { icon: 'send' | 'document' | 'message' | 'edit'; title: string; sub: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: primary ? 'var(--ink)' : 'var(--cream)',
        color: primary ? 'var(--cream)' : 'var(--ink)',
        border: `1px solid ${primary ? 'var(--ink)' : 'var(--line)'}`,
        borderRadius: 'var(--radius-atlas)',
        cursor: 'pointer',
        transition: 'all 180ms var(--ease-atlas)',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: primary ? 'var(--accent)' : 'var(--cream-2)',
          color: primary ? 'white' : 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <AtlasIcon name={icon} size={16} />
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>
        {title}
        <small style={{ display: 'block', fontWeight: 500, fontSize: 11, opacity: 0.7, marginTop: 2 }}>
          {sub}
        </small>
      </span>
    </button>
  );
}

const HEAT_BG: Record<number, string> = {
  1: '#4A2317', 2: '#8C3617', 3: '#C9831A', 4: '#1F7A4C', 5: '#0F2A2E',
};
function heatTier(p: number): number {
  if (p >= 0.80) return 5;
  if (p >= 0.60) return 4;
  if (p >= 0.40) return 3;
  if (p >= 0.20) return 2;
  return 1;
}

function HeatmapLegend() {
  return (
    <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--ink-3)' }}>
      {[1, 2, 3, 4, 5].map(t => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: HEAT_BG[t] }} />
          {t === 1 ? '0-20' : t === 2 ? '20-40' : t === 3 ? '40-60' : t === 4 ? '60-80' : '80+'}
        </span>
      ))}
    </div>
  );
}

function Heatmap({ data, isHi }: { data: HeatmapData | null; isHi: boolean }) {
  if (!data?.matrix?.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic' }}>
        {isHi ? 'अभी कोई मास्टरी डेटा नहीं — छात्रों को अभ्यास शुरू करना होगा।' : 'No mastery data yet — students need to start practising.'}
      </div>
    );
  }
  const concepts = (data.concepts || []).slice(0, 8);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: '4px 4px',
          fontFamily: 'var(--font-display)',
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 6px 8px', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {isHi ? 'छात्र' : 'Student'}
            </th>
            {concepts.map((c, i) => (
              <th key={i} style={{ textAlign: 'center', padding: '4px 2px 8px', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Ch{c.chapter}<br />
                <span style={{ fontWeight: 400, opacity: 0.7 }}>{c.title?.slice(0, 8) ?? ''}</span>
              </th>
            ))}
            <th style={{ textAlign: 'center', padding: '4px 2px 8px', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row: HeatmapRow, ri) => (
            <tr key={ri}>
              <td style={{ padding: '4px 6px', fontSize: 12, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                {row.student_name}
              </td>
              {(row.cells || []).slice(0, 8).map((cell: HeatmapCell, ci) => {
                const has = cell.attempts > 0;
                const tier = heatTier(cell.p_know);
                return (
                  <td key={ci} style={{ padding: 0, textAlign: 'center' }}>
                    <span
                      title={`P(know) = ${Math.round(cell.p_know * 100)}% · ${cell.attempts} attempts`}
                      style={{
                        display: 'inline-block',
                        minWidth: 36,
                        padding: '4px 2px',
                        background: has ? HEAT_BG[tier] : 'var(--cream-3)',
                        color: has ? 'white' : 'var(--ink-3)',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        opacity: has ? 1 : 0.4,
                      }}
                      className="atlas-tabnum"
                    >
                      {has ? Math.round(cell.p_know * 100) : '—'}
                    </span>
                  </td>
                );
              })}
              <td style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink)', padding: '4px 6px' }} className="atlas-tabnum">
                {row.avg_mastery}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
