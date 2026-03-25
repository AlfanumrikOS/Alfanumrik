'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants';
import { BottomNav } from '@/components/ui';
import { LESSON_STEPS, getLessonStepPrompt, getNextLessonStep, type LessonStep, type LessonState } from '@/lib/cognitive-engine';
import { useVoice } from '@/hooks/useVoice';
import { checkDailyUsage, recordUsage, type UsageResult } from '@/lib/usage';
import { ConversationStarters } from '@/components/foxy/ConversationStarters';
import { ChatBubble } from '@/components/foxy/ChatBubble';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// Lazy-load heavy audio components — not needed until user interacts with voice
const VoiceWaveform = dynamic(() => import('@/components/foxy/VoiceWaveform').then(m => ({ default: m.VoiceWaveform })), { ssr: false });
const TalkToLearnButton = dynamic(() => import('@/components/foxy/TalkToLearnButton').then(m => ({ default: m.TalkToLearnButton })), { ssr: false });

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
  { id: 'lesson', emoji: '🎓', label: 'Lesson', labelHi: 'पाठ', autoPrompt: () => '', autoPromptHi: () => '' },
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
    // Get user's JWT for authenticated edge function calls — anon key causes 401
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error('Foxy tutor error:', res.status, errText);
      if (res.status === 401 || res.status === 403) {
        return { reply: 'Session expired. Please refresh the page and try again!', xp_earned: 0, session_id: null };
      }
      return { reply: res.status === 429 ? 'Slow down! Wait a moment and try again.' : 'Foxy is taking a short break. Try again!', xp_earned: 0, session_id: null };
    }
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

