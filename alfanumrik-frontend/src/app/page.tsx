'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const supabase = createClient(SB_URL, SB_KEY)

// ── Sound Effects (Web Audio API) ────────────────────────────
const audioCtx = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null
function playSound(type: 'send'|'receive'|'click'|'success'|'error'|'badge'|'nav') {
  if (!audioCtx) return
  try { audioCtx.resume() } catch {}
  const o = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  o.connect(g); g.connect(audioCtx.destination)
  const t = audioCtx.currentTime
  g.gain.setValueAtTime(0.12, t)
  switch (type) {
    case 'send': o.frequency.setValueAtTime(880, t); o.frequency.linearRampToValueAtTime(1100, t + 0.08); g.gain.linearRampToValueAtTime(0, t + 0.1); break
    case 'receive': o.frequency.setValueAtTime(523, t); o.frequency.linearRampToValueAtTime(659, t + 0.1); o.frequency.linearRampToValueAtTime(784, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.25); break
    case 'click': o.frequency.setValueAtTime(600, t); g.gain.linearRampToValueAtTime(0, t + 0.05); break
    case 'success': o.frequency.setValueAtTime(523, t); o.frequency.setValueAtTime(659, t + 0.1); o.frequency.setValueAtTime(784, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.35); break
    case 'error': o.frequency.setValueAtTime(300, t); o.frequency.linearRampToValueAtTime(200, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 0.2); break
    case 'badge': o.frequency.setValueAtTime(523, t); o.frequency.setValueAtTime(659, t + 0.08); o.frequency.setValueAtTime(784, t + 0.16); o.frequency.setValueAtTime(1047, t + 0.24); g.gain.linearRampToValueAtTime(0, t + 0.4); break
    case 'nav': o.frequency.setValueAtTime(700, t); g.gain.setValueAtTime(0.06, t); g.gain.linearRampToValueAtTime(0, t + 0.04); break
  }
  o.start(t); o.stop(t + 0.5)
}

// ── Types ────────────────────────────────────────────────────
type Screen = 'loading'|'auth'|'onboard'|'home'|'foxy'|'quiz'|'progress'|'profile'
type Prof = { name: string; grade: string; subject: string; language: string; studentId?: string }
type Stats = { xp: number; streak: number; quizzes: number; sessions: number; correct: number; asked: number; minutes: number }

// ── Data ─────────────────────────────────────────────────────
const GRADES = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJ = [
  { id: 'Mathematics', icon: '\u2211', c: '#E8590C' }, { id: 'Science', icon: '\u269B', c: '#0C8599' },
  { id: 'English', icon: 'Aa', c: '#7C3AED' }, { id: 'Hindi', icon: '\u0905', c: '#D97706' },
  { id: 'Social Studies', icon: '\uD83C\uDF0D', c: '#059669' }, { id: 'Physics', icon: '\u26A1', c: '#2563EB' },
  { id: 'Chemistry', icon: '\uD83E\uDDEA', c: '#DC2626' }, { id: 'Biology', icon: '\uD83E\uDDEC', c: '#16A34A' },
]
const LANGS = [{ code:'en',label:'English' },{ code:'hi',label:'Hindi' },{ code:'ta',label:'Tamil' },{ code:'te',label:'Telugu' },{ code:'bn',label:'Bengali' },{ code:'mr',label:'Marathi' }]

// ── Foxy API ─────────────────────────────────────────────────
async function foxyChat(messages: any[], profile: Prof) {
  const fmt = typeof messages === 'string' ? [{ role: 'user', content: messages }] : Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }]
  try {
    const r = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: fmt, student_name: profile.name, grade: profile.grade, subject: profile.subject, language: profile.language }) })
    const d = await r.json(); return d.text || 'Foxy had a hiccup! Try again.'
  } catch { return 'Connection issue. Please try again.' }
}

// ── DB helpers ───────────────────────────────────────────────
async function ensureStudentRecord(userId: string, profile: Prof): Promise<string | null> {
  try {
    const { data: existing } = await supabase.from('students').select('id').eq('auth_user_id', userId).maybeSingle()
    if (existing) {
      await supabase.from('students').update({ name: profile.name, grade: profile.grade, preferred_language: profile.language, onboarding_completed: true }).eq('id', existing.id)
      return existing.id
    }
    const { data: created } = await supabase.from('students').insert({ auth_user_id: userId, name: profile.name, grade: profile.grade, preferred_language: profile.language, onboarding_completed: true }).select('id').single()
    return created?.id || null
  } catch (e) { console.error('Student record error:', e); return null }
}

async function fetchStats(studentId: string): Promise<Stats> {
  const zero: Stats = { xp: 0, streak: 0, quizzes: 0, sessions: 0, correct: 0, asked: 0, minutes: 0 }
  if (!studentId) return zero
  try {
    const { data } = await supabase.from('student_learning_profiles').select('xp, streak_days, total_sessions, total_questions_asked, total_questions_answered_correctly, total_time_minutes').eq('student_id', studentId).maybeSingle()
    if (!data) return zero
    return { xp: data.xp || 0, streak: data.streak_days || 0, quizzes: data.total_sessions || 0, sessions: data.total_sessions || 0, correct: data.total_questions_answered_correctly || 0, asked: data.total_questions_asked || 0, minutes: data.total_time_minutes || 0 }
  } catch { return zero }
}

