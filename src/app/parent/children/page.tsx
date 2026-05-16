'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { BottomNav } from '@/components/ui';
import { track } from '@/lib/analytics';
import ChildDataErasureSection from '@/components/parent/ChildDataErasureSection';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  // P13: parent-portal binds caller to JWT — Authorization header is now
  // required for every action except parent_login. Body.guardian_id is
  // overridden server-side from the JWT-resolved guardian.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — request will be rejected by Edge Function */ }

  const res = await fetch(`${SB_URL}/functions/v1/parent-portal`, {
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

// ============================================================
// TYPES
// ============================================================
interface ChildStats {
  xp: number;
  streak: number;
  mastery: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
}

interface RecentAchievement {
  title: string;
  icon: string;
  date: string;
}

interface ChildData {
  id: string;
  name: string;
  grade: string;
  stats: ChildStats;
  todayQuizzes: number;
  todayMinutes: number;
  lastActive: string | null;
  activeToday: boolean;
  subjects: string[];
  subjectProgress: { name: string; percent: number }[];
  recentAchievements: RecentAchievement[];
  weekSummary: string;
}

// ============================================================
// AVATAR
// ============================================================
const avatarGradients = [
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#DB2777'],
  ['#8B5CF6', '#7C3AED'],
  ['#06B6D4', '#0891B2'],
  ['#F97316', '#EA580C'],
  ['#10B981', '#059669'],
];

function ChildAvatar({ name, size = 52 }: { name: string; size?: number }) {
  const idx = name.charCodeAt(0) % avatarGradients.length;
  const [from, to] = avatarGradients[idx];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${from}, ${to})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        boxShadow: `0 2px 8px ${from}33`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ============================================================
// STAT PILL
// ============================================================
function StatPill({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '5px 10px', backgroundColor: `${color}12`,
      borderRadius: 8, border: `1px solid ${color}22`,
    }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 11, color: '#94A3B8' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color, marginLeft: 2 }}>{value}</span>
    </div>
  );
}

