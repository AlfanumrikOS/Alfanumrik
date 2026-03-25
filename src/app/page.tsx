'use client';

import { useState, useEffect, useRef, useCallback, memo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUBJECT_META } from '@/lib/constants';
import { validatePassword } from '@/lib/sanitize';
import { BottomNav } from '@/components/ui';

/* ══════════════════════════════════════════════════════════════
   SUBJECT CONFIGURATION
   ══════════════════════════════════════════════════════════════ */

interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

const SUBJECTS: Record<string, SubjectConfig> = {
  math: { name: 'Mathematics', icon: '∑', color: '#3B82F6' },
  science: { name: 'Science', icon: '⚛', color: '#10B981' },
  english: { name: 'English', icon: 'Aa', color: '#8B5CF6' },
  hindi: { name: 'Hindi', icon: 'अ', color: '#F59E0B' },
  physics: { name: 'Physics', icon: '⚡', color: '#EF4444' },
  chemistry: { name: 'Chemistry', icon: '⚗', color: '#06B6D4' },
  biology: { name: 'Biology', icon: '⚕', color: '#22C55E' },
  social_studies: { name: 'Social Studies', icon: '🌍', color: '#D97706' },
  coding: { name: 'Coding', icon: '💻', color: '#6366F1' },
};

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'HI' },
  { code: 'hinglish', label: 'Hing' },
];

const MODES = [
  { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो', autoPrompt: (topic: string) => topic ? `Teach me about: ${topic}` : 'Teach me the next concept step by step', autoPromptHi: (topic: string) => topic ? `मुझे सिखाओ: ${topic}` : 'मुझे अगला कॉन्सेप्ट सिखाओ' },
  { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास', autoPrompt: (topic: string) => topic ? `Give me 3 practice problems on: ${topic}` : 'Give me practice problems to solve', autoPromptHi: (topic: string) => topic ? `मुझे 3 अभ्यास प्रश्न दो: ${topic}` : 'मुझे अभ्यास प्रश्न दो' },
  { id: 'quiz', emoji: '⚡', label: 'Quiz', labelHi: 'क्विज़', autoPrompt: (topic: string) => topic ? `Quiz me on: ${topic} (5 MCQ questions, board exam pattern)` : 'Quiz me with 5 MCQ questions on this chapter', autoPromptHi: (topic: string) => topic ? `मुझसे क्विज़ लो: ${topic} (5 MCQ प्रश्न, बोर्ड परीक्षा पैटर्न)` : 'मुझसे 5 MCQ प्रश्न पूछो' },
  { id: 'doubt', emoji: '❓', label: 'Doubt', labelHi: 'डाउट', autoPrompt: () => '', autoPromptHi: () => '' },
  { id: 'revision', emoji: '🔄', label: 'Revise', labelHi: 'रिवीज़', autoPrompt: (topic: string) => topic ? `Give me a quick revision summary of: ${topic}` : 'Summarize the key points for revision', autoPromptHi: (topic: string) => topic ? `${topic} का त्वरित पुनरावृत्ति सारांश दो` : 'रिवीज़न के लिए मुख्य बिंदु बताओ' },
  { id: 'notes', emoji: '📝', label: 'Notes', labelHi: 'नोट्स', autoPrompt: (topic: string) => topic ? `Create concise exam notes for: ${topic}` : 'Create exam-ready notes for this chapter', autoPromptHi: (topic: string) => topic ? `${topic} के लिए परीक्षा नोट्स बनाओ` : 'इस अध्याय के परीक्षा नोट्स बनाओ' },
];

const MATH_SYMBOL_TABS = [
  { id: 'basic', label: 'Basic', emoji: '±', symbols: ['±', '×', '÷', '≠', '≈', '√', '²', '³', '∞', 'π'] },
  { id: 'algebra', label: 'Algebra', emoji: '∈', symbols: ['≤', '≥', '<', '>', '∈', '∉', '∪', '∩', '∅', '⊆'] },
  { id: 'calculus', label: 'Calc', emoji: '∫', symbols: ['∫', '∂', '∑', '∏', 'Δ', '∇', 'dx', 'dy', 'lim', '∞'] },
  { id: 'greek', label: 'Greek', emoji: 'α', symbols: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'σ', 'ω'] },
  { id: 'arrows', label: 'Arrows', emoji: '→', symbols: ['→', '←', '⇒', '⇔', '↑', '↓', '⇌', '∝'] },
  { id: 'science', label: 'Sci', emoji: '⚛', symbols: ['℃', '°', 'Ω', 'Å', 'mol', 'pH', 'atm', 'eV', 'Pa', 'Hz'] },
  { id: 'geometry', label: 'Geo', emoji: '∠', symbols: ['∠', '⊥', '∥', '△', '○', '°', 'π', 'r²'] },
  { id: 'super', label: 'Sup', emoji: 'x²', symbols: ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'] },
  { id: 'sub', label: 'Sub', emoji: 'x₂', symbols: ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'] },
];

const FOXY_FACES: Record<string, string> = { idle: '🦊', thinking: '🤔', happy: '😄' };

const MASTERY_COLORS: Record<string, string> = {
  not_started: '#9ca3af', beginner: '#F59E0B', developing: '#3B82F6', proficient: '#8B5CF6', mastered: '#10B981',
};

function getGradeSubjects(grade: string): string[] {
  const g = parseInt(grade) || 9;
  if (g <= 10) return ['math', 'science', 'english', 'hindi', 'social_studies'];
  return ['physics', 'chemistry', 'biology', 'math', 'english'];
}

/* ══════════════════════════════════════════════════════════════
   API HELPERS — uses shared Supabase client, no hardcoded creds
   ══════════════════════════════════════════════════════════════ */

async function fetchTopics(subjectCode: string, grade: string): Promise<any[]> {
  const { data: subjectRow } = await supabase.from('subjects').select('id').eq('code', subjectCode).eq('is_active', true).single();
  let query = supabase.from('curriculum_topics').select('*').is('parent_topic_id', null).eq('is_active', true).order('chapter_number').order('display_order').limit(80);
  query = query.or(`grade.eq.Grade ${grade},grade.eq.${grade}`);
  if (subjectRow?.id) query = query.eq('subject_id', subjectRow.id);
  const { data } = await query;
  return data ?? [];
}

async function fetchMastery(studentId: string, subject: string): Promise<any[]> {
  const { data } = await supabase.from('topic_mastery').select('*').eq('student_id', studentId).eq('subject', subject).order('updated_at', { ascending: false }).limit(50);
  return data ?? [];
}

async function fetchChatHistory(studentId: string) {
  const { data } = await supabase.from('chat_sessions').select('id, messages').eq('student_id', studentId).order('updated_at', { ascending: false }).limit(1);
  if (data && data[0]?.messages?.length > 0) return data[0];
  return null;
}

async function callFoxyTutor(params: Record<string, any>) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return { reply: data.reply || data.response || data.message || 'Let me think...', xp_earned: data.xp_earned || 0, session_id: data.session_id || null };
  } catch {
    return { reply: 'Connection issue. Check your network and try again!', xp_earned: 0, session_id: null };
  }
}

/* ══════════════════════════════════════════════════════════════
   RICH TEXT RENDERER
   ══════════════════════════════════════════════════════════════ */

function cleanMd(t: string): string {
  return t.replace(/\*\*([^*]+)\*\*/g, '[KEY: $1]').replace(/__([^_]+)__/g, '[KEY: $1]').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/`([^`]+)`/g, '[FORMULA: $1]').replace(/^#{1,4}\s+/gm, '');
}

function renderInline(text: string, color: string): ReactNode {
  const clean = cleanMd(text);
  const parts: ReactNode[] = [];
  const re = /\[(KEY|ANS|FORMULA|TIP|MARKS):\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null, last = 0, k = 0;

  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{clean.substring(last, m.index)}</span>);
    const [, tag, val] = m;
    if (tag === 'KEY') parts.push(<span key={k++} className="font-bold" style={{ color, borderBottom: `2px solid ${color}40`, paddingBottom: 1 }}>{val}</span>);
    else if (tag === 'ANS') parts.push(<span key={k++} className="inline-block px-3 py-1 my-1 rounded-lg font-extrabold text-sm" style={{ border: `2px solid ${color}`, color, background: `${color}08` }}>{val}</span>);
    else if (tag === 'FORMULA') parts.push(<code key={k++} className="inline-block px-3 py-1.5 my-1 rounded-lg font-semibold text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{val}</code>);
    else if (tag === 'TIP') parts.push(<div key={k++} className="my-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fffbeb', border: '1px solid #f59e0b30', color: '#92400e' }}><span className="font-extrabold">Exam Tip: </span>{val}</div>);
    else if (tag === 'MARKS') parts.push(<span key={k++} className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold ml-1" style={{ background: '#7c3aed15', color: '#7c3aed' }}>({val} marks)</span>);
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push(<span key={k++}>{clean.substring(last)}</span>);
  return parts.length > 0 ? <>{parts}</> : <span>{clean}</span>;
}

const RichContent = memo(function RichContent({ content, subjectKey }: { content: string; subjectKey: string }) {
  const cfg = SUBJECTS[subjectKey] || SUBJECTS.science;
  if (!content) return null;
  const text = cleanMd(content);
  const lines = text.split('\n');
  const els: ReactNode[] = [];
  let li: string[] = [], lk: 'num' | 'bul' | null = null;

  function flush() {
    if (li.length === 0) return;
    els.push(
      <div key={`l${els.length}`} className="my-3 px-4 py-3 rounded-r-xl" style={{ background: `${cfg.color}08`, borderLeft: `3px solid ${cfg.color}` }}>
        {li.map((item, i) => (
          <div key={i} className="flex gap-2.5 py-1.5 items-start" style={{ borderBottom: i < li.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${cfg.color}20`, color: cfg.color }}>{lk === 'num' ? i + 1 : '•'}</span>
            <span className="leading-relaxed">{renderInline(item, cfg.color)}</span>
          </div>
        ))}
      </div>
    );
    li = []; lk = null;
  }

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('###')) { flush(); els.push(<h4 key={idx} className="text-sm font-bold mt-4 mb-2 uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.icon} {t.replace(/^###\s*/, '')}</h4>); }
    else if (t.startsWith('##')) { flush(); els.push(<h3 key={idx} className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>{t.replace(/^##\s*/, '')}</h3>); }
    else if (t.startsWith('>')) { flush(); els.push(<div key={idx} className="my-3 px-4 py-3 rounded-xl text-sm leading-relaxed" style={{ background: `${cfg.color}08`, border: `1px solid ${cfg.color}25` }}>{renderInline(t.replace(/^>\s*/, ''), cfg.color)}</div>); }
    else if (/^\d+[.)]\s/.test(t)) { if (lk !== 'num') { flush(); lk = 'num'; } li.push(t.replace(/^\d+[.)]\s*/, '')); }
    else if (/^[-•*]\s/.test(t)) { if (lk !== 'bul') { flush(); lk = 'bul'; } li.push(t.replace(/^[-•*]\s*/, '')); }
    else if (!t) { flush(); els.push(<div key={idx} className="h-2" />); }
    else { flush(); els.push(<p key={idx} className="my-1.5 leading-[1.75] text-[var(--text-2)]">{renderInline(t, cfg.color)}</p>); }
  });
  flush();
  return <div>{els}</div>;
});