async function fetchDailyTopics(grade: string, subject: string) {
  try {
    const subMap: Record<string, string> = { Mathematics: 'math', Science: 'science', English: 'english', Hindi: 'hindi', 'Social Studies': 'social_studies', Physics: 'science', Chemistry: 'science', Biology: 'science' }
    const { data: subj } = await supabase.from('subjects').select('id').eq('code', subMap[subject] || 'math').single()
    if (!subj) return null
    const { data: topics } = await supabase.from('curriculum_topics').select('title, chapter_number, difficulty_level, estimated_minutes, description').eq('subject_id', subj.id).eq('grade', grade).eq('is_active', true).order('chapter_number').order('display_order').limit(5)
    return topics
  } catch { return null }
}

// ── AUTH ──────────────────────────────────────────────────────
function Auth({ onAuth }: { onAuth: (u:any)=>void }) {
  const [mode,setMode]=useState<'login'|'signup'>('login')
  const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [nm,setNm]=useState('')
  const [loading,setLoading]=useState(false); const [err,setErr]=useState('')
  const go = async()=>{
    setErr('');setLoading(true)
    try{
      if(!email.includes('@'))throw new Error('Valid email required')
      if(pw.length<6)throw new Error('Password must be 6+ chars')
      if(mode==='signup'){
        if(!nm.trim())throw new Error('Name required')
        const{data,error:e}=await supabase.auth.signUp({email,password:pw,options:{data:{full_name:nm}}})
        if(e)throw e; if(data.session){playSound('success');onAuth(data.user);return}
        const{data:l,error:le}=await supabase.auth.signInWithPassword({email,password:pw})
        if(le)throw le;playSound('success');onAuth(l.user)
      } else {
        const{data,error:e}=await supabase.auth.signInWithPassword({email,password:pw})
        if(e)throw e;playSound('success');onAuth(data.user)
      }
    }catch(e:any){playSound('error');setErr(e.message?.includes('Invalid')?'Wrong email or password':e.message||'Error')}
    setLoading(false)
  }
  return(
    <div className="a-auth">
      <div className="a-auth-l">
        <div style={{fontSize:56}}>&#x1F98A;</div>
        <h1>Alfanumrik</h1>
        <p className="a-auth-sub">AI-powered adaptive learning for every Indian student</p>
        <div className="a-auth-feats">
          {['Personalized AI tutor \u2014 Foxy','NCERT Class 6\u201312 curriculum','Learn in Hindi, English & more','Quizzes, progress & badges'].map(f=><div key={f} className="a-auth-feat"><span style={{color:'#E8590C',fontWeight:700}}>\u2713</span>{f}</div>)}
        </div>
        <p style={{marginTop:48,fontSize:12,color:'rgba(255,255,255,.25)'}}>Cusiosense Learning India Pvt. Ltd.</p>
      </div>
      <div className="a-auth-r">
        <div className="a-auth-box">
          <h2>{mode==='login'?'Welcome back':'Create account'}</h2>
          <p className="a-auth-hint">{mode==='login'?'Log in to continue learning':'Start your learning journey'}</p>
          <div className="a-tabs">{(['login','signup']as const).map(m=><button key={m} onClick={()=>{setMode(m);setErr('');playSound('click')}} className={`a-tab${mode===m?' on':''}`}>{m==='login'?'Log In':'Sign Up'}</button>)}</div>
          {err&&<div className="a-err">{err}</div>}
          {mode==='signup'&&<input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Full name" className="a-inp"/>}
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" className="a-inp"/>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="a-inp" onKeyDown={e=>e.key==='Enter'&&go()}/>
          <button onClick={go} disabled={loading} className="a-btn">{loading?'Please wait...':mode==='signup'?'Create Account':'Log In'}</button>
        </div>
      </div>
    </div>
  )
}

// ── ONBOARD ──────────────────────────────────────────────────
function Onboard({ user, done }: { user:any; done:(p:Prof)=>void }) {
  const [s,setS]=useState(0)
  const [nm,setNm]=useState(user?.user_metadata?.full_name||'')
  const [gr,setGr]=useState(''); const [su,setSu]=useState(''); const [la,setLa]=useState('en')
  const ok=[!!nm.trim(),!!gr,!!su,true][s]
  const titles=['What should Foxy call you?','Which grade?','Pick a subject','Choose language']
  const next=()=>{playSound('click');setS(v=>v+1)}
  return(
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#1C1917'}}>
      <div style={{width:'100%',maxWidth:480,padding:'40px 24px',textAlign:'center'}}>
        <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:32}}>{[0,1,2,3].map(i=><div key={i} style={{height:8,borderRadius:4,background:i<=s?'#E8590C':'rgba(255,255,255,.15)',transition:'all .3s',width:i<=s?24:8}}/>)}</div>
        <div style={{fontSize:56,marginBottom:16}}>&#x1F98A;</div>
        <h2 style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:4}}>{titles[s]}</h2>
        <p style={{fontSize:13,color:'rgba(255,255,255,.35)',marginBottom:28}}>Step {s+1} of 4</p>
        <div key={s} style={{animation:'slideUp .25s',minHeight:160}}>
          {s===0&&<input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Your name" autoFocus className="a-ob-inp" onKeyDown={e=>e.key==='Enter'&&nm.trim()&&next()}/>}
          {s===1&&<div className="a-ob-g3">{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);playSound('click')}} className={`a-ob-ch${gr===g?' on':''}`}>{g}</button>)}</div>}
          {s===2&&<div className="a-ob-g2">{SUBJ.map(x=><button key={x.id} onClick={()=>{setSu(x.id);playSound('click')}} className={`a-ob-ch${su===x.id?' on':''}`} style={su===x.id?{background:x.c}:{}}><span style={{fontSize:18}}>{x.icon}</span>{x.id}</button>)}</div>}
          {s===3&&<div className="a-ob-g2">{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);playSound('click')}} className={`a-ob-ch${la===l.code?' on':''}`}>{l.label}</button>)}</div>}
        </div>
        <div style={{display:'flex',gap:10,marginTop:28}}>
          {s>0&&<button onClick={()=>{setS(v=>v-1);playSound('click')}} className="a-ob-back">Back</button>}
          <button onClick={s<3?next:()=>{playSound('success');done({name:nm.trim(),grade:gr,subject:su,language:la})}} disabled={!ok} className="a-ob-next">{s<3?'Continue':"Let's Go!"}</button>
        </div>
      </div>
    </div>
  )
}

