'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getStudentProfiles, getSubjects, studentJoinClass } from '@/lib/supabase';
import { Card, Button, Input, Select, Avatar, SectionHeader, ProgressBar, StatCard, LoadingFoxy } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import TrustFooter from '@/components/TrustFooter';
import { GRADES, BOARDS, LANGUAGES } from '@/lib/constants';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { PlanBadge } from '@/components/PlanBadge';
import { isSoundEnabled, setSoundEnabled, playSound } from '@/lib/sounds';
import StreakBadge from '@/components/challenge/StreakBadge';
import XPRewardShop from '@/components/xp/XPRewardShop';

function SoundToggle() {
  const [on, setOn] = useState(() => isSoundEnabled());
  return (
    <button
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundEnabled(next);
        if (next) playSound('tap');
      }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200"
      style={{
        background: on ? 'rgba(22, 163, 74, 0.1)' : 'var(--surface-2)',
        border: `1px solid ${on ? 'rgba(22,163,74,0.2)' : 'var(--border)'}`,
      }}
    >
      <span className="text-sm">{on ? '🔔' : '🔕'}</span>
      <div
        className="w-7 h-4 rounded-full transition-all duration-200 relative flex-shrink-0"
        style={{ background: on ? '#16A34A' : 'var(--surface-3)' }}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200"
          style={{ left: on ? '14px' : '2px' }}
        />
      </div>
    </button>
  );
}

