'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const supabase = createClient(SB_URL, SB_KEY)

async function foxyChat(messages: any[], profile: any) {
  const fmt = typeof messages === 'string' ? [{ role: 'user', content: messages }] : Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }]
  try {
    const r = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: fmt, student_name: profile?.name || 'Student', grade: profile?.grade || 'Grade 6', subject: profile?.subject || 'Mathematics', language: profile?.language || 'en' }) })
    const d = await r.json(); return d.text || 'Foxy had a hiccup! Try again.'
  } catch { return 'Connection issue. Please try again.' }
}

type Screen = 'loading'|'auth'|'onboard'|'home'|'foxy'|'quiz'|'progress'|'profile'
type Prof = { name: string; grade: string; subject: string; language: string }
const GRADES = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJ = [
  { id: 'Mathematics', icon: '\u2211', c: '#E8590C' }, { id: 'Science', icon: '\u269B', c: '#0C8599' },
  { id: 'English', icon: 'Aa', c: '#7C3AED' }, { id: 'Hindi', icon: '\u0905', c: '#D97706' },
  { id: 'Social Studies', icon: '\uD83C\uDF0D', c: '#059669' }, { id: 'Physics', icon: '\u26A1', c: '#2563EB' },
  { id: 'Chemistry', icon: '\uD83E\uDDEA', c: '#DC2626' }, { id: 'Biology', icon: '\uD83E\uDDEC', c: '#16A34A' },
]
const LANGS = [{ code:'en',label:'English' },{ code:'hi',label:'Hindi' },{ code:'ta',label:'Tamil' },{ code:'te',label:'Telugu' },{ code:'bn',label:'Bengali' },{ code:'mr',label:'Marathi' }]

// ── AUTH ──
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
        if(e)throw e; if(data.session){onAuth(data.user);return}
        const{data:l,error:le}=await supabase.auth.signInWithPassword({email,password:pw})
        if(le)throw le;onAuth(l.user)
      } else {
        const{data,error:e}=await supabase.auth.signInWithPassword({email,password:pw})
        if(e)throw e;onAuth(data.user)
      }
    }catch(e:any){setErr(e.message?.includes('Invalid')?'Wrong email or password':e.message||'Error')}
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
        <p className="a-auth-co">Cusiosense Learning India Pvt. Ltd.</p>
      </div>
      <div className="a-auth-r">
        <div className="a-auth-box">
          <h2>{mode==='login'?'Welcome back':'Create account'}</h2>
          <p className="a-auth-hint">{mode==='login'?'Log in to continue learning':'Start your learning journey'}</p>
          <div className="a-tabs">
            {(['login','signup']as const).map(m=><button key={m} onClick={()=>{setMode(m);setErr('')}} className={`a-tab${mode===m?' on':''}`}>{m==='login'?'Log In':'Sign Up'}</button>)}
          </div>
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

