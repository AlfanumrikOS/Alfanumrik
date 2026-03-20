'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { foxyChat, saveChatSession, getTutorPersonas, getSubjects } from '@/lib/supabase';
import type { ChatMessage, TutorPersona, Subject, SessionMode, PersonaId } from '@/lib/types';
import ReactMarkdown from 'react-markdown';

const SESSION_MODES: Array<{ id: SessionMode; icon: string; en: string; hi: string }> = [
  { id:'learn',    icon:'📖', en:'Learn',    hi:'सीखो'   },
  { id:'practice', icon:'✏️', en:'Practice', hi:'अभ्यास' },
  { id:'doubt',    icon:'💭', en:'Doubt',    hi:'संदेह'  },
  { id:'quiz',     icon:'⚡', en:'Quiz',     hi:'क्विज़'  },
];

const QUICK_PROMPTS_EN = [
  "Explain Newton's Laws with examples",
  "What is photosynthesis?",
  "Solve: x² - 5x + 6 = 0",
  "Teach me Ohm's Law",
];
const QUICK_PROMPTS_HI = [
  "न्यूटन के नियम उदाहरण के साथ समझाओ",
  "प्रकाश संश्लेषण क्या है?",
  "हल करो: x² - 5x + 6 = 0",
  "ओम का नियम सिखाओ",
];