// ── HOME ─────────────────────────────────────────────────────
function Home({ p, nav, stats, dailyTopics }: { p:Prof; nav:(s:Screen)=>void; stats:Stats; dailyTopics:any[]|null }) {
  const h=new Date().getHours()
  const gr=h<12?'Good morning':h<17?'Good afternoon':'Good evening'
  const topics = dailyTopics?.slice(0, 3).map((t:any, i:number) => ({
    t: t.title, k: ['Learn','Practice','Challenge'][i] || 'Learn', i: ['\uD83D\uDCD0','\uD83C\uDFAF','\uD83E\uDDE9'][i], m: t.estimated_minutes || 10, c: ['#E8590C','#7C3AED','#0C8599'][i]
  })) || [
    {t:'Fractions & Decimals',k:'Learn',i:'\uD83D\uDCD0',m:10,c:'#E8590C'},
    {t:'Quick Quiz',k:'Practice',i:'\uD83C\uDFAF',m:5,c:'#7C3AED'},
    {t:'Word Problems',k:'Challenge',i:'\uD83E\uDDE9',m:8,c:'#0C8599'}
  ]
  const totalMins = topics.reduce((a:number, t:any) => a + t.m, 0)

  return(
    <div className="a-page">
      <div className="a-hdr"><div><p className="a-greet">{gr}</p><h1 className="a-title">{p.name}</h1></div><div className="a-badge">{p.grade} &middot; {p.subject}</div></div>
      <div className="a-home-grid">
        <div className="a-daily">
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}><span className="a-daily-tag">TODAY&apos;S TRAINING</span><span style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>{topics.length} activities &middot; {totalMins} min</span></div>
          {topics.map((t:any,i:number)=>(<button key={i} onClick={()=>{playSound('click');nav('foxy')}} className="a-daily-row"><div className="a-daily-ic" style={{background:`${t.c}20`}}>{t.i}</div><div style={{flex:1,textAlign:'left'}}><p style={{fontSize:14,fontWeight:700,color:'#fff'}}>{t.t}</p><p style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>{t.k} &middot; {t.m} min</p></div><span style={{color:'rgba(255,255,255,.25)',fontSize:20}}>&rsaquo;</span></button>))}
          <button onClick={()=>{playSound('success');nav('foxy')}} className="a-daily-go">Start Training</button>
        </div>
        <div className="a-home-r">
          <div className="a-qgrid">
            {[{i:'\uD83E\uDD8A',l:'Ask Foxy',s:'AI tutor chat',sc:'foxy' as Screen,c:'#E8590C'},{i:'\uD83C\uDFAF',l:'Quick Quiz',s:'Test yourself',sc:'quiz' as Screen,c:'#7C3AED'},{i:'\uD83D\uDCCA',l:'Progress',s:'Track growth',sc:'progress' as Screen,c:'#0C8599'},{i:'\uD83C\uDFC6',l:'Badges',s:'Achievements',sc:'profile' as Screen,c:'#D97706'}].map(a=>(
              <button key={a.l} onClick={()=>{playSound('click');nav(a.sc)}} className="a-qcard"><div className="a-qcard-ic" style={{background:`${a.c}10`}}>{a.i}</div><p className="a-qcard-l">{a.l}</p><p className="a-qcard-s">{a.s}</p></button>
            ))}
          </div>
          <div className="a-stats">
            {[{v:String(stats.xp),l:'XP earned',i:'\u26A1'},{v:String(stats.streak),l:'Day streak',i:'\uD83D\uDD25'},{v:String(stats.sessions),l:'Sessions',i:'\u2705'}].map(x=>(
              <div key={x.l} className="a-stat"><span style={{fontSize:20}}>{x.i}</span><p className="a-stat-v">{x.v}</p><p className="a-stat-l">{x.l}</p></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── FOXY CHAT ────────────────────────────────────────────────
function Foxy({ p }: { p:Prof }) {
  const [msgs,setMsgs]=useState([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor for ${p.grade}. What shall we learn today?`,isUser:false}])
  const [inp,setInp]=useState(''); const [ld,setLd]=useState(false); const [hist,setHist]=useState<any[]>([])
  const end=useRef<HTMLDivElement>(null); const iRef=useRef<HTMLInputElement>(null)
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'})},[msgs])
  const send=async(t:string)=>{
    if(!t.trim()||ld)return; const m=t.trim(); playSound('send')
    setMsgs(v=>[...v,{id:Date.now(),text:m,isUser:true}]); setInp(''); setLd(true)
    const nh=[...hist,{role:'user',content:m}]; const reply=await foxyChat(nh,p)
    playSound('receive')
    setMsgs(v=>[...v,{id:Date.now()+1,text:reply,isUser:false}]); setHist([...nh,{role:'assistant',content:reply}]); setLd(false); iRef.current?.focus()
  }
  return(
    <div className="a-chat">
      <div className="a-chat-hdr"><div className="a-chat-av">&#x1F98A;</div><div><p style={{fontSize:15,fontWeight:700,color:'#1C1917'}}>Foxy &mdash; MIGA Tutor</p><p style={{fontSize:12,color:'#A8A29E'}}>{p.subject} &middot; {p.grade}</p></div></div>
      <div className="a-chat-body">
        {msgs.map(m=>(<div key={m.id} className={`a-msg ${m.isUser?'u':'b'}`}>{!m.isUser&&<div className="a-msg-av">&#x1F98A;</div>}<div className={`a-bub ${m.isUser?'u':'b'}`}>{m.text}</div></div>))}
        {ld&&<div className="a-msg b"><div className="a-msg-av">&#x1F98A;</div><div className="a-typing"><span/><span/><span/></div></div>}
        <div ref={end}/>
      </div>
      {msgs.length<=2&&<div className="a-chips">{['Explain a concept','Give me a question','Help with homework','Quiz me','What topics are in my syllabus?'].map(c=><button key={c} onClick={()=>send(c)} className="a-chip">{c}</button>)}</div>}
      <div className="a-chat-bar"><input ref={iRef} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send(inp)} placeholder="Ask Foxy anything..." className="a-chat-inp"/><button onClick={()=>send(inp)} disabled={!inp.trim()||ld} className="a-chat-go"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M7 12V4m0 0L3 8m4-4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button></div>
    </div>
  )
}

// ── PROGRESS ─────────────────────────────────────────────────
function Progress({ p, stats }: { p:Prof; stats:Stats }) {
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const skills=['Number Sense','Algebra','Geometry','Data Handling','Problem Solving']
  const cc=['#E8590C','#7C3AED','#0C8599','#D97706','#16A34A']
  const accuracy = stats.asked > 0 ? Math.round((stats.correct / stats.asked) * 100) : 0
  return(
    <div className="a-page">
      <div className="a-hdr"><div><h1 className="a-title">Progress</h1><p className="a-greet">{p.subject} &middot; {p.grade}</p></div></div>
      {/* Summary stats from DB */}
      <div className="a-stats" style={{marginBottom:20}}>
        {[{v:String(stats.xp),l:'Total XP',i:'\u26A1'},{v:String(stats.streak),l:'Day streak',i:'\uD83D\uDD25'},{v:String(stats.sessions),l:'Sessions',i:'\uD83D\uDCDA'},{v:`${accuracy}%`,l:'Accuracy',i:'\uD83C\uDFAF'},{v:String(stats.minutes),l:'Minutes',i:'\u23F1'},{v:String(stats.asked),l:'Questions',i:'\u2753'}].map(x=>(
          <div key={x.l} className="a-stat"><span style={{fontSize:18}}>{x.i}</span><p className="a-stat-v">{x.v}</p><p className="a-stat-l">{x.l}</p></div>
        ))}
      </div>
      <div className="a-prog-grid">
        <div className="a-card"><h3 className="a-card-t">WEEKLY ACTIVITY</h3><div className="a-wk">{days.map((d,i)=><div key={d} className="a-wk-c"><div className="a-wk-b" style={{height:`${stats.sessions>0?15+Math.random()*70:5}%`,background:i===new Date().getDay()-1?'#E8590C':'#EDEBE6'}}/><span style={{fontSize:10,fontWeight:700,color:i===new Date().getDay()-1?'#E8590C':'#A8A29E'}}>{d}</span></div>)}</div></div>
        <div className="a-card"><h3 className="a-card-t">SKILL LEVELS</h3>{skills.map((s,i)=>{const v=stats.sessions>0?(10+Math.round(Math.random()*50)):0;return<div key={s} style={{marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:13,fontWeight:600}}>{s}</span><span style={{fontSize:13,fontWeight:700,color:cc[i]}}>{v}%</span></div><div style={{height:8,borderRadius:4,background:'#F5F4F0'}}><div style={{height:'100%',borderRadius:4,width:`${v}%`,background:cc[i]}}/></div></div>})}</div>
      </div>
    </div>
  )
}

// ── EDITABLE PROFILE ─────────────────────────────────────────
function ProfileScreen({ p, onUpdate, out, stats }: { p:Prof; onUpdate:(p:Prof)=>void; out:()=>void; stats:Stats }) {
  const [editing,setEditing]=useState<string|null>(null)
  const [nm,setNm]=useState(p.name)
  const [gr,setGr]=useState(p.grade)
  const [su,setSu]=useState(p.subject)
  const [la,setLa]=useState(p.language)
  const [saving,setSaving]=useState(false)

  const save = async (field: string) => {
    setSaving(true); playSound('success')
    const updated = { ...p, name: nm, grade: gr, subject: su, language: la }
    onUpdate(updated)
    setEditing(null); setSaving(false)
  }

  return(
    <div className="a-page">
      <div style={{textAlign:'center',padding:'20px 0 24px'}}>
        <div style={{width:80,height:80,borderRadius:'50%',margin:'0 auto 12px',background:'linear-gradient(135deg,#E8590C,#DC2626)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,fontWeight:900}}>{nm.charAt(0).toUpperCase()}</div>
        <h1 style={{fontSize:24,fontWeight:900}}>{nm}</h1>
        <p style={{fontSize:14,color:'#A8A29E',marginTop:4}}>{gr} &middot; {su} &middot; {LANGS.find(l=>l.code===la)?.label}</p>
        <div style={{display:'flex',justifyContent:'center',gap:20,marginTop:16}}>
          {[{v:String(stats.xp),l:'XP'},{v:String(stats.sessions),l:'Sessions'},{v:String(stats.streak),l:'Streak'}].map(x=>(
            <div key={x.l} style={{textAlign:'center'}}><p style={{fontSize:20,fontWeight:900,color:'#1C1917'}}>{x.v}</p><p style={{fontSize:11,color:'#A8A29E',fontWeight:600}}>{x.l}</p></div>
          ))}
        </div>
      </div>
      <div style={{maxWidth:520,margin:'0 auto'}}>
        {/* Name */}
        <div className="a-card" style={{padding:0,overflow:'hidden',marginBottom:12}}>
          <div className="a-profile-row" onClick={()=>{setEditing(editing==='name'?null:'name');playSound('click')}}>
            <span className="a-profile-label">Name</span><span className="a-profile-val">{editing==='name'?'':'  '+nm}</span><span style={{color:'#A8A29E'}}>{editing==='name'?'\u2715':'\u270E'}</span>
          </div>
          {editing==='name'&&<div className="a-edit-box"><input value={nm} onChange={e=>setNm(e.target.value)} className="a-edit-inp" autoFocus/><button onClick={()=>save('name')} disabled={!nm.trim()||saving} className="a-edit-btn">Save</button></div>}
        </div>
        {/* Grade */}
        <div className="a-card" style={{padding:0,overflow:'hidden',marginBottom:12}}>
          <div className="a-profile-row" onClick={()=>{setEditing(editing==='grade'?null:'grade');playSound('click')}}>
            <span className="a-profile-label">Grade</span><span className="a-profile-val">{editing==='grade'?'':'  '+gr}</span><span style={{color:'#A8A29E'}}>{editing==='grade'?'\u2715':'\u270E'}</span>
          </div>
          {editing==='grade'&&<div className="a-edit-box"><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);playSound('click')}} style={{padding:'8px 12px',borderRadius:10,border:gr===g?'none':'1px solid #E7E5E4',background:gr===g?'#E8590C':'#fff',color:gr===g?'#fff':'#1C1917',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{g}</button>)}</div><button onClick={()=>save('grade')} className="a-edit-btn" style={{marginTop:8}}>Save</button></div>}
        </div>
        {/* Subject */}
        <div className="a-card" style={{padding:0,overflow:'hidden',marginBottom:12}}>
          <div className="a-profile-row" onClick={()=>{setEditing(editing==='subject'?null:'subject');playSound('click')}}>
            <span className="a-profile-label">Subject</span><span className="a-profile-val">{editing==='subject'?'':'  '+su}</span><span style={{color:'#A8A29E'}}>{editing==='subject'?'\u2715':'\u270E'}</span>
          </div>
          {editing==='subject'&&<div className="a-edit-box"><div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:6}}>{SUBJ.map(x=><button key={x.id} onClick={()=>{setSu(x.id);playSound('click')}} style={{padding:'8px 10px',borderRadius:10,border:su===x.id?'none':'1px solid #E7E5E4',background:su===x.id?x.c:'#fff',color:su===x.id?'#fff':'#1C1917',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}><span>{x.icon}</span>{x.id}</button>)}</div><button onClick={()=>save('subject')} className="a-edit-btn" style={{marginTop:8}}>Save</button></div>}
        </div>
        {/* Language */}
        <div className="a-card" style={{padding:0,overflow:'hidden',marginBottom:12}}>
          <div className="a-profile-row" onClick={()=>{setEditing(editing==='language'?null:'language');playSound('click')}}>
            <span className="a-profile-label">Language</span><span className="a-profile-val">{editing==='language'?'':'  '+(LANGS.find(l=>l.code===la)?.label)}</span><span style={{color:'#A8A29E'}}>{editing==='language'?'\u2715':'\u270E'}</span>
          </div>
          {editing==='language'&&<div className="a-edit-box"><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);playSound('click')}} style={{padding:'8px 12px',borderRadius:10,border:la===l.code?'none':'1px solid #E7E5E4',background:la===l.code?'#E8590C':'#fff',color:la===l.code?'#fff':'#1C1917',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{l.label}</button>)}</div><button onClick={()=>save('language')} className="a-edit-btn" style={{marginTop:8}}>Save</button></div>}
        </div>
        <button onClick={()=>{playSound('click');out()}} style={{width:'100%',marginTop:8,padding:14,borderRadius:16,border:'none',background:'#FEE2E2',color:'#DC2626',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Sign Out</button>
        <p style={{textAlign:'center',fontSize:11,color:'#D4D0C8',marginTop:24}}>Alfanumrik v1.0 &middot; Cusiosense Learning India Pvt. Ltd.</p>
      </div>
    </div>
  )
}

// ── NAVIGATION ───────────────────────────────────────────────
function Nav({ active, nav, p }: { active:Screen; nav:(s:Screen)=>void; p:Prof }) {
  const tabs=[{sc:'home' as Screen,l:'Today',i:'\u2299'},{sc:'foxy' as Screen,l:'Foxy',i:'\uD83E\uDD8A'},{sc:'progress' as Screen,l:'Progress',i:'\u25D4'},{sc:'profile' as Screen,l:'Profile',i:'\u25D0'}]
  const go=(s:Screen)=>{playSound('nav');nav(s)}
  return(<>
    <nav className="a-side">
      <div className="a-side-brand"><span style={{fontSize:24}}>&#x1F98A;</span><span className="a-side-name">Alfanumrik</span></div>
      <div className="a-side-nav">{tabs.map(t=><button key={t.sc} onClick={()=>go(t.sc)} className={`a-side-btn${active===t.sc?' on':''}`}><span className="a-side-ic">{t.i}</span><span>{t.l}</span></button>)}</div>
      <div className="a-side-user"><div className="a-side-av">{p.name.charAt(0)}</div><div><p style={{fontSize:13,fontWeight:700}}>{p.name}</p><p style={{fontSize:11,color:'#A8A29E'}}>{p.grade}</p></div></div>
    </nav>
    <nav className="a-bot">{tabs.map(t=><button key={t.sc} onClick={()=>go(t.sc)} className={`a-bot-btn${active===t.sc?' on':''}`}><span className="a-bot-ic">{t.i}</span><span className="a-bot-lb">{t.l}</span></button>)}</nav>
  </>)
}

// ── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [sc,setSc]=useState<Screen>('loading'); const [user,setUser]=useState<any>(null)
  const [prof,setProf]=useState<Prof|null>(null)
  const [stats,setStats]=useState<Stats>({xp:0,streak:0,quizzes:0,sessions:0,correct:0,asked:0,minutes:0})
  const [dailyTopics,setDailyTopics]=useState<any[]|null>(null)

  // Load stats + daily topics when profile changes
  const loadData = useCallback(async (p: Prof) => {
    if (!p.studentId) return
    const s = await fetchStats(p.studentId)
    setStats(s)
    const t = await fetchDailyTopics(p.grade, p.subject)
    if (t) setDailyTopics(t)
  }, [])

  useEffect(()=>{
    supabase.auth.getSession().then(async({data:{session}})=>{
      if(session?.user){
        setUser(session.user)
        const saved=localStorage.getItem('alfanumrik_profile')
        if(saved){
          const p=JSON.parse(saved) as Prof
          // Ensure DB record exists
          const studentId = await ensureStudentRecord(session.user.id, p)
          const withId = { ...p, studentId: studentId || undefined }
          setProf(withId)
          localStorage.setItem('alfanumrik_profile', JSON.stringify(withId))
          await loadData(withId)
          setSc('home')
        } else setSc('onboard')
      } else setSc('auth')
    })
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{if(session?.user)setUser(session.user);else{setUser(null);setSc('auth')}})
    return()=>subscription.unsubscribe()
  },[loadData])

  const onAuth=async(u:any)=>{
    setUser(u)
    const saved=localStorage.getItem('alfanumrik_profile')
    if(saved){
      const p=JSON.parse(saved) as Prof
      const studentId = await ensureStudentRecord(u.id, p)
      const withId = { ...p, studentId: studentId || undefined }
      setProf(withId); localStorage.setItem('alfanumrik_profile', JSON.stringify(withId))
      await loadData(withId); setSc('home')
    } else setSc('onboard')
  }

  const onOb=async(p:Prof)=>{
    if(user){
      const studentId = await ensureStudentRecord(user.id, p)
      const withId = { ...p, studentId: studentId || undefined }
      setProf(withId); localStorage.setItem('alfanumrik_profile', JSON.stringify(withId))
      setStats({xp:0,streak:0,quizzes:0,sessions:0,correct:0,asked:0,minutes:0}) // Start at zero
      const t = await fetchDailyTopics(p.grade, p.subject)
      if (t) setDailyTopics(t)
      setSc('home')
    }
  }

  const onProfileUpdate = async (p: Prof) => {
    setProf(p)
    localStorage.setItem('alfanumrik_profile', JSON.stringify(p))
    if (p.studentId) {
      await supabase.from('students').update({ name: p.name, grade: p.grade, preferred_language: p.language }).eq('id', p.studentId)
      await loadData(p)
    }
    // Reload daily topics for new grade/subject
    const t = await fetchDailyTopics(p.grade, p.subject)
    if (t) setDailyTopics(t)
  }

  const logout=async()=>{await supabase.auth.signOut();localStorage.removeItem('alfanumrik_profile');setUser(null);setProf(null);setSc('auth')}

  if(sc==='loading')return<><CSS/><div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}><div style={{fontSize:48,animation:'pulse 1.5s infinite'}}>&#x1F98A;</div><p style={{fontSize:14,color:'#A8A29E',fontWeight:600}}>Loading...</p></div></>
  if(sc==='auth')return<><CSS/><Auth onAuth={onAuth}/></>
  if(sc==='onboard')return<><CSS/><Onboard user={user} done={onOb}/></>
  return(<><CSS/><div className="a-shell">{prof&&<Nav active={sc} nav={setSc} p={prof}/>}<main className="a-main">
    {sc==='home'&&prof&&<Home p={prof} nav={setSc} stats={stats} dailyTopics={dailyTopics}/>}
    {sc==='foxy'&&prof&&<Foxy p={prof}/>}
    {sc==='progress'&&prof&&<Progress p={prof} stats={stats}/>}
    {sc==='profile'&&prof&&<ProfileScreen p={prof} onUpdate={onProfileUpdate} out={logout} stats={stats}/>}
    {sc==='quiz'&&prof&&<Home p={prof} nav={setSc} stats={stats} dailyTopics={dailyTopics}/>}
  </main></div></>)
}

// ── ALL STYLES ───────────────────────────────────────────────
function CSS(){return<style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#FAFAF8;color:#1C1917;-webkit-font-smoothing:antialiased;overflow-x:hidden}
::selection{background:#E8590C;color:#fff}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#E7E5E4;border-radius:3px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.a-auth{min-height:100vh;display:flex}
.a-auth-l{flex:1;background:linear-gradient(135deg,#1C1917,#292524);padding:60px;display:flex;flex-direction:column;justify-content:center;color:#fff}
.a-auth-l h1{font-size:42px;font-weight:900;letter-spacing:-.02em;margin-top:16px}
.a-auth-sub{font-size:16px;color:rgba(255,255,255,.5);margin-top:8px}
.a-auth-feats{display:flex;flex-direction:column;gap:12px;margin-top:48px}
.a-auth-feat{font-size:15px;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:10px}
.a-auth-r{flex:1;display:flex;align-items:center;justify-content:center;padding:40px}
.a-auth-box{width:100%;max-width:400px}
.a-auth-box h2{font-size:28px;font-weight:800;margin-bottom:4px}
.a-auth-hint{font-size:14px;color:#A8A29E;margin-bottom:24px}
.a-tabs{display:flex;gap:4px;background:#F3F2EE;border-radius:12px;padding:4px;margin-bottom:20px}
.a-tab{flex:1;padding:10px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:#A8A29E;font-family:inherit;transition:all .2s}
.a-tab.on{background:#fff;color:#1C1917;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.a-err{background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;border-radius:12px;padding:10px 14px;font-size:13px;margin-bottom:14px}
.a-inp{width:100%;padding:14px 16px;border-radius:12px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:14px;outline:none;margin-bottom:12px;font-family:inherit;color:#1C1917;transition:border-color .2s}
.a-inp:focus{border-color:#E8590C}
.a-btn{width:100%;padding:14px;border-radius:12px;border:none;background:#E8590C;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;transition:opacity .2s}
.a-btn:disabled{opacity:.5}
.a-ob-inp{width:100%;padding:16px;border-radius:16px;border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#fff;font-size:18px;font-weight:700;text-align:center;outline:none;font-family:inherit}
.a-ob-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.a-ob-g2{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.a-ob-ch{padding:14px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:8px;transition:all .15s}
.a-ob-ch.on{background:#E8590C;color:#fff;border-color:transparent}
.a-ob-back{flex:1;padding:14px;border-radius:14px;border:none;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
.a-ob-next{flex:2;padding:14px;border-radius:14px;border:none;background:#E8590C;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
.a-ob-next:disabled{opacity:.3}
.a-shell{display:flex;min-height:100vh}
.a-main{flex:1;margin-left:240px;min-height:100vh;overflow-y:auto}
.a-side{width:240px;background:#fff;border-right:1px solid #E7E5E4;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50}
.a-side-brand{padding:24px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #F3F2EE}
.a-side-name{font-size:17px;font-weight:800;color:#1C1917}
.a-side-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px}
.a-side-btn{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#78766F;transition:all .15s;width:100%;text-align:left}
.a-side-btn:hover{background:#F5F4F0;color:#1C1917}
.a-side-btn.on{background:rgba(232,89,12,.08);color:#E8590C}
.a-side-ic{font-size:18px;width:24px;text-align:center}
.a-side-user{padding:16px 14px;border-top:1px solid #F3F2EE;display:flex;align-items:center;gap:10px}
.a-side-av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#E8590C,#DC2626);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.a-bot{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(20px);border-top:1px solid #E7E5E4;padding:6px 0 env(safe-area-inset-bottom,10px);z-index:50;justify-content:space-around}
.a-bot-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 16px;border:none;background:none;cursor:pointer;font-family:inherit}
.a-bot-ic{font-size:18px;opacity:.35;transition:opacity .2s}
.a-bot-btn.on .a-bot-ic{opacity:1}
.a-bot-lb{font-size:10px;font-weight:700;color:#A8A29E}
.a-bot-btn.on .a-bot-lb{color:#E8590C}
.a-page{padding:32px 40px;max-width:1200px;animation:fadeIn .3s}
.a-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px}
.a-greet{font-size:14px;font-weight:500;color:#A8A29E}
.a-title{font-size:28px;font-weight:900;margin-top:2px}
.a-badge{padding:6px 14px;border-radius:10px;background:#F5F4F0;font-size:13px;font-weight:600;color:#57534E}
.a-home-grid{display:grid;grid-template-columns:380px 1fr;gap:24px;align-items:start}
.a-home-r{display:flex;flex-direction:column;gap:20px}
.a-daily{background:linear-gradient(135deg,#1C1917,#292524);border-radius:20px;padding:24px}
.a-daily-tag{font-size:10px;font-weight:800;padding:4px 10px;border-radius:6px;background:rgba(232,89,12,.2);color:#E8590C;letter-spacing:.05em}
.a-daily-row{width:100%;display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.05);margin-bottom:8px;cursor:pointer;font-family:inherit;transition:background .15s}
.a-daily-row:hover{background:rgba(255,255,255,.1)}
.a-daily-ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.a-daily-go{width:100%;margin-top:8px;padding:14px;border-radius:14px;border:none;background:#E8590C;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
.a-daily-go:hover{opacity:.9}
.a-qgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.a-qcard{padding:20px;border-radius:16px;background:#fff;border:1px solid #E7E5E4;text-align:left;cursor:pointer;font-family:inherit;transition:all .15s}
.a-qcard:hover{border-color:#ccc;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.04)}
.a-qcard-ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:10px}
.a-qcard-l{font-size:14px;font-weight:700}
.a-qcard-s{font-size:12px;color:#A8A29E;margin-top:2px}
.a-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.a-stat{padding:16px;border-radius:16px;background:#F5F4F0;text-align:center}
.a-stat-v{font-size:22px;font-weight:900;margin:4px 0 0}
.a-stat-l{font-size:11px;color:#A8A29E;font-weight:600}
.a-card{background:#fff;border:1px solid #E7E5E4;border-radius:16px;padding:24px}
.a-card-t{font-size:11px;font-weight:800;letter-spacing:.08em;color:#A8A29E;margin-bottom:16px}
.a-prog-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.a-wk{display:flex;align-items:flex-end;gap:8px;height:100px;margin-bottom:8px}
.a-wk-c{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%}
.a-wk-b{width:100%;border-radius:6px;min-height:4px}
.a-chat{display:flex;flex-direction:column;height:100vh;animation:fadeIn .3s}
.a-chat-hdr{padding:16px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #E7E5E4;background:#fff}
.a-chat-av{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,#E8590C,#DC2626);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.a-chat-body{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px}
.a-msg{display:flex;max-width:720px}
.a-msg.u{justify-content:flex-end;align-self:flex-end;margin-left:auto}
.a-msg.b{justify-content:flex-start}
.a-msg-av{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,#E8590C,#DC2626);display:flex;align-items:center;justify-content:center;font-size:14px;margin-right:8px;margin-top:4px;flex-shrink:0}
.a-bub{padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.6;white-space:pre-wrap;max-width:600px}
.a-bub.u{background:#1C1917;color:#fff;border-top-right-radius:4px}
.a-bub.b{background:#fff;color:#1C1917;border:1px solid #E7E5E4;border-top-left-radius:4px}
.a-typing{display:flex;gap:4px;padding:8px 12px}
.a-typing span{width:6px;height:6px;border-radius:50%;background:#E8590C;animation:pulse 1s infinite}
.a-typing span:nth-child(2){animation-delay:.2s}
.a-typing span:nth-child(3){animation-delay:.4s}
.a-chips{padding:0 24px 12px;display:flex;gap:8px;flex-wrap:wrap}
.a-chip{padding:8px 14px;border-radius:20px;background:#F5F4F0;border:1px solid #E7E5E4;font-size:13px;font-weight:600;color:#57534E;cursor:pointer;font-family:inherit;transition:all .15s}
.a-chip:hover{background:#E7E5E4}
.a-chat-bar{padding:12px 24px 24px;display:flex;gap:8px;align-items:center;background:#fff;border-top:1px solid #F5F4F0}
.a-chat-inp{flex:1;padding:14px 16px;border-radius:14px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:14px;outline:none;font-family:inherit;color:#1C1917}
.a-chat-inp:focus{border-color:#E8590C}
.a-chat-go{width:44px;height:44px;border-radius:12px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;background:#F5F4F0;color:#A8A29E;transition:all .15s}
.a-chat-go:not(:disabled){background:#E8590C;color:#fff}
/* Profile editable rows */
.a-profile-row{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;cursor:pointer;transition:background .1s}
.a-profile-row:hover{background:#FAFAF8}
.a-profile-label{font-size:14px;font-weight:600;color:#1C1917}
.a-profile-val{font-size:14px;color:#78766F;flex:1;text-align:right;margin-right:8px}
.a-edit-box{padding:12px 20px 16px;border-top:1px solid #F5F4F0;background:#FAFAF8}
.a-edit-inp{width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #E7E5E4;font-size:14px;outline:none;font-family:inherit;color:#1C1917;margin-bottom:8px}
.a-edit-inp:focus{border-color:#E8590C}
.a-edit-btn{padding:8px 20px;border-radius:10px;border:none;background:#E8590C;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.a-edit-btn:disabled{opacity:.4}
@media(max-width:900px){
  .a-side{display:none}
  .a-main{margin-left:0}
  .a-bot{display:flex}
  .a-page{padding:20px 16px 100px}
  .a-home-grid{grid-template-columns:1fr}
  .a-prog-grid{grid-template-columns:1fr}
  .a-title{font-size:22px}
  .a-auth{flex-direction:column}
  .a-auth-l{padding:40px 24px;min-height:auto}
  .a-auth-l h1{font-size:28px!important}
  .a-auth-r{padding:24px}
  .a-chat{height:calc(100vh - 70px)}
  .a-chat-bar{padding:12px 16px 20px}
  .a-stats{grid-template-columns:repeat(3,1fr)}
}
`}</style>}
