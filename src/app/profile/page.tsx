'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getStudentProfiles, getSubjects, studentJoinClass } from '@/lib/supabase';
import { Card, Button, Input, Select, Avatar, SectionHeader, ProgressBar, StatCard, LoadingFoxy, BottomNav } from '@/components/ui';
import { GRADES, BOARDS, LANGUAGES, SUBJECT_META } from '@/lib/constants';

/* ═══ CONNECTIONS CARD: Parent Link Code + Class Join ═══ */
function ConnectionsCard({ studentId, isHi }: { studentId: string; isHi: boolean }) {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [classCode, setClassCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinResult, setJoinResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch or generate parent link code
  const fetchLinkCode = useCallback(async () => {
    setLoadingCode(true);
    try {
      // Try to get existing link code
      const { data: existing } = await supabase
        .from('guardian_student_links')
        .select('invite_code')
        .eq('student_id', studentId)
        .not('invite_code', 'is', null)
        .limit(1)
        .single();

      if (existing?.invite_code) {
        setLinkCode(existing.invite_code);
      } else {
        // Generate a new link code via RPC
        const { data, error } = await supabase.rpc('generate_parent_link_code', {
          p_student_id: studentId,
        });
        if (!error && data) setLinkCode(data);
      }
    } catch {
      // Silently fail — feature may not be available
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
    } catch (e: any) {
      setJoinResult({ ok: false, msg: e?.message || (isHi ? 'कोड अमान्य है' : 'Invalid class code') });
    }
    setJoinLoading(false);
  };

  return (
    <Card>
      <SectionHeader>{isHi ? 'कनेक्शन' : 'Connections'}</SectionHeader>

      {/* Parent Link Code */}
      <div className="mt-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
        <p className="text-xs font-semibold text-[var(--text-2)] mb-2">
          👨‍👩‍👧 {isHi ? 'पैरेंट लिंक कोड' : 'Parent Link Code'}
        </p>
        <p className="text-[10px] text-[var(--text-3)] mb-2">
          {isHi ? 'यह कोड अपने माता-पिता को दें — वे इसे पैरेंट डैशबोर्ड में दर्ज करेंगे' : 'Share this code with your parents so they can monitor your progress'}
        </p>
        {loadingCode ? (
          <p className="text-xs text-[var(--text-3)]">Loading...</p>
        ) : linkCode ? (
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-[4px] text-[var(--orange)]">{linkCode}</span>
            <button onClick={copyCode} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--surface-1)', color: copied ? 'var(--green)' : 'var(--text-2)' }}>
              {copied ? '✓' : isHi ? 'कॉपी' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-3)]">{isHi ? 'कोड उपलब्ध नहीं' : 'Code not available'}</p>
        )}
      </div>

      {/* Join Class */}
      <div className="mt-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
        <p className="text-xs font-semibold text-[var(--text-2)] mb-2">
          🏫 {isHi ? 'कक्षा में शामिल हों' : 'Join a Class'}
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            placeholder={isHi ? 'क्लास कोड दर्ज करें' : 'Enter class code'}
            value={classCode}
            onChange={e => setClassCode(e.target.value.toUpperCase())}
            maxLength={10}
            onKeyDown={e => e.key === 'Enter' && handleJoinClass()}
          />
          <button
            onClick={handleJoinClass}
            disabled={joinLoading || !classCode.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--orange)', opacity: joinLoading || !classCode.trim() ? 0.5 : 1 }}
          >
            {joinLoading ? '...' : isHi ? 'जुड़ें' : 'Join'}
          </button>
        </div>
        {joinResult && (
          <p className={`text-xs mt-2 ${joinResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {joinResult.msg}
          </p>
        )}
      </div>
    </Card>
  );
}

type Tab = 'overview' | 'edit' | 'achievements' | 'stats';

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

  const [tab, setTab] = useState<Tab>('overview');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [allAchievements, setAllAchievements] = useState<any[]>([]);
  const [quizStats, setQuizStats] = useState({ total: 0, avgScore: 0, bestScore: 0, totalXpFromQuiz: 0 });

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
    if (!isLoading && !isLoggedIn) router.replace('/');
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
      .select('score_percent, xp_earned')
      .eq('student_id', student.id)
      .eq('is_completed', true);
    if (qs && qs.length > 0) {
      const avg = Math.round(qs.reduce((a, q) => a + (q.score_percent || 0), 0) / qs.length);
      const best = Math.max(...qs.map(q => q.score_percent || 0));
      const xp = qs.reduce((a, q) => a + (q.xp_earned || 0), 0);
      setQuizStats({ total: qs.length, avgScore: avg, bestScore: best, totalXpFromQuiz: xp });
    }
  }, [student]);

  useEffect(() => {
    if (student) loadData();
  }, [student, loadData]);

  const handleSave = async () => {
    if (!student || !editName.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      const { error } = await supabase.from('students').update({
        name: editName.trim(),
        grade: editGrade,
        board: editBoard,
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
      }).eq('id', student.id);

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
      alert(isHi ? 'सेव करने में त्रुटि हुई' : 'Error saving profile');
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
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
        supabase.from('student_learning_profiles').select('*').eq('student_id', student.id),
        supabase.from('quiz_sessions').select('*').eq('student_id', student.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('concept_mastery').select('*').eq('student_id', student.id),
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
      alert(isHi ? 'डेटा एक्सपोर्ट में त्रुटि' : 'Error exporting data');
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
      router.replace('/');
    } catch (e) {
      console.error('Delete error:', e);
      alert(isHi ? 'खाता हटाने में त्रुटि। सपोर्ट से संपर्क करें।' : 'Error deleting account. Please contact support.');
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
        {/* Hero Card */}
        <Card accent="var(--orange)">
          <div className="flex items-center gap-4">
            <Avatar name={student.name} size={64} />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>{student.name}</h2>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                Grade {student.grade} · {student.board ?? 'CBSE'} · {memberSince}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm font-bold gradient-text">{totalXp.toLocaleString()} XP</span>
                <span className="text-sm font-bold">🔥 {streak}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--teal)' }}>{mastered} mastered</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Tab Switcher */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 min-w-0 py-2.5 rounded-xl text-xs font-semibold transition-all text-center"
              style={{
                background: tab === t.id ? 'rgba(232,88,28,0.1)' : 'var(--surface-2)',
                border: tab === t.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                color: tab === t.id ? 'var(--orange)' : 'var(--text-3)',
              }}
            >
              {t.icon} {isHi ? t.labelHi : t.label}
            </button>
          ))}
        </div>

        {/* ═══ OVERVIEW TAB ═══ */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <Card>
              <SectionHeader>{isHi ? 'विवरण' : 'Details'}</SectionHeader>
              <div className="space-y-3 mt-3">
                {[
                  { l: isHi ? 'नाम' : 'Name', v: student.name },
                  { l: isHi ? 'ईमेल' : 'Email', v: student.email ?? '—' },
                  { l: isHi ? 'फ़ोन' : 'Phone', v: student.phone ?? '—' },
                  { l: isHi ? 'कक्षा' : 'Grade', v: `Grade ${student.grade}` },
                  { l: isHi ? 'बोर्ड' : 'Board', v: student.board ?? 'CBSE' },
                  { l: isHi ? 'भाषा' : 'Language', v: LANGUAGES.find(la => la.code === student.preferred_language)?.label ?? student.preferred_language },
                  { l: isHi ? 'पसंदीदा विषय' : 'Preferred Subject', v: SUBJECT_META.find(s => s.code === student.preferred_subject)?.name ?? student.preferred_subject ?? '—' },
                  { l: isHi ? 'स्कूल' : 'School', v: student.school_name ?? '—' },
                  { l: isHi ? 'शहर' : 'City', v: [student.city, student.state].filter(Boolean).join(', ') || '—' },
                  { l: isHi ? 'लक्ष्य' : 'Academic Goal', v: GOALS.find(g => g.value === student.academic_goal)?.label ?? student.academic_goal ?? '—' },
                  { l: isHi ? 'रोज़ पढ़ाई' : 'Daily Study', v: `${student.daily_study_hours ?? 1} ${isHi ? 'घंटे' : 'hours'}` },
                ].map(f => (
                  <div key={f.l} className="flex justify-between items-center text-sm">
                    <span className="text-[var(--text-3)]">{f.l}</span>
                    <span className="font-medium text-right max-w-[60%] truncate">{f.v}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Parent Info */}
            {(student.parent_name || student.parent_phone) && (
              <Card>
                <SectionHeader>{isHi ? 'अभिभावक' : 'Parent / Guardian'}</SectionHeader>
                <div className="space-y-2 mt-3">
                  {student.parent_name && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[var(--text-3)]">{isHi ? 'नाम' : 'Name'}</span>
                      <span className="font-medium">{student.parent_name}</span>
                    </div>
                  )}
                  {student.parent_phone && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[var(--text-3)]">{isHi ? 'फ़ोन' : 'Phone'}</span>
                      <span className="font-medium">{student.parent_phone}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Quick Stats */}
            <div className="grid-stats">
              <StatCard icon="⭐" value={totalXp.toLocaleString()} label="Total XP" color="var(--orange)" />
              <StatCard icon="🔥" value={streak} label={isHi ? 'स्ट्रीक' : 'Streak'} color="#DC2626" />
              <StatCard icon="🎯" value={mastered} label={isHi ? 'महारत' : 'Mastered'} color="var(--green)" />
              <StatCard icon="⚡" value={quizzesTaken} label={isHi ? 'क्विज़' : 'Quizzes'} color="var(--purple)" />
            </div>

            {/* Connections: Parent Link Code & Class Join */}
            <ConnectionsCard studentId={student.id} isHi={isHi} />

            <Button fullWidth variant="ghost" onClick={() => setTab('edit')}>
              ✏️ {isHi ? 'प्रोफ़ाइल संपादित करो' : 'Edit Profile'}
            </Button>

            <div className="pt-2 space-y-2">
              <Button fullWidth variant="ghost" onClick={handleExportData} disabled={exporting}>
                📥 {exporting
                  ? (isHi ? 'एक्सपोर्ट हो रहा है...' : 'Exporting...')
                  : (isHi ? 'मेरा डेटा डाउनलोड करो' : 'Download My Data')}
              </Button>
              <Button fullWidth variant="ghost" onClick={handleSignOut}>
                {isHi ? 'लॉग आउट' : 'Sign Out'}
              </Button>
              <Button
                fullWidth
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                style={{ color: '#DC2626' }}
              >
                🗑️ {isHi ? 'खाता हटाओ' : 'Delete Account'}
              </Button>
            </div>

            {/* Delete Account Confirmation Modal */}
            {showDeleteConfirm && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }}
                  onClick={() => setShowDeleteConfirm(false)}
                />
                <div
                  style={{
                    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 101, background: 'var(--surface-1, #fff)', borderRadius: 16,
                    padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                  }}
                >
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'var(--font-display)' }}>
                    {isHi ? '⚠️ खाता हटाना' : '⚠️ Delete Account'}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 16 }}>
                    {isHi
                      ? 'यह आपका सारा डेटा — XP, प्रगति, बैज, और क्विज़ इतिहास — स्थायी रूप से हटा देगा। यह कार्य वापस नहीं किया जा सकता।'
                      : 'This will permanently delete all your data — XP, progress, badges, and quiz history. This action cannot be undone.'}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
                    {isHi ? 'पहले "मेरा डेटा डाउनलोड करो" से बैकअप ले लो।' : 'We recommend downloading your data first using "Download My Data".'}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button fullWidth variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                      {isHi ? 'रद्द करो' : 'Cancel'}
                    </Button>
                    <Button
                      fullWidth
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                      style={{ background: '#DC2626', color: '#fff' }}
                    >
                      {deleting
                        ? (isHi ? 'हटा रहे हैं...' : 'Deleting...')
                        : (isHi ? 'हाँ, हटाओ' : 'Yes, Delete')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ EDIT TAB ═══ */}
        {tab === 'edit' && (
          <div className="space-y-4">
            <Card>
              <SectionHeader icon="📝">{isHi ? 'व्यक्तिगत जानकारी' : 'Personal Info'}</SectionHeader>
              <div className="space-y-3 mt-3">
                <Input label={isHi ? 'नाम' : 'Full Name'} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Your name" />
                <Input label={isHi ? 'फ़ोन' : 'Phone Number'} value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+91 98765 43210" type="tel" />
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🎓">{isHi ? 'शैक्षणिक विवरण' : 'Academic Details'}</SectionHeader>
              <div className="space-y-3 mt-3">
                <Select
                  label={isHi ? 'कक्षा' : 'Grade'}
                  value={editGrade}
                  onChange={setEditGrade}
                  options={GRADES.map(g => ({ value: g, label: `Grade ${g}` }))}
                />
                <Select
                  label={isHi ? 'बोर्ड' : 'Board'}
                  value={editBoard}
                  onChange={setEditBoard}
                  options={BOARDS.map(b => ({ value: b, label: b }))}
                />
                <Select
                  label={isHi ? 'पसंदीदा विषय' : 'Preferred Subject'}
                  value={editSubject}
                  onChange={setEditSubject}
                  options={SUBJECT_META.map(s => ({ value: s.code, label: `${s.icon} ${s.name}` }))}
                />
                <Select
                  label={isHi ? 'भाषा' : 'Language'}
                  value={editLang}
                  onChange={setEditLang}
                  options={LANGUAGES.map(l => ({ value: l.code, label: `${l.labelNative} (${l.label})` }))}
                />
                <Select
                  label={isHi ? 'लक्ष्य' : 'Academic Goal'}
                  value={editGoal}
                  onChange={setEditGoal}
                  options={GOALS}
                />
                <Select
                  label={isHi ? 'रोज़ पढ़ाई' : 'Daily Study Hours'}
                  value={editHours}
                  onChange={setEditHours}
                  options={STUDY_HOURS}
                />
              </div>
            </Card>

            <Card>
              <SectionHeader icon="🏫">{isHi ? 'स्कूल और शहर' : 'School & Location'}</SectionHeader>
              <div className="space-y-3 mt-3">
                <Input label={isHi ? 'स्कूल का नाम' : 'School Name'} value={editSchool} onChange={e => setEditSchool(e.target.value)} placeholder="e.g. DPS, KV, DAV..." />
                <div className="grid grid-cols-2 gap-3">
                  <Input label={isHi ? 'शहर' : 'City'} value={editCity} onChange={e => setEditCity(e.target.value)} placeholder="e.g. Delhi" />
                  <Input label={isHi ? 'राज्य' : 'State'} value={editState} onChange={e => setEditState(e.target.value)} placeholder="e.g. Delhi" />
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeader icon="👨‍👩‍👧">{isHi ? 'अभिभावक जानकारी' : 'Parent / Guardian'}</SectionHeader>
              <div className="space-y-3 mt-3">
                <Input label={isHi ? 'अभिभावक का नाम' : 'Parent Name'} value={editParentName} onChange={e => setEditParentName(e.target.value)} placeholder="Parent's full name" />
                <Input label={isHi ? 'अभिभावक फ़ोन' : 'Parent Phone'} value={editParentPhone} onChange={e => setEditParentPhone(e.target.value)} placeholder="+91 98765 43210" type="tel" />
              </div>
            </Card>

            <div className="flex gap-3">
              <Button fullWidth variant="ghost" onClick={() => setTab('overview')}>
                {isHi ? 'रद्द करो' : 'Cancel'}
              </Button>
              <Button fullWidth onClick={handleSave} color="var(--orange)">
                {saving ? (isHi ? 'सेव हो रहा...' : 'Saving...') : saved ? '✓ Saved!' : (isHi ? 'सेव करो' : 'Save Changes')}
              </Button>
            </div>
          </div>
        )}

        {/* ═══ ACHIEVEMENTS TAB ═══ */}
        {tab === 'achievements' && (
          <div className="space-y-4">
            {/* Unlocked */}
            {achievements.length > 0 && (
              <div>
                <SectionHeader icon="🏅">{isHi ? `अनलॉक किये (${achievements.length})` : `Unlocked (${achievements.length})`}</SectionHeader>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {achievements.map(sa => (
                    <div
                      key={sa.id}
                      className="rounded-2xl p-3 text-center"
                      style={{ background: 'var(--surface-1)', border: '1.5px solid rgba(245,166,35,0.3)' }}
                    >
                      <div className="text-2xl mb-1">{sa.achievements?.icon || '🏅'}</div>
                      <div className="text-[10px] font-bold truncate">{sa.achievements?.title}</div>
                      <div className="text-[10px] text-[var(--text-3)]">+{sa.achievements?.xp_reward} XP</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Locked / Available */}
            <div>
              <SectionHeader icon="🔒">{isHi ? 'उपलब्ध बैज' : 'Available Badges'}</SectionHeader>
              <div className="space-y-2 mt-2">
                {allAchievements.map(a => {
                  const unlocked = achievements.some(sa => sa.achievement_id === a.id);
                  return (
                    <div
                      key={a.id}
                      className="rounded-xl p-3 flex items-center gap-3"
                      style={{
                        background: unlocked ? 'rgba(245,166,35,0.06)' : 'var(--surface-1)',
                        border: `1px solid ${unlocked ? 'rgba(245,166,35,0.2)' : 'var(--border)'}`,
                        opacity: unlocked ? 1 : 0.6,
                      }}
                    >
                      <span className="text-xl w-8 text-center">{unlocked ? a.icon : '🔒'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{a.title}</div>
                        <div className="text-[10px] text-[var(--text-3)]">
                          {a.condition_type === 'xp_total' && `Earn ${a.condition_value} XP`}
                          {a.condition_type === 'streak_days' && `${a.condition_value}-day streak`}
                          {a.condition_type === 'sessions_count' && `Complete ${a.condition_value} sessions`}
                          {a.condition_type === 'concepts_mastered' && `Master ${a.condition_value} concepts`}
                          {a.condition_type === 'speed_answers' && `${a.condition_value} speed answers`}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-bold" style={{ color: unlocked ? 'var(--orange)' : 'var(--text-3)' }}>
                          {unlocked ? '✓' : `+${a.xp_reward}`}
                        </div>
                        <div className="text-[10px] text-[var(--text-3)]">XP</div>
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
            {/* Overall Stats */}
            <div className="grid-stats">
              <StatCard icon="⭐" value={totalXp.toLocaleString()} label="Total XP" color="var(--orange)" />
              <StatCard icon="🔥" value={streak} label={isHi ? 'स्ट्रीक' : 'Streak'} color="#DC2626" />
              <StatCard icon="🎯" value={mastered} label={isHi ? 'महारत' : 'Mastered'} color="var(--green)" />
              <StatCard icon="📊" value={`${snapshot?.avg_score ?? 0}%`} label={isHi ? 'सटीकता' : 'Accuracy'} color="var(--teal)" />
            </div>

            {/* Quiz Performance */}
            <Card>
              <SectionHeader icon="⚡">{isHi ? 'क्विज़ प्रदर्शन' : 'Quiz Performance'}</SectionHeader>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--purple)' }}>{quizStats.total}</div>
                  <div className="text-[10px] text-[var(--text-3)] font-medium">{isHi ? 'कुल क्विज़' : 'Total Quizzes'}</div>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{quizStats.avgScore}%</div>
                  <div className="text-[10px] text-[var(--text-3)] font-medium">{isHi ? 'औसत स्कोर' : 'Avg Score'}</div>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--orange)' }}>{quizStats.bestScore}%</div>
                  <div className="text-[10px] text-[var(--text-3)] font-medium">{isHi ? 'सर्वश्रेष्ठ' : 'Best Score'}</div>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
                  <div className="text-2xl font-bold gradient-text">{quizStats.totalXpFromQuiz}</div>
                  <div className="text-[10px] text-[var(--text-3)] font-medium">{isHi ? 'क्विज़ XP' : 'Quiz XP'}</div>
                </div>
              </div>
            </Card>

            {/* Subject Breakdown */}
            {profiles.length > 0 && (
              <Card>
                <SectionHeader icon="📚">{isHi ? 'विषयवार प्रगति' : 'Subject Breakdown'}</SectionHeader>
                <div className="space-y-3 mt-3">
                  {profiles.map(p => {
                    const meta = subjects.find(s => s.code === p.subject);
                    const pct = p.total_questions_asked > 0
                      ? Math.round((p.total_questions_answered_correctly / p.total_questions_asked) * 100) : 0;
                    return (
                      <div key={p.id}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{meta?.icon ?? '📚'}</span>
                            <span className="text-xs font-semibold">{meta?.name ?? p.subject}</span>
                          </div>
                          <div className="text-xs text-[var(--text-3)]">
                            Lv{p.level} · {p.xp} XP · {p.streak_days}🔥
                          </div>
                        </div>
                        <ProgressBar value={pct} color={meta?.color} height={6} label={isHi ? 'सटीकता' : 'Accuracy'} showPercent />
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Account Info */}
            <Card>
              <SectionHeader icon="🔐">{isHi ? 'खाता' : 'Account'}</SectionHeader>
              <div className="space-y-2 mt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">{isHi ? 'सदस्य बने' : 'Member since'}</span>
                  <span className="font-medium">{memberSince}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">{isHi ? 'योजना' : 'Plan'}</span>
                  <span className="font-medium capitalize">{student.subscription_plan ?? 'Free'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">{isHi ? 'स्थिति' : 'Status'}</span>
                  <span className="font-medium" style={{ color: 'var(--green)' }}>{student.account_status ?? 'Active'}</span>
                </div>
              </div>
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-[var(--text-3)] pt-4">
          Alfanumrik Learning OS v2.0 · Built with ❤️ in India
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