// ============================================================
// MINI PROGRESS BAR
// ============================================================
function MiniProgressBar({ label, percent, color }: { label: string; percent: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>{percent}%</span>
      </div>
      <div style={{ height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.min(percent, 100)}%`,
          backgroundColor: color, borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

// ============================================================
// CHILD CARD
// ============================================================
function ChildCard({
  child, expanded, onToggle, onViewReport, onUnlink, onDownloadData,
}: {
  child: ChildData;
  expanded: boolean;
  onToggle: () => void;
  onViewReport: () => void;
  onUnlink: () => void;
  onDownloadData: () => void;
}) {
  const subjectColors = ['#16A34A', '#2563EB', '#D97706', '#8B5CF6', '#EC4899', '#06B6D4'];

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid #FDBA7444',
      marginBottom: 14,
      overflow: 'hidden',
      transition: 'box-shadow 0.3s ease',
      boxShadow: expanded ? '0 4px 20px #F9731615' : 'none',
    }}>
      {/* Main card area */}
      <div
        onClick={onToggle}
        style={{
          padding: '16px 18px',
          cursor: 'pointer',
        }}
      >
        {/* Top row: avatar + name + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <ChildAvatar name={child.name} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1E293B', margin: 0 }}>
                {child.name}
              </h3>
              {/* Status dot */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: child.activeToday ? '#22C55E' : '#64748B',
                flexShrink: 0,
              }} />
            </div>
            <p style={{ fontSize: 13, color: '#94A3B8', margin: '2px 0 0' }}>
              Grade {child.grade}
            </p>
            <p style={{ fontSize: 11, color: child.activeToday ? '#22C55E' : '#64748B', margin: '2px 0 0' }}>
              {child.activeToday
                ? 'Active today'
                : child.lastActive
                  ? `Last active: ${new Date(child.lastActive).toLocaleDateString()}`
                  : 'No recent activity'}
            </p>
          </div>
          {/* Expand arrow */}
          <span style={{
            fontSize: 18, color: '#64748B',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease',
          }}>
            &#9660;
          </span>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <StatPill icon="&#x2B50;" label="XP" value={child.stats.xp} color="#F59E0B" />
          <StatPill icon="&#x1F525;" label="Streak" value={`${child.stats.streak}d`} color="#EF4444" />
          <StatPill icon="&#x1F4CA;" label="Mastery" value={`${child.stats.mastery}%`} color="#16A34A" />
          <StatPill icon="&#x1F3AF;" label="Accuracy" value={`${child.stats.accuracy}%`} color="#2563EB" />
        </div>
      </div>

      {/* Today's activity bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 18px',
        backgroundColor: '#FFF8F0',
        borderTop: '1px solid #FDBA7433',
      }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>
            Today: <strong style={{ color: '#1E293B' }}>{child.todayQuizzes}</strong> quizzes
          </span>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>
            <strong style={{ color: '#1E293B' }}>{child.todayMinutes}m</strong> spent
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onViewReport(); }}
          style={{
            padding: '6px 14px',
            backgroundColor: '#16A34A',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          View Full Report
        </button>
      </div>

      {/* Subject chips */}
      {child.subjects.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          padding: '10px 18px 12px',
          borderTop: '1px solid #FDBA7433',
        }}>
          {child.subjects.map((subj, i) => (
            <span key={subj} style={{
              padding: '3px 10px',
              backgroundColor: `${subjectColors[i % subjectColors.length]}18`,
              color: subjectColors[i % subjectColors.length],
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              border: `1px solid ${subjectColors[i % subjectColors.length]}30`,
            }}>
              {subj}
            </span>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      <div style={{
        maxHeight: expanded ? 500 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.4s ease',
      }}>
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid #1E293B' }}>
          {/* Subject progress bars */}
          {child.subjectProgress.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', margin: '0 0 10px' }}>
                Subject Progress
              </h4>
              {child.subjectProgress.map((sp, i) => (
                <MiniProgressBar
                  key={sp.name}
                  label={sp.name}
                  percent={sp.percent}
                  color={subjectColors[i % subjectColors.length]}
                />
              ))}
            </div>
          )}

          {/* Study streak */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', marginTop: 10,
            backgroundColor: '#FFF3E6', borderRadius: 10,
          }}>
            <span style={{ fontSize: 22 }}>&#x1F525;</span>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B' }}>
                {child.stats.streak} day streak
              </span>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>
                Keep it going!
              </p>
            </div>
          </div>

          {/* Recent achievements */}
          {child.recentAchievements.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', margin: '0 0 8px' }}>
                Recent Achievements
              </h4>
              {child.recentAchievements.slice(0, 3).map((ach, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderBottom: i < Math.min(child.recentAchievements.length, 3) - 1 ? '1px solid #FDBA7433' : 'none',
                }}>
                  <span style={{ fontSize: 18 }}>{ach.icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{ach.title}</span>
                    <p style={{ fontSize: 11, color: '#64748B', margin: '1px 0 0' }}>{ach.date}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Learning this week */}
          {child.weekSummary && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              backgroundColor: '#16A34A12', borderRadius: 10,
              border: '1px solid #16A34A25',
            }}>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: '#16A34A', margin: '0 0 4px' }}>
                Learning this week
              </h4>
              <p style={{ fontSize: 13, color: '#475569', margin: 0, lineHeight: 1.5 }}>
                {child.weekSummary}
              </p>
            </div>
          )}

          {/* DPDP §13 — Download child data (Phase D.2) */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #FDBA7433' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDownloadData(); }}
              data-testid={`download-child-data-${child.id}`}
              style={{
                padding: '7px 16px',
                backgroundColor: 'transparent',
                color: '#2563EB',
                border: '1px solid #2563EB',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
              }}
            >
              &#x2B07;&#xFE0F; {t(false, "Download my child's data", 'मेरे बच्चे का डेटा डाउनलोड करें')}
            </button>
          </div>

          {/* Remove Link */}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onUnlink(); }}
              style={{
                padding: '7px 16px',
                backgroundColor: 'transparent',
                color: '#EF4444',
                border: '1px solid #EF4444',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              &#x1F517; {t(false, 'Remove Link', 'लिंक हटाएं')}
            </button>
          </div>

          {/* Phase D.3 — DPDP §15 right-to-erasure (parent-initiated). */}
          <div onClick={(e) => e.stopPropagation()}>
            <ChildDataErasureSection
              studentId={child.id}
              studentName={child.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LINK CHILD SECTION
// ============================================================
function LinkChildSection({
  guardianId: _guardianId,
  onLinked,
  compact,
  isHi = false,
}: {
  guardianId: string;
  onLinked: () => void;
  compact?: boolean;
  isHi?: boolean;
}) {
  // Phase D.4: 2-step OTP-gated flow. step 1 = enter code, step 2 = enter OTP.
  type Step = 'code' | 'otp' | 'locked';
  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number | null>(null);

  const requestOtp = async (codeToSend: string) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/parent/link-code/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_code: codeToSend.trim().toUpperCase() }),
      });
      if (res.status === 429) {
        setMessage({
          type: 'error',
          text: t(isHi,
            'Too many attempts. Please wait an hour and try again.',
            'बहुत अधिक प्रयास। कृपया एक घंटा प्रतीक्षा करें और पुनः प्रयास करें।'),
        });
        return false;
      }
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: t(isHi, 'Something went wrong. Please try again.', 'कुछ गलत हो गया। कृपया पुनः प्रयास करें।'),
        });
        return false;
      }
      // 1-minute resend cooldown on the client to mirror the server-side rule.
      setResendCooldownUntil(Date.now() + 60_000);
      setMessage({
        type: 'info',
        text: t(isHi,
          "If the code is valid, we've sent a 6-digit code to your email. Check your inbox.",
          'यदि कोड मान्य है, तो हमने आपके ईमेल पर 6-अंकीय कोड भेजा है। अपना इनबॉक्स देखें।'),
      });
      return true;
    } catch {
      setMessage({
        type: 'error',
        text: t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'),
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRequestCode = async () => {
    if (!code.trim()) {
      setMessage({ type: 'error', text: t(isHi, 'Please enter a link code.', 'कृपया एक लिंक कोड दर्ज करें।') });
      return;
    }
    const ok = await requestOtp(code);
    if (ok) setStep('otp');
  };

  const handleResend = async () => {
    if (resendCooldownUntil && Date.now() < resendCooldownUntil) return;
    await requestOtp(code);
  };

  const handleVerifyOtp = async () => {
    if (!/^\d{6}$/.test(otp.trim())) {
      setMessage({
        type: 'error',
        text: t(isHi, 'Please enter the 6-digit code from your email.', 'कृपया अपने ईमेल से 6-अंकीय कोड दर्ज करें।'),
      });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/parent/link-code/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link_code: code.trim().toUpperCase(),
          otp: otp.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        linked?: boolean;
        student_name?: string | null;
        remaining_attempts?: number;
      };
      if (res.status === 423) {
        setStep('locked');
        setMessage({
          type: 'error',
          text: t(isHi,
            'Too many incorrect attempts. Try again in 1 hour.',
            'बहुत अधिक गलत प्रयास। 1 घंटे में पुनः प्रयास करें।'),
        });
        return;
      }
      if (res.status === 429) {
        setMessage({
          type: 'error',
          text: t(isHi,
            'Too many attempts. Please wait an hour and try again.',
            'बहुत अधिक प्रयास। कृपया एक घंटा प्रतीक्षा करें और पुनः प्रयास करें।'),
        });
        return;
      }
      if (!res.ok || !body.success) {
        const remaining = body.remaining_attempts;
        setMessage({
          type: 'error',
          text: typeof remaining === 'number'
            ? t(isHi,
                `Incorrect code. ${remaining} attempts left.`,
                `गलत कोड। ${remaining} प्रयास शेष।`)
            : body.error ?? t(isHi, 'Incorrect code.', 'गलत कोड।'),
        });
        return;
      }

      // Success — fire analytics (best effort) and reset the form.
      try {
        track('parent_linked', { method: 'code', link_method: 'code' });
      } catch { /* non-critical */ }
      setMessage({
        type: 'success',
        text: t(isHi, 'Child linked successfully!', 'बच्चा सफलतापूर्वक जुड़ गया!'),
      });
      setCode('');
      setOtp('');
      setTimeout(() => {
        setMessage(null);
        setStep('code');
        onLinked();
      }, 1500);
    } catch {
      setMessage({
        type: 'error',
        text: t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBackToCode = () => {
    setOtp('');
    setStep('code');
    setMessage(null);
  };

  const resendDisabled = !!(resendCooldownUntil && Date.now() < resendCooldownUntil);

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid #FDBA7444',
      padding: compact ? '16px 18px' : '24px 22px',
      marginBottom: 14,
    }}>
      {!compact && (
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', margin: '0 0 4px' }}>
          {t(isHi, 'Link a New Child', 'नया बच्चा जोड़ें')}
        </h3>
      )}
      <p style={{
        fontSize: 13, color: '#94A3B8', margin: compact ? '0 0 12px' : '0 0 16px',
        lineHeight: 1.5,
      }}>
        {step === 'code'
          ? (compact
              ? t(isHi, "Enter your child's link code to connect and start tracking their progress.", 'अपने बच्चे का लिंक कोड दर्ज करें और उनकी प्रगति ट्रैक करना शुरू करें।')
              : t(isHi, "Ask your child's teacher for the link code, or find it in your child's profile page under Settings.", 'लिंक कोड के लिए अपने बच्चे के शिक्षक से पूछें, या इसे बच्चे के प्रोफ़ाइल पेज में सेटिंग्स के तहत खोजें।'))
          : step === 'otp'
            ? t(isHi,
                "Enter the 6-digit code we sent to your email.",
                'हमने आपके ईमेल पर भेजा गया 6-अंकीय कोड दर्ज करें।')
            : t(isHi,
                'Too many incorrect attempts. Try again in 1 hour.',
                'बहुत अधिक गलत प्रयास। 1 घंटे में पुनः प्रयास करें।')}
      </p>

      {step === 'code' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder={t(isHi, "Enter your child's link code", 'अपने बच्चे का लिंक कोड दर्ज करें')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleRequestCode()}
            maxLength={12}
            style={{
              flex: 1,
              padding: '12px 14px',
              backgroundColor: '#FFF8F0',
              border: '1px solid #FDBA7444',
              borderRadius: 10,
              color: '#1E293B',
              fontSize: 15,
              letterSpacing: 2,
              textTransform: 'uppercase' as const,
              outline: 'none',
              boxSizing: 'border-box' as const,
            }}
          />
          <button
            onClick={handleRequestCode}
            disabled={loading}
            style={{
              padding: '12px 20px',
              backgroundColor: '#16A34A',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
              whiteSpace: 'nowrap' as const,
              minWidth: 100,
            }}
          >
            {loading
              ? t(isHi, 'Sending...', 'भेज रहे हैं...')
              : t(isHi, 'Send Code', 'कोड भेजें')}
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
              maxLength={6}
              style={{
                flex: 1,
                padding: '12px 14px',
                backgroundColor: '#FFF8F0',
                border: '1px solid #FDBA7444',
                borderRadius: 10,
                color: '#1E293B',
                fontSize: 18,
                letterSpacing: 6,
                textAlign: 'center' as const,
                outline: 'none',
                boxSizing: 'border-box' as const,
              }}
            />
            <button
              onClick={handleVerifyOtp}
              disabled={loading}
              style={{
                padding: '12px 20px',
                backgroundColor: '#16A34A',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'default' : 'pointer',
                opacity: loading ? 0.6 : 1,
                whiteSpace: 'nowrap' as const,
                minWidth: 100,
              }}
            >
              {loading
                ? t(isHi, 'Verifying...', 'सत्यापित कर रहे हैं...')
                : t(isHi, 'Verify', 'सत्यापित करें')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <button
              onClick={handleBackToCode}
              type="button"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748B',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {t(isHi, 'Back', 'वापस')}
            </button>
            <button
              onClick={handleResend}
              disabled={resendDisabled || loading}
              type="button"
              style={{
                background: 'transparent',
                border: 'none',
                color: resendDisabled ? '#94A3B8' : '#6C5CE7',
                fontSize: 12,
                fontWeight: 600,
                cursor: resendDisabled ? 'default' : 'pointer',
                padding: 0,
              }}
            >
              {resendDisabled
                ? t(isHi, 'Resend in 1 min', '1 मिनट में पुनः भेजें')
                : t(isHi, 'Resend code', 'कोड पुनः भेजें')}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p style={{
          fontSize: 13, margin: '10px 0 0',
          color:
            message.type === 'success'
              ? '#22C55E'
              : message.type === 'info'
                ? '#64748B'
                : '#EF4444',
          fontWeight: 500,
        }}>
          {message.text}
        </p>
      )}
    </div>
  );
}

// ============================================================
// NO CHILDREN STATE
// ============================================================
function NoChildrenState({ guardianId, onLinked, isHi }: { guardianId: string; onLinked: () => void; isHi: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>&#x1F468;&#x200D;&#x1F469;&#x200D;&#x1F467;</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: '0 0 8px' }}>
        {t(isHi, 'No children linked yet', 'अभी तक कोई बच्चा जुड़ा नहीं है')}
      </h2>
      <p style={{ fontSize: 14, color: '#94A3B8', margin: '0 0 24px', lineHeight: 1.5 }}>
        {t(isHi, "Enter your child's link code to connect and start tracking their progress.", 'अपने बच्चे का लिंक कोड दर्ज करें और उनकी प्रगति ट्रैक करना शुरू करें।')}
      </p>
      <LinkChildSection guardianId={guardianId} onLinked={onLinked} compact isHi={isHi} />
    </div>
  );
}

// ============================================================
// UNLINK CONFIRMATION MODAL
// ============================================================
function UnlinkConfirmModal({
  childName,
  onConfirm,
  onCancel,
  loading,
  isHi,
}: {
  childName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  isHi: boolean;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 20px',
    }}>
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        padding: '26px 22px',
        maxWidth: 360,
        width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>&#x26A0;&#xFE0F;</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1E293B', margin: '0 0 8px', textAlign: 'center' }}>
          {t(isHi,
            `Remove link with ${childName}?`,
            `${childName} के साथ लिंक हटाएं?`
          )}
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 1.6, margin: '0 0 20px' }}>
          {t(isHi,
            'This will revoke your access to their progress data. The student will need to share a new link code to reconnect.',
            'इससे उनके प्रगति डेटा तक आपकी पहुँच रद्द हो जाएगी। पुनः कनेक्ट करने के लिए छात्र को नया लिंक कोड साझा करना होगा।'
          )}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: 1, padding: '12px', backgroundColor: '#F1F5F9',
              color: '#475569', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {t(isHi, 'Cancel', 'रद्द करें')}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 1, padding: '12px', backgroundColor: '#EF4444',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {loading ? (
              <span style={{
                display: 'inline-block', width: 14, height: 14,
                border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
            ) : (
              t(isHi, 'Remove', 'हटाएं')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DOWNLOAD DATA CONFIRMATION MODAL (DPDP §13, Phase D.2)
// ============================================================
function DownloadDataConfirmModal({
  childName,
  onConfirm,
  onCancel,
  isHi,
}: {
  childName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isHi: boolean;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 20px',
    }}>
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        padding: '26px 22px',
        maxWidth: 380,
        width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>&#x1F4C2;</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1E293B', margin: '0 0 8px', textAlign: 'center' }}>
          {t(isHi,
            `Download data for ${childName}?`,
            `${childName} का डेटा डाउनलोड करें?`
          )}
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 1.6, margin: '0 0 16px' }}>
          {t(isHi,
            `This will download a JSON file with all of ${childName}'s data — quiz history, Foxy AI chats, learning progress, and account info.`,
            `यह ${childName} के सभी डेटा के साथ एक JSON फ़ाइल डाउनलोड करेगा — क्विज़ इतिहास, फॉक्सी AI चैट, सीखने की प्रगति और खाता जानकारी।`
          )}
        </p>
        <p style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 1.5, margin: '0 0 20px' }}>
          {t(isHi,
            'DPDP §13 — Right to Access. Continue?',
            'DPDP §13 — एक्सेस का अधिकार। जारी रखें?'
          )}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '12px', backgroundColor: '#F1F5F9',
              color: '#475569', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t(isHi, 'Cancel', 'रद्द करें')}
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-download-data"
            style={{
              flex: 1, padding: '12px', backgroundColor: '#2563EB',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t(isHi, 'Download', 'डाउनलोड')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

export default function ParentChildrenPage() {
  const { guardian, isLoading: authLoading, isLoggedIn, isHi } = useAuth();
  const router = useRouter();

  const [children, setChildren] = useState<ChildData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChild, setExpandedChild] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<ChildData | null>(null);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<ChildData | null>(null);

  const fetchChildren = useCallback(async () => {
    if (!guardian) return;
    setLoading(true);
    try {
      const res = await api('get_child_dashboard', { guardian_id: guardian.id });

      // The API may return a single child or a list — normalize to array
      let childrenList: ChildData[] = [];

      if (Array.isArray(res)) {
        childrenList = res.map(normalizeChild);
      } else if (res && res.students && Array.isArray(res.students)) {
        childrenList = res.students.map(normalizeChild);
      } else if (res && res.student) {
        childrenList = [normalizeChild(res)];
      } else if (res && !res.error) {
        childrenList = [normalizeChild(res)];
      }

      setChildren(childrenList);
    } catch (err) {
      console.error('Failed to fetch children:', err);
      setChildren([]);
    }
    setLoading(false);
  }, [guardian]);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn || !guardian) {
      if (typeof window !== 'undefined' && !authLoading) {
        window.location.href = '/';
      }
      return;
    }
    fetchChildren();
  }, [authLoading, isLoggedIn, guardian, fetchChildren]);

  const handleViewReport = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/parent/reports';
    }
  };

  const handleDownloadConfirm = () => {
    if (!downloadTarget) return;
    // Browser handles the download via Content-Disposition header.
    // Same-origin GET preserves the parent's auth cookie automatically,
    // so the API route can resolve the guardian + verify the link.
    if (typeof window !== 'undefined') {
      window.location.href = `/api/parent/children/${downloadTarget.id}/export`;
    }
    setDownloadTarget(null);
  };

  const handleUnlinkConfirm = async () => {
    if (!unlinkTarget || !guardian) return;
    setUnlinkLoading(true);
    try {
      await supabase
        .from('guardian_student_links')
        .update({ status: 'revoked' })
        .eq('student_id', unlinkTarget.id)
        .eq('guardian_id', guardian.id);
      setUnlinkTarget(null);
      await fetchChildren();
    } catch (err) {
      console.error('Failed to unlink child:', err);
    }
    setUnlinkLoading(false);
  };

  // Loading state
  if (authLoading || loading) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid #FDBA7444', borderTopColor: '#F97316',
            borderRadius: '50%', margin: '0 auto 16px',
            animation: 'spin 0.8s linear infinite',
          }} />
          {t(isHi, 'Loading children...', 'बच्चे लोड हो रहे हैं...')}
        </div>
      </div>
    );
  }

  // Auth guard
  if (!guardian) {
    return null;
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Unlink Confirmation Modal */}
      {unlinkTarget && (
        <UnlinkConfirmModal
          childName={unlinkTarget.name}
          onConfirm={handleUnlinkConfirm}
          onCancel={() => setUnlinkTarget(null)}
          loading={unlinkLoading}
          isHi={isHi}
        />
      )}

      {/* DPDP §13 — Download Data Confirmation Modal (Phase D.2) */}
      {downloadTarget && (
        <DownloadDataConfirmModal
          childName={downloadTarget.name}
          onConfirm={handleDownloadConfirm}
          onCancel={() => setDownloadTarget(null)}
          isHi={isHi}
        />
      )}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #F97316, #EA580C)',
        borderRadius: 16,
        padding: '24px 22px',
        marginBottom: 20,
        position: 'relative',
      }}>
        <button
          onClick={() => router.push('/parent')}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, padding: '4px 10px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          &larr; {t(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
          &#x1F467; {t(isHi, 'My Children', 'मेरे बच्चे')}
        </h1>
        <p style={{ fontSize: 14, color: '#BBF7D0', margin: 0 }}>
          {t(isHi, "Monitor your children's learning journey", 'अपने बच्चों की सीखने की यात्रा पर नज़र रखें')}
        </p>
      </div>

      {/* Children list or empty state */}
      {children.length === 0 ? (
        <NoChildrenState guardianId={guardian.id} onLinked={fetchChildren} isHi={isHi} />
      ) : (
        <>
          {children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              expanded={expandedChild === child.id}
              onToggle={() =>
                setExpandedChild(expandedChild === child.id ? null : child.id)
              }
              onViewReport={handleViewReport}
              onUnlink={() => setUnlinkTarget(child)}
              onDownloadData={() => setDownloadTarget(child)}
            />
          ))}

          {/* Link new child section */}
          <div style={{ marginTop: 8 }}>
            <LinkChildSection guardianId={guardian.id} onLinked={fetchChildren} isHi={isHi} />
          </div>
        </>
      )}

      {/* Footer */}
      <p style={{ textAlign: 'center', fontSize: 11, color: '#475569', margin: '24px 0 12px' }}>
        Alfanumrik Learning OS | {t(isHi, 'Parent Portal', 'अभिभावक पोर्टल')}
      </p>
      <BottomNav />
    </div>
  );
}

