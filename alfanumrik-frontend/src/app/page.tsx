'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const supabase = createClient(SB_URL, SB_KEY)

async function foxyChat(messages: any[], profile: any) {
  const formatted = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }]
  try {
    const res = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: formatted, student_name: profile?.name || 'Student', grade: profile?.grade || 'Grade 6', subject: profile?.subject || 'Mathematics', language: profile?.language || 'en' }),
    })
    const data = await res.json()
    return data.text || 'Foxy had a hiccup! Try again.'
  } catch { return 'Connection issue. Please try again.' }
}

type Screen = 'loading' | 'auth' | 'onboard' | 'home' | 'foxy' | 'quiz' | 'progress' | 'profile'
type Profile = { name: string; grade: string; subject: string; language: string }

const GRADES = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJECTS = [
  { id: 'Mathematics', icon: '\u2211', color: '#E8590C' }, { id: 'Science', icon: '\u269B', color: '#0C8599' },
  { id: 'English', icon: 'Aa', color: '#7C3AED' }, { id: 'Hindi', icon: '\u0905', color: '#D97706' },
  { id: 'Social Studies', icon: '\uD83C\uDF0D', color: '#059669' }, { id: 'Physics', icon: '\u26A1', color: '#2563EB' },
  { id: 'Chemistry', icon: '\uD83E\uDDEA', color: '#DC2626' }, { id: 'Biology', icon: '\uD83E\uDDEC', color: '#16A34A' },
]
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' }, { code: 'te', label: 'Telugu' },
  { code: 'bn', label: 'Bengali' }, { code: 'mr', label: 'Marathi' },
]

function AuthScreen({ onAuth }: { onAuth: (u: any) => void }) {
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('')
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
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
        if (le) throw le; onAuth(login.user)
      } else {
        const { data, error: e } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (e) throw e; onAuth(data.user)
      }
    } catch (e: any) { setError(e.message?.includes('Invalid') ? 'Wrong email or password' : e.message || 'Something went wrong') }
    setLoading(false)
  }
  return (
    <div className="alf-auth-page">
      <div className="alf-auth-left">
        <div><div style={{fontSize:56}}>&#x1F98A;</div><h1 style={{fontSize:42,fontWeight:900,letterSpacing:'-.02em',marginTop:16}}>Alfanumrik</h1><p style={{fontSize:16,color:'rgba(255,255,255,.5)',marginTop:8}}>AI-powered adaptive learning for every Indian student</p></div>
        <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:48}}>
          {['Personalized AI tutor \u2014 Foxy','NCERT Class 6\u201312 curriculum','Learn in Hindi, English & more','Quizzes, progress & badges'].map(f => (
            <div key={f} style={{fontSize:15,color:'rgba(255,255,255,.7)',display:'flex',alignItems:'center',gap:10}}><span style={{color:'#E8590C',fontWeight:700}}>&#10003;</span>{f}</div>
          ))}
        </div>
        <p style={{marginTop:48,fontSize:12,color:'rgba(255,255,255,.25)'}}>Cusiosense Learning India Pvt. Ltd.</p>
      </div>
      <div className="alf-auth-right">
        <div style={{width:'100%',maxWidth:400}}>
          <h2 style={{fontSize:28,fontWeight:800,marginBottom:4}}>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          <p style={{fontSize:14,color:'#A8A29E',marginBottom:24}}>{mode === 'login' ? 'Log in to continue learning' : 'Start your learning journey'}</p>
          <div className="alf-auth-tabs">
            {(['login','signup'] as const).map(m => (<button key={m} onClick={() => { setMode(m); setError('') }} className={`alf-auth-tab ${mode === m ? 'active' : ''}`}>{m === 'login' ? 'Log In' : 'Sign Up'}</button>))}
          </div>
          {error && <div style={{background:'#FEE2E2',color:'#B91C1C',border:'1px solid #FECACA',borderRadius:12,padding:'10px 14px',fontSize:13,marginBottom:14}}>{error}</div>}
          {mode === 'signup' && <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className="alf-auth-input" />}
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" className="alf-auth-input" />
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" className="alf-auth-input" onKeyDown={e => e.key === 'Enter' && go()} />
          <button onClick={go} disabled={loading} className="alf-auth-btn">{loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Log In'}</button>
        </div>
      </div>
    </div>
  )
}

