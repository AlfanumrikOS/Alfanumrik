'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { chatWithFoxy } from '@/lib/supabase';
import { FOXY_MODES } from '@/lib/constants';
import { Card, Button, LoadingFoxy, BottomNav } from '@/components/ui';
import type { ChatMessage } from '@/lib/types';

export default function FoxyChat() {
  const { student, isLoggedIn, isLoading, isHi, language } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [mode, setMode] = useState('learn');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || !student || sending) return;
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const response = await chatWithFoxy({
      message: msg,
      student_id: student.id,
      session_id: sessionId || undefined,
      subject: student.preferred_subject ?? undefined,
      grade: student.grade,
      language,
      mode,
    });

    if (response.session_id) setSessionId(response.session_id);
    const botMsg: ChatMessage = { role: 'assistant', content: response.reply, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, botMsg]);
    setSending(false);
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const quickPrompts = isHi
    ? ['मुझे आज का टॉपिक समझाओ', 'एक quiz लो', 'कल का revision करो', 'ये doubt clear करो']
    : ['Teach me today\'s topic', 'Give me a quiz', 'Revise yesterday\'s topic', 'Clear my doubt'];

  return (
    <div className="mesh-bg min-h-dvh flex flex-col pb-nav">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] hover:text-[var(--text-1)]">←</button>
              <div className="text-2xl">🦊</div>
              <div>
                <h1 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>Foxy</h1>
                <p className="text-[10px] text-[var(--text-3)]">{isHi ? 'तुम्हारा AI ट्यूटर' : 'Your AI Tutor'}</p>
              </div>
            </div>
            <button onClick={() => { setMessages([]); setSessionId(''); }} className="text-xs px-3 py-1.5 rounded-xl border" style={{ borderColor: 'var(--border-mid)', color: 'var(--text-3)' }}>
              {isHi ? 'नई चैट' : 'New Chat'}
            </button>
          </div>
          {/* Mode Selector */}
          <div className="flex gap-1.5 mt-3 overflow-x-auto">
            {FOXY_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: mode === m.id ? 'rgba(232,88,28,0.1)' : 'var(--surface-2)',
                  border: mode === m.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                  color: mode === m.id ? 'var(--orange)' : 'var(--text-3)',
                }}
              >
                {m.icon} {isHi ? m.labelHi : m.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 max-w-lg mx-auto w-full">
        {messages.length === 0 ? (
          <div className="text-center pt-8 pb-4">
            <div className="text-5xl mb-4 animate-float">🦊</div>
            <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'नमस्ते! मैं Foxy हूँ' : 'Hey! I\'m Foxy'}
            </h2>
            <p className="text-sm text-[var(--text-3)] mb-6 max-w-xs mx-auto">
              {isHi ? 'कुछ भी पूछो — पढ़ाई, doubt, quiz सब!' : 'Ask me anything — lessons, doubts, quizzes!'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="p-3 rounded-xl text-xs text-left font-medium transition-all"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {msg.role === 'assistant' && <div className="text-xl flex-shrink-0 mt-1">🦊</div>}
                <div
                  className={`max-w-[82%] rounded-2xl p-3.5 text-sm leading-relaxed ${
                    msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                  }`}
                  style={{
                    background: msg.role === 'user' ? 'linear-gradient(135deg, var(--orange), var(--orange-light, #FF7A3D))' : 'var(--surface-1)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-1)',
                    border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                    boxShadow: msg.role === 'assistant' ? '0 2px 8px rgba(0,0,0,0.03)' : 'none',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex items-start gap-2">
                <div className="text-xl">🦊</div>
                <div className="rounded-2xl rounded-bl-sm p-3.5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--orange)' }} />
                    <span className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--orange)' }} />
                    <span className="w-2 h-2 rounded-full typing-dot" style={{ background: 'var(--orange)' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="sticky bottom-[4.5rem] z-30 border-t px-4 py-3" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(16px)', borderColor: 'var(--border)' }}>
        <div className="max-w-lg mx-auto flex gap-2">
          <input
            className="input-base flex-1 !py-3"
            placeholder={isHi ? 'Foxy से पूछो...' : 'Ask Foxy anything...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={sending}
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FF7A3D))' }}
          >
            ↑
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
