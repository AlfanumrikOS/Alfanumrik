'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

// ═══════════════════════════════════════════════════════════════
// ALFANUMRIK ADAPTIVE LEARNING OS — Elevate-Inspired Web App
// Foxy by MIGA · Cusiosense Learning India Pvt. Ltd.
// ═══════════════════════════════════════════════════════════════

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const supabase = createClient(SB_URL, SB_KEY)

// ── Foxy API ─────────────────────────────────────────────────
async function foxyChat(messages: any[], profile: any) {
  const formatted = typeof messages === 'string' 
    ? [{ role: 'user', content: messages }]
    : Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }]
  
  try {
    const res = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: formatted,
        student_name: profile?.name || 'Student',
        grade: profile?.grade || 'Grade 6',
        subject: profile?.subject || 'Mathematics',
        language: profile?.language || 'en',
      }),
    })
    const data = await res.json()
    return data.text || 'Foxy had a hiccup! Try again.'
  } catch { return 'Connection issue. Please try again.' }
}

// ── Types ────────────────────────────────────────────────────
type Screen = 'loading' | 'auth' | 'onboard' | 'home' | 'foxy' | 'quiz' | 'progress' | 'profile'
type Profile = { name: string; grade: string; subject: string; language: string }

// ── Curriculum Data ──────────────────────────────────────────
const GRADES = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJECTS = [
  { id: 'Mathematics', icon: '∑', color: '#E8590C' },
  { id: 'Science', icon: '⚛', color: '#0C8599' },
  { id: 'English', icon: 'Aa', color: '#7C3AED' },
  { id: 'Hindi', icon: 'अ', color: '#D97706' },
  { id: 'Social Studies', icon: '🌍', color: '#059669' },
  { id: 'Physics', icon: '⚡', color: '#2563EB' },
  { id: 'Chemistry', icon: '🧪', color: '#DC2626' },
  { id: 'Biology', icon: '🧬', color: '#16A34A' },
]
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' }, { code: 'te', label: 'Telugu' },
  { code: 'bn', label: 'Bengali' }, { code: 'mr', label: 'Marathi' },
]
const DAILY_TOPICS = [
  { title: 'Fractions & Decimals', type: 'Learn', icon: '📐', mins: 10, color: '#E8590C' },
  { title: 'Quick Quiz', type: 'Practice', icon: '🎯', mins: 5, color: '#7C3AED' },
  { title: 'Word Problems', type: 'Challenge', icon: '🧩', mins: 8, color: '#0C8599' },
]