// ============================================================
// NORMALIZE API RESPONSE TO ChildData
// ============================================================
interface RawSubjectProgress {
  name?: string;
  subject?: string;
  percent?: number;
  mastery?: number;
  progress?: number;
}

interface RawAchievement {
  title?: string;
  name?: string;
  icon?: string;
  date?: string;
  earned_at?: string;
}

interface RawChildResponse {
  id?: string;
  name?: string;
  grade?: string;
  student?: { id?: string; name?: string; grade?: string; last_active?: string };
  stats?: Record<string, number>;
  lastActive?: string;
  last_active?: string;
  // Server-computed flag: true iff the child took >=1 quiz today (UTC date).
  // The Edge Function calculates this from quiz_sessions, which is the freshest
  // source. The students.last_active timestamp is updated by other flows (chat,
  // login, etc.) and may lag behind quiz activity.
  activeToday?: boolean;
  active_today?: boolean;
  bktMastery?: { levels?: Record<string, number>; total?: number };
  subjects?: string[];
  subjectProgress?: RawSubjectProgress[];
  subject_progress?: RawSubjectProgress[];
  recentAchievements?: RawAchievement[];
  recent_achievements?: RawAchievement[];
  achievements?: RawAchievement[];
  weekSummary?: string;
  week_summary?: string;
}