/* ══════════════════════════════════════════════════════════════
   CHAT INPUT COMPONENT
   ══════════════════════════════════════════════════════════════ */

function ChatInput({ onSubmit, subjectKey, disabled, onMicTap, isListening }: {
  onSubmit: (t: string) => void; subjectKey: string; disabled: boolean; onMicTap?: () => void; isListening?: boolean;
}) {
  const [text, setText] = useState('');
  const [showSymbols, setShowSymbols] = useState(false);
  const [symTab, setSymTab] = useState('basic');
  const [pointMode, setPointMode] = useState(false);
  const [pointCount, setPointCount] = useState(1);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cfg = SUBJECTS[subjectKey] || SUBJECTS.science;

  const insertAt = (s: string) => {
    const ta = taRef.current; if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    setText(text.substring(0, start) + s + text.substring(end));
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + s.length; }, 0);
  };

  const send = () => {
    if (!text.trim() || disabled) return;
    onSubmit(text.trim()); setText(''); setPointCount(1); setPointMode(false);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Enter' && e.shiftKey && pointMode) { e.preventDefault(); const n = pointCount + 1; insertAt(`\n${n}. `); setPointCount(n); }
  };

  const togglePoints = () => {
    if (!pointMode) {
      if (!text.trim()) { setText('1. '); setPointCount(1); }
      else if (!text.startsWith('1.')) { setText(`1. ${text}`); setPointCount(1); }
      setPointMode(true);
      setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } }, 0);
    } else setPointMode(false);
  };

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const syms = MATH_SYMBOL_TABS.find(t => t.id === symTab)?.symbols ?? MATH_SYMBOL_TABS[0].symbols;

  return (
    <div className="border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      {showSymbols && (
        <div className="px-3 pt-2 pb-1">
          <div className="flex gap-1 overflow-x-auto mb-2" style={{ scrollbarWidth: 'none' }}>
            {MATH_SYMBOL_TABS.map(tab => (
              <button key={tab.id} onClick={() => setSymTab(tab.id)} className="shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                style={{ background: symTab === tab.id ? `${cfg.color}15` : 'transparent', color: symTab === tab.id ? cfg.color : 'var(--text-3)', border: symTab === tab.id ? `1px solid ${cfg.color}30` : '1px solid transparent' }}>
                <span className="text-sm mr-0.5">{tab.emoji}</span> {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {syms.map((s, i) => (
              <button key={i} onClick={() => insertAt(s)} className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold transition-all active:scale-90"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <button onClick={() => setShowSymbols(!showSymbols)} className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: showSymbols ? `${cfg.color}15` : 'var(--surface-2)', color: showSymbols ? cfg.color : 'var(--text-3)', border: `1px solid ${showSymbols ? `${cfg.color}30` : 'var(--border)'}` }}>
          {showSymbols ? '× Close' : 'fx Math'}
        </button>
        <button onClick={togglePoints} className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: pointMode ? `${cfg.color}15` : 'var(--surface-2)', color: pointMode ? cfg.color : 'var(--text-3)', border: `1px solid ${pointMode ? `${cfg.color}30` : 'var(--border)'}` }}>
          {pointMode ? '1. ON' : '1. Points'}
        </button>
        <span className="flex-1" />
        <span className="text-[9px] text-[var(--text-3)] hidden sm:inline">Enter = send · Shift+Enter = new line</span>
      </div>
      <div className="px-3 py-2 flex items-end gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)' }}>
        <textarea ref={taRef} value={text} onChange={autoGrow} onKeyDown={handleKey}
          placeholder={pointMode ? '1. Write your answer point by point...\n(Shift+Enter for next point)' : 'Ask Foxy anything... (Shift+Enter for new line)'}
          rows={pointMode ? 3 : 1} className="flex-1 text-sm rounded-2xl px-4 py-2.5 resize-none outline-none leading-relaxed"
          style={{ background: 'var(--surface-2)', border: `1.5px solid ${pointMode ? `${cfg.color}40` : 'var(--border)'}`, fontFamily: 'var(--font-body)', maxHeight: 200, minHeight: pointMode ? 80 : 40 }} />
        {onMicTap && (
          <button onClick={onMicTap} className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all active:scale-90"
            style={{ background: isListening ? '#EF444420' : 'var(--surface-2)', border: isListening ? '2px solid #EF4444' : '1.5px solid var(--border)' }}>
            {isListening ? '🔴' : '🎤'}
          </button>
        )}
        <button onClick={send} disabled={disabled || !text.trim()}
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-all active:scale-90 disabled:opacity-40"
          style={{ background: text.trim() ? `linear-gradient(135deg, ${cfg.color}, ${cfg.color}dd)` : 'var(--surface-2)', color: text.trim() ? '#fff' : 'var(--text-3)' }}>
          {disabled ? '...' : '↑'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   AUTH SCREEN — Login / Signup / Forgot Password
   ══════════════════════════════════════════════════════════════ */

const AUTH_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const AUTH_BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'];

function AuthScreen({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'check-email'>('login');
  const [roleTab, setRoleTab] = useState<'student' | 'teacher' | 'parent'>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('9');
  const [board, setBoard] = useState('CBSE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Teacher fields
  const [schoolName, setSchoolName] = useState('');
  const [subjectsTaught, setSubjectsTaught] = useState<string[]>([]);
  const [gradesTaught, setGradesTaught] = useState<string[]>([]);

  // Student age / parental consent fields
  const [studentAgeRange, setStudentAgeRange] = useState<'13-18' | '10-12'>('13-18');
  const [parentEmail, setParentEmail] = useState('');
  const [parentConsent, setParentConsent] = useState(false);

  // Parent fields
  const [phone, setPhone] = useState('');
  const [linkCode, setLinkCode] = useState('');

  // Email verification pending
  const [pendingEmail, setPendingEmail] = useState('');
  const [consentData, setConsentData] = useState(false);
  const [consentAnalytics, setConsentAnalytics] = useState(false);

  const TEACHER_SUBJECTS = SUBJECT_META.filter(s =>
    ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi'].includes(s.code)
  );
  const TEACHER_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

  const toggleSubject = (code: string) => {
    setSubjectsTaught(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };
  const toggleGradeTaught = (g: string) => {
    setGradesTaught(prev => prev.includes(g) ? prev.filter(c => c !== g) : [...prev, g]);
  };

  const ROLE_TABS = [
    { key: 'student' as const, label: 'Student', emoji: '\uD83C\uDF93', color: '#E8590C' },
    { key: 'teacher' as const, label: 'Teacher', emoji: '\uD83D\uDC69\u200D\uD83C\uDFEB', color: '#2563EB' },
    { key: 'parent' as const, label: 'Parent', emoji: '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67', color: '#16A34A' },
  ];

  const activeRoleColor = ROLE_TABS.find(r => r.key === roleTab)?.color ?? '#E8590C';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) { setError(authError.message); setLoading(false); return; }
      onSuccess();
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name'); return; }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }

    if (roleTab === 'teacher') {
      if (!schoolName.trim()) { setError('Please enter your school name'); return; }
      if (subjectsTaught.length === 0) { setError('Please select at least one subject'); return; }
      if (gradesTaught.length === 0) { setError('Please select at least one grade'); return; }
    }

    if (roleTab === 'student' && studentAgeRange === '10-12') {
      if (!parentEmail.trim()) { setError('Parent/guardian email is required for students under 13'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim())) { setError('Please enter a valid parent/guardian email'); return; }
      if (!parentConsent) { setError('Please confirm parental consent to continue'); return; }
    }

    if (!consentData) { setError('Please consent to data processing to continue'); return; }

    setError(''); setLoading(true);
    try {
      const metaData: Record<string, string> = { name: name.trim(), role: roleTab, consent_data: 'true', consent_analytics: consentAnalytics ? 'true' : 'false' };
      if (roleTab === 'student') {
        metaData.grade = grade;
        metaData.board = board;
        if (studentAgeRange === '10-12') {
          metaData.is_minor = 'true';
          metaData.parent_consent_email = parentEmail.trim();
        }
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: metaData,
          emailRedirectTo: `${window.location.origin}/auth/callback?type=signup`,
        },
      });
      if (authError) { setError(authError.message); setLoading(false); return; }
      if (authData.user) {
        let profileError: string | null = null;

        if (roleTab === 'student') {
          const { error: insErr } = await supabase.from('students').insert({
            auth_user_id: authData.user.id,
            name: name.trim(),
            email: email.trim(),
            grade: `Grade ${grade}`,
            board,
            preferred_language: 'en',
            account_status: 'active',
          });
          if (insErr) profileError = insErr.message;
        } else if (roleTab === 'teacher') {
          const { error: insErr } = await supabase.from('teachers').insert({
            auth_user_id: authData.user.id,
            name: name.trim(),
            email: email.trim(),
            school_name: schoolName.trim(),
            subjects_taught: subjectsTaught,
            grades_taught: gradesTaught,
          });
          if (insErr) profileError = insErr.message;
        } else if (roleTab === 'parent') {
          const { data: guardianData, error: insErr } = await supabase.from('guardians').insert({
            auth_user_id: authData.user.id,
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
          }).select('id').single();
          if (insErr) profileError = insErr.message;

          if (linkCode.trim() && guardianData) {
            await supabase.rpc('link_guardian_to_student_via_code', {
              p_guardian_id: guardianData.id,
              p_invite_code: linkCode.trim(),
            });
          }
        }

        if (profileError) {
          console.error(`[Signup] Profile insert failed for ${roleTab}:`, profileError);
          // Don't block signup — user can still verify email. Profile will be re-created on login if needed.
        }

        // Fire-and-forget welcome email (non-blocking)
        const session = authData.session;
        if (session) {
          const welcomePayload: Record<string, string> = { role: roleTab, name: name.trim(), email: email.trim() };
          if (roleTab === 'student') { welcomePayload.grade = grade; welcomePayload.board = board; }
          if (roleTab === 'teacher') { welcomePayload.school_name = schoolName.trim(); }
          fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify(welcomePayload),
          }).catch(() => {}); // Silent fail — welcome email is best-effort
          onSuccess();
        } else {
          setPendingEmail(email.trim());
          setMode('check-email');
          setSuccess('');
          setError('');
          setLoading(false);
        }
      }
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email'); return; }
    setError(''); setLoading(true);
    try {
      // PKCE flow: Supabase emails a link with a `code` param.
      // The link goes to /auth/callback which exchanges the code server-side,
      // then redirects to /auth/reset with a valid session.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      });
      if (resetError) { setError(resetError.message); setLoading(false); return; }
      setSuccess('Password reset link sent to your email!');
      setLoading(false);
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  const handleResendVerification = async () => {
    setError(''); setLoading(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
      });
      if (resendError) { setError(resendError.message); } else { setSuccess('Verification email sent again! Check your inbox.'); }
      setLoading(false);
    } catch { setError('Connection error.'); setLoading(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: 12,
    border: '1.5px solid var(--border)', background: 'var(--surface-2)',
    fontSize: 14, outline: 'none', fontFamily: 'var(--font-body)',
    color: 'var(--text-1)',
  };

  const chipStyle = (selected: boolean, color: string): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    border: `1.5px solid ${selected ? color : 'var(--border)'}`,
    background: selected ? `${color}18` : 'var(--surface-2)',
    color: selected ? color : 'var(--text-3)',
    cursor: 'pointer', transition: 'all 0.15s ease',
  });

  const subtitle = roleTab === 'teacher'
    ? 'Empower your classroom with AI'
    : roleTab === 'parent'
      ? 'Track your child\'s learning journey'
      : 'AI Tutor for CBSE Students';

  const signupTitle = roleTab === 'teacher'
    ? 'Join as Teacher'
    : roleTab === 'parent'
      ? 'Join as Parent'
      : 'Start Learning Now';

  const buttonGradient = roleTab === 'teacher'
    ? 'linear-gradient(135deg, #2563EB, #3B82F6)'
    : roleTab === 'parent'
      ? 'linear-gradient(135deg, #16A34A, #22C55E)'
      : 'linear-gradient(135deg, #E8590C, #F59E0B)';

  return (
    <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Hero — First impression. 3 seconds to hook an Indian student. */}
        <div className="text-center mb-5">
          <div className="text-6xl mb-2 animate-float">{'\uD83E\uDD8A'}</div>
          <h1 className="text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', background: 'linear-gradient(135deg, #E8590C, #F59E0B)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Alfanumrik
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-2)' }}>{subtitle}</p>

          {/* Value proposition — what PW/Byju's miss on their login screens */}
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>
              CBSE Grades 6-12
            </span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(22,163,74,0.08)', color: '#16A34A' }}>
              Hindi & English
            </span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>
              AI-Powered Adaptive
            </span>
          </div>
        </div>

        {/* Role Tabs */}
        {mode !== 'check-email' && <div className="flex gap-1 mb-4 p-1 rounded-2xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          {ROLE_TABS.map(tab => {
            const isActive = roleTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => { setRoleTab(tab.key); setError(''); setSuccess(''); }}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: isActive ? `${tab.color}15` : 'transparent',
                  color: isActive ? tab.color : 'var(--text-3)',
                  borderBottom: isActive ? `2.5px solid ${tab.color}` : '2.5px solid transparent',
                }}
              >
                <span className="mr-1">{tab.emoji}</span>
                {tab.label}
              </button>
            );
          })}
        </div>}

        {/* Form Card */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <h2 className="text-lg font-bold mb-4 text-center" style={{ color: 'var(--text-1)' }}>
            {mode === 'login' ? 'Welcome Back!' : mode === 'signup' ? signupTitle : mode === 'check-email' ? 'Check Your Email' : 'Reset Password'}
          </h2>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}
          {success && (
            <div className="mb-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#D1FAE5', color: '#059669', border: '1px solid #A7F3D0' }}>
              {success}
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgot} className="space-y-3">
            {mode === 'check-email' && (
              <div className="text-center space-y-4 py-2">
                <div className="text-4xl">📧</div>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  We sent a verification link to<br/><strong style={{ color: 'var(--text-1)' }}>{pendingEmail}</strong>
                </p>
                <p className="text-xs" style={{ color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Click the link in your email to verify your account and start learning. Check your spam folder if you don&apos;t see it.
                </p>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full text-center text-xs font-semibold py-2"
                  style={{ color: activeRoleColor }}
                >
                  {loading ? '...' : "Didn\u0027t receive it? Resend Email"}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <input type="text" placeholder="Your Name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} required />
            )}

            {mode !== 'check-email' && (
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            )}

            {mode !== 'forgot' && mode !== 'check-email' && (
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} placeholder="Password (min 8 chars, A-z, 0-9)" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 44 }} required minLength={8} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--text-3)' }}>
                  {showPassword ? '\uD83D\uDE48' : '\uD83D\uDC41'}
                </button>
              </div>
            )}

            {/* Student signup fields */}
            {mode === 'signup' && roleTab === 'student' && (
              <>
                <div className="flex gap-2">
                  <select value={grade} onChange={e => setGrade(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}>
                    {AUTH_GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={board} onChange={e => setBoard(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}>
                    {AUTH_BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                {/* Age range & parental consent */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Age Range</label>
                  <select value={studentAgeRange} onChange={e => { setStudentAgeRange(e.target.value as '13-18' | '10-12'); if (e.target.value === '13-18') { setParentEmail(''); setParentConsent(false); } }} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="13-18">13 &ndash; 18 years</option>
                    <option value="10-12">10 &ndash; 12 years</option>
                  </select>
                </div>

                {studentAgeRange === '10-12' && (
                  <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#F59E0B' }}>Parental consent required for students under 13</p>
                    <input
                      type="email"
                      placeholder="Parent/Guardian Email"
                      value={parentEmail}
                      onChange={e => setParentEmail(e.target.value)}
                      style={inputStyle}
                      required
                    />
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={parentConsent}
                        onChange={e => setParentConsent(e.target.checked)}
                        className="mt-0.5"
                        style={{ accentColor: '#E8590C' }}
                      />
                      <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                        I confirm that my parent/guardian has given consent for me to use this platform
                      </span>
                    </label>
                    <p className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>
                      Your parent/guardian will receive an email to verify their consent.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Teacher signup fields */}
            {mode === 'signup' && roleTab === 'teacher' && (
              <>
                <input type="text" placeholder="School Name" value={schoolName} onChange={e => setSchoolName(e.target.value)} style={inputStyle} required />

                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Subjects You Teach</label>
                  <div className="flex flex-wrap gap-1.5">
                    {TEACHER_SUBJECTS.map(s => (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => toggleSubject(s.code)}
                        style={chipStyle(subjectsTaught.includes(s.code), '#2563EB')}
                      >
                        {s.icon} {s.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Grades You Teach</label>
                  <div className="flex flex-wrap gap-1.5">
                    {TEACHER_GRADES.map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGradeTaught(g)}
                        style={chipStyle(gradesTaught.includes(g), '#2563EB')}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Parent signup fields */}
            {mode === 'signup' && roleTab === 'parent' && (
              <>
                <input type="tel" placeholder="Phone Number (optional)" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} />

                <div>
                  <input type="text" placeholder="Child Link Code (optional)" value={linkCode} onChange={e => setLinkCode(e.target.value)} style={inputStyle} maxLength={8} />
                  <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--text-3)' }}>
                    Have a link code from your child&apos;s school? Enter it to connect!
                  </p>
                </div>
              </>
            )}

            {/* DPDPA Consent Checkboxes */}
            {mode === 'signup' && (
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input
                    type="checkbox"
                    checked={consentData}
                    onChange={e => setConsentData(e.target.checked)}
                    className="mt-0.5 shrink-0"
                    style={{ accentColor: activeRoleColor, width: 16, height: 16 }}
                  />
                  <span>
                    I consent to the collection and processing of my data as described in the{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: activeRoleColor }}>Privacy Policy</a>
                    <span style={{ color: '#EF4444' }}> *</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <input
                    type="checkbox"
                    checked={consentAnalytics}
                    onChange={e => setConsentAnalytics(e.target.checked)}
                    className="mt-0.5 shrink-0"
                    style={{ accentColor: activeRoleColor, width: 16, height: 16 }}
                  />
                  <span>I consent to analytics tracking to improve the platform</span>
                </label>
              </div>
            )}

            {mode !== 'check-email' && (
            <button type="submit" disabled={loading} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50" style={{ background: buttonGradient }}>
              {loading ? '...' : mode === 'login' ? 'Log In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
            </button>
            )}
          </form>

          {mode === 'login' && (
            <button onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }} className="w-full text-center text-xs mt-3 font-semibold" style={{ color: 'var(--text-3)' }}>
              Forgot password?
            </button>
          )}

          <div className="mt-4 pt-4 text-center text-xs" style={{ borderTop: '1px solid var(--border)' }}>
            {mode === 'login' ? (
              <span style={{ color: 'var(--text-3)' }}>New here? <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>Create Account</button></span>
            ) : (
              <span style={{ color: 'var(--text-3)' }}>Already have an account? <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }} className="font-bold" style={{ color: activeRoleColor }}>Log In</button></span>
            )}
          </div>
        </div>

        {/* Trust signals — Indian parents check this before letting kids sign up */}
        <div className="mt-5 text-center space-y-2">
          <div className="flex items-center justify-center gap-4 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
            <span>🛡️ Safe & Secure</span>
            <span>🇮🇳 Made in India</span>
            <span>🔒 No Ads</span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            By signing up, you agree to our <a href="/terms" className="underline">Terms</a> & <a href="/privacy" className="underline">Privacy Policy</a>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            © {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN FOXY PAGE
   ══════════════════════════════════════════════════════════════ */

interface ChatMessage { id: number; role: 'student' | 'tutor'; content: string; timestamp: string; xp?: number; feedback?: 'up' | 'down' | null; reported?: boolean; }

const REPORT_REASONS = [
  { value: 'wrong_answer', label: '❌ Wrong answer', labelHi: '❌ गलत उत्तर' },
  { value: 'wrong_formula', label: '📐 Wrong formula', labelHi: '📐 गलत फॉर्मूला' },
  { value: 'wrong_explanation', label: '📝 Wrong explanation', labelHi: '📝 गलत व्याख्या' },
  { value: 'incomplete', label: '⚠️ Incomplete', labelHi: '⚠️ अधूरा' },
  { value: 'irrelevant', label: '🔀 Off-topic', labelHi: '🔀 विषय से हटकर' },
  { value: 'confusing', label: '😕 Confusing', labelHi: '😕 भ्रमित करने वाला' },
  { value: 'other', label: '💬 Other', labelHi: '💬 अन्य' },
];

export default function FoxyPage() {
  const { student: authStudent, isLoggedIn, isLoading: authLoading, activeRole, signOut } = useAuth();
  const router = useRouter();

  // Core state
  const [student, setStudent] = useState<any>(null);
  const [activeSubject, setActiveSubject] = useState('science');
  const [studentGrade, setStudentGrade] = useState('9');
  const [topics, setTopics] = useState<any[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionMode, setSessionMode] = useState('learn');
  const [language, setLanguage] = useState('en');
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [foxyState, setFoxyState] = useState<'idle' | 'thinking' | 'happy'>('idle');
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [xpGained, setXpGained] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [streakDays, setStreakDays] = useState(0);

  // UI state
  const [showSubjectDD, setShowSubjectDD] = useState(false);
  const [showChapterDD, setShowChapterDD] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [studentSubs, setStudentSubs] = useState<string[]>([]);
  const [showTopicSheet, setShowTopicSheet] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Error reporting
  const [reportModal, setReportModal] = useState<{ msgId: number; studentMsg: string; foxyMsg: string } | null>(null);
  const [reportReason, setReportReason] = useState('wrong_answer');
  const [reportCorrection, setReportCorrection] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Voice
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const recognitionRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // No redirect needed — landing page shows auth form when not logged in

  // Preload voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load(); window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Init student data
  useEffect(() => {
    if (!authStudent) return;
    setStudent(authStudent); setTotalXP(authStudent.xp_total || 0); setStreakDays(authStudent.streak_days || 0);
    const grade = (authStudent.grade || '9').replace('Grade ', ''); setStudentGrade(grade);
    setLanguage(authStudent.preferred_language || 'en');
    const saved = typeof window !== 'undefined' ? localStorage.getItem('alfanumrik_subject') : null;
    setActiveSubject(saved || authStudent.preferred_subject || 'science');
    setStudentSubs((authStudent.selected_subjects && authStudent.selected_subjects.length > 1) ? (authStudent.selected_subjects as string[]) : getGradeSubjects(grade));
    (async () => {
      const hist = await fetchChatHistory(authStudent.id);
      if (hist) {
        setChatSessionId(hist.id);
        setMessages(hist.messages.map((m: any, i: number) => ({ id: Date.now() + i, role: m.role === 'assistant' ? 'tutor' as const : m.role, content: m.content, timestamp: m.ts || new Date().toISOString(), xp: m.meta?.xp || 0 })));
      }
    })();
  }, [authStudent]);

  // Load topics on subject/grade change
  useEffect(() => {
    (async () => {
      setTopics(await fetchTopics(activeSubject, studentGrade));
      if (student?.id) setMasteryData(await fetchMastery(student.id, activeSubject));
    })();
  }, [activeSubject, studentGrade, student?.id]);

  // Auto-scroll
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // TTS
  const speakText = useCallback((text: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    let clean = text.replace(/\[KEY:\s*([^\]]+)\]/g, '$1').replace(/\[ANS:\s*([^\]]+)\]/g, 'The answer is $1.').replace(/\[FORMULA:\s*([^\]]+)\]/g, 'The formula is $1.').replace(/\[TIP:\s*([^\]]+)\]/g, 'Exam tip: $1.').replace(/\[MARKS:\s*([^\]]+)\]/g, 'This is a $1 marks question.').replace(/\[DIAGRAM:\s*([^\]]+)\]/g, 'You should draw a diagram of $1.').replace(/<!--[\s\S]*?-->/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices();
    const voice = language === 'hi' ? (voices.find(v => v.lang === 'hi-IN') || voices.find(v => v.lang.startsWith('hi'))) : (voices.find(v => v.lang === 'en-IN') || voices.find(v => v.name.toLowerCase().includes('india')) || voices.find(v => v.lang.startsWith('en')) || null);
    if (clean.length > 300) {
      const chunks = clean.match(/[^.!?]+[.!?]+/g) || [clean];
      setIsSpeaking(true);
      chunks.forEach((chunk, i) => { const u = new SpeechSynthesisUtterance(chunk.trim()); if (voice) u.voice = voice; u.rate = 0.9; u.pitch = 1.05; u.lang = language === 'hi' ? 'hi-IN' : 'en-IN'; if (i === chunks.length - 1) u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false); window.speechSynthesis.speak(u); });
    } else {
      const u = new SpeechSynthesisUtterance(clean); if (voice) u.voice = voice; u.rate = 0.9; u.pitch = 1.05; u.lang = language === 'hi' ? 'hi-IN' : 'en-IN'; u.onstart = () => setIsSpeaking(true); u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false); window.speechSynthesis.speak(u);
    }
  }, [voiceEnabled, language]);

  const stopSpeaking = useCallback(() => { if (typeof window !== 'undefined' && window.speechSynthesis) { window.speechSynthesis.cancel(); setIsSpeaking(false); } }, []);

  // STT
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (text.length > 5000) {
      setMessages(p => [...p, { id: Date.now(), role: 'tutor', content: 'Message too long! Please keep it under 5000 characters.', timestamp: new Date().toISOString() }]);
      return;
    }
    setMessages(p => [...p, { id: Date.now(), role: 'student', content: text, timestamp: new Date().toISOString() }]);
    setLoading(true); setFoxyState('thinking'); setShowTopicSheet(false);
    try {
      const chapCtx = selectedChapters.length > 0 ? topics.filter(t => selectedChapters.includes(t.id)).map(t => `Ch ${t.chapter_number}: ${t.title}`).join(', ') : null;
      const resp = await callFoxyTutor({ message: text, student_id: student?.id || '', student_name: student?.name || 'Student', grade: studentGrade, subject: activeSubject, language, mode: sessionMode, topic_id: activeTopic?.id || null, topic_title: activeTopic?.title || null, session_id: chatSessionId, selected_chapters: chapCtx });
      setMessages(p => [...p, { id: Date.now() + 1, role: 'tutor', content: resp.reply, timestamp: new Date().toISOString(), xp: resp.xp_earned }]);
      if (voiceEnabled) setTimeout(() => speakText(resp.reply), 300);
      if (resp.xp_earned > 0) setXpGained(p => p + resp.xp_earned);
      if (resp.session_id) setChatSessionId(resp.session_id);
      setFoxyState('happy'); setTimeout(() => setFoxyState('idle'), 2000);
    } catch {
      setMessages(p => [...p, { id: Date.now() + 1, role: 'tutor', content: 'Oops! Please try again.', timestamp: new Date().toISOString() }]);
      setFoxyState('idle');
    }
    setLoading(false);
  }, [student, studentGrade, activeSubject, language, sessionMode, activeTopic, chatSessionId, selectedChapters, topics, voiceEnabled, speakText]);

  // Feedback: thumbs up/down
  const handleFeedback = useCallback(async (msgId: number, isUp: boolean) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: isUp ? 'up' : 'down' } : m));
    try { await supabase.rpc('track_ai_quality', { p_subject: activeSubject, p_is_thumbs_up: isUp }); } catch {}
  }, [activeSubject]);

  // Open report modal
  const openReport = useCallback((msgId: number) => {
    const foxyMsg = messages.find(m => m.id === msgId);
    const idx = messages.findIndex(m => m.id === msgId);
    const studentMsg = idx > 0 ? messages.slice(0, idx).reverse().find(m => m.role === 'student') : null;
    if (!foxyMsg) return;
    setReportModal({ msgId, studentMsg: studentMsg?.content || '', foxyMsg: foxyMsg.content });
    setReportReason('wrong_answer'); setReportCorrection(''); setReportSuccess(false);
  }, [messages]);

  // Submit report
  const submitReport = useCallback(async () => {
    if (!reportModal) return;
    setReportSubmitting(true);
    try {
      await supabase.from('ai_response_reports').insert({
        student_id: student?.id || null,
        student_name: student?.name || 'Anonymous',
        session_id: chatSessionId,
        student_message: reportModal.studentMsg,
        foxy_response: reportModal.foxyMsg.substring(0, 4000),
        report_reason: reportReason,
        student_correction: reportCorrection || null,
        subject: activeSubject,
        grade: studentGrade,
        topic_title: activeTopic?.title || null,
        session_mode: sessionMode,
        language,
      });
      await supabase.rpc('track_ai_quality', { p_subject: activeSubject, p_is_report: true });
      setMessages(prev => prev.map(m => m.id === reportModal.msgId ? { ...m, reported: true, feedback: 'down' } : m));
      setReportSuccess(true);
    } catch {}
    setReportSubmitting(false);
  }, [reportModal, student, chatSessionId, reportReason, reportCorrection, activeSubject, studentGrade, activeTopic, sessionMode, language]);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not supported. Try Chrome.'); return; }
    const r = new SR(); r.continuous = false; r.interimResults = false; r.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; if (t.trim()) sendMessage(t.trim()); };
    r.onerror = () => setIsListening(false); r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start();
  }, [language, sendMessage]);

  const stopListening = useCallback(() => { if (recognitionRef.current) { recognitionRef.current.stop(); setIsListening(false); } }, []);

  const switchSubject = (key: string) => {
    setActiveSubject(key); setActiveTopic(null); setSelectedChapters([]); setShowSubjectDD(false); setMessages([]); setChatSessionId(null);
    if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_subject', key);
    // Auto-set language for language subjects
    if (key === 'hindi') setLanguage('hi');
    else if (key === 'english') setLanguage('en');
  };

  // Language toggle lock for language subjects
  const isLangLocked = activeSubject === 'hindi' || activeSubject === 'english';

  // Mode switch with auto-prompt
  const switchMode = useCallback((modeId: string) => {
    setSessionMode(modeId);
    const mode = MODES.find(m => m.id === modeId);
    if (!mode) return;
    // Doubt mode: let user type their own question
    if (modeId === 'doubt') return;
    // Auto-send a contextual prompt
    const topicName = activeTopic?.title || '';
    const prompt = language === 'hi' ? mode.autoPromptHi(topicName) : mode.autoPrompt(topicName);
    if (prompt) sendMessage(prompt);
  }, [activeTopic, language, sendMessage]);

  const cfg = SUBJECTS[activeSubject] || SUBJECTS.science;

  if (authLoading) return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-center"><div className="text-5xl animate-float mb-3">{FOXY_FACES.idle}</div><p className="text-sm text-[var(--text-3)]">Loading Foxy...</p></div>
    </div>
  );

  if (!isLoggedIn && !authLoading) return <AuthScreen onSuccess={() => window.location.reload()} />;

  if (!student) {
    // Non-student roles: show role-aware screen with navigation (don't auto-redirect)
    if (activeRole === 'guardian' || activeRole === 'teacher') {
      const dashPath = activeRole === 'guardian' ? '/parent' : '/teacher';
      const roleLabel = activeRole === 'guardian' ? 'Parent' : 'Teacher';
      return (
        <div className="mesh-bg min-h-dvh flex items-center justify-center">
          <div className="text-center max-w-xs mx-auto px-4">
            <div className="text-5xl mb-4">{activeRole === 'guardian' ? '👨‍👩‍👧' : '👩‍🏫'}</div>
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>Welcome, {roleLabel}!</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>You are logged in as a {roleLabel.toLowerCase()}. Foxy AI Tutor is for students.</p>
            <button
              onClick={() => router.push(dashPath)}
              className="w-full py-3 px-4 rounded-xl font-semibold text-white text-sm mb-3"
              style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)' }}
            >
              Go to {roleLabel} Dashboard
            </button>
            <button
              onClick={async () => { await signOut(); window.location.reload(); }}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-medium"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              Sign out &amp; switch account
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-float mb-3">{FOXY_FACES.idle}</div>
          <p className="text-sm text-[var(--text-3)]">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col pb-nav" style={{ background: 'var(--surface-2)' }}>

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-30 px-3 py-2.5 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #1a1a2e, #0f3460)', color: '#fff' }}>
        <button onClick={() => router.push('/dashboard')} className="text-white/60 text-sm">←</button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)', animation: foxyState === 'thinking' ? 'pulse 1s infinite' : 'none' }}>
          {FOXY_FACES[foxyState]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">Foxy <span className="text-[10px] font-semibold opacity-60">AI Tutor</span></div>
          <div className="text-[10px] opacity-50 flex gap-2"><span>{totalXP + xpGained} XP</span><span>{streakDays}d streak</span><span>Gr {studentGrade}</span></div>
        </div>
        <div className="flex items-center gap-1.5">
          {LANGS.map(l => <button key={l.code} onClick={() => { if (!isLangLocked) setLanguage(l.code); }} className="text-[10px] font-bold px-2 py-1 rounded-lg transition-all" style={{ background: language === l.code ? 'rgba(255,255,255,0.2)' : 'transparent', color: language === l.code ? '#fff' : 'rgba(255,255,255,0.4)', opacity: isLangLocked && language !== l.code ? 0.2 : 1, cursor: isLangLocked ? 'default' : 'pointer' }}>{l.label}</button>)}
          {isLangLocked && <span className="text-[8px] text-white/30">🔒</span>}
          <button onClick={() => { if (voiceEnabled) { stopSpeaking(); setVoiceEnabled(false); } else setVoiceEnabled(true); }} className="ml-1 px-2 py-1 rounded-lg text-sm transition-all" style={{ background: voiceEnabled ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.1)' }}>{voiceEnabled ? (isSpeaking ? '🔊' : '🔈') : '🔇'}</button>
        </div>
      </header>

      {/* ═══ SUBJECT + CHAPTER + MODE BAR ═══ */}
      <div className="foxy-toolbar" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
        {/* Subject dropdown */}
        <div className="relative">
          <button onClick={() => { setShowSubjectDD(!showSubjectDD); setShowChapterDD(false); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{ background: `${cfg.color}10`, border: `1.5px solid ${cfg.color}30`, color: cfg.color }}>
            <span className="text-sm">{cfg.icon}</span><span>{cfg.name}</span><span className="text-[10px] ml-0.5 opacity-60">{showSubjectDD ? '▲' : '▼'}</span>
          </button>
          {showSubjectDD && (
            <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-2xl overflow-hidden shadow-lg" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] px-3">My Subjects</div>
              {(studentSubs.length > 0 ? studentSubs : Object.keys(SUBJECTS)).map(key => {
                const sub = SUBJECTS[key]; if (!sub) return null;
                return (
                  <button key={key} onClick={() => switchSubject(key)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all" style={{ background: activeSubject === key ? `${sub.color}08` : 'transparent', borderLeft: activeSubject === key ? `3px solid ${sub.color}` : '3px solid transparent' }}>
                    <span className="text-base">{sub.icon}</span>
                    <span className="text-sm font-semibold" style={{ color: activeSubject === key ? sub.color : 'var(--text-1)' }}>{sub.name}</span>
                    {activeSubject === key && <span className="ml-auto text-xs" style={{ color: sub.color }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Chapter dropdown */}
        <div className="relative">
          <button onClick={() => { setShowChapterDD(!showChapterDD); setShowSubjectDD(false); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-2)' }}>
            <span className="text-sm">📖</span><span>{selectedChapters.length > 0 ? `${selectedChapters.length} Ch` : `All ${topics.length} Ch`}</span><span className="text-[10px] ml-0.5 opacity-60">{showChapterDD ? '▲' : '▼'}</span>
          </button>
          {showChapterDD && (
            <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-[50vh] rounded-2xl overflow-hidden shadow-lg flex flex-col" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="p-2 px-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">{cfg.icon} {cfg.name} Chapters</span>
                <button onClick={() => setSelectedChapters([])} className="text-[10px] font-semibold" style={{ color: 'var(--orange)' }}>Clear All</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {topics.map(topic => {
                  const sel = selectedChapters.includes(topic.id);
                  const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                  const lvl = mastery?.mastery_level || 'not_started';
                  const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                  return (
                    <button key={topic.id} onClick={() => setSelectedChapters(p => sel ? p.filter(x => x !== topic.id) : [...p, topic.id])} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all" style={{ background: sel ? `${cfg.color}06` : 'transparent', borderBottom: '1px solid var(--border)' }}>
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px]" style={{ background: sel ? cfg.color : 'var(--surface-2)', color: sel ? '#fff' : 'var(--text-3)', border: sel ? 'none' : '1.5px solid var(--border)' }}>{sel ? '✓' : ''}</div>
                      <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div></div>
                      <span className="text-[9px] font-bold capitalize px-1.5 py-0.5 rounded" style={{ background: `${lc}15`, color: lc }}>{lvl.replace('_', ' ')}</span>
                    </button>
                  );
                })}
              </div>
              {selectedChapters.length > 0 && (
                <div className="p-2 px-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => { const ch = topics.find(t => selectedChapters.includes(t.id)); if (ch) { setActiveTopic(ch); sendMessage(`Teach me about: ${ch.title} (Chapter ${ch.chapter_number})`); setShowChapterDD(false); } }} className="w-full py-2 rounded-xl text-xs font-bold text-white" style={{ background: cfg.color }}>
                    Start with Selected
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mode pills — each triggers a mode-specific action */}
        <div className="foxy-mode-bar ml-auto">
          {MODES.map(m => (
            <button key={m.id} onClick={() => switchMode(m.id)} className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1" style={{ background: sessionMode === m.id ? `${cfg.color}15` : 'transparent', color: sessionMode === m.id ? cfg.color : 'var(--text-3)', border: sessionMode === m.id ? `1px solid ${cfg.color}30` : '1px solid transparent' }}>
              <span>{m.emoji}</span>
              <span className="hidden sm:inline">{language === 'hi' ? m.labelHi : m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Close dropdowns */}
      {(showSubjectDD || showChapterDD) && <div className="fixed inset-0 z-40" onClick={() => { setShowSubjectDD(false); setShowChapterDD(false); }} />}

      {/* ═══ MAIN CHAT AREA ═══ */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop sidebar */}
        <div className="hidden lg:flex shrink-0 relative" style={{ width: sidebarOpen ? 280 : 0, transition: 'width 0.3s ease' }}>
          <div className="flex flex-col overflow-hidden border-r" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', width: 280, position: 'absolute', top: 0, bottom: 0, left: 0, transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s ease' }}>
            <div className="p-3 text-xs font-bold flex items-center justify-between" style={{ color: cfg.color, borderBottom: '1px solid var(--border)' }}>
              <span>{cfg.icon} {cfg.name} · Gr {studentGrade} ({topics.length})</span>
              <button onClick={() => setSidebarOpen(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all hover:opacity-70" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }} title="Collapse">«</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {topics.map(topic => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => { setActiveTopic(topic); sendMessage(`Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`); }} className="w-full text-left p-3 rounded-xl transition-all active:scale-[0.98]" style={{ border: `1px solid ${lc}25`, background: 'var(--surface-1)' }}>
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: lc }} /></div>
                      <span className="text-[10px] font-bold capitalize" style={{ color: lc }}>{lvl.replace('_', ' ')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} className="hidden lg:flex shrink-0 w-8 items-center justify-center border-r cursor-pointer transition-all hover:bg-[var(--surface-2)]" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }} title="Show chapters"><span className="text-[10px]" style={{ color: 'var(--text-3)' }}>»</span></button>}

        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4">
            {/* Empty state */}
            {messages.length === 0 && (
              <div className="text-center py-12 md:py-20 animate-slide-up">
                <div className="text-6xl md:text-7xl mb-4 animate-float">{FOXY_FACES.idle}</div>
                <h2 className="text-xl md:text-2xl font-extrabold mb-2" style={{ fontFamily: 'var(--font-display)', background: `linear-gradient(135deg, #E8590C, ${cfg.color})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Hi! I am Foxy</h2>
                <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto mb-6 leading-relaxed">Your AI tutor. Pick a topic, type below, or tap 🎤 to talk!</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                  {['What should I study today?', 'Quick quiz', 'Explain last topic', 'Formula sheet', 'Weak areas'].map(prompt => (
                    <button key={prompt} onClick={() => sendMessage(prompt)} className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>{prompt}</button>
                  ))}
                </div>
                <button onClick={() => setShowChapterDD(true)} className="mt-6 px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: `${cfg.color}10`, color: cfg.color, border: `1.5px solid ${cfg.color}30` }}>{cfg.icon} Browse {topics.length} Chapters</button>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, msgIdx) => (
              <div key={msg.id} className="mb-4 w-full animate-fade-in">
                <div className="flex items-center gap-2 mb-1.5">
                  {msg.role === 'tutor'
                    ? <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)' }}>{FOXY_FACES.idle}</div>
                    : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}bb)` }}>{student?.name?.[0]?.toUpperCase() || 'S'}</div>}
                  <span className="text-xs font-bold" style={{ color: msg.role === 'tutor' ? 'var(--orange)' : cfg.color }}>{msg.role === 'tutor' ? 'Foxy' : (student?.name || 'You')}</span>
                  <span className="text-[10px] text-[var(--text-3)]">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {msg.role === 'tutor' && <span className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>🤖 AI</span>}
                  {(msg.xp ?? 0) > 0 && <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold text-white" style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>+{msg.xp} XP</span>}
                </div>
                <div className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: msg.role === 'student' ? `${cfg.color}08` : 'var(--surface-1)', color: 'var(--text-1)', border: msg.role === 'student' ? `1.5px solid ${cfg.color}20` : msg.reported ? '1.5px solid #EF444440' : '1px solid var(--border)' }}>
                  {msg.role === 'tutor' ? <RichContent content={msg.content} subjectKey={activeSubject} /> : <div className="whitespace-pre-wrap">{msg.content}</div>}
                </div>

                {/* ── Feedback bar for tutor messages ── */}
                {msg.role === 'tutor' && msg.content !== 'Oops! Please try again.' && (
                  <div className="flex items-center gap-1 mt-1.5 pl-1">
                    {/* Thumbs up */}
                    <button
                      onClick={() => handleFeedback(msg.id, true)}
                      className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
                      style={{ background: msg.feedback === 'up' ? '#16A34A18' : 'transparent', color: msg.feedback === 'up' ? '#16A34A' : 'var(--text-3)', border: msg.feedback === 'up' ? '1px solid #16A34A30' : '1px solid transparent' }}
                    >{msg.feedback === 'up' ? '👍' : '👍'}</button>

                    {/* Thumbs down */}
                    <button
                      onClick={() => { handleFeedback(msg.id, false); }}
                      className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
                      style={{ background: msg.feedback === 'down' ? '#EF444418' : 'transparent', color: msg.feedback === 'down' ? '#EF4444' : 'var(--text-3)', border: msg.feedback === 'down' ? '1px solid #EF444430' : '1px solid transparent' }}
                    >👎</button>

                    {/* Report error */}
                    {!msg.reported ? (
                      <button
                        onClick={() => openReport(msg.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-all active:scale-95 ml-1"
                        style={{ color: 'var(--text-3)' }}
                      >⚠️ Report</button>
                    ) : (
                      <span className="px-2 py-1 text-[10px] font-semibold" style={{ color: '#EF4444' }}>✓ Reported</span>
                    )}

                    {/* AI disclaimer for math/science */}
                    {['math', 'science', 'physics', 'chemistry'].includes(activeSubject) && (msg.content.includes('=') || msg.content.includes('formula') || msg.content.includes('²') || msg.content.includes('√')) && (
                      <span className="ml-auto text-[9px] px-2 py-0.5 rounded" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>Verify with textbook</span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* ── Report Error Modal ── */}
            {reportModal && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget) { setReportModal(null); } }}>
                <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up" style={{ background: 'var(--surface-1)' }}>
                  {!reportSuccess ? (<>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>⚠️ Report Incorrect Answer</h3>
                      <button onClick={() => setReportModal(null)} className="text-lg" style={{ color: 'var(--text-3)' }}>✕</button>
                    </div>

                    {/* What Foxy said */}
                    <div className="mb-4 p-3 rounded-xl text-xs" style={{ background: '#EF444408', border: '1px solid #EF444420' }}>
                      <div className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: '#EF4444' }}>Foxy&apos;s response:</div>
                      <div className="leading-relaxed" style={{ color: 'var(--text-2)', maxHeight: 100, overflow: 'hidden' }}>{reportModal.foxyMsg.substring(0, 300)}{reportModal.foxyMsg.length > 300 ? '...' : ''}</div>
                    </div>

                    {/* Reason */}
                    <div className="mb-3">
                      <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text-3)' }}>What&apos;s wrong?</label>
                      <div className="flex flex-wrap gap-1.5">
                        {REPORT_REASONS.map(r => (
                          <button key={r.value} onClick={() => setReportReason(r.value)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all" style={{ background: reportReason === r.value ? '#EF444415' : 'var(--surface-2)', color: reportReason === r.value ? '#EF4444' : 'var(--text-3)', border: `1.5px solid ${reportReason === r.value ? '#EF444440' : 'var(--border)'}` }}>
                            {language === 'hi' ? r.labelHi : r.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Student's correction */}
                    <div className="mb-4">
                      <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>What should the correct answer be? (optional)</label>
                      <textarea
                        value={reportCorrection}
                        onChange={e => setReportCorrection(e.target.value)}
                        placeholder={language === 'hi' ? 'सही उत्तर लिखें...' : 'Type the correct answer here...'}
                        rows={3}
                        className="w-full text-sm rounded-xl px-3 py-2 resize-none outline-none"
                        style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', fontFamily: 'var(--font-body)' }}
                      />
                    </div>

                    {/* Submit */}
                    <div className="flex gap-2">
                      <button onClick={() => setReportModal(null)} className="flex-1 py-2.5 rounded-xl text-xs font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>Cancel</button>
                      <button onClick={submitReport} disabled={reportSubmitting} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50" style={{ background: '#EF4444' }}>
                        {reportSubmitting ? 'Submitting...' : '⚠️ Submit Report'}
                      </button>
                    </div>
                  </>) : (
                    <div className="text-center py-6">
                      <div className="text-4xl mb-3">✅</div>
                      <h3 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>Thank you!</h3>
                      <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                        {language === 'hi' ? 'आपकी रिपोर्ट दर्ज हो गई है। हम इसकी जाँच करेंगे और सुधार करेंगे।' : 'Your report has been recorded. Our team will review and fix this.'}
                      </p>
                      <button onClick={() => setReportModal(null)} className="px-6 py-2 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--orange)' }}>OK</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Thinking */}
            {loading && (
              <div className="flex gap-2.5 items-center mb-4">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)', animation: 'pulse 1s infinite' }}>{FOXY_FACES.thinking}</div>
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  {[0, 1, 2].map(i => <div key={i} className="w-2 h-2 rounded-full" style={{ background: cfg.color, animation: `pulse 1s infinite ${i * 0.2}s`, opacity: 0.5 }} />)}
                  <span className="text-xs text-[var(--text-3)] ml-1.5">Foxy is thinking...</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <ChatInput onSubmit={sendMessage} subjectKey={activeSubject} disabled={loading} onMicTap={isListening ? stopListening : startListening} isListening={isListening} />
        </div>
      </div>

      {/* Mobile topics sheet */}
      {showTopicSheet && (
        <>
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowTopicSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl max-h-[75vh] flex flex-col lg:hidden" style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} /></div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.icon} {cfg.name} · Gr {studentGrade}</span>
              <button onClick={() => setShowTopicSheet(false)} className="text-xs text-[var(--text-3)] font-semibold">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
              {topics.map(topic => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => { setActiveTopic(topic); setShowTopicSheet(false); sendMessage(`Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`); }} className="w-full text-left p-3.5 rounded-xl flex items-center gap-3 active:scale-[0.98] transition-all" style={{ background: 'var(--surface-2)', border: `1px solid ${lc}20` }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `${lc}15` }}>{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: lc }} /></div>
                        <span className="text-[10px] font-bold capitalize shrink-0" style={{ color: lc }}>{pct}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {isSpeaking && <button onClick={stopSpeaking} className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all" style={{ background: '#EF4444', color: '#fff', fontSize: 18, boxShadow: '0 4px 20px rgba(239,68,68,0.4)' }}>■</button>}

      <BottomNav />
{/* Foxy styles in globals.css */}
    </div>
  );
}