// ═══════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════
function AuthScreen({ onAuth }: { onAuth: (user: any) => void }) {
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const go = async () => {
    setError(''); setLoading(true)
    try {
      if (!email.includes('@')) throw new Error('Enter a valid email')
      if (pw.length < 6) throw new Error('Password must be 6+ characters')
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Enter your name')
        const { data, error: e } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name } } })
        if (e) throw e
        if (data.session) { onAuth(data.user); return }
        const { data: login, error: le } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (le) throw le
        onAuth(login.user)
      } else {
        const { data, error: e } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (e) throw e
        onAuth(data.user)
      }
    } catch (e: any) {
      setError(e.message?.includes('Invalid') ? 'Wrong email or password' : e.message || 'Something went wrong')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6" style={{ background: '#FAFAF8' }}>
      <div className="w-full max-w-sm" style={{ animation: 'fadeIn .5s' }}>
        <div className="text-center mb-10">
          <div className="text-7xl mb-3">🦊</div>
          <h1 className="text-3xl font-black tracking-tight" style={{ color: '#1C1917', fontFamily: "'DM Sans',sans-serif" }}>Alfanumrik</h1>
          <p className="text-xs mt-1" style={{ color: '#A8A29E' }}>Foxy by MIGA · AI Tutor</p>
        </div>
        <div className="flex rounded-xl p-1 mb-6" style={{ background: '#F3F2EE' }}>
          {(['login','signup'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all"
              style={{ background: mode === m ? '#FFF' : 'transparent', color: mode === m ? '#1C1917' : '#A8A29E',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>
        <div className="rounded-2xl p-6" style={{ background: '#FFF', border: '1px solid #E7E5E4' }}>
          {error && <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA' }}>{error}</div>}
          {mode === 'signup' && (
            <div className="mb-4">
              <label className="text-xs font-semibold block mb-1.5" style={{ color: '#57534E' }}>Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all" style={{ background: '#FAFAF8', border: '1.5px solid #E7E5E4', color: '#1C1917' }}
                onFocus={e => (e.target.style.borderColor = '#E8590C')} onBlur={e => (e.target.style.borderColor = '#E7E5E4')} />
            </div>
          )}
          <div className="mb-4">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: '#57534E' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ background: '#FAFAF8', border: '1.5px solid #E7E5E4', color: '#1C1917' }}
              onFocus={e => (e.target.style.borderColor = '#E8590C')} onBlur={e => (e.target.style.borderColor = '#E7E5E4')} />
          </div>
          <div className="mb-5">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: '#57534E' }}>Password</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Min 6 characters"
              onKeyDown={e => e.key === 'Enter' && go()}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ background: '#FAFAF8', border: '1.5px solid #E7E5E4', color: '#1C1917' }}
              onFocus={e => (e.target.style.borderColor = '#E8590C')} onBlur={e => (e.target.style.borderColor = '#E7E5E4')} />
          </div>
          <button onClick={go} disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: '#E8590C', color: '#FFF', opacity: loading ? .6 : 1 }}>
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Log In'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════
function OnboardScreen({ user, onComplete }: { user: any; onComplete: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(user?.user_metadata?.full_name || '')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [language, setLanguage] = useState('en')
  
  const canNext = [!!name.trim(), !!grade, !!subject, true][step]
  const finish = () => onComplete({ name: name.trim(), grade, subject, language })
  
  const titles = ['What should Foxy call you?', 'Which grade are you in?', 'Pick a subject to start', 'Choose your language']

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#1C1917' }}>
      <div className="px-6 pt-8">
        <div className="flex gap-1.5 mb-8">
          {[0,1,2,3].map(i => (
            <div key={i} className="flex-1 h-1 rounded-full" style={{ background: i <= step ? '#E8590C' : 'rgba(255,255,255,.15)' }} />
          ))}
        </div>
        <div className="text-5xl mb-6 text-center">🦊</div>
        <h2 className="text-2xl font-black text-center text-white mb-2">{titles[step]}</h2>
        <p className="text-center text-sm mb-8" style={{ color: 'rgba(255,255,255,.45)' }}>Step {step + 1} of 4</p>
      </div>
      <div className="flex-1 px-6 overflow-y-auto pb-4" key={step} style={{ animation: 'slideUp .3s' }}>
        {step === 0 && <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name"
          autoFocus className="w-full px-5 py-4 rounded-2xl text-center text-lg font-bold outline-none"
          style={{ background: 'rgba(255,255,255,.08)', color: '#FFF', border: '1.5px solid rgba(255,255,255,.12)' }}
          onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(1)} />}
        {step === 1 && <div className="grid grid-cols-3 gap-2">
          {GRADES.map(g => <button key={g} onClick={() => setGrade(g)} className="py-3.5 rounded-2xl text-sm font-bold transition-all"
            style={{ background: grade === g ? '#E8590C' : 'rgba(255,255,255,.06)', color: grade === g ? '#FFF' : 'rgba(255,255,255,.7)', border: grade === g ? 'none' : '1px solid rgba(255,255,255,.08)' }}>{g}</button>)}
        </div>}
        {step === 2 && <div className="grid grid-cols-2 gap-2">
          {SUBJECTS.map(s => <button key={s.id} onClick={() => setSubject(s.id)} className="py-4 px-3 rounded-2xl text-left transition-all"
            style={{ background: subject === s.id ? s.color : 'rgba(255,255,255,.06)', color: '#FFF', border: subject === s.id ? 'none' : '1px solid rgba(255,255,255,.08)' }}>
            <span className="text-xl block mb-1">{s.icon}</span>
            <span className="text-sm font-bold">{s.id}</span>
          </button>)}
        </div>}
        {step === 3 && <div className="grid grid-cols-2 gap-2">
          {LANGUAGES.map(l => <button key={l.code} onClick={() => setLanguage(l.code)} className="py-4 rounded-2xl text-sm font-bold transition-all"
            style={{ background: language === l.code ? '#E8590C' : 'rgba(255,255,255,.06)', color: '#FFF', border: language === l.code ? 'none' : '1px solid rgba(255,255,255,.08)' }}>{l.label}</button>)}
        </div>}
      </div>
      <div className="px-6 pb-8 flex gap-3">
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="flex-1 py-3.5 rounded-2xl text-sm font-bold"
          style={{ background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.7)' }}>Back</button>}
        <button onClick={step < 3 ? () => setStep(s => s + 1) : finish} disabled={!canNext}
          className="flex-1 py-3.5 rounded-2xl text-sm font-bold transition-all"
          style={{ background: canNext ? '#E8590C' : 'rgba(232,89,12,.25)', color: '#FFF' }}>
          {step < 3 ? 'Continue' : "Let's Go!"}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HOME SCREEN — Elevate-inspired: Daily Training + Stats
// ═══════════════════════════════════════════════════════════════
function HomeScreen({ profile, onNavigate }: { profile: Profile; onNavigate: (s: Screen) => void }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const subj = SUBJECTS.find(s => s.id === profile.subject) || SUBJECTS[0]

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <p className="text-sm font-medium" style={{ color: '#A8A29E' }}>{greeting}</p>
        <h1 className="text-2xl font-black" style={{ color: '#1C1917' }}>{profile.name}</h1>
      </div>

      {/* Daily Training Hero — Elevate style */}
      <div className="mx-5 rounded-3xl p-5 mb-5" style={{ background: 'linear-gradient(135deg, #1C1917 0%, #292524 100%)' }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,89,12,.2)', color: '#E8590C' }}>TODAY&apos;S TRAINING</span>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>3 activities · 23 min</span>
        </div>
        <div className="space-y-2.5">
          {DAILY_TOPICS.map((t, i) => (
            <button key={i} onClick={() => onNavigate('foxy')} className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all"
              style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.06)' }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,.1)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: `${t.color}20` }}>{t.icon}</div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">{t.title}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,.4)' }}>{t.type} · {t.mins} min</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="rgba(255,255,255,.3)" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          ))}
        </div>
        <button onClick={() => onNavigate('foxy')} className="w-full mt-4 py-3 rounded-2xl text-sm font-bold transition-all"
          style={{ background: '#E8590C', color: '#FFF' }}>
          Start Training
        </button>
      </div>

      {/* Quick Actions — Elevate grid */}
      <div className="px-5 mb-5">
        <h3 className="text-xs font-bold tracking-widest mb-3" style={{ color: '#A8A29E' }}>EXPLORE</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: '🦊', label: 'Ask Foxy', sub: 'AI tutor chat', screen: 'foxy' as Screen, color: '#E8590C' },
            { icon: '🎯', label: 'Quick Quiz', sub: 'Test yourself', screen: 'quiz' as Screen, color: '#7C3AED' },
            { icon: '📊', label: 'My Progress', sub: 'Track growth', screen: 'progress' as Screen, color: '#0C8599' },
            { icon: '🏆', label: 'Achievements', sub: 'Earn badges', screen: 'profile' as Screen, color: '#D97706' },
          ].map(a => (
            <button key={a.label} onClick={() => onNavigate(a.screen)} className="p-4 rounded-2xl text-left transition-all"
              style={{ background: '#FFF', border: '1px solid #E7E5E4' }}
              onMouseOver={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#E7E5E4'; e.currentTarget.style.transform = 'none' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-3" style={{ background: `${a.color}10` }}>{a.icon}</div>
              <p className="text-sm font-bold" style={{ color: '#1C1917' }}>{a.label}</p>
              <p className="text-xs mt-0.5" style={{ color: '#A8A29E' }}>{a.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row */}
      <div className="px-5">
        <h3 className="text-xs font-bold tracking-widest mb-3" style={{ color: '#A8A29E' }}>THIS WEEK</h3>
        <div className="flex gap-3">
          {[{ v: '0', l: 'XP earned', icon: '⚡' }, { v: '0', l: 'Day streak', icon: '🔥' }, { v: '0', l: 'Quizzes', icon: '✅' }].map(s => (
            <div key={s.l} className="flex-1 p-3 rounded-2xl text-center" style={{ background: '#F5F4F0' }}>
              <span className="text-lg">{s.icon}</span>
              <p className="text-xl font-black mt-1" style={{ color: '#1C1917' }}>{s.v}</p>
              <p className="text-[10px] font-medium" style={{ color: '#A8A29E' }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FOXY CHAT SCREEN
// ═══════════════════════════════════════════════════════════════
function FoxyScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [messages, setMessages] = useState<{ id: number; text: string; isUser: boolean }[]>([
    { id: 1, text: `Hey ${profile.name}! I'm Foxy, your ${profile.subject} tutor. What shall we learn today?`, isUser: false }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg = text.trim()
    setMessages(p => [...p, { id: Date.now(), text: userMsg, isUser: true }])
    setInput(''); setLoading(true)
    const newHistory = [...history, { role: 'user', content: userMsg }]
    const reply = await foxyChat(newHistory, profile)
    setMessages(p => [...p, { id: Date.now() + 1, text: reply, isUser: false }])
    setHistory([...newHistory, { role: 'assistant', content: reply }])
    setLoading(false)
    inputRef.current?.focus()
  }

  const chips = ['Explain a concept', 'Give me a question', 'Help with homework', 'Quiz me']

  return (
    <div className="h-dvh flex flex-col" style={{ background: '#FAFAF8' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(16px)', borderColor: '#E7E5E4' }}>
        <button onClick={onBack} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#F5F4F0' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4l-4 4 4 4" stroke="#57534E" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm" style={{ background: 'linear-gradient(135deg,#E8590C,#DC2626)' }}>🦊</div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: '#1C1917' }}>Foxy</p>
          <p className="text-[10px]" style={{ color: '#A8A29E' }}>{profile.subject} · {profile.grade}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.isUser ? 'justify-end' : 'justify-start'}`}>
            {!m.isUser && <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs mr-2 mt-1 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#E8590C,#DC2626)' }}>🦊</div>}
            <div className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed" style={{
              background: m.isUser ? '#1C1917' : '#FFF',
              color: m.isUser ? '#FFF' : '#1C1917',
              border: m.isUser ? 'none' : '1px solid #E7E5E4',
              borderTopLeftRadius: m.isUser ? 16 : 4,
              borderTopRightRadius: m.isUser ? 4 : 16,
              whiteSpace: 'pre-wrap',
            }}>{m.text}</div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 px-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs" style={{ background: 'linear-gradient(135deg,#E8590C,#DC2626)' }}>🦊</div>
            <div className="flex gap-1 px-3 py-2">{[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8590C', animation: `pulse 1s ${i * .2}s infinite` }} />)}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Chips */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 flex-wrap">
          {chips.map(c => <button key={c} onClick={() => send(c)} className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: '#F5F4F0', color: '#57534E', border: '1px solid #E7E5E4' }}>{c}</button>)}
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-6 pt-2" style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(16px)' }}>
        <div className="flex gap-2 items-center rounded-2xl px-4" style={{ background: '#FFF', border: '1px solid #E7E5E4' }}>
          <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send(input)} placeholder="Ask Foxy anything..."
            className="flex-1 py-3.5 text-sm outline-none bg-transparent" style={{ color: '#1C1917' }} />
          <button onClick={() => send(input)} disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
            style={{ background: input.trim() && !loading ? '#E8590C' : '#F5F4F0' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2m0 0l-4 4m4-4l4 4" stroke={input.trim() && !loading ? '#FFF' : '#A8A29E'} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PROGRESS SCREEN — Elevate-inspired stats
// ═══════════════════════════════════════════════════════════════
function ProgressScreen({ profile }: { profile: Profile }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  return (
    <div className="pb-24">
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#1C1917' }}>Progress</h1>
        <p className="text-sm" style={{ color: '#A8A29E' }}>{profile.subject} · {profile.grade}</p>
      </div>
      {/* Weekly Activity */}
      <div className="mx-5 p-5 rounded-2xl mb-4" style={{ background: '#FFF', border: '1px solid #E7E5E4' }}>
        <h3 className="text-xs font-bold tracking-widest mb-4" style={{ color: '#A8A29E' }}>WEEKLY ACTIVITY</h3>
        <div className="flex items-end gap-2 h-24 mb-3">
          {days.map((d, i) => {
            const h = Math.random() * 80 + 10
            return (
              <div key={d} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-lg transition-all" style={{ height: `${h}%`, background: i === new Date().getDay() - 1 ? '#E8590C' : '#F5F4F0', minHeight: 4 }} />
                <span className="text-[9px] font-bold" style={{ color: i === new Date().getDay() - 1 ? '#E8590C' : '#A8A29E' }}>{d}</span>
              </div>
            )
          })}
        </div>
      </div>
      {/* Skill Breakdown */}
      <div className="mx-5 p-5 rounded-2xl mb-4" style={{ background: '#FFF', border: '1px solid #E7E5E4' }}>
        <h3 className="text-xs font-bold tracking-widest mb-4" style={{ color: '#A8A29E' }}>SKILL LEVELS</h3>
        {['Number Sense', 'Algebra', 'Geometry', 'Data Handling', 'Problem Solving'].map((s, i) => (
          <div key={s} className="mb-3 last:mb-0">
            <div className="flex justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: '#1C1917' }}>{s}</span>
              <span className="text-xs font-bold" style={{ color: '#E8590C' }}>{Math.round(20 + Math.random() * 40)}%</span>
            </div>
            <div className="h-2 rounded-full" style={{ background: '#F5F4F0' }}>
              <div className="h-full rounded-full" style={{ width: `${20 + Math.random() * 40}%`, background: ['#E8590C','#7C3AED','#0C8599','#D97706','#16A34A'][i] }} />
            </div>
          </div>
        ))}
      </div>
      {/* Achievements Preview */}
      <div className="mx-5 p-5 rounded-2xl" style={{ background: '#FFF', border: '1px solid #E7E5E4' }}>
        <h3 className="text-xs font-bold tracking-widest mb-3" style={{ color: '#A8A29E' }}>RECENT BADGES</h3>
        <div className="flex gap-3">
          {['🌟','🎯','🔥','📚'].map((b, i) => (
            <div key={i} className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl" style={{ background: '#F5F4F0', opacity: i > 1 ? .3 : 1 }}>{b}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PROFILE SCREEN
// ═══════════════════════════════════════════════════════════════
function ProfileScreen({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  return (
    <div className="pb-24">
      <div className="px-5 pt-6 pb-6 text-center">
        <div className="w-20 h-20 rounded-full mx-auto mb-3 flex items-center justify-center text-3xl font-black"
          style={{ background: 'linear-gradient(135deg,#E8590C,#DC2626)', color: '#FFF' }}>{profile.name.charAt(0).toUpperCase()}</div>
        <h1 className="text-xl font-black" style={{ color: '#1C1917' }}>{profile.name}</h1>
        <p className="text-sm" style={{ color: '#A8A29E' }}>{profile.grade} · {profile.subject}</p>
      </div>
      <div className="mx-5 rounded-2xl overflow-hidden mb-4" style={{ border: '1px solid #E7E5E4' }}>
        {[{ l: 'Edit Profile', v: '' }, { l: 'Language', v: LANGUAGES.find(l => l.code === profile.language)?.label }, { l: 'Notifications', v: 'On' }].map((item, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-4" style={{ background: '#FFF', borderBottom: i < 2 ? '1px solid #F5F4F0' : 'none' }}>
            <span className="text-sm font-medium" style={{ color: '#1C1917' }}>{item.l}</span>
            <span className="text-sm" style={{ color: '#A8A29E' }}>{item.v}</span>
          </div>
        ))}
      </div>
      <div className="mx-5">
        <button onClick={onLogout} className="w-full py-3.5 rounded-2xl text-sm font-bold" style={{ background: '#FEE2E2', color: '#DC2626' }}>Sign Out</button>
      </div>
      <p className="text-center text-[10px] mt-6" style={{ color: '#D4D0C8' }}>Alfanumrik v1.0 · Cusiosense Learning India Pvt. Ltd.</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BOTTOM NAV — Elevate style (4 tabs, clean)
// ═══════════════════════════════════════════════════════════════
function BottomNav({ active, onNavigate }: { active: Screen; onNavigate: (s: Screen) => void }) {
  const tabs: { screen: Screen; label: string; icon: string }[] = [
    { screen: 'home', label: 'Today', icon: '◉' },
    { screen: 'progress', label: 'Progress', icon: '◔' },
    { screen: 'foxy', label: 'Foxy', icon: '🦊' },
    { screen: 'profile', label: 'Profile', icon: '◐' },
  ]
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-around py-2 pb-5 border-t"
      style={{ background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(20px)', borderColor: '#E7E5E4' }}>
      {tabs.map(t => {
        const isActive = active === t.screen
        return (
          <button key={t.screen} onClick={() => onNavigate(t.screen)} className="flex flex-col items-center gap-0.5 px-4 py-1 transition-all">
            <span className="text-lg" style={{ opacity: isActive ? 1 : .4 }}>{t.icon}</span>
            <span className="text-[10px] font-bold" style={{ color: isActive ? '#E8590C' : '#A8A29E' }}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP — Screen Router
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        // Check if onboarding is complete
        const saved = localStorage.getItem('alfanumrik_profile')
        if (saved) { setProfile(JSON.parse(saved)); setScreen('home') }
        else setScreen('onboard')
      } else { setScreen('auth') }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(session.user)
      else { setUser(null); setScreen('auth') }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleAuth = (u: any) => {
    setUser(u)
    const saved = localStorage.getItem('alfanumrik_profile')
    if (saved) { setProfile(JSON.parse(saved)); setScreen('home') }
    else setScreen('onboard')
  }

  const handleOnboard = (p: Profile) => {
    setProfile(p)
    localStorage.setItem('alfanumrik_profile', JSON.stringify(p))
    setScreen('home')
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('alfanumrik_profile')
    setUser(null); setProfile(null); setScreen('auth')
  }

  const navigate = (s: Screen) => setScreen(s)

  // Loading
  if (screen === 'loading') return (
    <div className="min-h-dvh flex items-center justify-center" style={{ background: '#FAFAF8' }}>
      <div className="text-center">
        <div className="text-5xl mb-3" style={{ animation: 'pulse 1.5s infinite' }}>🦊</div>
        <p className="text-sm font-bold" style={{ color: '#A8A29E' }}>Loading...</p>
      </div>
    </div>
  )

  // Auth
  if (screen === 'auth') return <AuthScreen onAuth={handleAuth} />
  
  // Onboard
  if (screen === 'onboard') return <OnboardScreen user={user} onComplete={handleOnboard} />

  // Foxy (full screen, no nav)
  if (screen === 'foxy' && profile) return <FoxyScreen profile={profile} onBack={() => setScreen('home')} />

  // Screens with nav
  const showNav = ['home', 'progress', 'profile', 'quiz'].includes(screen)

  return (
    <div className="min-h-dvh" style={{ background: '#FAFAF8' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
        * { font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
        ::-webkit-scrollbar { width: 0; }
      `}</style>
      
      {screen === 'home' && profile && <HomeScreen profile={profile} onNavigate={navigate} />}
      {screen === 'progress' && profile && <ProgressScreen profile={profile} />}
      {screen === 'profile' && profile && <ProfileScreen profile={profile} onLogout={handleLogout} />}
      {screen === 'quiz' && profile && <HomeScreen profile={profile} onNavigate={navigate} />}
      
      {showNav && <BottomNav active={screen} onNavigate={navigate} />}
    </div>
  )
}