function RichContent({ content, subjectKey }: { content: string; subjectKey: string }) {
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
}

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
  const { student: authStudent, isLoggedIn, isLoading: authLoading } = useAuth();
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

  // Voice — unified hook replaces manual Web Speech API
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  // Usage enforcement
  const [chatUsage, setChatUsage] = useState<UsageResult | null>(null);
  const [ttsUsage, setTtsUsage] = useState<UsageResult | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Lesson flow state
  const [lessonStep, setLessonStep] = useState<LessonStep>('hook');
  const [lessonStepsCompleted, setLessonStepsCompleted] = useState<LessonStep[]>([]);
  const [lessonPrediction, setLessonPrediction] = useState('');
  const [showPredictionInput, setShowPredictionInput] = useState(false);
  const [predictionSubmitted, setPredictionSubmitted] = useState(false);

  // Ref to forward sendMessage to useVoice's onTranscript (avoids circular dep)
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  // Unified voice hook
  const voice = useVoice({
    language,
    enabled: voiceEnabled,
    onTranscript: (text: string) => sendMessageRef.current(text),
  });

  useEffect(() => { if (!authLoading && !isLoggedIn) router.replace('/'); }, [authLoading, isLoggedIn, router]);

  // Fetch usage stats on mount and after student loads
  useEffect(() => {
    if (!student?.id) return;
    const plan = student.subscription_plan || 'free';
    checkDailyUsage(student.id, 'foxy_chat', plan).then(setChatUsage);
    checkDailyUsage(student.id, 'foxy_tts', plan).then(setTtsUsage);
  }, [student?.id, student?.subscription_plan]);

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

  // TTS — uses unified voice hook; checks limit then records usage
  const speakText = useCallback(async (text: string) => {
    if (!voiceEnabled) return;
    // Check TTS usage limit before speaking
    if (student?.id) {
      const usage = await checkDailyUsage(student.id, 'foxy_tts', student.subscription_plan || 'free');
      setTtsUsage(usage);
      if (!usage.allowed) {
        // Silently fall back — don't block chat, just skip TTS
        return;
      }
      recordUsage(student.id, 'foxy_tts');
      setTtsUsage(prev => prev ? { ...prev, count: prev.count + 1, remaining: Math.max(0, prev.remaining - 1), allowed: prev.count + 1 < prev.limit } : prev);
    }
    await voice.speak(text, student?.id);
  }, [voiceEnabled, voice.speak, student?.id, student?.subscription_plan]);

  const stopSpeaking = useCallback(() => { voice.stopSpeaking(); }, [voice.stopSpeaking]);

  // Send message with usage enforcement
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    // Client-side length limit matching server-side MAX_MESSAGE_LENGTH
    if (text.length > 5000) {
      setMessages(p => [...p, { id: Date.now(), role: 'tutor', content: 'Message too long! Please keep it under 5000 characters.', timestamp: new Date().toISOString() }]);
      return;
    }

    // Check chat usage limit
    if (student?.id) {
      const usage = await checkDailyUsage(student.id, 'foxy_chat', student.subscription_plan || 'free');
      setChatUsage(usage);
      if (!usage.allowed) {
        setShowLimitModal(true);
        return;
      }
      recordUsage(student.id, 'foxy_chat');
      setChatUsage(prev => prev ? { ...prev, count: prev.count + 1, remaining: Math.max(0, prev.remaining - 1), allowed: prev.count + 1 < prev.limit } : prev);
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

  // STT — delegate to unified voice hook
  const startListening = useCallback(() => { voice.startListening(); }, [voice.startListening]);
  const stopListening = useCallback(() => { voice.stopListening(); }, [voice.stopListening]);

  // Keep sendMessageRef in sync for useVoice's onTranscript callback
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

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
    // Lesson mode: start lesson flow
    if (modeId === 'lesson') {
      setLessonStep('hook');
      setLessonStepsCompleted([]);
      setPredictionSubmitted(false);
      setShowPredictionInput(false);
      const topicName = activeTopic?.title || '';
      if (topicName) {
        const prompt = getLessonStepPrompt('hook', topicName, language);
        sendMessage(prompt);
      }
      return;
    }
    // Auto-send a contextual prompt
    const topicName = activeTopic?.title || '';
    const prompt = language === 'hi' ? mode.autoPromptHi(topicName) : mode.autoPrompt(topicName);
    if (prompt) sendMessage(prompt);
  }, [activeTopic, language, sendMessage]);

  // Advance lesson step
  const advanceLessonStep = useCallback(() => {
    const state: LessonState = {
      currentStep: lessonStep,
      stepsCompleted: lessonStepsCompleted,
      recallScore: null,
      applicationScore: null,
    };
    const next = getNextLessonStep(state);
    if (next === 'complete') {
      setSessionMode('learn');
      return;
    }
    setLessonStepsCompleted(prev => [...prev, lessonStep]);
    setLessonStep(next);
    setPredictionSubmitted(false);
    setShowPredictionInput(next === 'active_recall');
    const topicName = activeTopic?.title || '';
    if (topicName) {
      const prompt = getLessonStepPrompt(next, topicName, language);
      sendMessage(prompt);
    }
  }, [lessonStep, lessonStepsCompleted, activeTopic, language, sendMessage]);

  const cfg = SUBJECTS[activeSubject] || SUBJECTS.science;

  if (authLoading || !student) return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-center"><div className="text-5xl animate-float mb-3">{FOXY_FACES.idle}</div><p className="text-sm text-[var(--text-3)]">Loading Foxy...</p></div>
    </div>
  );

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
          <button onClick={() => { if (voiceEnabled) { stopSpeaking(); setVoiceEnabled(false); } else setVoiceEnabled(true); }} className="ml-1 px-2 py-1 rounded-lg text-sm transition-all" style={{ background: voiceEnabled ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.1)' }}>{voiceEnabled ? (voice.isSpeaking ? '🔊' : '🔈') : '🔇'}</button>
          {chatUsage && <span className="text-[8px] opacity-40 ml-1" title="Chat messages remaining">💬{chatUsage.remaining}/{chatUsage.limit}</span>}
          {voiceEnabled && ttsUsage && <span className="text-[8px] opacity-40 ml-0.5" title="Voice calls remaining">🔊{ttsUsage.remaining}/{ttsUsage.limit}</span>}
        </div>
      </header>

      {/* Voice waveform — shown when Foxy is speaking via ElevenLabs */}
      {voiceEnabled && voice.isSpeaking && (
        <div className="foxy-voice-bar">
          <VoiceWaveform isActive={voice.isSpeaking} analyserNode={voice.analyserNode} color={cfg.color} />
        </div>
      )}

      {/* Interim transcript overlay — live STT feedback */}
      {voice.interimTranscript && (
        <div className="foxy-interim-transcript">
          <span className="text-xs opacity-70">🎤 {voice.interimTranscript}</span>
        </div>
      )}

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

      {/* ═══ LESSON STEP PROGRESS BAR ═══ */}
      {sessionMode === 'lesson' && (
        <div className="px-3 py-2" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1 mb-1.5">
            {LESSON_STEPS.map((step, idx) => {
              const isCompleted = lessonStepsCompleted.includes(step);
              const isCurrent = step === lessonStep;
              const stepLabels: Record<string, string> = {
                hook: '🪝 Hook', visualization: '👁 Visual', guided_examples: '📝 Examples',
                active_recall: '🧠 Recall', application: '🔧 Apply', spaced_revision: '🔄 Revise',
              };
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full h-1.5 rounded-full" style={{
                    background: isCompleted ? cfg.color : isCurrent ? `${cfg.color}60` : 'var(--surface-2)',
                    transition: 'all 0.3s ease',
                  }} />
                  <span className="text-[8px] font-bold truncate" style={{
                    color: isCompleted ? cfg.color : isCurrent ? cfg.color : 'var(--text-3)',
                  }}>{stepLabels[step] || step}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
              {language === 'hi' ? 'पाठ प्रगति' : 'Lesson Progress'}: {lessonStepsCompleted.length + 1}/{LESSON_STEPS.length}
            </span>
            {!loading && messages.length > 0 && (
              <button
                onClick={advanceLessonStep}
                className="px-3 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
                style={{ background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}30` }}
              >
                {lessonStep === 'spaced_revision'
                  ? (language === 'hi' ? '✓ पूरा हुआ' : '✓ Complete')
                  : (language === 'hi' ? 'अगला चरण →' : 'Next Step →')}
              </button>
            )}
          </div>
          {/* Predict-before-reveal for active recall step */}
          {showPredictionInput && !predictionSubmitted && (
            <div className="mt-2 p-3 rounded-xl" style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}20` }}>
              <p className="text-xs font-semibold mb-1.5" style={{ color: cfg.color }}>
                🧠 {language === 'hi' ? 'पहले अपना अनुमान लिखो:' : 'Write your prediction first:'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lessonPrediction}
                  onChange={e => setLessonPrediction(e.target.value)}
                  placeholder={language === 'hi' ? 'तुम्हारा अनुमान...' : 'Your prediction...'}
                  className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                />
                <button
                  onClick={() => {
                    if (lessonPrediction.trim()) {
                      setPredictionSubmitted(true);
                      sendMessage(`My prediction: ${lessonPrediction.trim()}`);
                      setLessonPrediction('');
                    }
                  }}
                  disabled={!lessonPrediction.trim()}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: cfg.color }}
                >
                  {language === 'hi' ? 'भेजो' : 'Submit'}
                </button>
              </div>
            </div>
          )}
          {showPredictionInput && predictionSubmitted && (
            <div className="mt-2 text-[10px] font-semibold" style={{ color: '#16A34A' }}>
              ✓ {language === 'hi' ? 'अनुमान जमा हो गया! Foxy का जवाब देखो।' : 'Prediction submitted! See Foxy\'s answer below.'}
            </div>
          )}
        </div>
      )}

      {/* ═══ MAIN CHAT AREA ═══ */}
      <SectionErrorBoundary section="Foxy Chat">
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
            {/* Empty state with ConversationStarters */}
            {messages.length === 0 && (
              <div className="text-center py-12 md:py-20 animate-slide-up">
                <div className="text-6xl md:text-7xl mb-4 animate-float">{FOXY_FACES.idle}</div>
                <h2 className="text-xl md:text-2xl font-extrabold mb-2" style={{ fontFamily: 'var(--font-display)', background: `linear-gradient(135deg, #E8590C, ${cfg.color})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Hi! I am Foxy</h2>
                <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto mb-4 leading-relaxed">Your AI tutor. Pick a topic, type below, or tap 🎤 to talk!</p>

                {/* Voice hero button */}
                {voiceEnabled && voice.sttAvailable && (
                  <div className="mb-6">
                    <TalkToLearnButton
                      isListening={voice.isListening}
                      isSpeaking={voice.isSpeaking}
                      isLoading={voice.isLoadingAudio}
                      onTap={voice.isListening ? stopListening : startListening}
                      size="lg"
                      color={cfg.color}
                    />
                    <p className="text-[10px] text-[var(--text-3)] mt-2">Tap to talk to Foxy</p>
                  </div>
                )}

                {/* Smart conversation starters */}
                <ConversationStarters
                  subject={activeSubject}
                  language={language}
                  topicTitle={activeTopic?.title}
                  onSelect={sendMessage}
                />

                <button onClick={() => setShowChapterDD(true)} className="mt-6 px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: `${cfg.color}10`, color: cfg.color, border: `1.5px solid ${cfg.color}30` }}>{cfg.icon} Browse {topics.length} Chapters</button>
              </div>
            )}

            {/* Messages — using ChatBubble component */}
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.role === 'tutor' ? <RichContent content={msg.content} subjectKey={activeSubject} /> : <div className="whitespace-pre-wrap">{msg.content}</div>}
                rawContent={msg.content}
                timestamp={msg.timestamp}
                studentName={student?.name}
                xp={msg.xp}
                feedback={msg.feedback}
                reported={msg.reported}
                color={cfg.color}
                isSpeaking={voice.isSpeaking}
                isLoadingAudio={voice.isLoadingAudio}
                voiceEnabled={voiceEnabled}
                activeSubject={activeSubject}
                onPlayAudio={() => voice.isSpeaking ? stopSpeaking() : speakText(msg.content)}
                onFeedback={(isUp) => handleFeedback(msg.id, isUp)}
                onReport={() => openReport(msg.id)}
              />
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

          <ChatInput onSubmit={sendMessage} subjectKey={activeSubject} disabled={loading} onMicTap={voice.isListening ? stopListening : startListening} isListening={voice.isListening} />
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

      {voice.isSpeaking && <button onClick={stopSpeaking} className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all" style={{ background: '#EF4444', color: '#fff', fontSize: 18, boxShadow: '0 4px 20px rgba(239,68,68,0.4)' }}>■</button>}

      {/* ═══ USAGE LIMIT MODAL ═══ */}
      {showLimitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowLimitModal(false)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 text-center animate-slide-up" style={{ background: 'var(--surface-1)' }} onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">⏳</div>
            <h3 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {language === 'hi' ? 'आज की सीमा पूरी हो गई' : 'Daily Limit Reached'}
            </h3>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {language === 'hi'
                ? `आपने आज ${chatUsage?.limit || 50} संदेश भेज दिए हैं। कल फिर से प्रयास करें या अपग्रेड करें।`
                : `You've used all ${chatUsage?.limit || 50} messages for today. Come back tomorrow or upgrade your plan.`}
            </p>
            <button onClick={() => setShowLimitModal(false)} className="px-6 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--orange)' }}>
              {language === 'hi' ? 'ठीक है' : 'Got it'}
            </button>
          </div>
        </div>
      )}
      </SectionErrorBoundary>

      <BottomNav />
    </div>
  );
}