// ── ONBOARD ──
function Onboard({ user, done }: { user:any; done:(p:Prof)=>void }) {
  const [s,setS]=useState(0)
  const [nm,setNm]=useState(user?.user_metadata?.full_name||'')
  const [gr,setGr]=useState(''); const [su,setSu]=useState(''); const [la,setLa]=useState('en')
  const ok=[!!nm.trim(),!!gr,!!su,true][s]
  const titles=['What should Foxy call you?','Which grade?','Pick a subject','Choose language']
  return(
    <div className="a-ob">
      <div className="a-ob-in">
        <div className="a-ob-dots">{[0,1,2,3].map(i=><div key={i} className={`a-ob-dot${i<=s?' on':''}`} style={{width:i<=s?24:8}}/>)}</div>
        <div style={{fontSize:56,marginBottom:16}}>&#x1F98A;</div>
        <h2 className="a-ob-t">{titles[s]}</h2>
        <p className="a-ob-st">Step {s+1} of 4</p>
        <div key={s} className="a-ob-body">
          {s===0&&<input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Your name" autoFocus className="a-ob-inp" onKeyDown={e=>e.key==='Enter'&&nm.trim()&&setS(1)}/>}
          {s===1&&<div className="a-ob-g3">{GRADES.map(g=><button key={g} onClick={()=>setGr(g)} className={`a-ob-ch${gr===g?' on':''}`}>{g}</button>)}</div>}
          {s===2&&<div className="a-ob-g2">{SUBJ.map(x=><button key={x.id} onClick={()=>setSu(x.id)} className={`a-ob-ch${su===x.id?' on':''}`} style={su===x.id?{background:x.c}:{}}><span style={{fontSize:18}}>{x.icon}</span>{x.id}</button>)}</div>}
          {s===3&&<div className="a-ob-g2">{LANGS.map(l=><button key={l.code} onClick={()=>setLa(l.code)} className={`a-ob-ch${la===l.code?' on':''}`}>{l.label}</button>)}</div>}
        </div>
        <div className="a-ob-acts">
          {s>0&&<button onClick={()=>setS(v=>v-1)} className="a-ob-back">Back</button>}
          <button onClick={s<3?()=>setS(v=>v+1):()=>done({name:nm.trim(),grade:gr,subject:su,language:la})} disabled={!ok} className="a-ob-next">{s<3?'Continue':"Let's Go!"}</button>
        </div>
      </div>
    </div>
  )
}

// ── HOME ──
function Home({ p, nav }: { p:Prof; nav:(s:Screen)=>void }) {
  const h=new Date().getHours()
  const gr=h<12?'Good morning':h<17?'Good afternoon':'Good evening'
  const topics=[{t:'Fractions & Decimals',k:'Learn',i:'\uD83D\uDCD0',m:10,c:'#E8590C'},{t:'Quick Quiz',k:'Practice',i:'\uD83C\uDFAF',m:5,c:'#7C3AED'},{t:'Word Problems',k:'Challenge',i:'\uD83E\uDDE9',m:8,c:'#0C8599'}]
  return(
    <div className="a-page">
      <div className="a-hdr"><div><p className="a-greet">{gr}</p><h1 className="a-title">{p.name}</h1></div><div className="a-badge">{p.grade} &middot; {p.subject}</div></div>
      <div className="a-home-grid">
        <div className="a-daily">
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}><span className="a-daily-tag">TODAY&apos;S TRAINING</span><span style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>3 activities &middot; 23 min</span></div>
          {topics.map((t,i)=>(<button key={i} onClick={()=>nav('foxy')} className="a-daily-row"><div className="a-daily-ic" style={{background:`${t.c}20`}}>{t.i}</div><div style={{flex:1,textAlign:'left'}}><p style={{fontSize:14,fontWeight:700,color:'#fff'}}>{t.t}</p><p style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>{t.k} &middot; {t.m} min</p></div><span style={{color:'rgba(255,255,255,.25)',fontSize:20}}>&rsaquo;</span></button>))}
          <button onClick={()=>nav('foxy')} className="a-daily-go">Start Training</button>
        </div>
        <div className="a-home-r">
          <div className="a-qgrid">
            {[{i:'\uD83E\uDD8A',l:'Ask Foxy',s:'AI tutor chat',sc:'foxy' as Screen,c:'#E8590C'},{i:'\uD83C\uDFAF',l:'Quick Quiz',s:'Test yourself',sc:'quiz' as Screen,c:'#7C3AED'},{i:'\uD83D\uDCCA',l:'Progress',s:'Track growth',sc:'progress' as Screen,c:'#0C8599'},{i:'\uD83C\uDFC6',l:'Badges',s:'Achievements',sc:'profile' as Screen,c:'#D97706'}].map(a=>(
              <button key={a.l} onClick={()=>nav(a.sc)} className="a-qcard"><div className="a-qcard-ic" style={{background:`${a.c}10`}}>{a.i}</div><p className="a-qcard-l">{a.l}</p><p className="a-qcard-s">{a.s}</p></button>
            ))}
          </div>
          <div className="a-stats">
            {[{v:'0',l:'XP earned',i:'\u26A1'},{v:'0',l:'Day streak',i:'\uD83D\uDD25'},{v:'0',l:'Quizzes',i:'\u2705'}].map(x=>(
              <div key={x.l} className="a-stat"><span style={{fontSize:20}}>{x.i}</span><p className="a-stat-v">{x.v}</p><p className="a-stat-l">{x.l}</p></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── FOXY CHAT ──
function Foxy({ p }: { p:Prof }) {
  const [msgs,setMsgs]=useState([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor. What shall we learn today?`,isUser:false}])
  const [inp,setInp]=useState(''); const [ld,setLd]=useState(false); const [hist,setHist]=useState<any[]>([])
  const end=useRef<HTMLDivElement>(null); const iRef=useRef<HTMLInputElement>(null)
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'})},[msgs])
  const send=async(t:string)=>{
    if(!t.trim()||ld)return; const m=t.trim(); setMsgs(v=>[...v,{id:Date.now(),text:m,isUser:true}]); setInp(''); setLd(true)
    const nh=[...hist,{role:'user',content:m}]; const reply=await foxyChat(nh,p)
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
      {msgs.length<=2&&<div className="a-chips">{['Explain a concept','Give me a question','Help with homework','Quiz me'].map(c=><button key={c} onClick={()=>send(c)} className="a-chip">{c}</button>)}</div>}
      <div className="a-chat-bar"><input ref={iRef} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send(inp)} placeholder="Ask Foxy anything..." className="a-chat-inp"/><button onClick={()=>send(inp)} disabled={!inp.trim()||ld} className="a-chat-go"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M7 12V4m0 0L3 8m4-4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button></div>
    </div>
  )
}

// ── PROGRESS ──
function Progress({ p }: { p:Prof }) {
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; const sk=['Number Sense','Algebra','Geometry','Data Handling','Problem Solving']; const cc=['#E8590C','#7C3AED','#0C8599','#D97706','#16A34A']
  return(
    <div className="a-page">
      <div className="a-hdr"><div><h1 className="a-title">Progress</h1><p className="a-greet">{p.subject} &middot; {p.grade}</p></div></div>
      <div className="a-prog-grid">
        <div className="a-card"><h3 className="a-card-t">WEEKLY ACTIVITY</h3><div className="a-wk">{days.map((d,i)=>{const h=15+Math.random()*70;return<div key={d} className="a-wk-c"><div className="a-wk-b" style={{height:`${h}%`,background:i===new Date().getDay()-1?'#E8590C':'#EDEBE6'}}/><span style={{fontSize:10,fontWeight:700,color:i===new Date().getDay()-1?'#E8590C':'#A8A29E'}}>{d}</span></div>})}</div></div>
        <div className="a-card"><h3 className="a-card-t">SKILL LEVELS</h3>{sk.map((s,i)=>{const v=20+Math.round(Math.random()*40);return<div key={s} style={{marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:13,fontWeight:600}}>{s}</span><span style={{fontSize:13,fontWeight:700,color:cc[i]}}>{v}%</span></div><div style={{height:8,borderRadius:4,background:'#F5F4F0'}}><div style={{height:'100%',borderRadius:4,width:`${v}%`,background:cc[i]}}/></div></div>})}</div>
        <div className="a-card a-span2"><h3 className="a-card-t">RECENT BADGES</h3><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{['\uD83C\uDF1F','\uD83C\uDFAF','\uD83D\uDD25','\uD83D\uDCDA','\uD83D\uDCA1','\uD83C\uDFC6'].map((b,i)=><div key={i} style={{width:48,height:48,borderRadius:14,background:'#F5F4F0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,opacity:i>2?.3:1}}>{b}</div>)}</div></div>
      </div>
    </div>
  )
}

// ── PROFILE ──
function ProfileScreen({ p, out }: { p:Prof; out:()=>void }) {
  return(
    <div className="a-page">
      <div style={{textAlign:'center',padding:'40px 0 32px'}}>
        <div style={{width:80,height:80,borderRadius:'50%',margin:'0 auto 12px',background:'linear-gradient(135deg,#E8590C,#DC2626)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,fontWeight:900}}>{p.name.charAt(0).toUpperCase()}</div>
        <h1 style={{fontSize:24,fontWeight:900}}>{p.name}</h1>
        <p style={{fontSize:14,color:'#A8A29E',marginTop:4}}>{p.grade} &middot; {p.subject} &middot; {LANGS.find(l=>l.code===p.language)?.label}</p>
      </div>
      <div style={{maxWidth:480,margin:'0 auto'}}>
        <div className="a-card" style={{padding:0,overflow:'hidden'}}>{['Edit Profile','Change Subject','Language','Notifications'].map((x,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'14px 20px',borderBottom:i<3?'1px solid #F5F4F0':'none',cursor:'pointer'}}><span style={{fontSize:14,fontWeight:500}}>{x}</span><span style={{color:'#A8A29E'}}>&rsaquo;</span></div>))}</div>
        <button onClick={out} style={{width:'100%',marginTop:16,padding:14,borderRadius:16,border:'none',background:'#FEE2E2',color:'#DC2626',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Sign Out</button>
        <p style={{textAlign:'center',fontSize:11,color:'#D4D0C8',marginTop:24}}>Alfanumrik v1.0 &middot; Cusiosense Learning India Pvt. Ltd.</p>
      </div>
    </div>
  )
}

// ── NAV ──
function Nav({ active, nav, p }: { active:Screen; nav:(s:Screen)=>void; p:Prof }) {
  const tabs=[{sc:'home' as Screen,l:'Today',i:'\u2299'},{sc:'foxy' as Screen,l:'Foxy',i:'\uD83E\uDD8A'},{sc:'progress' as Screen,l:'Progress',i:'\u25D4'},{sc:'profile' as Screen,l:'Profile',i:'\u25D0'}]
  return(<>
    <nav className="a-side">
      <div className="a-side-brand"><span style={{fontSize:24}}>&#x1F98A;</span><span className="a-side-name">Alfanumrik</span></div>
      <div className="a-side-nav">{tabs.map(t=><button key={t.sc} onClick={()=>nav(t.sc)} className={`a-side-btn${active===t.sc?' on':''}`}><span className="a-side-ic">{t.i}</span><span>{t.l}</span></button>)}</div>
      <div className="a-side-user"><div className="a-side-av">{p.name.charAt(0)}</div><div><p style={{fontSize:13,fontWeight:700}}>{p.name}</p><p style={{fontSize:11,color:'#A8A29E'}}>{p.grade}</p></div></div>
    </nav>
    <nav className="a-bot">{tabs.map(t=><button key={t.sc} onClick={()=>nav(t.sc)} className={`a-bot-btn${active===t.sc?' on':''}`}><span className="a-bot-ic">{t.i}</span><span className="a-bot-lb">{t.l}</span></button>)}</nav>
  </>)
}

// ── MAIN ──
export default function App() {
  const [sc,setSc]=useState<Screen>('loading'); const [user,setUser]=useState<any>(null); const [prof,setProf]=useState<Prof|null>(null)
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{if(session?.user){setUser(session.user);const s=localStorage.getItem('alfanumrik_profile');if(s){setProf(JSON.parse(s));setSc('home')}else setSc('onboard')}else setSc('auth')})
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{if(session?.user)setUser(session.user);else{setUser(null);setSc('auth')}})
    return()=>subscription.unsubscribe()
  },[])
  const onAuth=(u:any)=>{setUser(u);const s=localStorage.getItem('alfanumrik_profile');if(s){setProf(JSON.parse(s));setSc('home')}else setSc('onboard')}
  const onOb=(p:Prof)=>{setProf(p);localStorage.setItem('alfanumrik_profile',JSON.stringify(p));setSc('home')}
  const logout=async()=>{await supabase.auth.signOut();localStorage.removeItem('alfanumrik_profile');setUser(null);setProf(null);setSc('auth')}

  if(sc==='loading')return<><CSS/><div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}><div style={{fontSize:48,animation:'pulse 1.5s infinite'}}>&#x1F98A;</div><p style={{fontSize:14,color:'#A8A29E',fontWeight:600}}>Loading...</p></div></>
  if(sc==='auth')return<><CSS/><Auth onAuth={onAuth}/></>
  if(sc==='onboard')return<><CSS/><Onboard user={user} done={onOb}/></>
  return(<><CSS/><div className="a-shell">{prof&&<Nav active={sc} nav={setSc} p={prof}/>}<main className="a-main">{sc==='home'&&prof&&<Home p={prof} nav={setSc}/>}{sc==='foxy'&&prof&&<Foxy p={prof}/>}{sc==='progress'&&prof&&<Progress p={prof}/>}{sc==='profile'&&prof&&<ProfileScreen p={prof} out={logout}/>}{sc==='quiz'&&prof&&<Home p={prof} nav={setSc}/>}</main></div></>)
}

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
.a-auth-co{margin-top:48px;font-size:12px;color:rgba(255,255,255,.25)}
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

.a-ob{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1C1917}
.a-ob-in{width:100%;max-width:480px;padding:40px 24px;text-align:center}
.a-ob-dots{display:flex;gap:6px;justify-content:center;margin-bottom:32px}
.a-ob-dot{height:8px;border-radius:4px;background:rgba(255,255,255,.15);transition:all .3s}
.a-ob-dot.on{background:#E8590C}
.a-ob-t{font-size:26px;font-weight:800;color:#fff;margin-bottom:4px}
.a-ob-st{font-size:13px;color:rgba(255,255,255,.35);margin-bottom:28px}
.a-ob-body{animation:slideUp .25s;min-height:160px}
.a-ob-inp{width:100%;padding:16px;border-radius:16px;border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#fff;font-size:18px;font-weight:700;text-align:center;outline:none;font-family:inherit}
.a-ob-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.a-ob-g2{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.a-ob-ch{padding:14px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:8px;transition:all .15s}
.a-ob-ch.on{background:#E8590C;color:#fff;border-color:transparent}
.a-ob-acts{display:flex;gap:10px;margin-top:28px}
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
.a-span2{grid-column:span 2}
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

@media(max-width:900px){
  .a-side{display:none}
  .a-main{margin-left:0}
  .a-bot{display:flex}
  .a-page{padding:20px 16px 100px}
  .a-home-grid{grid-template-columns:1fr}
  .a-prog-grid{grid-template-columns:1fr}
  .a-span2{grid-column:span 1}
  .a-title{font-size:22px}
  .a-auth{flex-direction:column}
  .a-auth-l{padding:40px 24px;min-height:auto}
  .a-auth-l h1{font-size:28px!important}
  .a-auth-r{padding:24px}
  .a-chat{height:calc(100vh - 70px)}
  .a-chat-bar{padding:12px 16px 20px}
}
`}</style>}