function OnboardScreen({ user, onComplete }: { user: any; onComplete: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(user?.user_metadata?.full_name || '')
  const [grade, setGrade] = useState(''); const [subject, setSubject] = useState(''); const [language, setLanguage] = useState('en')
  const canNext = [!!name.trim(), !!grade, !!subject, true][step]
  const titles = ['What should Foxy call you?', 'Which grade?', 'Pick a subject', 'Choose language']
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#1C1917'}}>
      <div style={{width:'100%',maxWidth:480,padding:'40px 24px',textAlign:'center'}}>
        <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:32}}>{[0,1,2,3].map(i => <div key={i} style={{height:8,borderRadius:4,background:i<=step?'#E8590C':'rgba(255,255,255,.15)',transition:'all .3s',width:i<=step?24:8}} />)}</div>
        <div style={{fontSize:56,marginBottom:16}}>&#x1F98A;</div>
        <h2 style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:4}}>{titles[step]}</h2>
        <p style={{fontSize:13,color:'rgba(255,255,255,.35)',marginBottom:28}}>Step {step+1} of 4</p>
        <div key={step} style={{animation:'slideUp .25s',minHeight:160}}>
          {step===0 && <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" autoFocus onKeyDown={e=>e.key==='Enter'&&name.trim()&&setStep(1)} style={{width:'100%',padding:16,borderRadius:16,border:'1.5px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.06)',color:'#fff',fontSize:18,fontWeight:700,textAlign:'center',outline:'none',fontFamily:'inherit'}} />}
          {step===1 && <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>{GRADES.map(g=><button key={g} onClick={()=>setGrade(g)} style={{padding:'14px 12px',borderRadius:14,border:grade===g?'none':'1px solid rgba(255,255,255,.08)',background:grade===g?'#E8590C':'rgba(255,255,255,.05)',color:grade===g?'#fff':'rgba(255,255,255,.7)',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{g}</button>)}</div>}
          {step===2 && <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>{SUBJECTS.map(s=><button key={s.id} onClick={()=>setSubject(s.id)} style={{padding:'14px 12px',borderRadius:14,border:subject===s.id?'none':'1px solid rgba(255,255,255,.08)',background:subject===s.id?s.color:'rgba(255,255,255,.05)',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',textAlign:'left',display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{s.icon}</span>{s.id}</button>)}</div>}
          {step===3 && <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>{LANGUAGES.map(l=><button key={l.code} onClick={()=>setLanguage(l.code)} style={{padding:14,borderRadius:14,border:language===l.code?'none':'1px solid rgba(255,255,255,.08)',background:language===l.code?'#E8590C':'rgba(255,255,255,.05)',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{l.label}</button>)}</div>}
        </div>
        <div style={{display:'flex',gap:10,marginTop:28}}>
          {step>0 && <button onClick={()=>setStep(s=>s-1)} style={{flex:1,padding:14,borderRadius:14,border:'none',background:'rgba(255,255,255,.08)',color:'rgba(255,255,255,.6)',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Back</button>}
          <button onClick={step<3?()=>setStep(s=>s+1):()=>onComplete({name:name.trim(),grade,subject,language})} disabled={!canNext} style={{flex:2,padding:14,borderRadius:14,border:'none',background:canNext?'#E8590C':'rgba(232,89,12,.25)',color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{step<3?'Continue':"Let's Go!"}</button>
        </div>
      </div>
    </div>
  )
}

function HomeContent({ profile, onNavigate }: { profile: Profile; onNavigate: (s: Screen) => void }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const topics = [{ title: 'Fractions & Decimals', type: 'Learn', icon: '\uD83D\uDCD0', mins: 10, color: '#E8590C' },{ title: 'Quick Quiz', type: 'Practice', icon: '\uD83C\uDFAF', mins: 5, color: '#7C3AED' },{ title: 'Word Problems', type: 'Challenge', icon: '\uD83E\uDDE9', mins: 8, color: '#0C8599' }]
  return (
    <div className="alf-content-area">
      <div className="alf-content-header"><div><p className="alf-greeting">{greeting}</p><h1 className="alf-content-title">{profile.name}</h1></div><div className="alf-header-badge">{profile.grade} &middot; {profile.subject}</div></div>
      <div className="alf-home-layout">
        <div className="alf-daily-card">
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}><span className="alf-daily-badge">TODAY&apos;S TRAINING</span><span style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>3 activities &middot; 23 min</span></div>
          {topics.map((t, i) => (<button key={i} onClick={() => onNavigate('foxy')} className="alf-daily-item"><div style={{width:40,height:40,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:`${t.color}20`,flexShrink:0}}>{t.icon}</div><div style={{flex:1,textAlign:'left'}}><p style={{fontSize:14,fontWeight:700,color:'#fff'}}>{t.title}</p><p style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>{t.type} &middot; {t.mins} min</p></div><span style={{color:'rgba(255,255,255,.25)',fontSize:20}}>&rsaquo;</span></button>))}
          <button onClick={() => onNavigate('foxy')} className="alf-daily-start">Start Training</button>
        </div>
        <div className="alf-home-right">
          <div className="alf-actions-grid">
            {[{ icon: '\uD83E\uDD8A', label: 'Ask Foxy', sub: 'AI tutor chat', screen: 'foxy' as Screen, color: '#E8590C' },{ icon: '\uD83C\uDFAF', label: 'Quick Quiz', sub: 'Test yourself', screen: 'quiz' as Screen, color: '#7C3AED' },{ icon: '\uD83D\uDCCA', label: 'Progress', sub: 'Track growth', screen: 'progress' as Screen, color: '#0C8599' },{ icon: '\uD83C\uDFC6', label: 'Badges', sub: 'Achievements', screen: 'profile' as Screen, color: '#D97706' }].map(a => (
              <button key={a.label} onClick={() => onNavigate(a.screen)} className="alf-action-card"><div style={{width:40,height:40,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:`${a.color}10`,marginBottom:10}}>{a.icon}</div><p style={{fontSize:14,fontWeight:700,color:'#1C1917'}}>{a.label}</p><p style={{fontSize:12,color:'#A8A29E',marginTop:2}}>{a.sub}</p></button>
            ))}
          </div>
          <div className="alf-stats-row">
            {[{ v: '0', l: 'XP earned', i: '\u26A1' }, { v: '0', l: 'Day streak', i: '\uD83D\uDD25' }, { v: '0', l: 'Quizzes', i: '\u2705' }].map(s => (<div key={s.l} className="alf-stat-card"><span style={{fontSize:20}}>{s.i}</span><p style={{fontSize:22,fontWeight:900,color:'#1C1917',margin:'4px 0 0'}}>{s.v}</p><p style={{fontSize:11,color:'#A8A29E',fontWeight:600}}>{s.l}</p></div>))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FoxyContent({ profile }: { profile: Profile }) {
  const [messages, setMessages] = useState<{ id: number; text: string; isUser: boolean }[]>([{ id: 1, text: `Hey ${profile.name}! I'm Foxy, your ${profile.subject} tutor. What shall we learn today?`, isUser: false }])
  const [input, setInput] = useState(''); const [loading, setLoading] = useState(false); const [history, setHistory] = useState<any[]>([])
  const endRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const send = async (text: string) => {
    if (!text.trim() || loading) return
    const msg = text.trim(); setMessages(p => [...p, { id: Date.now(), text: msg, isUser: true }]); setInput(''); setLoading(true)
    const nh = [...history, { role: 'user', content: msg }]
    const reply = await foxyChat(nh, profile)
    setMessages(p => [...p, { id: Date.now() + 1, text: reply, isUser: false }])
    setHistory([...nh, { role: 'assistant', content: reply }]); setLoading(false); inputRef.current?.focus()
  }
  return (
    <div className="alf-chat-area">
      <div className="alf-chat-header"><div style={{width:36,height:36,borderRadius:12,background:'linear-gradient(135deg,#E8590C,#DC2626)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>&#x1F98A;</div><div><p style={{fontSize:15,fontWeight:700,color:'#1C1917'}}>Foxy &mdash; MIGA Tutor</p><p style={{fontSize:12,color:'#A8A29E'}}>{profile.subject} &middot; {profile.grade}</p></div></div>
      <div className="alf-chat-messages">
        {messages.map(m => (<div key={m.id} className={`alf-chat-row ${m.isUser ? 'user' : 'bot'}`}>{!m.isUser && <div className="alf-chat-bot-av">&#x1F98A;</div>}<div className={`alf-chat-bubble ${m.isUser ? 'user' : 'bot'}`}>{m.text}</div></div>))}
        {loading && <div className="alf-chat-row bot"><div className="alf-chat-bot-av">&#x1F98A;</div><div className="alf-chat-typing"><span/><span/><span/></div></div>}
        <div ref={endRef} />
      </div>
      {messages.length <= 2 && <div className="alf-chat-chips">{['Explain a concept','Give me a question','Help with homework','Quiz me'].map(c => <button key={c} onClick={() => send(c)} className="alf-chip">{c}</button>)}</div>}
      <div className="alf-chat-input-bar">
        <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(input)} placeholder="Ask Foxy anything..." className="alf-chat-input" />
        <button onClick={() => send(input)} disabled={!input.trim() || loading} className="alf-chat-send"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M7 12V4m0 0L3 8m4-4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
      </div>
    </div>
  )
}

function ProgressContent({ profile }: { profile: Profile }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; const skills = ['Number Sense','Algebra','Geometry','Data Handling','Problem Solving']; const colors = ['#E8590C','#7C3AED','#0C8599','#D97706','#16A34A']
  return (
    <div className="alf-content-area">
      <div className="alf-content-header"><div><h1 className="alf-content-title">Progress</h1><p className="alf-greeting">{profile.subject} &middot; {profile.grade}</p></div></div>
      <div className="alf-progress-grid">
        <div className="alf-card"><h3 className="alf-card-title">WEEKLY ACTIVITY</h3><div className="alf-week-bars">{days.map((d, i) => { const h = 15 + Math.random() * 70; return <div key={d} className="alf-week-col"><div className="alf-week-bar" style={{ height: `${h}%`, background: i === new Date().getDay() - 1 ? '#E8590C' : '#EDEBE6' }} /><span style={{fontSize:10,fontWeight:700,color: i === new Date().getDay()-1 ? '#E8590C' : '#A8A29E'}}>{d}</span></div> })}</div></div>
        <div className="alf-card"><h3 className="alf-card-title">SKILL LEVELS</h3>{skills.map((s, i) => { const pct = 20 + Math.round(Math.random() * 40); return <div key={s} style={{marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:13,fontWeight:600,color:'#1C1917'}}>{s}</span><span style={{fontSize:13,fontWeight:700,color:colors[i]}}>{pct}%</span></div><div style={{height:8,borderRadius:4,background:'#F5F4F0'}}><div style={{height:'100%',borderRadius:4,width:`${pct}%`,background:colors[i]}} /></div></div> })}</div>
        <div className="alf-card"><h3 className="alf-card-title">RECENT BADGES</h3><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{['\uD83C\uDF1F','\uD83C\uDFAF','\uD83D\uDD25','\uD83D\uDCDA','\uD83D\uDCA1','\uD83C\uDFC6'].map((b, i) => <div key={i} style={{width:48,height:48,borderRadius:14,background:'#F5F4F0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,opacity:i>2?.3:1}}>{b}</div>)}</div></div>
      </div>
    </div>
  )
}

function ProfileContent({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  return (
    <div className="alf-content-area">
      <div style={{textAlign:'center',padding:'40px 0 32px'}}><div style={{width:80,height:80,borderRadius:'50%',margin:'0 auto 12px',background:'linear-gradient(135deg,#E8590C,#DC2626)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,fontWeight:900}}>{profile.name.charAt(0).toUpperCase()}</div><h1 style={{fontSize:24,fontWeight:900,color:'#1C1917'}}>{profile.name}</h1><p style={{fontSize:14,color:'#A8A29E',marginTop:4}}>{profile.grade} &middot; {profile.subject} &middot; {LANGUAGES.find(l => l.code === profile.language)?.label}</p></div>
      <div style={{maxWidth:480,margin:'0 auto'}}>
        <div className="alf-card" style={{padding:0,overflow:'hidden'}}>{['Edit Profile','Change Subject','Language','Notifications'].map((item, i) => (<div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',borderBottom:i<3?'1px solid #F5F4F0':'none',cursor:'pointer'}}><span style={{fontSize:14,fontWeight:500,color:'#1C1917'}}>{item}</span><span style={{color:'#A8A29E',fontSize:18}}>&rsaquo;</span></div>))}</div>
        <button onClick={onLogout} style={{width:'100%',marginTop:16,padding:14,borderRadius:16,border:'none',background:'#FEE2E2',color:'#DC2626',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Sign Out</button>
        <p style={{textAlign:'center',fontSize:11,color:'#D4D0C8',marginTop:24}}>Alfanumrik v1.0 &middot; Cusiosense Learning India Pvt. Ltd.</p>
      </div>
    </div>
  )
}

function Navigation({ active, onNavigate, profile }: { active: Screen; onNavigate: (s: Screen) => void; profile: Profile }) {
  const tabs = [{ screen: 'home' as Screen, label: 'Today', icon: '\u2299' },{ screen: 'foxy' as Screen, label: 'Foxy', icon: '\uD83E\uDD8A' },{ screen: 'progress' as Screen, label: 'Progress', icon: '\u25D4' },{ screen: 'profile' as Screen, label: 'Profile', icon: '\u25D0' }]
  return (<>
    <nav className="alf-sidebar">
      <div className="alf-sidebar-brand"><span style={{fontSize:24}}>&#x1F98A;</span><span style={{fontSize:17,fontWeight:800,color:'#1C1917'}}>Alfanumrik</span></div>
      <div className="alf-sidebar-nav">{tabs.map(t => (<button key={t.screen} onClick={() => onNavigate(t.screen)} className={`alf-sidebar-item ${active === t.screen ? 'active' : ''}`}><span className="alf-sidebar-icon">{t.icon}</span><span>{t.label}</span></button>))}</div>
      <div className="alf-sidebar-user"><div style={{width:32,height:32,borderRadius:10,background:'linear-gradient(135deg,#E8590C,#DC2626)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{profile.name.charAt(0)}</div><div><p style={{fontSize:13,fontWeight:700,color:'#1C1917'}}>{profile.name}</p><p style={{fontSize:11,color:'#A8A29E'}}>{profile.grade}</p></div></div>
    </nav>
    <nav className="alf-bottomnav">{tabs.map(t => (<button key={t.screen} onClick={() => onNavigate(t.screen)} className={`alf-bottomnav-item ${active === t.screen ? 'active' : ''}`}><span className="alf-bottomnav-icon">{t.icon}</span><span className="alf-bottomnav-label">{t.label}</span></button>))}</nav>
  </>)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { if (session?.user) { setUser(session.user); const saved = localStorage.getItem('alfanumrik_profile'); if (saved) { setProfile(JSON.parse(saved)); setScreen('home') } else setScreen('onboard') } else setScreen('auth') })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => { if (session?.user) setUser(session.user); else { setUser(null); setScreen('auth') } })
    return () => subscription.unsubscribe()
  }, [])
  const handleAuth = (u: any) => { setUser(u); const saved = localStorage.getItem('alfanumrik_profile'); if (saved) { setProfile(JSON.parse(saved)); setScreen('home') } else setScreen('onboard') }
  const handleOnboard = (p: Profile) => { setProfile(p); localStorage.setItem('alfanumrik_profile', JSON.stringify(p)); setScreen('home') }
  const handleLogout = async () => { await supabase.auth.signOut(); localStorage.removeItem('alfanumrik_profile'); setUser(null); setProfile(null); setScreen('auth') }

  if (screen === 'loading') return <><AppStyles /><div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}><div style={{fontSize:48,animation:'pulse 1.5s infinite'}}>&#x1F98A;</div><p style={{fontSize:14,color:'#A8A29E',fontWeight:600}}>Loading...</p></div></>
  if (screen === 'auth') return <><AppStyles /><AuthScreen onAuth={handleAuth} /></>
  if (screen === 'onboard') return <><AppStyles /><OnboardScreen user={user} onComplete={handleOnboard} /></>
  return (<><AppStyles /><div className="alf-shell">{profile && <Navigation active={screen} onNavigate={setScreen} profile={profile} />}<main className="alf-main">{screen === 'home' && profile && <HomeContent profile={profile} onNavigate={setScreen} />}{screen === 'foxy' && profile && <FoxyContent profile={profile} />}{screen === 'progress' && profile && <ProgressContent profile={profile} />}{screen === 'profile' && profile && <ProfileContent profile={profile} onLogout={handleLogout} />}{screen === 'quiz' && profile && <HomeContent profile={profile} onNavigate={setScreen} />}</main></div></>)
}

function AppStyles() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:#FAFAF8;color:#1C1917;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
::selection{background:#E8590C;color:#fff;}
::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-thumb{background:#E7E5E4;border-radius:3px;}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.alf-auth-page{min-height:100vh;display:flex;}
.alf-auth-left{flex:1;background:linear-gradient(135deg,#1C1917,#292524);padding:60px;display:flex;flex-direction:column;justify-content:center;color:#fff;}
.alf-auth-right{flex:1;display:flex;align-items:center;justify-content:center;padding:40px;}
.alf-auth-tabs{display:flex;gap:4px;background:#F3F2EE;border-radius:12px;padding:4px;margin-bottom:20px;}
.alf-auth-tab{flex:1;padding:10px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:#A8A29E;font-family:inherit;transition:all .2s;}
.alf-auth-tab.active{background:#fff;color:#1C1917;box-shadow:0 1px 3px rgba(0,0,0,.08);}
.alf-auth-input{width:100%;padding:14px 16px;border-radius:12px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:14px;outline:none;margin-bottom:12px;font-family:inherit;color:#1C1917;transition:border-color .2s;}
.alf-auth-input:focus{border-color:#E8590C;}
.alf-auth-btn{width:100%;padding:14px;border-radius:12px;border:none;background:#E8590C;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;transition:opacity .2s;}
.alf-auth-btn:disabled{opacity:.5;}
.alf-shell{display:flex;min-height:100vh;}
.alf-main{flex:1;margin-left:240px;min-height:100vh;overflow-y:auto;}
.alf-sidebar{width:240px;background:#fff;border-right:1px solid #E7E5E4;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50;}
.alf-sidebar-brand{padding:24px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #F3F2EE;}
.alf-sidebar-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px;}
.alf-sidebar-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#78766F;transition:all .15s;width:100%;text-align:left;}
.alf-sidebar-item:hover{background:#F5F4F0;color:#1C1917;}
.alf-sidebar-item.active{background:rgba(232,89,12,.08);color:#E8590C;}
.alf-sidebar-icon{font-size:18px;width:24px;text-align:center;}
.alf-sidebar-user{padding:16px 14px;border-top:1px solid #F3F2EE;display:flex;align-items:center;gap:10px;}
.alf-bottomnav{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(20px);border-top:1px solid #E7E5E4;padding:6px 0 env(safe-area-inset-bottom,10px);z-index:50;justify-content:space-around;}
.alf-bottomnav-item{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 16px;border:none;background:none;cursor:pointer;font-family:inherit;}
.alf-bottomnav-icon{font-size:18px;opacity:.35;transition:opacity .2s;}
.alf-bottomnav-item.active .alf-bottomnav-icon{opacity:1;}
.alf-bottomnav-label{font-size:10px;font-weight:700;color:#A8A29E;}
.alf-bottomnav-item.active .alf-bottomnav-label{color:#E8590C;}
.alf-content-area{padding:32px 40px;max-width:1200px;animation:fadeIn .3s;}
.alf-content-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;}
.alf-greeting{font-size:14px;font-weight:500;color:#A8A29E;}
.alf-content-title{font-size:28px;font-weight:900;color:#1C1917;margin-top:2px;}
.alf-header-badge{padding:6px 14px;border-radius:10px;background:#F5F4F0;font-size:13px;font-weight:600;color:#57534E;}
.alf-home-layout{display:grid;grid-template-columns:380px 1fr;gap:24px;align-items:start;}
.alf-home-right{display:flex;flex-direction:column;gap:20px;}
.alf-daily-card{background:linear-gradient(135deg,#1C1917,#292524);border-radius:20px;padding:24px;}
.alf-daily-badge{font-size:10px;font-weight:800;padding:4px 10px;border-radius:6px;background:rgba(232,89,12,.2);color:#E8590C;letter-spacing:.05em;}
.alf-daily-item{width:100%;display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.05);margin-bottom:8px;cursor:pointer;font-family:inherit;transition:background .15s;}
.alf-daily-item:hover{background:rgba(255,255,255,.1);}
.alf-daily-start{width:100%;margin-top:8px;padding:14px;border-radius:14px;border:none;background:#E8590C;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;}
.alf-daily-start:hover{opacity:.9;}
.alf-actions-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}
.alf-action-card{padding:20px;border-radius:16px;background:#fff;border:1px solid #E7E5E4;text-align:left;cursor:pointer;font-family:inherit;transition:all .15s;}
.alf-action-card:hover{border-color:#ccc;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.04);}
.alf-stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.alf-stat-card{padding:16px;border-radius:16px;background:#F5F4F0;text-align:center;}
.alf-card{background:#fff;border:1px solid #E7E5E4;border-radius:16px;padding:24px;}
.alf-card-title{font-size:11px;font-weight:800;letter-spacing:.08em;color:#A8A29E;margin-bottom:16px;}
.alf-progress-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
.alf-progress-grid .alf-card:last-child{grid-column:span 2;}
.alf-week-bars{display:flex;align-items:flex-end;gap:8px;height:100px;margin-bottom:8px;}
.alf-week-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;}
.alf-week-bar{width:100%;border-radius:6px;min-height:4px;transition:height .5s;}
.alf-chat-area{display:flex;flex-direction:column;height:100vh;animation:fadeIn .3s;}
.alf-chat-header{padding:16px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #E7E5E4;background:#fff;}
.alf-chat-messages{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px;}
.alf-chat-row{display:flex;max-width:720px;}
.alf-chat-row.user{justify-content:flex-end;align-self:flex-end;margin-left:auto;}
.alf-chat-row.bot{justify-content:flex-start;}
.alf-chat-bot-av{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,#E8590C,#DC2626);display:flex;align-items:center;justify-content:center;font-size:14px;margin-right:8px;margin-top:4px;flex-shrink:0;}
.alf-chat-bubble{padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.6;white-space:pre-wrap;max-width:600px;}
.alf-chat-bubble.user{background:#1C1917;color:#fff;border-top-right-radius:4px;}
.alf-chat-bubble.bot{background:#fff;color:#1C1917;border:1px solid #E7E5E4;border-top-left-radius:4px;}
.alf-chat-typing{display:flex;gap:4px;padding:8px 12px;}
.alf-chat-typing span{width:6px;height:6px;border-radius:50%;background:#E8590C;animation:pulse 1s infinite;}
.alf-chat-typing span:nth-child(2){animation-delay:.2s;}
.alf-chat-typing span:nth-child(3){animation-delay:.4s;}
.alf-chat-chips{padding:0 24px 12px;display:flex;gap:8px;flex-wrap:wrap;}
.alf-chip{padding:8px 14px;border-radius:20px;background:#F5F4F0;border:1px solid #E7E5E4;font-size:13px;font-weight:600;color:#57534E;cursor:pointer;font-family:inherit;transition:all .15s;}
.alf-chip:hover{background:#E7E5E4;}
.alf-chat-input-bar{padding:12px 24px 24px;display:flex;gap:8px;align-items:center;background:#fff;border-top:1px solid #F5F4F0;}
.alf-chat-input{flex:1;padding:14px 16px;border-radius:14px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:14px;outline:none;font-family:inherit;color:#1C1917;transition:border-color .2s;}
.alf-chat-input:focus{border-color:#E8590C;}
.alf-chat-send{width:44px;height:44px;border-radius:12px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;transition:all .15s;flex-shrink:0;background:#F5F4F0;color:#A8A29E;}
.alf-chat-send:not(:disabled){background:#E8590C;color:#fff;}
@media(max-width:900px){
  .alf-sidebar{display:none;}
  .alf-main{margin-left:0;}
  .alf-bottomnav{display:flex;}
  .alf-content-area{padding:20px 16px 100px;}
  .alf-home-layout{grid-template-columns:1fr;}
  .alf-progress-grid{grid-template-columns:1fr;}
  .alf-progress-grid .alf-card:last-child{grid-column:span 1;}
  .alf-content-title{font-size:22px;}
  .alf-auth-page{flex-direction:column;}
  .alf-auth-left{padding:40px 24px;min-height:auto;}
  .alf-auth-left h1{font-size:28px!important;}
  .alf-auth-right{padding:24px;}
  .alf-chat-area{height:calc(100vh - 70px);}
  .alf-chat-input-bar{padding:12px 16px 20px;}
}
@media(max-width:600px){
  .alf-stats-row{grid-template-columns:repeat(3,1fr);}
  .alf-actions-grid{grid-template-columns:repeat(2,1fr);}
}
  `}</style>
}
