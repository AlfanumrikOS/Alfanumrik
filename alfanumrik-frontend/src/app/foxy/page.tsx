'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { foxyChat, saveChatSession } from '@/lib/supabase';
import { SUBJECT_CONFIG, type Subject, type ChatMessage } from '@/lib/types';
import { ArrowLeft, Send, Sparkles, BookOpen, HelpCircle, Brain, RotateCcw } from 'lucide-react';

type SessionMode = 'learn' | 'practice' | 'doubt' | 'quiz';

const SESSION_MODES: Array<{ id: SessionMode; icon: React.ReactNode; labelEn: string; labelHi: string }> = [
  { id: 'learn', icon: <BookOpen className="w-4 h-4" />, labelEn: 'Learn', labelHi: 'सीखो' },
  { id: 'practice', icon: <Brain className="w-4 h-4" />, labelEn: 'Practice', labelHi: 'अभ्यास' },
  { id: 'doubt', icon: <HelpCircle className="w-4 h-4" />, labelEn: 'Ask Doubt', labelHi: 'सवाल पूछो' },
  { id: 'quiz', icon: <Sparkles className="w-4 h-4" />, labelEn: 'Quick Quiz', labelHi: 'क्विज़' },
];

export default function FoxyPage() {
  const { student, isLoggedIn, isLoading, isHi } = useStudent();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('learn');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoggedIn && !isLoading) router.push('/');
  }, [isLoggedIn, isLoading]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  if (isLoading || !student) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-2xl animate-pulse">🦊</div>
    </div>
  );

  const subjectCfg = SUBJECT_CONFIG[(student.subject as Subject) || 'math'];

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'student',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const result = await foxyChat({
        message: text.trim(),
        studentName: student.name,
        grade: student.grade,
        language: student.language,
        subject: student.subject,
        sessionMode,
        history,
      });

      const foxyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'foxy',
        content: result.response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, foxyMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'foxy',
        content: isHi ? '🦊 ओह! कुछ गड़बड़ हुई। दोबारा पूछो!' : '🦊 Oops! Something went wrong. Please try again!',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }
    setIsTyping(false);
  };

  const handleNewChat = async () => {
    // Save current session before starting new
    if (messages.length > 0 && student.id) {
      await saveChatSession({
        studentId: student.id,
        subjectId: student.subject,
        sessionMode,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
    }
    setMessages([]);
  };

  const quickPrompts = isHi
    ? ['न्यूटन के नियम समझाओ', 'द्विघात समीकरण क्या है?', 'प्रकाश संश्लेषण बताओ', 'ओम का नियम समझाओ']
    : ['Explain Newton\'s Laws', 'What are quadratic equations?', 'Teach me photosynthesis', 'How does Ohm\'s Law work?'];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
            <div className="flex items-center gap-2">
              <span className="text-xl">🦊</span>
              <div>
                <div className="font-bold text-sm">Foxy</div>
                <div className="text-[10px] text-white/25">{isHi ? 'AI ट्यूटर' : 'AI Tutor'} • {subjectCfg.icon} {isHi ? subjectCfg.nameHi : subjectCfg.nameEn}</div>
              </div>
            </div>
          </div>
          <button onClick={handleNewChat} className="p-2 rounded-lg hover:bg-white/5 transition-colors" title="New chat">
            <RotateCcw className="w-4 h-4 text-white/30" />
          </button>
        </div>
        {/* Session mode tabs */}
        <div className="max-w-2xl mx-auto px-4 pb-2 flex gap-2">
          {SESSION_MODES.map(mode => (
            <button key={mode.id} onClick={() => setSessionMode(mode.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{
              background: sessionMode === mode.id ? `${subjectCfg.color}20` : 'transparent',
              color: sessionMode === mode.id ? subjectCfg.color : 'rgba(255,255,255,0.3)',
              border: sessionMode === mode.id ? `1px solid ${subjectCfg.color}40` : '1px solid transparent',
            }}>
              {mode.icon}
              {isHi ? mode.labelHi : mode.labelEn}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="pt-8 text-center">
              <div className="text-5xl mb-4">🦊</div>
              <h2 className="text-xl font-bold mb-2">{isHi ? `नमस्ते, ${student.name}!` : `Hey, ${student.name}!`}</h2>
              <p className="text-sm text-white/40 mb-6">{isHi ? 'मुझसे कुछ भी पूछो — मैं तुम्हारी मदद के लिए हूँ!' : 'Ask me anything — I\'m here to help you learn!'}</p>
              <div className="grid grid-cols-2 gap-2">
                {quickPrompts.map((prompt, i) => (
                  <button key={i} onClick={() => sendMessage(prompt)} className="p-3 rounded-xl text-left text-sm transition-all border border-white/5 hover:border-white/15" style={{background:'rgba(30,27,46,0.5)'}}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'student' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl ${
                  msg.role === 'student' 
                    ? 'rounded-br-md' 
                    : 'rounded-bl-md'
                }`} style={{
                  background: msg.role === 'student' 
                    ? 'linear-gradient(135deg,#FF6B35,#FFB800)' 
                    : 'rgba(30,27,46,0.8)',
                  border: msg.role === 'foxy' ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}>
                  {msg.role === 'foxy' && <div className="text-xs text-white/30 mb-1">🦊 Foxy</div>}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div className="flex justify-start">
              <div className="p-4 rounded-2xl rounded-bl-md" style={{background:'rgba(30,27,46,0.8)', border:'1px solid rgba(255,255,255,0.05)'}}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background:'#FF6B35', animationDelay:'0ms'}} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background:'#FFB800', animationDelay:'150ms'}} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{background:'#00B4D8', animationDelay:'300ms'}} />
                </div>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 glass border-t border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
              placeholder={isHi ? 'अपना सवाल पूछो...' : 'Ask your question...'}
              className="flex-1 px-4 py-3 rounded-xl bg-surface-800/50 border border-white/10 text-white placeholder-white/30 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all text-sm"
              disabled={isTyping}
            />
            <button onClick={() => sendMessage(input)} disabled={!input.trim() || isTyping} className="w-11 h-11 rounded-xl flex items-center justify-center transition-all disabled:opacity-30" style={{background: input.trim() ? 'linear-gradient(135deg,#FF6B35,#FFB800)' : '#333'}}>
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