// IST day computation. Indian users perceive "today" as the IST calendar
// day, not UTC. Edge Function emits IST-bucketed dates; the client must
// agree when falling back to a last_active comparison.
function istDateStringFromInstant(d: Date): string {
  const istMs = d.getTime() + 330 * 60_000; // +5h30m
  return new Date(istMs).toISOString().slice(0, 10);
}

function normalizeChild(raw: RawChildResponse): ChildData {
  const student = raw.student || raw;
  const stats = raw.stats || {};
  const today = istDateStringFromInstant(new Date());

  // Determine if active today.
  // Bug fix (2026-04-29): Prefer the server-computed activeToday flag over
  // re-deriving from students.last_active. Previously the client compared
  // last_active to today, but last_active can be stale (set by login/chat
  // flows but not always after a quiz). This caused the "Active today" dot
  // to be wrong even when today's quiz count was non-zero.
  // Bug fix (2026-04-29 IST timezone): the fallback comparison now uses an
  // IST calendar date, matching the Edge Function's istDateString() output.
  const lastActiveRaw = raw.lastActive || raw.last_active || (raw.student ? raw.student.last_active : null) || null;
  const serverActiveToday = typeof raw.activeToday === 'boolean'
    ? raw.activeToday
    : typeof raw.active_today === 'boolean'
      ? raw.active_today
      : null;
  const todayQuizzes = stats.todayQuizzes || stats.today_quizzes || 0;
  const activeToday = serverActiveToday ?? (
    todayQuizzes > 0
      ? true
      : lastActiveRaw
        ? istDateStringFromInstant(new Date(lastActiveRaw)) === today
        : false
  );

  // Extract subjects
  const subjects: string[] = raw.subjects
    || (raw.subjectProgress || raw.subject_progress || []).map((s: RawSubjectProgress) => s.name || s.subject || '')
    || [];

  // Extract subject progress
  const subjectProgress: { name: string; percent: number }[] =
    (raw.subjectProgress || raw.subject_progress || []).map((s: RawSubjectProgress) => ({
      name: s.name || s.subject || 'Unknown',
      percent: s.percent || s.mastery || s.progress || 0,
    }));

  // Extract recent achievements
  const recentAchievements: RecentAchievement[] =
    (raw.recentAchievements || raw.recent_achievements || raw.achievements || [])
      .slice(0, 3)
      .map((a: RawAchievement) => ({
        title: a.title || a.name || 'Achievement',
        icon: a.icon || '\uD83C\uDFC6',
        date: a.date || a.earned_at || '',
      }));

  return {
    id: student.id || raw.id || String(Math.random()),
    name: student.name || raw.name || 'Child',
    grade: student.grade || raw.grade || '?',
    stats: {
      xp: stats.xp || 0,
      streak: stats.streak || stats.current_streak || 0,
      mastery: stats.mastery || stats.mastery_percent || 0,
      accuracy: stats.accuracy || stats.avg_score || 0,
      totalQuizzes: stats.totalQuizzes || stats.total_quizzes || 0,
      minutes: stats.minutes || stats.study_minutes || 0,
    },
    todayQuizzes: stats.todayQuizzes || stats.today_quizzes || 0,
    todayMinutes: stats.todayMinutes || stats.today_minutes || 0,
    lastActive: lastActiveRaw,
    activeToday,
    subjects: subjects.filter(Boolean),
    subjectProgress,
    recentAchievements,
    weekSummary: raw.weekSummary || raw.week_summary || '',
  };
}

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  maxWidth: 600,
  margin: '0 auto',
  padding: '20px 16px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#1E293B',
  backgroundColor: '#FFF8F0',
  minHeight: '100vh',
};