/* ═══ CONNECTIONS CARD: Parent Link Code + Class Join ═══ */
function ConnectionsCard({ studentId, isHi }: { studentId: string; isHi: boolean }) {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [classCode, setClassCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinResult, setJoinResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch parent link code
  const fetchLinkCode = useCallback(async () => {
    setLoadingCode(true);
    try {
      const { data: studentData } = await supabase
        .from('students')
        .select('invite_code')
        .eq('id', studentId)
        .single();

      if (studentData?.invite_code) {
        setLinkCode(studentData.invite_code);
      } else {
        const { data: existing } = await supabase
          .from('guardian_student_links')
          .select('invite_code')
          .eq('student_id', studentId)
          .not('invite_code', 'is', null)
          .limit(1)
          .single();

        if (existing?.invite_code) {
          setLinkCode(existing.invite_code);
        }
      }
    } catch {
      // Silently fail
    }
    setLoadingCode(false);
  }, [studentId]);

  useEffect(() => { fetchLinkCode(); }, [fetchLinkCode]);

  const copyCode = () => {
    if (!linkCode) return;
    navigator.clipboard.writeText(linkCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleJoinClass = async () => {
    if (!classCode.trim()) return;
    setJoinLoading(true);
    setJoinResult(null);
    try {
      await studentJoinClass(studentId, classCode.trim().toUpperCase());
      setJoinResult({ ok: true, msg: isHi ? 'कक्षा में शामिल हो गए!' : 'Joined class successfully!' });
      setClassCode('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (isHi ? 'कोड अमान्य है' : 'Invalid class code');
      setJoinResult({ ok: false, msg });
    }
    setJoinLoading(false);
  };

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow duration-300">
      <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
        <span>🔗</span>
        <span>{isHi ? 'कनेक्शन' : 'Connections'}</span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Parent Link Code */}
        <div className="p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.01]" style={{ background: 'linear-gradient(135deg, rgba(245, 166, 35, 0.07) 0%, rgba(245, 166, 35, 0.02) 100%)', borderColor: 'rgba(245, 166, 35, 0.22)' }}>
          <p className="text-xs font-bold mb-1 flex items-center gap-1" style={{ color: '#B45309' }}>
            <span>👨‍👩‍👧</span>
            <span>{isHi ? 'पैरेंट लिंक कोड' : 'Parent Link Code'}</span>
          </p>
          <p className="text-[10px] mb-3 leading-normal" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'यह कोड अपने माता-पिता को दें — वे इसे पैरेंट डैशबोर्ड में दर्ज करेंगे' : 'Share this code with your parents so they can monitor your progress'}
          </p>
          {loadingCode ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</p>
          ) : linkCode ? (
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-center text-lg font-black tracking-[4px] px-3 py-2 rounded-xl"
                style={{ fontFamily: 'monospace', background: 'rgba(245, 166, 35, 0.12)', color: 'var(--orange)', border: '1px dashed rgba(245, 166, 35, 0.4)' }}
              >
                {linkCode}
              </code>
              <button
                onClick={copyCode}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 active:scale-95 shadow-sm"
                style={{
                  background: copied ? 'rgba(22, 163, 74, 0.1)' : 'white',
                  color: copied ? '#16A34A' : 'var(--text-2)',
                  border: `1px solid ${copied ? 'rgba(22, 163, 74, 0.2)' : 'var(--border)'}`,
                }}
              >
                {copied ? '✓' : isHi ? 'कॉपी' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{isHi ? 'कोड उपलब्ध नहीं' : 'Code not available'}</p>
          )}
        </div>

        {/* Join Class */}
        <div className="p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.01]" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
          <p className="text-xs font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
            <span>🏫</span>
            <span>{isHi ? 'कक्षा में शामिल हों' : 'Join a Class'}</span>
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-orange-200 transition-all duration-200"
              style={{ background: 'var(--surface-1)', border: '1.5px solid var(--border)', color: 'var(--text-1)' }}
              placeholder={isHi ? 'क्लास कोड' : 'CLASS CODE'}
              value={classCode}
              onChange={e => setClassCode(e.target.value.toUpperCase())}
              maxLength={10}
              onKeyDown={e => e.key === 'Enter' && handleJoinClass()}
            />
            <button
              onClick={handleJoinClass}
              disabled={joinLoading || !classCode.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97] shadow-sm hover:opacity-95"
              style={{ background: 'var(--orange)', opacity: joinLoading || !classCode.trim() ? 0.5 : 1 }}
            >
              {joinLoading ? '...' : isHi ? 'जुड़ें' : 'Join'}
            </button>
          </div>
          {joinResult && (
            <p className={`text-xs mt-2.5 font-bold ${joinResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {joinResult.ok ? '✓ ' : '✗ '}{joinResult.msg}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

type Tab = 'overview' | 'edit' | 'achievements' | 'stats' | 'shop';

const GOALS = [
  { value: '', label: 'Not set' },
  { value: 'board_topper', label: 'Board Topper (90%+)' },
  { value: 'school_topper', label: 'School Topper' },
  { value: 'pass_comfortably', label: 'Pass Comfortably' },
  { value: 'competitive_exam', label: 'JEE / NEET Prep' },
  { value: 'olympiad', label: 'Olympiad Prep' },
  { value: 'improve_basics', label: 'Improve Basics' },
];

const STUDY_HOURS = [
  { value: '1', label: '1 hour' },
  { value: '2', label: '2 hours' },
  { value: '3', label: '3 hours' },
  { value: '4', label: '4+ hours' },
];

export default function ProfilePage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, language, setLanguage, signOut, refreshStudent, refreshSnapshot } = useAuth();
  const router = useRouter();

  // Allowed subjects from the subjects service — grade + stream + plan aware.
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const [tab, setTab] = useState<Tab>('overview');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [allAchievements, setAllAchievements] = useState<any[]>([]);
  const [quizStats, setQuizStats] = useState({ total: 0, avgScore: 0, bestScore: 0, totalXpFromQuiz: 0 });
  const [challengeStreak, setChallengeStreak] = useState<{ current: number; best: number; badges: string[] } | null>(null);
  const [coinsBalance, setCoinsBalance] = useState(0);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [editBoard, setEditBoard] = useState('');
  const [editLang, setEditLang] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editSchool, setEditSchool] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [editGoal, setEditGoal] = useState('');
  const [editHours, setEditHours] = useState('1');
  const [editPhone, setEditPhone] = useState('');
  const [editParentName, setEditParentName] = useState('');
  const [editParentPhone, setEditParentPhone] = useState('');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // Populate edit form from student data
  useEffect(() => {
    if (!student) return;
    setEditName(student.name || '');
    setEditGrade(student.grade || '9');
    setEditBoard(student.board || 'CBSE');
    setEditLang(student.preferred_language || 'en');
    setEditSubject(student.preferred_subject || 'math');
    setEditSchool(student.school_name || '');
    setEditCity(student.city || '');
    setEditState(student.state || '');
    setEditGoal(student.academic_goal || '');
    setEditHours(String(student.daily_study_hours || 1));
    setEditPhone(student.phone || '');
    setEditParentName(student.parent_name || '');
    setEditParentPhone(student.parent_phone || '');
  }, [student]);

  const loadData = useCallback(async () => {
    if (!student) return;
    const [profs, subs] = await Promise.all([
      getStudentProfiles(student.id),
      getSubjects(),
    ]);
    setProfiles(profs);
    setSubjects(subs);

    // Achievements
    const { data: sa } = await supabase
      .from('student_achievements')
      .select('*, achievements(*)')
      .eq('student_id', student.id)
      .order('unlocked_at', { ascending: false });
    setAchievements(sa || []);

    const { data: allA } = await supabase
      .from('achievements')
      .select('*')
      .order('xp_reward');
    setAllAchievements(allA || []);

    // Quiz stats
    const { data: qs } = await supabase
      .from('quiz_sessions')
      .select('score_percent, score')
      .eq('student_id', student.id)
      .eq('is_completed', true);
    if (qs && qs.length > 0) {
      const avg = Math.round(qs.reduce((a, q) => a + (q.score_percent || 0), 0) / qs.length);
      const best = Math.max(...qs.map(q => q.score_percent || 0));
      const xp = qs.reduce((a, q) => a + (q.score || 0), 0);
      setQuizStats({ total: qs.length, avgScore: avg, bestScore: best, totalXpFromQuiz: xp });
    }

    // Challenge streak
    try {
      const { data: streakData } = await supabase
        .from('challenge_streaks')
        .select('current_streak, best_streak, badges')
        .eq('student_id', student.id)
        .single();
      if (streakData) {
        setChallengeStreak({
          current: streakData.current_streak ?? 0,
          best: streakData.best_streak ?? 0,
          badges: Array.isArray(streakData.badges) ? streakData.badges : [],
        });
      }
    } catch {
      // No streak data yet -- that is fine
    }

    // Fetch coins balance
    try {
      const { data: coinBal } = await supabase
        .from('coin_balances')
        .select('balance')
        .eq('student_id', student.id)
        .maybeSingle()
      setCoinsBalance(coinBal?.balance ?? 0)
    } catch (e) {
      console.warn('Failed to load coin balance:', e)
    }
  }, [student])

  const handleRedeemCoins = useCallback(async (rewardId: string) => {
    if (!student) return false
    try {
      const res = await fetch('/api/student/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: rewardId, currency: 'coins' }),
      })
      if (res.ok) {
        // Re-fetch coin balance
        const { data: coinBal } = await supabase
          .from('coin_balances')
          .select('balance')
          .eq('student_id', student.id)
          .maybeSingle()
        setCoinsBalance(coinBal?.balance ?? 0)
        await refreshStudent()
        await refreshSnapshot()
        return true
      } else {
        const errData = await res.json()
        toast.error(errData.error || (isHi ? 'त्रुटि हुई' : 'Redemption failed'))
        return false
      }
    } catch (e) {
      console.error('Redeem error:', e)
      return false
    }
  }, [student, isHi, refreshStudent, refreshSnapshot])

  useEffect(() => {
    if (student) loadData();
  }, [student, loadData]);

  // ═══ PROFILE LOCK POLICY ═══
  //
  // WHY: In India, account sharing kills the business model.
  // Tuition centers share 1 account across 30 students.
  // A student changes their name/grade and hands the phone to a friend.
  // The entire adaptive BKT model becomes useless.
  //
  // POLICY:
  // - Name: Can only be changed ONCE after signup (to fix typos).
  //   After that, locked forever. To change again, contact support.
  // - Grade: Can only change UP by 1 (natural promotion: 9 → 10).
  //   Cannot go down. Cannot skip grades. Resets learning profiles.
  // - Board: LOCKED after first quiz. Changing board mid-year is a
  //   red flag for account sharing. Must contact support.
  //
  // Everything else (language, subject, school, goal) remains editable
  // because these are preferences, not identity.
  //
  const [nameChangeCount, setNameChangeCount] = useState(0);
  const [hasQuizHistory, setHasQuizHistory] = useState(false);

  useEffect(() => {
    if (!student) return;
    // Check name change history
    const changes = student.name_change_count ?? 0;
    setNameChangeCount(changes);
    // Check if student has quiz history (board becomes locked)
    supabase
      .from('quiz_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', student.id)
      .eq('is_completed', true)
      .then(({ count }) => setHasQuizHistory((count ?? 0) > 0));
  }, [student]);

  // Derived lock states
  const isNameLocked = nameChangeCount >= 1 && student?.name === editName;
  const isNameEditable = nameChangeCount < 1;
  const isBoardLocked = hasQuizHistory;
  const isGradeLocked = false; // Grade can change up by 1

  const handleSave = async () => {
    if (!student || !editName.trim()) return;

    // VALIDATE: Name change limit
    if (editName.trim() !== student.name && nameChangeCount >= 1) {
      toast.error(isHi
        ? 'नाम पहले ही बदला जा चुका है। सहायता से संपर्क करें।'
        : 'Name has already been changed once. Contact support to change again.');
      return;
    }

    // VALIDATE: Board lock after quiz history
    if (editBoard !== student.board && hasQuizHistory) {
      toast.error(isHi
        ? 'क्विज़ इतिहास होने पर बोर्ड नहीं बदला जा सकता। सहायता से संपर्क करें।'
        : 'Board cannot be changed after taking quizzes. Contact support.');
      return;
    }

    // VALIDATE: Grade can only go up by 1 (natural promotion)
    const currentGradeNum = parseInt(student.grade);
    const newGradeNum = parseInt(editGrade);
    if (!isNaN(currentGradeNum) && !isNaN(newGradeNum)) {
      if (newGradeNum < currentGradeNum) {
        toast.error(isHi
          ? 'कक्षा कम नहीं की जा सकती। सहायता से संपर्क करें।'
          : 'Grade cannot be decreased. Contact support if this is an error.');
        return;
      }
      if (newGradeNum > currentGradeNum + 1) {
        toast.error(isHi
          ? 'कक्षा एक बार में सिर्फ 1 बढ़ा सकते हैं।'
          : 'Grade can only increase by 1 at a time (annual promotion).');
        return;
      }
    }

    setSaving(true);
    setSaved(false);
    try {
      // Track name change
      const nameChanged = editName.trim() !== student.name;
      const updatePayload: Record<string, unknown> = {
        preferred_language: editLang,
        preferred_subject: editSubject,
        school_name: editSchool.trim() || null,
        city: editCity.trim() || null,
        state: editState.trim() || null,
        academic_goal: editGoal || null,
        daily_study_hours: parseInt(editHours) || 1,
        phone: editPhone.trim() || null,
        parent_name: editParentName.trim() || null,
        parent_phone: editParentPhone.trim() || null,
        updated_at: new Date().toISOString(),
      };

      // Only include identity fields if they actually changed and are allowed
      if (nameChanged && nameChangeCount < 1) {
        updatePayload.name = editName.trim();
        updatePayload.name_change_count = (nameChangeCount || 0) + 1;
      }
      // Grade is system-managed — never allow client update
      if (editBoard !== student.board && !hasQuizHistory) {
        updatePayload.board = editBoard;
      }

      const { error } = await supabase.from('students').update(updatePayload).eq('id', student.id);

      if (error) throw error;

      // Update language in AuthContext too
      setLanguage(editLang);

      // Refresh student data in AuthContext
      await refreshStudent();
      await refreshSnapshot();

      setSaved(true);
      setTimeout(() => { setSaved(false); setTab('overview'); }, 1500);
    } catch (e) {
      console.error('Save error:', e);
      toast.error(isHi ? 'सेव करने में त्रुटि हुई' : 'Error saving profile');
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  /* ── GDPR: Export personal data as JSON ── */
  const [exporting, setExporting] = useState(false);
  const handleExportData = async () => {
    if (!student) return;
    setExporting(true);
    try {
      const [
        { data: profile },
        { data: learning },
        { data: quizzes },
        { data: mastery },
        { data: achv },
      ] = await Promise.all([
        supabase.from('students').select('*').eq('id', student.id).single(),
        supabase.from('student_learning_profiles').select('*').eq('student_id', student.id).limit(20),
        supabase.from('quiz_sessions').select('*').eq('student_id', student.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('concept_mastery').select('*').eq('student_id', student.id).order('updated_at', { ascending: false }).limit(100),
        supabase.from('student_achievements').select('*, achievements(*)').eq('student_id', student.id),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        profile,
        learning_profiles: learning ?? [],
        quiz_sessions: quizzes ?? [],
        concept_mastery: mastery ?? [],
        achievements: achv ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alfanumrik-data-${student.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      toast.error(isHi ? 'डेटा एक्सपोर्ट में त्रुटि' : 'Error exporting data');
    }
    setExporting(false);
  };

  /* ── GDPR: Delete account ── */
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = async () => {
    if (!student) return;
    setDeleting(true);
    try {
      // Delete student data via RPC (cascades to profiles, mastery, quiz sessions, etc.)
      const { error } = await supabase.rpc('delete_student_account', { p_student_id: student.id });
      if (error) throw error;
      await signOut();
      router.replace('/login');
    } catch (e) {
      console.error('Delete error:', e);
      toast.error(isHi ? 'खाता हटाने में त्रुटि। सपोर्ट से संपर्क करें।' : 'Error deleting account. Please contact support.');
      setDeleting(false);
    }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const totalXp = snapshot?.total_xp ?? student.xp_total ?? 0;
  const streak = snapshot?.current_streak ?? student.streak_days ?? 0;
  const mastered = snapshot?.topics_mastered ?? 0;
  const quizzesTaken = snapshot?.quizzes_taken ?? 0;
  const memberSince = student.created_at ? new Date(student.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';

  const TABS: { id: Tab; label: string; labelHi: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', labelHi: 'अवलोकन', icon: '👤' },
    { id: 'edit', label: 'Edit', labelHi: 'संपादन', icon: '✏️' },
    { id: 'achievements', label: 'Badges', labelHi: 'बैज', icon: '🏅' },
    { id: 'stats', label: 'Stats', labelHi: 'आँकड़े', icon: '📊' },
    { id: 'shop', label: 'Shop', labelHi: 'दुकान', icon: '🛒' },
  ];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            👤 {isHi ? 'प्रोफ़ाइल' : 'Profile'}
          </h1>
        </div>
      </header>

      <main className="app-container py-5 space-y-4">

        {/* ── Hero Banner ── */}
        <div
          className="relative rounded-3xl overflow-hidden p-6 sm:p-8"
          style={{
            background: 'linear-gradient(135deg, #FFF7F0 0%, #FFFDFB 50%, rgba(232,88,28,0.08) 100%)',
            border: '1px solid rgba(232,88,28,0.18)',
            boxShadow: '0 8px 32px rgba(232,88,28,0.08)',
          }}
        >
          {/* Radial Glow */}
          <div
            className="absolute top-0 right-0 w-64 h-64 pointer-events-none opacity-60 filter blur-2xl rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(232,88,28,0.2) 0%, transparent 70%)' }}
          />
          <div className="relative flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-5">
            {/* Avatar Ring */}
            <div className="relative flex-shrink-0">
              <div
                className="w-20 h-20 rounded-full p-[3px] animate-[pulse_3s_infinite]"
                style={{ background: 'linear-gradient(135deg, var(--orange) 0%, #F5A623 50%, #FF8C00 100%)' }}
              >
                <div className="w-full h-full rounded-full overflow-hidden bg-white flex items-center justify-center p-[2px]">
                  <Avatar name={student.name} size={76} />
                </div>
              </div>
              <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-sm" />
            </div>

            {/* Info details */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 justify-center sm:justify-start">
                <h2 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                  {student.name}
                </h2>
                <div className="flex justify-center sm:justify-start">
                  <PlanBadge planCode={student.subscription_plan} size="sm" isHi={isHi} />
                </div>
              </div>

              {/* Styled Pill Row */}
              <div className="flex flex-wrap justify-center sm:justify-start gap-1.5 mb-4 text-xs font-semibold text-[var(--text-3)]">
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)]">Grade {student.grade}</span>
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)]">{student.board ?? 'CBSE'}</span>
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)]">{isHi ? 'सदस्य' : 'Member since'} {memberSince}</span>
              </div>

              {/* Stats & StreakBadge Group */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap">
                {/* Stats chips */}
                <div className="flex items-center justify-center sm:justify-start gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-orange-50/50 border border-orange-100/70 shadow-sm transition-transform hover:scale-105 duration-200">
                    <span className="text-lg">⭐</span>
                    <div className="text-left">
                      <span className="block text-sm font-black leading-none" style={{ color: 'var(--orange)' }}>{totalXp.toLocaleString()}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">XP</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-red-50/50 border border-red-100/70 shadow-sm transition-transform hover:scale-105 duration-200">
                    <span className="text-lg">🔥</span>
                    <div className="text-left">
                      <span className="block text-sm font-black leading-none text-red-600">{streak}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">{isHi ? 'दिन' : 'Streak'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-green-50/50 border border-green-100/70 shadow-sm transition-transform hover:scale-105 duration-200">
                    <span className="text-lg">🎯</span>
                    <div className="text-left">
                      <span className="block text-sm font-black leading-none" style={{ color: 'var(--green)' }}>{mastered}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">{isHi ? 'महारत' : 'Mastered'}</span>
                    </div>
                  </div>
                </div>

                {/* Challenge / Streak Badge */}
                <div className="flex justify-center sm:justify-start items-center gap-2">
                  {challengeStreak && challengeStreak.current > 0 ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <StreakBadge streak={challengeStreak.current} badges={challengeStreak.badges} isHi={isHi} size="lg" />
                      {challengeStreak.best > 0 && (
                        <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>
                          {isHi ? `सर्वश्रेष्ठ: ${challengeStreak.best} दिन` : `Best: ${challengeStreak.best} days`}
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => router.push('/dashboard')}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all hover:opacity-90 active:scale-[0.97] border border-orange-200/50 shadow-sm"
                      style={{ color: 'var(--orange)', background: 'rgba(232,88,28,0.08)' }}
                    >
                      🔥 {isHi ? 'डेली चैलेंज शुरू करो' : 'Start Daily Challenge'}
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ── iOS Pill Tab Bar ── */}
        <div className="flex p-1 rounded-2xl gap-1 bg-gray-100 border border-gray-200/60 shadow-inner">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-0 py-2.5 px-1.5 rounded-xl text-xs font-extrabold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                tab === t.id ? 'bg-white shadow-sm border border-gray-200/50 scale-[1.01]' : 'hover:bg-gray-50/50 active:scale-[0.98]'
              }`}
              style={{
                color: tab === t.id ? 'var(--orange)' : '#6B7280',
              }}
            >
              <span className="text-sm">{t.icon}</span>
              <span className="hidden sm:inline truncate">{isHi ? t.labelHi : t.label}</span>
            </button>
          ))}
        </div>

        {/* ═══ OVERVIEW TAB ═══ */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Details Card */}
            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>📋</span>
                <span>{isHi ? 'विवरण' : 'Details'}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: '👤', l: isHi ? 'नाम' : 'Name', v: student.name },
                  { icon: '📧', l: isHi ? 'ईमेल' : 'Email', v: student.email ?? '—' },
                  { icon: '📱', l: isHi ? 'फ़ोन' : 'Phone', v: student.phone ?? '—' },
                  { icon: '🎒', l: isHi ? 'कक्षा' : 'Grade', v: `Grade ${student.grade}` },
                  { icon: '🏛️', l: isHi ? 'बोर्ड' : 'Board', v: student.board ?? 'CBSE' },
                  { icon: '🌐', l: isHi ? 'भाषा' : 'Language', v: LANGUAGES.find(la => la.code === student.preferred_language)?.label ?? student.preferred_language ?? '—' },
                  { icon: '📚', l: isHi ? 'विषय' : 'Subject', v: allowedSubjects.find(s => s.code === student.preferred_subject)?.name ?? student.preferred_subject ?? '—' },
                  { icon: '🏫', l: isHi ? 'स्कूल' : 'School', v: student.school_name ?? '—' },
                  { icon: '📍', l: isHi ? 'शहर' : 'City', v: [student.city, student.state].filter(Boolean).join(', ') || '—' },
                  { icon: '🎯', l: isHi ? 'लक्ष्य' : 'Goal', v: GOALS.find(g => g.value === student.academic_goal)?.label ?? student.academic_goal ?? '—' },
                ].map(f => (
                  <div key={f.l} className="p-3 rounded-2xl border transition-all duration-200 hover:bg-gray-50/50" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{f.icon} {f.l}</p>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{f.v}</p>
                  </div>
                ))}
              </div>
            </Card>

            {(student.parent_name || student.parent_phone) && (
              <Card className="shadow-sm hover:shadow-md transition-all duration-300">
                <p className="text-[11px] font-black uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                  <span>👨‍👩‍👧</span>
                  <span>{isHi ? 'अभिभावक' : 'Parent / Guardian'}</span>
                </p>
                <div className="divide-y divide-[var(--border)]">
                  {student.parent_name && (
                    <div className="flex justify-between items-center text-sm py-3">
                      <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'नाम' : 'Name'}</span>
                      <span className="font-bold text-[var(--text-1)]">{student.parent_name}</span>
                    </div>
                  )}
                  {student.parent_phone && (
                    <div className="flex justify-between items-center text-sm py-3">
                      <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'फ़ोन' : 'Phone'}</span>
                      <span className="font-bold text-[var(--text-1)]">{student.parent_phone}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Elevated Stats Card grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.08) 0%, rgba(232,88,28,0.02) 100%)', borderColor: 'rgba(232,88,28,0.15)' }}>
                <span className="text-2xl mb-1.5">⭐</span>
                <span className="text-2xl font-black" style={{ color: 'var(--orange)' }}>{totalXp.toLocaleString()}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">Total XP</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.02) 100%)', borderColor: 'rgba(220,38,38,0.15)' }}>
                <span className="text-2xl mb-1.5">🔥</span>
                <span className="text-2xl font-black text-red-600">{streak}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'स्ट्रीक' : 'Streak'}</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(22,163,74,0.08) 0%, rgba(22,163,74,0.02) 100%)', borderColor: 'rgba(22,163,74,0.15)' }}>
                <span className="text-2xl mb-1.5">🎯</span>
                <span className="text-2xl font-black" style={{ color: 'var(--green)' }}>{mastered}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'महारत' : 'Mastered'}</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(124,58,237,0.02) 100%)', borderColor: 'rgba(124,58,237,0.15)' }}>
                <span className="text-2xl mb-1.5">⚡</span>
                <span className="text-2xl font-black text-purple-600">{quizzesTaken}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'क्विज़' : 'Quizzes'}</span>
              </div>
            </div>

            {/* Connections Card component */}
            <ConnectionsCard studentId={student.id} isHi={isHi} />

            {/* Semantic Action Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setTab('edit')}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, var(--orange) 0%, #F5A623 100%)', boxShadow: '0 4px 16px rgba(232,88,28,0.2)' }}
              >
                ✏️ {isHi ? 'प्रोफ़ाइल संपादित करो' : 'Edit Profile'}
              </button>
              <button
                onClick={handleExportData}
                disabled={exporting}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)'
                }}
              >
                📥 {exporting ? (isHi ? 'डाउनलोड हो रहा है...' : 'Downloading...') : (isHi ? 'मेरा डेटा डाउनलोड करो' : 'Download My Data')}
              </button>
            </div>

            {/* Danger Zone at very bottom */}
            <div className="rounded-2xl p-4 border" style={{ background: 'rgba(220,38,38,0.02)', borderColor: 'rgba(220,38,38,0.12)' }}>
              <p className="text-[11px] font-black uppercase tracking-wider mb-1.5" style={{ color: '#DC2626', fontFamily: 'var(--font-display)' }}>
                ⚠️ {isHi ? 'खतरे का क्षेत्र' : 'Danger Zone'}
              </p>
              <p className="text-[10px] mb-3 leading-normal" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'यह क्रिया स्थायी है और वापस नहीं होगी।' : 'This action is permanent and cannot be undone.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleSignOut}
                  className="flex-1 py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:bg-gray-100/50 active:scale-[0.98]"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                >
                  <span>🚪</span>
                  {isHi ? 'लॉग आउट' : 'Sign Out'}
                </button>
                <button
                  onClick={() => router.push('/settings/account/delete')}
                  data-testid="profile-delete-account-link"
                  className="flex-1 py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: 'rgba(220,38,38,0.06)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.15)' }}
                >
                  <span>🗑️</span>
                  {isHi ? 'खाता हटाओ' : 'Delete Account'}
                </button>
              </div>
            </div>

            {/* Delete confirm modal (legacy defensive fallback) */}
            {showDeleteConfirm && (
              <>
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} onClick={() => setShowDeleteConfirm(false)} />
                <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 101, background: 'var(--surface-1, #fff)', borderRadius: 16, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{isHi ? '⚠️ खाता हटाना' : '⚠️ Delete Account'}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 16 }}>
                    {isHi ? 'यह आपका सारा डेटा — XP, प्रगति, बैज, और क्विज़ इतिहास — स्थायी रूप से हटा देगा। यह कार्य वापस नहीं किया जा सकता।' : 'This will permanently delete all your data — XP, progress, badges, and quiz history. This action cannot be undone.'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
                    {isHi ? 'पहले "मेरा डेटा डाउनलोड करो" से बैकअप ले लो।' : 'We recommend downloading your data first using "Download My Data".'}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button fullWidth variant="ghost" onClick={() => setShowDeleteConfirm(false)}>{isHi ? 'रद्द करो' : 'Cancel'}</Button>
                    <Button fullWidth onClick={handleDeleteAccount} disabled={deleting} style={{ background: '#DC2626', color: '#fff' }}>
                      {deleting ? (isHi ? 'हटा रहे हैं...' : 'Deleting...') : (isHi ? 'हाँ, हटाओ' : 'Yes, Delete')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ SHOP TAB ═══ */}
        {tab === 'shop' && (
          <div className="space-y-4">
            <XPRewardShop balance={coinsBalance} isHi={isHi} onRedeem={handleRedeemCoins} />
          </div>
        )}

        {/* ═══ EDIT TAB ═══ */}
        {tab === 'edit' && (
          <div className="space-y-4">
            {/* Stepper Header */}
            <div className="flex justify-between items-center px-4 py-3 bg-[var(--surface-2)] rounded-2xl border border-[var(--border)] mb-2 overflow-x-auto gap-2 scrollbar-none shadow-sm">
              {[
                { step: 1, label: isHi ? 'व्यक्तिगत' : 'Personal', icon: '📝' },
                { step: 2, label: isHi ? 'शैक्षणिक' : 'Academic', icon: '🎓' },
                { step: 3, label: isHi ? 'स्कूल' : 'School', icon: '🏫' },
                { step: 4, label: isHi ? 'अभिभावक' : 'Parent', icon: '👨‍👩‍👧' }
              ].map((s, idx) => (
                <div key={s.step} className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white bg-[var(--orange)] shadow-sm">
                    {s.step}
                  </div>
                  <span className="text-xs font-bold text-[var(--text-2)]">{s.label}</span>
                  {idx < 3 && <span className="text-[var(--text-3)] text-xs font-semibold mx-1">→</span>}
                </div>
              ))}
            </div>

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>📝</span>
                <span>{isHi ? 'व्यक्तिगत जानकारी' : 'Personal Info'}</span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 flex items-center justify-between ml-1 font-bold">
                    <span>{isHi ? 'नाम' : 'Full Name'}</span>
                    {!isNameEditable && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100/50 flex items-center gap-0.5 shadow-sm">
                        🔒 {isHi ? 'लॉक किया गया' : 'Locked'}
                      </span>
                    )}
                  </label>
                  <Input
                    value={editName}
                    onChange={e => isNameEditable ? setEditName(e.target.value) : undefined}
                    placeholder="Your name"
                    disabled={!isNameEditable}
                  />
                  {!isNameEditable && (
                    <p className="text-[10px] mt-1.5 ml-1 text-red-500 font-semibold leading-normal">
                      {isHi ? 'नाम पहले ही बदला जा चुका है। सहायता से संपर्क करें।' : 'Name has already been changed once. Contact support to change.'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'फ़ोन नंबर' : 'Phone Number'}
                  </label>
                  <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+91 98765 43210" type="tel" />
                </div>
              </div>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>🎓</span>
                <span>{isHi ? 'शैक्षणिक विवरण' : 'Academic Details'}</span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 flex items-center justify-between ml-1 font-bold">
                    <span>{isHi ? 'कक्षा' : 'Grade'}</span>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200/50 flex items-center gap-0.5 shadow-sm">
                      🔒 {isHi ? 'सिस्टम द्वारा' : 'System-managed'}
                    </span>
                  </label>
                  <div className="p-3 rounded-xl text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    Grade {editGrade}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 flex items-center justify-between ml-1 font-bold">
                    <span>{isHi ? 'बोर्ड' : 'Board'}</span>
                    {isBoardLocked && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100/50 flex items-center gap-0.5 shadow-sm">
                        🔒 {isHi ? 'लॉक किया गया' : 'Locked'}
                      </span>
                    )}
                  </label>
                  <Select value={editBoard} onChange={isBoardLocked ? () => {} : setEditBoard} options={BOARDS.map(b => ({ value: b, label: b }))} disabled={isBoardLocked} />
                  {isBoardLocked && (
                    <p className="text-[10px] mt-1.5 ml-1 text-red-500 font-semibold leading-normal">
                      {isHi ? 'क्विज़ इतिहास के बाद बोर्ड बदलना बंद है।' : 'Board locked after quiz history. Contact support to change.'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'पसंदीदा विषय' : 'Preferred Subject'}
                  </label>
                  <Select value={editSubject} onChange={setEditSubject} options={allowedSubjects.map(s => ({ value: s.code, label: `${s.icon} ${s.name}` }))} />
                  {editSubject && allowedSubjects.length > 0 && !allowedSubjects.some(s => s.code === editSubject) && (
                    <p className="text-[11px] mt-1.5 text-red-500 font-bold">
                      {isHi ? 'यह विषय अब आपकी योजना पर उपलब्ध नहीं है — कोई नया चुनें' : 'This subject is no longer available on your plan — pick a new one'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'भाषा' : 'Language'}
                  </label>
                  <Select value={editLang} onChange={setEditLang} options={LANGUAGES.map(l => ({ value: l.code, label: `${l.labelNative} (${l.label})` }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'अकादमिक लक्ष्य' : 'Academic Goal'}
                  </label>
                  <Select value={editGoal} onChange={setEditGoal} options={GOALS} />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'दैनिक अध्ययन के घंटे' : 'Daily Study Hours'}
                  </label>
                  <Select value={editHours} onChange={setEditHours} options={STUDY_HOURS} />
                </div>
              </div>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>🏫</span>
                <span>{isHi ? 'स्कूल और स्थान' : 'School & Location'}</span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'स्कूल का नाम' : 'School Name'}
                  </label>
                  <Input value={editSchool} onChange={e => setEditSchool(e.target.value)} placeholder="e.g. DPS, KV, DAV..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                      {isHi ? 'शहर' : 'City'}
                    </label>
                    <Input value={editCity} onChange={e => setEditCity(e.target.value)} placeholder="e.g. Delhi" />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                      {isHi ? 'राज्य' : 'State'}
                    </label>
                    <Input value={editState} onChange={e => setEditState(e.target.value)} placeholder="e.g. Delhi" />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>👨‍👩‍👧</span>
                <span>{isHi ? 'अभिभावक जानकारी' : 'Parent / Guardian'}</span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'अभिभावक का नाम' : 'Parent Name'}
                  </label>
                  <Input value={editParentName} onChange={e => setEditParentName(e.target.value)} placeholder="Parent's full name" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-bold">
                    {isHi ? 'अभिभावक फ़ोन' : 'Parent Phone'}
                  </label>
                  <Input value={editParentPhone} onChange={e => setEditParentPhone(e.target.value)} placeholder="+91 98765 43210" type="tel" />
                </div>
              </div>
            </Card>

            {/* Sticky Save / Cancel bar */}
            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:static bg-white/95 backdrop-blur-md p-4 border-t border-[var(--border)] -mx-5 -mb-5 sm:mx-0 sm:mb-0 sm:p-0 sm:border-0 sm:bg-transparent z-10 flex gap-3 shadow-md sm:shadow-none rounded-t-2xl sm:rounded-none">
              <button
                onClick={() => setTab('overview')}
                className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] hover:bg-gray-50 border border-gray-200"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
              >
                {isHi ? 'रद्द करो' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97]"
                style={{ background: saved ? '#16A34A' : 'linear-gradient(135deg, var(--orange) 0%, #F5A623 100%)', boxShadow: '0 4px 16px rgba(232,88,28,0.2)' }}
              >
                {saving ? (isHi ? 'सेव हो रहा...' : 'Saving...') : saved ? '✓ Saved!' : (isHi ? 'सेव करो' : 'Save Changes')}
              </button>
            </div>
          </div>
        )}

        {/* ═══ ACHIEVEMENTS TAB ═══ */}
        {tab === 'achievements' && (
          <div className="space-y-5">
            {achievements.length > 0 ? (
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                  <span>🏅</span>
                  <span>{isHi ? `अनलॉक किये (${achievements.length})` : `Unlocked (${achievements.length})`}</span>
                </p>
                <div className="grid grid-cols-3 gap-4 justify-items-center">
                  {achievements.map(sa => (
                    <div
                      key={sa.id}
                      className="flex flex-col items-center justify-center p-3 text-center relative overflow-hidden transition-all duration-300 hover:scale-105"
                      style={{
                        width: '96px',
                        height: '128px',
                      }}
                    >
                      {/* Hexagonal Background Ring with Gold Shimmer */}
                      <div
                        className="w-[76px] h-[76px] rounded-[24%] flex items-center justify-center relative shadow-md border-2 mb-2"
                        style={{
                          background: 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 50%, #FFFBEB 100%)',
                          borderColor: '#F5A623',
                          boxShadow: '0 4px 12px rgba(245,166,35,0.18), inset 0 0 8px rgba(255,255,255,0.8)',
                        }}
                      >
                        {/* Shimmer Effect overlay */}
                        <div className="absolute inset-0 opacity-20 bg-gradient-to-tr from-transparent via-white to-transparent animate-[pulse_2s_infinite]" />
                        <span className="text-3xl relative z-10 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.1)]">{sa.achievements?.icon || '🏅'}</span>
                      </div>
                      <div className="text-[10px] font-extrabold leading-tight text-[var(--text-1)] truncate w-full px-1">{sa.achievements?.title}</div>
                      <div className="text-[8px] font-black mt-1 px-1.5 py-0.5 rounded-full inline-block bg-amber-100 text-amber-800 border border-amber-200/50 shadow-2xs">
                        +{sa.achievements?.xp_reward} XP
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 rounded-3xl border shadow-sm" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                <div className="text-4xl mb-2.5 animate-bounce">🏅</div>
                <p className="text-sm font-bold text-[var(--text-2)]">{isHi ? 'अभी कोई बैज नहीं' : 'No badges yet'}</p>
                <p className="text-xs mt-1 text-[var(--text-3)]">{isHi ? 'सीखते रहो और बैज अनलॉक करो!' : 'Keep learning to unlock badges!'}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>🔒</span>
                <span>{isHi ? 'उपलब्ध बैज' : 'Available Badges'}</span>
              </p>
              <div className="space-y-2.5">
                {allAchievements.map(a => {
                  const unlocked = achievements.some(sa => sa.achievement_id === a.id);
                  return (
                    <div
                      key={a.id}
                      className="rounded-2xl p-3 flex items-center gap-3 transition-all duration-300 border hover:shadow-xs"
                      style={{
                        background: unlocked ? 'linear-gradient(135deg, rgba(245,166,35,0.06) 0%, rgba(245,166,35,0.02) 100%)' : 'var(--surface-1)',
                        borderColor: unlocked ? 'rgba(245,166,35,0.22)' : 'var(--border)',
                        opacity: unlocked ? 1 : 0.72
                      }}
                    >
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0 border shadow-xs" style={{ background: unlocked ? 'rgba(245,166,35,0.12)' : 'var(--surface-2)', borderColor: unlocked ? 'rgba(245,166,35,0.2)' : 'var(--border)' }}>
                        {unlocked ? a.icon : '🔒'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{a.title}</div>
                        <div className="text-[10px] mt-0.5 font-medium leading-none" style={{ color: 'var(--text-3)' }}>
                          {a.condition_type === 'xp_total' && `Earn ${a.condition_value} XP`}
                          {a.condition_type === 'streak_days' && `${a.condition_value}-day streak`}
                          {a.condition_type === 'sessions_count' && `Complete ${a.condition_value} sessions`}
                          {a.condition_type === 'concepts_mastered' && `Master ${a.condition_value} concepts`}
                          {a.condition_type === 'speed_answers' && `${a.condition_value} speed answers`}
                        </div>
                      </div>
                      <div className="text-xs font-black px-2.5 py-1.5 rounded-xl flex-shrink-0 text-center border shadow-3xs" style={{ background: unlocked ? 'rgba(22,163,74,0.08)' : 'var(--surface-2)', borderColor: unlocked ? 'rgba(22,163,74,0.18)' : 'var(--border)', color: unlocked ? '#16A34A' : 'var(--text-3)', minWidth: 44 }}>
                        {unlocked ? '✓' : `+${a.xp_reward}`}
                        {!unlocked && <div className="text-[8px] font-bold text-[var(--text-3)]">XP</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ═══ STATS TAB ═══ */}
        {tab === 'stats' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.08) 0%, rgba(232,88,28,0.02) 100%)', borderColor: 'rgba(232,88,28,0.15)' }}>
                <span className="text-2xl mb-1.5">⭐</span>
                <span className="text-3xl font-black" style={{ color: 'var(--orange)' }}>{totalXp.toLocaleString()}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">Total XP</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.02) 100%)', borderColor: 'rgba(220,38,38,0.15)' }}>
                <span className="text-2xl mb-1.5">🔥</span>
                <span className="text-3xl font-black text-red-600">{streak}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'स्ट्रीक' : 'Streak'}</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(22,163,74,0.08) 0%, rgba(22,163,74,0.02) 100%)', borderColor: 'rgba(22,163,74,0.15)' }}>
                <span className="text-2xl mb-1.5">🎯</span>
                <span className="text-3xl font-black" style={{ color: 'var(--green)' }}>{mastered}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'महारत' : 'Mastered'}</span>
              </div>
              <div className="rounded-2xl p-4 flex flex-col items-center text-center border transition-all duration-300 hover:scale-[1.02] hover:shadow-sm" style={{ background: 'linear-gradient(135deg, rgba(8,145,178,0.08) 0%, rgba(8,145,178,0.02) 100%)', borderColor: 'rgba(8,145,178,0.15)' }}>
                <span className="text-2xl mb-1.5">📊</span>
                <span className="text-3xl font-black" style={{ color: 'var(--teal)' }}>{snapshot?.avg_score ?? 0}%</span>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'सटीकता' : 'Accuracy'}</span>
              </div>
            </div>

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>⚡</span>
                <span>{isHi ? 'क्विज़ प्रदर्शन' : 'Quiz Performance'}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-4 text-center border bg-gray-50/40" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-3xl font-black text-purple-600">{quizStats.total}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'कुल क्विज़' : 'Total Quizzes'}</div>
                </div>
                <div className="rounded-2xl p-4 text-center border bg-gray-50/40" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-3xl font-black text-green-600">{quizStats.avgScore}%</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'औसत स्कोर' : 'Avg Score'}</div>
                </div>
                <div className="rounded-2xl p-4 text-center border bg-gray-50/40" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-3xl font-black text-orange-600">{quizStats.bestScore}%</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'सर्वश्रेष्ठ' : 'Best Score'}</div>
                </div>
                <div className="rounded-2xl p-4 text-center border bg-gray-50/40" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-3xl font-black text-blue-600">{quizStats.totalXpFromQuiz}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-1 text-[var(--text-3)]">{isHi ? 'क्विज़ XP' : 'Quiz XP'}</div>
                </div>
              </div>
            </Card>

            {profiles.length > 0 && (
              <Card className="shadow-sm hover:shadow-md transition-all duration-300">
                <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                  <span>📚</span>
                  <span>{isHi ? 'विषयवार प्रगति' : 'Subject Breakdown'}</span>
                </p>
                <div className="space-y-4">
                  {profiles.map(p => {
                    const meta = subjects.find(s => s.code === p.subject);
                    const pct = p.total_questions_asked > 0
                      ? Math.round((p.total_questions_answered_correctly / p.total_questions_asked) * 100) : 0;
                    return (
                      <div key={p.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-2xs" style={{ backgroundColor: meta?.color || 'var(--orange)' }} />
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0" style={{ background: `${meta?.color || 'var(--orange)'}18` }}>
                              {meta?.icon ?? '📚'}
                            </div>
                            <div>
                              <div className="text-sm font-black leading-tight" style={{ color: 'var(--text-1)' }}>{meta?.name ?? p.subject}</div>
                              <div className="text-[10px] font-bold text-[var(--text-3)]">Lv{p.level} · {p.xp} XP · {p.streak_days}🔥</div>
                            </div>
                          </div>
                          <span className="text-sm font-black" style={{ color: meta?.color || 'var(--orange)' }}>{pct}%</span>
                        </div>
                        <ProgressBar value={pct} color={meta?.color} height={6} label={isHi ? 'सटीकता' : 'Accuracy'} showPercent={false} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card className="shadow-sm hover:shadow-md transition-all duration-300">
              <p className="text-[11px] font-black uppercase tracking-wider mb-4 flex items-center gap-1.5" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                <span>🔐</span>
                <span>{isHi ? 'खाता' : 'Account'}</span>
              </p>
              <div className="divide-y divide-[var(--border)] text-sm">
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'सदस्य बने' : 'Member since'}</span>
                  <span className="font-bold text-[var(--text-1)]">{memberSince}</span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'योजना' : 'Plan'}</span>
                  <PlanBadge planCode={student.subscription_plan} size="md" showUpgrade isHi={isHi} />
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'बिलिंग' : 'Billing'}</span>
                  <button onClick={() => router.push('/billing')} className="text-xs font-bold px-3.5 py-1.5 rounded-xl border transition-all hover:bg-orange-50/50 active:scale-95 shadow-3xs" style={{ color: 'var(--orange)', background: 'rgba(232,88,28,0.06)', borderColor: 'rgba(232,88,28,0.18)' }}>
                    {isHi ? 'प्रबंधित करें' : 'Manage'}
                  </button>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'स्थिति' : 'Status'}</span>
                  <span className="font-bold uppercase tracking-wider text-xs" style={{ color: student.account_status === 'active' || !student.account_status ? 'var(--green)' : 'var(--orange)' }}>
                    {student.account_status ?? 'Active'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{isHi ? 'ध्वनि प्रतिक्रिया' : 'Sound Effects'}</span>
                  <SoundToggle />
                </div>
              </div>
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-[var(--text-3)] pt-4">
          Alfanumrik Learning OS v2.0 · Built with ❤️ in India
        </p>
      </main>
      <TrustFooter />
      
    </div>
  );
}