export default function FoxyPage() {
  const { student, isLoggedIn, isLoading, isHi, language } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('learn');
  const [personas, setPersonas] = useState<TutorPersona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<PersonaId>('friendly_primary');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [showPersonaSheet, setShowPersonaSheet] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    setSelectedSubject(student.preferred_subject);
    Promise.all([getTutorPersonas(), getSubjects()]).then(([p, s]) => {
      setPersonas(p as TutorPersona[]);
      setSubjects(s as Subject[]);
    });
  }, [student?.id]); // eslint-disable-line

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const currentSubject = subjects.find(s => s.code === selectedSubject);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || typing || !student) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'student', content: text.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    try {
      const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
      const result = await foxyChat({
        message: text.trim(),
        studentId: student.id,
        studentName: student.name,
        grade: student.grade,
        language,
        subject: selectedSubject,
        sessionMode,
        personaId: selectedPersona,
        history,
      }) as { response: string; model: string };
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'foxy', content: result.response, timestamp: Date.now() }]);
    } catch {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'foxy', content: isHi ? '🦊 कुछ गड़बड़ हुई। दोबारा पूछो!' : '🦊 Something went wrong! Please try again.', timestamp: Date.now() }]);
    }
    setTyping(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [typing, student, messages, language, selectedSubject, sessionMode, selectedPersona, isHi]);

  const newChat = async () => {
    if (messages.length > 0 && student) {
      await saveChatSession({ studentId: student.id, subject: selectedSubject, grade: student.grade, title: messages[1]?.content?.slice(0,60) ?? 'Chat', messages: messages.map(m => ({ role: m.role, content: m.content })) });
    }
    setMessages([]);
  };

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const quickPrompts = isHi ? QUICK_PROMPTS_HI : QUICK_PROMPTS_EN;
  const persona = personas.find(p => p.persona_id === selectedPersona);

  return (
    <div className="mesh-bg min-h-dvh flex flex-col pb-nav">
      {/* ── Header ── */}
      <header className="glass border-b border-[var(--border)] sticky top-0 z-40">
        <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1">←</button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xl"
              style={{ background: 'linear-gradient(135deg, rgba(255,107,53,0.3), rgba(255,184,0,0.2))', border: '1px solid rgba(255,107,53,0.3)' }}>
              🦊
            </div>
            <div>
              <div className="text-sm font-bold">Foxy</div>
              <div className="text-[10px] text-[var(--text-3)]">
                {persona?.display_name ?? 'AI Tutor'} · {currentSubject?.name ?? selectedSubject}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowPersonaSheet(true)} className="text-xs px-2.5 py-1.5 rounded-xl border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]">
              ✨ {isHi ? 'पर्सोना' : 'Persona'}
            </button>
            <button onClick={newChat} className="text-xs px-2.5 py-1.5 rounded-xl border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]">
              🗑 {isHi ? 'नया' : 'New'}
            </button>
          </div>
        </div>

        {/* Mode + Subject bar */}
        <div className="max-w-lg mx-auto px-4 pb-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {SESSION_MODES.map(m => (
            <button key={m.id} onClick={() => setSessionMode(m.id)}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{ background: sessionMode === m.id ? `${currentSubject?.color ?? 'var(--orange)'}20` : 'transparent',
                border: sessionMode === m.id ? `1px solid ${currentSubject?.color ?? 'var(--orange)'}` : '1px solid transparent',
                color: sessionMode === m.id ? (currentSubject?.color ?? 'var(--orange)') : 'var(--text-3)' }}>
              {m.icon} {isHi ? m.hi : m.en}
            </button>
          ))}
          <div className="w-px h-4 bg-[var(--border)] flex-shrink-0" />
          {subjects.slice(0,4).map(s => (
            <button key={s.code} onClick={() => setSelectedSubject(s.code)}
              className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{ background: selectedSubject === s.code ? `${s.color}20` : 'transparent',
                border: selectedSubject === s.code ? `1px solid ${s.color}` : '1px solid transparent',
                color: selectedSubject === s.code ? s.color : 'var(--text-3)' }}>
              {s.icon} {s.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-lg mx-auto w-full">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center pt-8 pb-4 animate-fade-in">
            <div className="text-6xl mb-4 animate-float" style={{ filter: 'drop-shadow(0 0 20px rgba(255,107,53,0.5))' }}>🦊</div>
            <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? `नमस्ते, ${student.name}!` : `Hey, ${student.name}!`}
            </h2>
            <p className="text-sm text-[var(--text-3)] mb-6 text-center max-w-xs">
              {isHi ? 'कुछ भी पूछो — मैं यहाँ हूँ!' : 'Ask me anything — I\'m here to help!'}
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              {quickPrompts.map((p, i) => (
                <button key={i} onClick={() => sendMessage(p)}
                  className="glass-mid rounded-xl p-3 text-left text-xs text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-mid)] transition-all">
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'student' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                {msg.role === 'foxy' && <div className="w-7 h-7 rounded-full flex items-center justify-center text-base flex-shrink-0 mr-2 mt-1 self-start"
                  style={{ background: 'rgba(255,107,53,0.15)', border: '1px solid rgba(255,107,53,0.2)' }}>🦊</div>}
                <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'student' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                  style={{ background: msg.role === 'student' ? 'linear-gradient(135deg, var(--orange), var(--gold))' : 'rgba(23,18,40,0.9)',
                    border: msg.role === 'foxy' ? '1px solid var(--border)' : 'none',
                    color: msg.role === 'student' ? '#fff' : 'var(--text-1)' }}>
                  {msg.role === 'foxy' ? (
                    <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="leading-relaxed">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start animate-fade-in">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-base flex-shrink-0 mr-2"
                  style={{ background: 'rgba(255,107,53,0.15)' }}>🦊</div>
                <div className="glass-mid rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--orange)' }} />
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--gold)' }} />
                  <div className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--teal)' }} />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* ── Input ── */}
      <div className="glass border-t border-[var(--border)] sticky bottom-[4.5rem] z-30">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2">
          <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            placeholder={isHi ? 'अपना सवाल पूछो…' : 'Ask your question…'}
            disabled={typing}
            className="flex-1 bg-[var(--surface-2)] rounded-2xl px-4 py-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] border border-[var(--border)] focus:outline-none focus:border-[rgba(255,107,53,0.5)] transition-colors" />
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || typing}
            className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all disabled:opacity-30 flex-shrink-0"
            style={{ background: input.trim() ? 'linear-gradient(135deg, var(--orange), var(--gold))' : 'var(--surface-2)',
              border: input.trim() ? 'none' : '1px solid var(--border)' }}>
            <span className="text-lg">↑</span>
          </button>
        </div>
      </div>

      {/* ── Persona Bottom Sheet ── */}
      {showPersonaSheet && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowPersonaSheet(false)}>
          <div className="w-full max-w-lg mx-auto glass-mid rounded-t-3xl p-6 animate-slide-up border-t border-[var(--border-mid)]" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[var(--border-mid)] mx-auto mb-4" />
            <h3 className="font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'ट्यूटर चुनो' : 'Choose your tutor'}
            </h3>
            <div className="space-y-2">
              {personas.map(p => (
                <button key={p.persona_id} onClick={() => { setSelectedPersona(p.persona_id as PersonaId); setShowPersonaSheet(false); }}
                  className="w-full rounded-xl p-3 text-left transition-all flex items-start gap-3"
                  style={{ background: selectedPersona === p.persona_id ? 'rgba(255,107,53,0.12)' : 'var(--surface-2)',
                    border: selectedPersona === p.persona_id ? '1px solid rgba(255,107,53,0.4)' : '1px solid var(--border)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: selectedPersona === p.persona_id ? 'rgba(255,107,53,0.2)' : 'rgba(255,255,255,0.05)' }}>
                    🦊
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{p.display_name}</div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">{p.description}</div>
                  </div>
                  {selectedPersona === p.persona_id && <span className="ml-auto text-[var(--orange)]">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
