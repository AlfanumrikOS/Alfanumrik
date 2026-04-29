'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { BottomNav } from '@/components/ui';
import { track } from '@/lib/analytics';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SB_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
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
  child, expanded, onToggle, onViewReport, onUnlink,
}: {
  child: ChildData;
  expanded: boolean;
  onToggle: () => void;
  onViewReport: () => void;
  onUnlink: () => void;
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

          {/* Remove Link */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #FDBA7433' }}>
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
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LINK CHILD SECTION
// ============================================================
function LinkChildSection({
  guardianId,
  onLinked,
  compact,
  isHi = false,
}: {
  guardianId: string;
  onLinked: () => void;
  compact?: boolean;
  isHi?: boolean;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleLink = async () => {
    if (!code.trim()) {
      setMessage({ type: 'error', text: t(isHi, 'Please enter a link code.', 'कृपया एक लिंक कोड दर्ज करें।') });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('link_guardian_to_student_via_code', {
        p_guardian_id: guardianId,
        p_invite_code: code.trim().toUpperCase(),
      });
      if (error) throw error;
      if (data && typeof data === 'object' && 'error' in data) {
        setMessage({ type: 'error', text: (data as { error: string }).error });
      } else {
        setMessage({ type: 'success', text: t(isHi, 'Child linked successfully!', 'बच्चा सफलतापूर्वक जुड़ गया!') });
        // Analytics: F16 — see audit 2026-04-27.
        // Fires once per successful link redemption. Never log raw student_id —
        // hash to first 8 bytes (16 hex chars) for cohort analysis without PII.
        try {
          const studentId = data && typeof data === 'object' && 'student_id' in data
            ? (data as { student_id: string }).student_id
            : null;
          let studentIdHash: string | undefined;
          if (studentId && typeof crypto !== 'undefined' && crypto.subtle) {
            const buf = new TextEncoder().encode(studentId);
            const digest = await crypto.subtle.digest('SHA-256', buf);
            studentIdHash = Array.from(new Uint8Array(digest).slice(0, 8))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
          }
          track('parent_linked', {
            method: 'code',
            link_method: 'code',
            ...(studentIdHash ? { student_id_hash: studentIdHash } : {}),
          });
        } catch { /* analytics is non-critical */ }
        setCode('');
        setTimeout(() => {
          setMessage(null);
          onLinked();
        }, 1500);
      }
    } catch {
      setMessage({ type: 'error', text: t(isHi, 'Invalid code or already linked. Please check and try again.', 'अमान्य कोड या पहले से जुड़ा हुआ। कृपया जाँच करें और पुनः प्रयास करें।') });
    }
    setLoading(false);
  };

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
        {compact
          ? t(isHi, "Enter your child's link code to connect and start tracking their progress.", 'अपने बच्चे का लिंक कोड दर्ज करें और उनकी प्रगति ट्रैक करना शुरू करें।')
          : t(isHi, "Ask your child's teacher for the link code, or find it in your child's profile page under Settings.", 'लिंक कोड के लिए अपने बच्चे के शिक्षक से पूछें, या इसे बच्चे के प्रोफ़ाइल पेज में सेटिंग्स के तहत खोजें।')}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder={t(isHi, "Enter your child's link code", 'अपने बच्चे का लिंक कोड दर्ज करें')}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleLink()}
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
          onClick={handleLink}
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
          {loading ? t(isHi, 'Linking...', 'जोड़ रहे हैं...') : t(isHi, 'Link Child', 'बच्चा जोड़ें')}
        </button>
      </div>

      {message && (
        <p style={{
          fontSize: 13, margin: '10px 0 0',
          color: message.type === 'success' ? '#22C55E' : '#EF4444',
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

function normalizeChild(raw: RawChildResponse): ChildData {
  const student = raw.student || raw;
  const stats = raw.stats || {};
  const today = new Date().toISOString().slice(0, 10);

  // Determine if active today.
  // Bug fix (2026-04-29): Prefer the server-computed activeToday flag over
  // re-deriving from students.last_active. Previously the client compared
  // last_active to today, but last_active can be stale (set by login/chat
  // flows but not always after a quiz). This caused the "Active today" dot
  // to be wrong even when today's quiz count was non-zero.
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
        ? new Date(lastActiveRaw).toISOString().slice(0, 10) === today
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
