'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const sb = createClient(SB, SK)
const SITE = typeof window!=='undefined'?window.location.origin:'https://alfanumrik-eight.vercel.app'
const EF = `${SB}/functions/v1`
// ── Sound Engine — Socratic + Holistic (12 types) ──
let audioCtx:AudioContext|null=null
function getAC(){if(!audioCtx&&typeof window!=='undefined')audioCtx=new(window.AudioContext||(window as any).webkitAudioContext)();return audioCtx}
function snd(type:string){const ac=getAC();if(!ac)return;try{ac.resume()}catch{};const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);const t=ac.currentTime;
switch(type){
case'click':o.type='sine';o.frequency.setValueAtTime(800,t);g.gain.setValueAtTime(.06,t);g.gain.linearRampToValueAtTime(0,t+.04);break
case'nav':o.type='sine';o.frequency.setValueAtTime(400,t);o.frequency.linearRampToValueAtTime(600,t+.06);g.gain.setValueAtTime(.04,t);g.gain.linearRampToValueAtTime(0,t+.08);break
case'send':o.type='sine';o.frequency.setValueAtTime(523,t);o.frequency.linearRampToValueAtTime(1047,t+.1);g.gain.setValueAtTime(.08,t);g.gain.linearRampToValueAtTime(0,t+.12);break
case'recv':o.type='triangle';o.frequency.setValueAtTime(880,t);o.frequency.linearRampToValueAtTime(523,t+.2);g.gain.setValueAtTime(.06,t);g.gain.linearRampToValueAtTime(0,t+.25);break
case'think':o.type='sine';o.frequency.setValueAtTime(392,t);o.frequency.setValueAtTime(440,t+.15);o.frequency.setValueAtTime(523,t+.3);g.gain.setValueAtTime(.05,t);g.gain.linearRampToValueAtTime(.07,t+.2);g.gain.linearRampToValueAtTime(0,t+.4);break
case'eureka':o.type='sine';o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(659,t+.08);o.frequency.setValueAtTime(784,t+.16);o.frequency.setValueAtTime(1047,t+.24);g.gain.setValueAtTime(.1,t);g.gain.linearRampToValueAtTime(0,t+.4);break
case'correct':o.type='sine';o.frequency.setValueAtTime(659,t);o.frequency.setValueAtTime(880,t+.1);g.gain.setValueAtTime(.12,t);g.gain.linearRampToValueAtTime(0,t+.2);break
case'wrong':o.type='triangle';o.frequency.setValueAtTime(220,t);g.gain.setValueAtTime(.06,t);g.gain.linearRampToValueAtTime(0,t+.15);break
case'badge':o.type='sine';o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(659,t+.1);o.frequency.setValueAtTime(784,t+.2);o.frequency.setValueAtTime(1047,t+.3);g.gain.setValueAtTime(.12,t);g.gain.linearRampToValueAtTime(0,t+.5);break
case'streak':o.type='sine';o.frequency.setValueAtTime(440,t);o.frequency.setValueAtTime(554,t+.12);o.frequency.setValueAtTime(659,t+.24);g.gain.setValueAtTime(.08,t);g.gain.linearRampToValueAtTime(0,t+.4);break
case'unlock':o.type='sine';o.frequency.setValueAtTime(698,t);o.frequency.setValueAtTime(880,t+.08);o.frequency.setValueAtTime(1047,t+.16);o.frequency.setValueAtTime(1319,t+.24);g.gain.setValueAtTime(.1,t);g.gain.setValueAtTime(.12,t+.16);g.gain.linearRampToValueAtTime(0,t+.5);break
default:o.type='sine';o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(784,t+.12);g.gain.setValueAtTime(.08,t);g.gain.linearRampToValueAtTime(0,t+.2)
};o.start(t);o.stop(t+.6)}

type Screen='loading'|'auth'|'confirm'|'reset'|'onboard'|'home'|'foxy'|'quiz'|'notes'|'progress'|'skills'|'profile'|'plan'
type Prof={name:string;grade:string;subject:string;language:string;studentId?:string}
type Stats={xp:number;streak:number;sessions:number;correct:number;asked:number;minutes:number}
type Note={id:string;title:string;content:string;note_type:string;color:string;chapter_number?:number;chapter_title?:string;is_pinned:boolean;is_starred:boolean;word_count:number;updated_at:string}
const GRADES=['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJ=[{id:'Mathematics',icon:'\u2211',c:'#E8590C'},{id:'Science',icon:'\u269B',c:'#0EA5E9'},{id:'English',icon:'Aa',c:'#8B5CF6'},{id:'Hindi',icon:'\u0905',c:'#F59E0B'},{id:'Social Studies',icon:'\uD83C\uDF0D',c:'#10B981'},{id:'Physics',icon:'\u26A1',c:'#3B82F6'},{id:'Chemistry',icon:'\uD83E\uDDEA',c:'#EF4444'},{id:'Biology',icon:'\uD83E\uDDEC',c:'#22C55E'},{id:'Computer Science',icon:'\uD83D\uDCBB',c:'#14B8A6'},{id:'Accountancy',icon:'\uD83D\uDCCA',c:'#8B5CF6'},{id:'Economics',icon:'\uD83D\uDCC8',c:'#F59E0B'}]
const LANGS=[{code:'en',label:'English'},{code:'hi',label:'Hindi'},{code:'ta',label:'Tamil'},{code:'te',label:'Telugu'},{code:'bn',label:'Bengali'},{code:'mr',label:'Marathi'}]
const NC=['#E8590C','#3B82F6','#8B5CF6','#F59E0B','#10B981','#EF4444','#14B8A6','#EC4899']
const SM:Record<string,string>={Mathematics:'math',Science:'science',English:'english',Hindi:'hindi','Social Studies':'social_studies',Physics:'physics',Chemistry:'chemistry',Biology:'biology','Computer Science':'computer_science'}
async function api(fn:string,body:any){try{const r=await fetch(`${EF}/${fn}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return await r.json()}catch{return{error:'API failed'}}}
async function ensureStudent(uid:string,p:Prof):Promise<string|null>{try{const{data:ex}=await sb.from('students').select('id').eq('auth_user_id',uid).maybeSingle();if(ex){await sb.from('students').update({name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject,onboarding_completed:true}).eq('id',ex.id);return ex.id};const{data:cr}=await sb.from('students').insert({auth_user_id:uid,name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject,onboarding_completed:true}).select('id').single();return cr?.id||null}catch(e){console.error(e);return null}}
const RS:Record<string,string>={math:'Mathematics',science:'Science',english:'English',hindi:'Hindi',social_studies:'Social Studies',physics:'Physics',chemistry:'Chemistry',biology:'Biology',computer_science:'Computer Science'}
async function loadProfileFromDB(uid:string):Promise<Prof|null>{try{const{data}=await sb.from('students').select('id,name,grade,preferred_language,preferred_subject,onboarding_completed').eq('auth_user_id',uid).maybeSingle();if(!data||!data.onboarding_completed)return null;const sub=RS[data.preferred_subject]||data.preferred_subject||'Mathematics';return{name:data.name||'Student',grade:data.grade||'Grade 6',subject:sub,language:data.preferred_language||'en',studentId:data.id}}catch{return null}}
async function getStats(sid:string):Promise<Stats>{const z:Stats={xp:0,streak:0,sessions:0,correct:0,asked:0,minutes:0};if(!sid)return z;try{const{data}=await sb.from('student_overall_stats').select('total_xp,streak_days,total_sessions,total_questions_asked,total_questions_answered_correctly,total_time_minutes').eq('student_id',sid).maybeSingle();if(!data)return z;return{xp:data.total_xp||0,streak:data.streak_days||0,sessions:data.total_sessions||0,correct:data.total_questions_answered_correctly||0,asked:data.total_questions_asked||0,minutes:data.total_time_minutes||0}}catch{return z}}
async function getTopicMastery(sid:string,sub:string){try{const{data}=await sb.from('topic_mastery').select('topic_tag,mastery_percent,mastery_level,total_attempts,correct_attempts').eq('student_id',sid).eq('subject',sub).order('mastery_percent',{ascending:false}).limit(20);return data||[]}catch{return[]}}
// AUTH — with bigger mobile buttons
function Auth({onAuth,onConfirm}:{onAuth:(u:any)=>void;onConfirm:()=>void}){const[mode,setMode]=useState<'login'|'signup'|'forgot'>('login');const[email,setEmail]=useState('');const[pw,setPw]=useState('');const[nm,setNm]=useState('');const[ld,setLd]=useState(false);const[err,setErr]=useState('');const[msg,setMsg]=useState('');const ggl=async()=>{const{error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:SITE}});if(error)setErr(error.message)};const go=async()=>{setErr('');setMsg('');setLd(true);try{if(mode==='forgot'){const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:`${SITE}?reset=true`});if(error)throw error;setMsg('Reset link sent!');setLd(false);return}if(pw.length<6)throw new Error('6+ chars');if(mode==='signup'){if(!nm.trim())throw new Error('Name required');const{data,error}=await sb.auth.signUp({email,password:pw,options:{data:{full_name:nm},emailRedirectTo:SITE}});if(error)throw error;if(!data.session){snd('ok');onConfirm();setLd(false);return}snd('ok');onAuth(data.user)}else{const{data,error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw error;snd('ok');onAuth(data.user)}}catch(e:any){snd('click');setErr(e.message?.includes('Invalid')?'Wrong email or password':e.message||'Error')};setLd(false)};return(<div className="a-auth"><div className="a-auth-l"><div style={{fontSize:56}}>&#x1F98A;</div><h1 style={{fontSize:42,fontWeight:900,marginTop:16}}>Alfanumrik</h1><p style={{fontSize:16,color:'rgba(255,255,255,.5)',marginTop:8}}>AI-powered adaptive learning by CusioSense Learning India Private Limited</p></div><div className="a-auth-r"><div style={{width:'100%',maxWidth:400}}><h2 style={{fontSize:28,fontWeight:800,marginBottom:24}}>{mode==='forgot'?'Reset password':mode==='signup'?'Create account':'Welcome back'}</h2>{mode!=='forgot'&&<div className="a-tabs">{(['login','signup']as const).map(m=><button key={m} onClick={()=>{setMode(m);setErr('');setMsg('')}} className={`a-tab${mode===m?' on':''}`}>{m==='login'?'Log In':'Sign Up'}</button>)}</div>}{err&&<div className="a-err">{err}</div>}{msg&&<div className="a-ok-msg">{msg}</div>}{mode==='signup'&&<input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Full name" className="a-inp"/>}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" className="a-inp"/>{mode!=='forgot'&&<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="a-inp" onKeyDown={e=>e.key==='Enter'&&go()}/>}<button onClick={go} disabled={ld} className="a-btn-primary" style={{width:'100%',minHeight:52}}>{ld?'Please wait...':{login:'Log In',signup:'Create Account',forgot:'Send Reset Link'}[mode]}</button>{mode==='login'&&<button onClick={()=>setMode('forgot')} className="a-link">Forgot password?</button>}{mode==='forgot'&&<button onClick={()=>setMode('login')} className="a-link">Back to login</button>}{mode!=='forgot'&&<><div className="a-divider"><span>or</span></div><button onClick={ggl} className="a-ggl" style={{minHeight:48}}><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.28-3.14.77-4.59l-7.98-6.19A23.9 23.9 0 000 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google</button></>}</div></div></div>)}
function ConfirmScreen({onBack}:{onBack:()=>void}){return(<div className="a-center-dark"><div style={{fontSize:64,marginBottom:16}}>&#x2709;&#xFE0F;</div><h2 style={{fontSize:24,fontWeight:800,color:'#fff',marginBottom:8}}>Check your email!</h2><p style={{fontSize:15,color:'rgba(255,255,255,.6)',marginBottom:24}}>Click the verification link to activate your account.</p><button onClick={onBack} className="a-btn-primary" style={{maxWidth:200,minHeight:48}}>Back to Login</button></div>)}
function ResetScreen(){const[pw,setPw]=useState('');const[pw2,setPw2]=useState('');const[ld,setLd]=useState(false);const[msg,setMsg]=useState('');const[err,setErr]=useState('');const go=async()=>{if(pw.length<6||pw!==pw2){setErr("Passwords don't match or too short");return}setLd(true);const{error}=await sb.auth.updateUser({password:pw});if(error)setErr(error.message);else{setMsg('Updated! Redirecting...');setTimeout(()=>window.location.href=SITE,2000)}setLd(false)};return(<div className="a-center-dark"><div style={{fontSize:48}}>&#x1F510;</div><h2 style={{fontSize:22,fontWeight:800,color:'#fff',margin:'12px 0 24px'}}>Set new password</h2>{err&&<div className="a-err">{err}</div>}{msg&&<div className="a-ok-msg">{msg}</div>}<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="New password" className="a-inp" style={{background:'rgba(255,255,255,.06)',color:'#fff',borderColor:'rgba(255,255,255,.1)'}}/><input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Confirm" className="a-inp" style={{background:'rgba(255,255,255,.06)',color:'#fff',borderColor:'rgba(255,255,255,.1)'}} onKeyDown={e=>e.key==='Enter'&&go()}/><button onClick={go} disabled={ld} className="a-btn-primary" style={{minHeight:48}}>{ld?'Updating...':'Update Password'}</button></div>)}
function Onboard({user,done}:{user:any;done:(p:Prof)=>void}){const[s,setS]=useState(0);const[nm,setNm]=useState(user?.user_metadata?.full_name||'');const[gr,setGr]=useState('');const[su,setSu]=useState('');const[la,setLa]=useState('en');const ok=[!!nm.trim(),!!gr,!!su,true][s];const nx=()=>{snd('click');setS(v=>v+1)};return(<div className="a-center-dark" style={{maxWidth:480,padding:'40px 24px'}}><div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:32}}>{[0,1,2,3,4].map(i=><div key={i} style={{height:8,borderRadius:4,background:i<=s?'#E8590C':'rgba(255,255,255,.15)',width:i<=s?24:8,transition:'all .3s'}}/>)}</div><div style={{fontSize:56,marginBottom:16,animation:'alfBounce 2s infinite'}}>&#x1F98A;</div><h2 style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:28}}>{['What should Foxy call you?','Which grade?','Pick a subject','Choose language','Welcome to Alfanumrik!'][s]}</h2><div key={s} style={{animation:'alfSlideUp .3s',minHeight:160}}>{s===0&&<input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Your name" autoFocus className="a-ob-inp" onKeyDown={e=>e.key==='Enter'&&nm.trim()&&nx()}/>}{s===1&&<div className="a-ob-g3">{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);snd('click')}} className={`a-ob-ch${gr===g?' on':''}`} style={{minHeight:52}}>{g}</button>)}</div>}{s===2&&<div className="a-ob-g2">{SUBJ.filter(x=>{const g=parseInt(gr.replace(/\D/g,'')||'6');return g>=11?['Mathematics','Physics','Chemistry','Biology','English','Computer Science','Accountancy','Economics'].includes(x.id):['Mathematics','Science','English','Hindi','Social Studies'].includes(x.id)}).map(x=><button key={x.id} onClick={()=>{setSu(x.id);snd('click')}} className={`a-ob-ch${su===x.id?' on':''}`} style={{minHeight:56,...(su===x.id?{background:x.c}:{})}}><span style={{fontSize:20}}>{x.icon}</span>{x.id}</button>)}</div>}{s===3&&<div className="a-ob-g2">{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);snd('click')}} className={`a-ob-ch${la===l.code?' on':''}`} style={{minHeight:52}}>{l.label}</button>)}</div>}{s===4&&<div style={{textAlign:'center',color:'rgba(255,255,255,.7)',lineHeight:1.8,fontSize:14}}>
<p style={{marginBottom:16}}>Hey {nm}! Here's how to get started:</p>
<div style={{display:'flex',flexDirection:'column',gap:12,textAlign:'left'}}>
{[{e:'🦊',t:'Chat with Foxy',d:'Ask any question about your NCERT chapters'},{e:'🎯',t:'Take Quizzes',d:'Test what you know and track mastery per chapter'},{e:'🗺️',t:'Learning Journey',d:'See all chapters and your progress'},{e:'📋',t:'Study Plan',d:'AI creates a daily plan based on your weaknesses'}].map(tip=><div key={tip.t} style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',borderRadius:12,background:'rgba(255,255,255,.08)'}}><span style={{fontSize:24}}>{tip.e}</span><div><p style={{fontWeight:700,color:'#fff',fontSize:13}}>{tip.t}</p><p style={{fontSize:11,opacity:.6}}>{tip.d}</p></div></div>)}
</div></div>}</div><div style={{display:'flex',gap:10,marginTop:28}}>{s>0&&<button onClick={()=>{setS(v=>v-1)}} className="a-ob-back" style={{minHeight:52}}>Back</button>}<button onClick={s<4?nx:()=>{snd('eureka');done({name:nm.trim(),grade:gr,subject:su,language:la})}} disabled={!ok} className="a-ob-next" style={{minHeight:52}}>{s<3?'Continue':s===3?'Next':"\uD83D\uDE80 Start Learning!"}</button></div></div>)}
// HOME — Playful colorful Duolingo-Indian with gradient hero, moments carousel, big action cards
function Home({p,nav,stats,history}:{p:Prof;nav:(s:Screen)=>void;stats:Stats;history:any}){const h=new Date().getHours();const greeting=h<12?'Good morning':h<17?'Good afternoon':'Good evening';const[inst,setInst]=useState(false);const[moments,setMoments]=useState<any[]>([]);const acc=stats.asked>0?Math.round((stats.correct/stats.asked)*100):0;
useEffect(()=>{if(typeof window!=='undefined'&&(window as any).alfanumrikInstallPrompt)setInst(true)},[]);
useEffect(()=>{if(!p.studentId)return;api('student-experience',{action:'dashboard',student_id:p.studentId,subject:SM[p.subject]||'math',grade:p.grade}).then(d=>{setMoments(d.celebrations||[])})},[p.studentId,p.subject,p.grade]);
const doInst=async()=>{const pr=(window as any).alfanumrikInstallPrompt;if(pr){pr.prompt();const{outcome}=await pr.userChoice;if(outcome==='accepted')setInst(false)}};
const MIcon:Record<string,{i:string;bg:string;bd:string}>={concept_mastered:{i:'\u2B50',bg:'#FFF7ED',bd:'#E8590C'},layer_unlocked:{i:'\uD83D\uDD13',bg:'#EFF6FF',bd:'#3B82F6'},misconception_fixed:{i:'\uD83D\uDD27',bg:'#F0FDF4',bd:'#22C55E'},streak_milestone:{i:'\uD83D\uDD25',bg:'#FFFBEB',bd:'#F59E0B'},comeback:{i:'\uD83D\uDE80',bg:'#FAF5FF',bd:'#8B5CF6'},first_correct:{i:'\uD83C\uDF31',bg:'#ECFDF5',bd:'#06B6D4'},exam_ready:{i:'\uD83C\uDF93',bg:'#FDF2F8',bd:'#EC4899'}};
return(<div style={{padding:'24px 28px 120px',maxWidth:900,animation:'alfFadeIn .4s'}}>
{/* GRADIENT HERO */}
<div style={{background:'linear-gradient(135deg,#E8590C,#EC4899)',borderRadius:24,padding:'28px 24px',color:'#fff',marginBottom:20,position:'relative',overflow:'hidden'}}>
<div style={{position:'absolute',top:-30,right:-30,width:120,height:120,borderRadius:'50%',background:'rgba(255,255,255,.1)'}}/>
<div style={{position:'absolute',bottom:-20,right:40,width:80,height:80,borderRadius:'50%',background:'rgba(255,255,255,.06)'}}/>
<p style={{fontSize:14,opacity:.8,fontWeight:500}}>{greeting}</p>
<h1 style={{fontSize:28,fontWeight:900,margin:'4px 0 16px',letterSpacing:'-.02em'}}>{p.name} \uD83E\uDD8A</h1>
<div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
{[{v:String(stats.xp),l:'XP',i:'\u26A1'},{v:String(stats.streak||0),l:'Streak',i:'\uD83D\uDD25'},{v:`${acc}%`,l:'Accuracy',i:'\uD83C\uDFAF'},{v:String(stats.sessions),l:'Quizzes',i:'\uD83D\uDCDA'}].map(s=>(
<div key={s.l} style={{background:'rgba(255,255,255,.15)',borderRadius:14,padding:'10px 16px',backdropFilter:'blur(8px)',display:'flex',alignItems:'center',gap:8}}>
<span style={{fontSize:18}}>{s.i}</span><div><p style={{fontSize:18,fontWeight:900,lineHeight:1}}>{s.v}</p><p style={{fontSize:10,opacity:.7,fontWeight:600}}>{s.l}</p></div></div>))}
</div></div>
{/* PWA Install */}
{inst&&<button onClick={doInst} style={{width:'100%',padding:'16px 20px',borderRadius:16,border:'2px dashed #E8590C',background:'#FFF7ED',color:'#E8590C',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'center',gap:8,animation:'alfBounce 2s infinite',minHeight:56}}>{'\uD83D\uDCF2'} Install Alfanumrik App</button>}
{/* MOMENTS CAROUSEL */}
{moments.length>0&&<div style={{marginBottom:20}}><h3 className="a-section-title">{'\u2728'} YOUR MOMENTS</h3>
<div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:8,scrollSnapType:'x mandatory',WebkitOverflowScrolling:'touch' as any}}>
{moments.map((m:any,i:number)=>{const look=MIcon[m.moment_type]||{i:'\u2728',bg:'#F5F4F0',bd:'#E7E5E4'};return(
<div key={m.id||i} style={{minWidth:260,maxWidth:300,padding:'16px 18px',borderRadius:18,border:`2px solid ${look.bd}20`,background:look.bg,scrollSnapAlign:'start',flexShrink:0,animation:`alfSlideUp .4s ease ${i*.1}s both`}}>
<div style={{fontSize:24,marginBottom:6}}>{look.i}</div>
<p style={{fontSize:14,fontWeight:800,marginBottom:4,color:'#1C1917'}}>{m.title}</p>
<p style={{fontSize:12,color:'#57534E',lineHeight:1.5}}>{m.description}</p>
<p style={{fontSize:12,fontWeight:900,color:'#E8590C',marginTop:8}}>+{m.xp_awarded} XP</p>
</div>)})}
</div></div>}
{/* BIG ACTION CARDS */}
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12,marginBottom:20}}>
{[{icon:'\uD83E\uDD8A',label:'Chat with Foxy',desc:'Ask anything',sc:'foxy' as Screen,bg:'linear-gradient(135deg,#FFF7ED,#FEF3C7)',border:'#E8590C'},
{icon:'\uD83C\uDFAF',label:'Take a Quiz',desc:`${stats.sessions} completed`,sc:'quiz' as Screen,bg:'linear-gradient(135deg,#FAF5FF,#EDE9FE)',border:'#8B5CF6'},
{icon:'\uD83D\uDCCB',label:'Study Plan',desc:'AI daily tasks',sc:'plan' as Screen,bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)',border:'#22C55E'},
{icon:'\u2B50',label:'Learning Journey',desc:'Chapter mastery',sc:'skills' as Screen,bg:'linear-gradient(135deg,#ECFDF5,#D1FAE5)',border:'#0EA5E9'}
].map((card,i)=>(
<button key={card.sc} onClick={()=>{snd('click');nav(card.sc)}} style={{padding:'20px 16px',borderRadius:20,border:`2px solid ${card.border}25`,background:card.bg,cursor:'pointer',fontFamily:'inherit',textAlign:'left',minHeight:120,transition:'all .2s',animation:`alfSlideUp .4s ease ${.1+i*.08}s both`}}>
<span style={{fontSize:32,display:'block',marginBottom:10}}>{card.icon}</span>
<p style={{fontSize:15,fontWeight:800,color:'#1C1917',marginBottom:2}}>{card.label}</p>
<p style={{fontSize:12,color:'#78716C',fontWeight:500}}>{card.desc}</p>
</button>))}
</div>
{/* RECENT QUIZZES */}
{history?.quizzes?.length>0&&<div className="a-card"><h3 className="a-section-title">RECENT QUIZZES</h3>
{history.quizzes.slice(0,4).map((q:any)=><div key={q.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid #F5F4F0'}}>
<div><p style={{fontSize:13,fontWeight:600}}>{q.subject} &middot; {q.grade}</p><p style={{fontSize:11,color:'#A8A29E'}}>{new Date(q.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</p></div>
<div style={{fontSize:15,fontWeight:900,padding:'4px 12px',borderRadius:10,background:q.score_percent>=70?'#F0FDF4':q.score_percent>=40?'#FFFBEB':'#FEF2F2',color:q.score_percent>=70?'#16A34A':q.score_percent>=40?'#D97706':'#DC2626'}}>{q.score_percent}%</div>
</div>)}</div>}
{/* GROWTH MESSAGE */}
<div style={{background:'linear-gradient(135deg,#1C1917,#292524)',borderRadius:20,padding:24,color:'#D6D3D1',lineHeight:1.7,fontSize:14}}>
<p style={{fontSize:12,fontWeight:800,color:'#E8590C',letterSpacing:'.08em',marginBottom:10}}>{'\uD83E\uDDE0'} YOU ARE GETTING BETTER AT THINKING</p>
<p>Every question you answer builds your understanding. Keep going!</p>
</div>
</div>)}
// LEARNING JOURNEY — Fully NCERT-aligned chapter journey with Foxy + Quiz integration
function SkillTree({p,nav}:{p:Prof;nav:(s:Screen)=>void}){const[chapters,setChapters]=useState<any[]>([]);const[loading,setLoading]=useState(true);const[sel,setSel]=useState<any>(null);const[stats,setStats]=useState<any>({});const[topicPreviews,setTopicPreviews]=useState<Record<number,string[]>>({});
useEffect(()=>{loadJourney()},[p.studentId,p.subject,p.grade]);
const loadJourney=async()=>{setLoading(true);try{
const sc=SM[p.subject]||'math';
// 1. Load curriculum chapters
const{data:subj}=await sb.from('subjects').select('id').eq('code',sc).maybeSingle();
let chs:any[]=[];
if(subj){const{data:topics}=await sb.from('curriculum_topics').select('chapter_number,title').eq('subject_id',subj.id).eq('grade',p.grade).eq('is_active',true).order('chapter_number');chs=topics||[]}
// 2. Load RAG content counts + key topics per chapter
const{data:ragData}=await sb.from('rag_content_chunks').select('chapter_number,chunk_type,chunk_text').eq('grade',p.grade).eq('subject',p.subject).eq('is_active',true);
const ragMap:Record<number,{count:number;topics:string[]}>={};
(ragData||[]).forEach((r:any)=>{
  if(!ragMap[r.chapter_number])ragMap[r.chapter_number]={count:0,topics:[]};
  ragMap[r.chapter_number].count++;
  // Extract key topics from definition and key_point chunks
  if((r.chunk_type==='definition'||r.chunk_type==='key_point'||r.chunk_type==='theorem')&&r.chunk_text){
    const preview=r.chunk_text.replace(/^(Definition:|Key Point:|Formula:|Theorem:)\s*/i,'').substring(0,80);
    if(ragMap[r.chapter_number].topics.length<3)ragMap[r.chapter_number].topics.push(preview);
  }
});
// 3. Load quiz mastery per chapter from quiz_sessions
let quizMap:Record<number,{sessions:number;bestScore:number;totalQs:number;totalCorrect:number}>={};
if(p.studentId){try{
  const{data:sessions}=await sb.from('quiz_sessions').select('chapter_number,score_percent,total_questions,correct_answers').eq('student_id',p.studentId).eq('subject',sc).eq('grade',p.grade);
  (sessions||[]).forEach((s:any)=>{
    const ch=s.chapter_number||0;if(ch<=0)return;
    if(!quizMap[ch])quizMap[ch]={sessions:0,bestScore:0,totalQs:0,totalCorrect:0};
    quizMap[ch].sessions++;
    quizMap[ch].bestScore=Math.max(quizMap[ch].bestScore,s.score_percent||0);
    quizMap[ch].totalQs+=(s.total_questions||0);
    quizMap[ch].totalCorrect+=(s.correct_answers||0);
  });
}catch{}}
// 4. Load question_bank counts per chapter
const{data:qbCounts}=await sb.from('question_bank').select('chapter_number').eq('grade',p.grade).eq('subject',sc).eq('is_active',true);
const qbMap:Record<number,number>={};
(qbCounts||[]).forEach((q:any)=>{qbMap[q.chapter_number]=(qbMap[q.chapter_number]||0)+1});
// 5. Merge everything into chapter objects
const merged=chs.map((ch:any,i:number)=>{
  const rag=ragMap[ch.chapter_number]||{count:0,topics:[]};
  const quiz=quizMap[ch.chapter_number];
  const qbCount=qbMap[ch.chapter_number]||0;
  const mastery=quiz?Math.round(quiz.bestScore):0;
  const hasContent=rag.count>0;
  const hasQuiz=qbCount>0||hasContent; // Can generate quiz from RAG content even if no pre-made questions
  let status:'mastered'|'proficient'|'learning'|'attempted'|'ready'|'upcoming'='upcoming';
  if(mastery>=85)status='mastered';
  else if(mastery>=60)status='proficient';
  else if(mastery>=30)status='learning';
  else if(quiz&&quiz.sessions>0)status='attempted';
  else if(hasContent)status='ready';
  return{
    ...ch, index:i, rag_chunks:rag.count, key_topics:rag.topics,
    quiz_sessions:quiz?.sessions||0, best_score:mastery, total_qs:quiz?.totalQs||0, total_correct:quiz?.totalCorrect||0,
    qb_count:qbCount, has_content:hasContent, has_quiz:hasQuiz, status, mastery
  };
});
setChapters(merged);
const tp={}as Record<number,string[]>;merged.forEach(c=>{if(c.key_topics.length>0)tp[c.chapter_number]=c.key_topics});setTopicPreviews(tp);
const m=merged.filter(c=>c.status==='mastered').length;
const pr=merged.filter(c=>c.status==='proficient').length;
const lr=merged.filter(c=>c.status==='learning'||c.status==='attempted').length;
const rd=merged.filter(c=>c.status==='ready').length;
const overallPct=merged.length?Math.round((m*100+pr*75+lr*30)/(merged.length*100)*100):0;
setStats({total:merged.length,mastered:m,proficient:pr,learning:lr,ready:rd,upcoming:merged.length-m-pr-lr-rd,pct:overallPct,totalRag:merged.reduce((s,c)=>s+c.rag_chunks,0)});
}catch(e){console.error('Journey load error:',e)}setLoading(false)};
// Navigate to Foxy with chapter context
const learnWithFoxy=(ch:any)=>{
  // Store chapter context in localStorage for Foxy to pick up
  try{localStorage.setItem('alfanumrik_foxy_chapter',JSON.stringify({chapter:ch.chapter_number,title:ch.title,subject:p.subject,grade:p.grade}));}catch{}
  nav('foxy' as Screen);
  // The Foxy component will detect this and auto-send a learning prompt
};
// Navigate to Quiz with chapter pre-selected
const takeQuiz=(ch:any)=>{
  try{localStorage.setItem('alfanumrik_quiz_chapter',JSON.stringify({chapter:ch.chapter_number,title:ch.title,subject:p.subject,grade:p.grade}));}catch{}
  nav('quiz' as Screen);
};
const ST:Record<string,{emoji:string;color:string;bg:string;label:string;border:string}>={
  mastered:{emoji:'🏆',color:'#E8590C',bg:'linear-gradient(135deg,#FFF7ED,#FFEDD5)',label:'Mastered',border:'#E8590C'},
  proficient:{emoji:'✅',color:'#16A34A',bg:'linear-gradient(135deg,#F0FDF4,#DCFCE7)',label:'Proficient',border:'#16A34A'},
  learning:{emoji:'📖',color:'#3B82F6',bg:'linear-gradient(135deg,#EFF6FF,#DBEAFE)',label:'Learning',border:'#3B82F6'},
  attempted:{emoji:'💪',color:'#F59E0B',bg:'linear-gradient(135deg,#FFFBEB,#FEF3C7)',label:'Keep Going',border:'#F59E0B'},
  ready:{emoji:'🚀',color:'#22C55E',bg:'linear-gradient(135deg,#F0FDF4,#BBF7D0)',label:'Start Learning',border:'#22C55E'},
  upcoming:{emoji:'📋',color:'#A8A29E',bg:'#F5F4F0',label:'Coming Soon',border:'#E7E5E4'}
};
if(loading)return<div style={{padding:'80px 20px',textAlign:'center'}}><div style={{fontSize:48,animation:'alfPulse 1.5s infinite'}}>🗺️</div><p style={{color:'#A8A29E',marginTop:12}}>Loading your learning journey...</p></div>;
return(<div style={{padding:'20px 24px 120px',maxWidth:900,animation:'alfFadeIn .4s'}}>
{/* Header */}
<div style={{marginBottom:16}}><h1 style={{fontSize:24,fontWeight:900}}>🗺️ Learning Journey</h1><p style={{fontSize:13,color:'#78716C',marginTop:4}}>{p.subject} · {p.grade} · {chapters.length} chapters · {stats.totalRag||0} NCERT study materials</p></div>
{/* Progress hero card */}
<div style={{background:'linear-gradient(135deg,#1C1917,#292524)',borderRadius:20,padding:20,marginBottom:20,color:'#fff'}}>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
<div><p style={{fontSize:12,fontWeight:700,color:'#E8590C',letterSpacing:'.05em'}}>SYLLABUS PROGRESS</p><p style={{fontSize:42,fontWeight:900,lineHeight:1}}>{stats.pct}<span style={{fontSize:18,color:'#A8A29E'}}>%</span></p></div>
<div style={{display:'flex',gap:12,textAlign:'center'}}>{[{v:stats.mastered,l:'Mastered',e:'🏆',c:'#E8590C'},{v:stats.proficient||0,l:'Proficient',e:'✅',c:'#16A34A'},{v:stats.learning,l:'Learning',e:'📖',c:'#3B82F6'},{v:stats.ready,l:'Ready',e:'🚀',c:'#22C55E'}].map(x=><div key={x.l}><p style={{fontSize:20,fontWeight:900}}>{x.v}</p><p style={{fontSize:9,color:x.c,fontWeight:700}}>{x.l}</p></div>)}</div>
</div>
<div style={{height:8,borderRadius:4,background:'rgba(255,255,255,.08)',overflow:'hidden',display:'flex'}}>
{[{w:stats.mastered,c:'#E8590C'},{w:stats.proficient||0,c:'#16A34A'},{w:stats.learning,c:'#3B82F6'},{w:stats.ready,c:'#22C55E30'}].map((seg,i)=><div key={i} style={{width:`${(seg.w/(stats.total||1))*100}%`,background:seg.c,transition:'width .6s'}}/>)}
</div>
</div>
{/* Chapter cards */}
<div style={{display:'flex',flexDirection:'column',gap:12}}>
{chapters.map((ch,i)=>{const st=ST[ch.status]||ST.upcoming;const isOpen=sel?.chapter_number===ch.chapter_number;const hasActivity=ch.has_content||ch.quiz_sessions>0;
return<div key={ch.chapter_number} style={{animation:`alfSlideUp .4s ease ${Math.min(i*.04,.6)}s both`}}>
<button onClick={()=>{snd('click');setSel(isOpen?null:ch)}} style={{width:'100%',padding:'16px 18px',borderRadius:16,border:`1.5px solid ${isOpen?st.border:st.border+'40'}`,background:st.bg,cursor:'pointer',fontFamily:'inherit',textAlign:'left',transition:'all .2s',boxShadow:isOpen?`0 4px 20px ${st.color}15`:'none'}}>
{/* Top row: chapter number + title + mastery */}
<div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,flexWrap:'wrap'}}>
<span style={{fontSize:13,fontWeight:800,color:st.color,whiteSpace:'nowrap'}}>Ch {ch.chapter_number}</span>
<span style={{fontSize:16}}>{st.emoji}</span>
{ch.has_content&&<span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:6,background:'#E8590C15',color:'#E8590C',whiteSpace:'nowrap'}}>📚 NCERT</span>}
{ch.quiz_sessions>0&&<span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:6,background:'#3B82F615',color:'#3B82F6',whiteSpace:'nowrap'}}>🎯 {ch.quiz_sessions} quiz{ch.quiz_sessions>1?'zes':''}</span>}
</div>
<p style={{fontSize:15,fontWeight:700,color:'#1C1917',lineHeight:1.35}}>{ch.title}</p>
{/* Key topics preview */}
{ch.key_topics.length>0&&!isOpen&&<p style={{fontSize:11,color:'#78716C',marginTop:4,lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:1,WebkitBoxOrient:'vertical' as any}}>{ch.key_topics[0]}</p>}
</div>
{/* Mastery score */}
{ch.mastery>0&&<div style={{textAlign:'right',flexShrink:0,paddingLeft:8}}>
<p style={{fontSize:28,fontWeight:900,color:st.color,lineHeight:1}}>{ch.mastery}%</p>
<p style={{fontSize:10,color:'#78716C',fontWeight:600}}>{ch.total_correct}/{ch.total_qs} correct</p>
</div>}
{!ch.mastery&&ch.has_content&&<div style={{textAlign:'right',flexShrink:0,paddingLeft:8}}>
<p style={{fontSize:12,fontWeight:700,color:st.color}}>{st.label}</p>
<p style={{fontSize:10,color:'#78716C'}}>{ch.rag_chunks} materials</p>
</div>}
</div>
{/* Progress bar */}
<div style={{height:5,borderRadius:3,background:`${st.color}12`,marginTop:10}}>
<div style={{height:'100%',borderRadius:3,background:st.color,width:`${Math.max(ch.mastery,ch.has_content?3:0)}%`,transition:'width .5s'}}/>
</div>
</button>
{/* Expanded detail panel */}
{isOpen&&<div style={{padding:'16px 18px',marginTop:-4,borderRadius:'0 0 16px 16px',border:`1.5px solid ${st.border}40`,borderTop:'none',background:'#fff',animation:'alfFadeIn .3s'}}>
{/* Key topics from NCERT */}
{ch.key_topics.length>0&&<div style={{marginBottom:14}}>
<p style={{fontSize:11,fontWeight:700,color:'#78716C',marginBottom:6,letterSpacing:'.05em'}}>KEY TOPICS FROM NCERT</p>
<div style={{display:'flex',flexDirection:'column',gap:4}}>
{ch.key_topics.map((t:string,j:number)=><div key={j} style={{padding:'8px 12px',borderRadius:10,background:'#FAFAF8',border:'1px solid #E7E5E4',fontSize:12,color:'#44403C',lineHeight:1.4}}>
<span style={{color:'#E8590C',fontWeight:700,marginRight:6}}>•</span>{t}
</div>)}
</div>
</div>}
{/* Stats row */}
<div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
{ch.rag_chunks>0&&<div style={{padding:'8px 14px',borderRadius:10,background:'#FFF7ED',border:'1px solid #FFEDD5',flex:'1 1 auto',textAlign:'center'}}>
<p style={{fontSize:18,fontWeight:900,color:'#E8590C'}}>{ch.rag_chunks}</p><p style={{fontSize:10,color:'#78716C',fontWeight:600}}>Study Materials</p>
</div>}
{ch.quiz_sessions>0&&<div style={{padding:'8px 14px',borderRadius:10,background:'#EFF6FF',border:'1px solid #DBEAFE',flex:'1 1 auto',textAlign:'center'}}>
<p style={{fontSize:18,fontWeight:900,color:'#3B82F6'}}>{ch.best_score}%</p><p style={{fontSize:10,color:'#78716C',fontWeight:600}}>Best Score</p>
</div>}
{ch.quiz_sessions>0&&<div style={{padding:'8px 14px',borderRadius:10,background:'#F0FDF4',border:'1px solid #DCFCE7',flex:'1 1 auto',textAlign:'center'}}>
<p style={{fontSize:18,fontWeight:900,color:'#16A34A'}}>{ch.total_correct}/{ch.total_qs}</p><p style={{fontSize:10,color:'#78716C',fontWeight:600}}>Questions</p>
</div>}
</div>
{/* Action buttons */}
<div style={{display:'flex',gap:8}}>
{ch.has_content&&<button onClick={(e)=>{e.stopPropagation();snd('ok');learnWithFoxy(ch)}} style={{flex:1,padding:'13px 16px',borderRadius:14,border:'none',background:`linear-gradient(135deg,${st.color},${st.color}CC)`,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:48,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>🦊 Learn with Foxy</button>}
<button onClick={(e)=>{e.stopPropagation();snd('ok');takeQuiz(ch)}} style={{flex:1,padding:'13px 16px',borderRadius:14,border:`2px solid ${st.color}`,background:'#fff',color:st.color,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:48,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>🎯 Take Quiz</button>
</div>
{/* Mastery breakdown for attempted chapters */}
{ch.quiz_sessions>0&&ch.mastery<85&&<p style={{fontSize:11,color:'#78716C',marginTop:10,textAlign:'center'}}>{ch.mastery>=60?'Almost there! One more quiz to master this chapter.':ch.mastery>=30?'Good progress! Keep practicing to improve your score.':'Take a few more quizzes to build mastery.'}</p>}
{ch.status==='mastered'&&<p style={{fontSize:11,color:'#E8590C',fontWeight:700,marginTop:10,textAlign:'center'}}>🏆 You have mastered this chapter! Try the next one.</p>}
</div>}
</div>})}
</div>
{/* Empty state */}
{stats.mastered===0&&stats.learning===0&&stats.proficient===0&&<div style={{background:'linear-gradient(135deg,#FFF7ED,#FED7AA)',borderRadius:20,padding:24,marginTop:16,textAlign:'center'}}>
<FoxyAvatar state="encouraging" size={64} color="#E8590C"/>
<p style={{fontSize:16,fontWeight:800,marginTop:12,color:'#1C1917'}}>Your adventure begins here!</p>
<p style={{fontSize:13,color:'#78716C',marginTop:6,lineHeight:1.5}}>Tap any chapter with 📚 NCERT badge to start learning with Foxy, or take a quiz to test what you already know. Each chapter you complete lights up your journey!</p>
</div>}
</div>)}
// ANIMATED AVATAR SVG — Phase 2
function FoxyAvatar({state,size=80,color='#E8590C'}:{state:string;size?:number;color?:string}){
const mouthD = state==='talking'||state==='explaining' ? 'M 30 58 Q 40 68 50 58' : state==='celebrating' ? 'M 28 55 Q 40 70 52 55' : state==='thinking' ? 'M 33 58 L 47 58' : state==='listening' ? 'M 34 58 Q 40 62 46 58' : 'M 32 56 Q 40 62 48 56';
const eyeR = state==='thinking' ? 4.5 : state==='celebrating' ? 3 : 5;
const eyeY = state==='thinking' ? 36 : 37;
const browY = state==='asking' ? 26 : state==='celebrating' ? 28 : 29;
return <svg viewBox="0 0 80 80" width={size} height={size} style={{filter:'drop-shadow(0 4px 12px rgba(0,0,0,.1))'}}>
<defs><radialGradient id="fg" cx="50%" cy="40%"><stop offset="0%" stopColor={color}/><stop offset="100%" stopColor="#C2410C"/></radialGradient></defs>
{/* Head */}<ellipse cx="40" cy="42" rx="28" ry="26" fill="url(#fg)"/>
{/* Ears */}<path d="M 14 30 L 8 10 L 24 24 Z" fill={color}><animateTransform attributeName="transform" type="rotate" values={state==='listening'?'-5 14 30;5 14 30;-5 14 30':'0 14 30'} dur={state==='listening'?'0.8s':'2s'} repeatCount="indefinite"/></path>
<path d="M 66 30 L 72 10 L 56 24 Z" fill={color}><animateTransform attributeName="transform" type="rotate" values={state==='listening'?'5 66 30;-5 66 30;5 66 30':'0 66 30'} dur={state==='listening'?'0.8s':'2s'} repeatCount="indefinite"/></path>
{/* Ear inners */}<path d="M 15 28 L 12 14 L 22 24 Z" fill="#FED7AA"/><path d="M 65 28 L 68 14 L 58 24 Z" fill="#FED7AA"/>
{/* Face mask */}<ellipse cx="40" cy="48" rx="18" ry="14" fill="#FFF7ED"/>
{/* Eyes */}<circle cx="30" cy={eyeY} r={eyeR} fill="#1C1917">
{state==='talking'&&<animate attributeName="r" values="5;4;5" dur="0.3s" repeatCount="indefinite"/>}
{state==='celebrating'&&<animate attributeName="cy" values="37;35;37" dur="0.5s" repeatCount="indefinite"/>}
</circle><circle cx="50" cy={eyeY} r={eyeR} fill="#1C1917">
{state==='talking'&&<animate attributeName="r" values="5;4;5" dur="0.3s" repeatCount="indefinite"/>}
</circle>
{/* Eye sparkle */}<circle cx="32" cy={eyeY-2} r="1.5" fill="#fff"/><circle cx="52" cy={eyeY-2} r="1.5" fill="#fff"/>
{/* Brows */}{state==='asking'&&<><line x1="25" y1={browY} x2="33" y2={browY-3} stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round"/><line x1="55" y1={browY} x2="47" y2={browY-3} stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round"/></>}
{state==='thinking'&&<><line x1="25" y1="28" x2="33" y2="30" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round"/><circle cx="60" cy="22" r="3" fill="none" stroke="#A8A29E" strokeWidth="1"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="64" cy="16" r="2" fill="none" stroke="#A8A29E" strokeWidth="1"><animate attributeName="opacity" values="0;0;1;0" dur="1.5s" repeatCount="indefinite"/></circle></>}
{/* Nose */}<ellipse cx="40" cy="48" rx="3" ry="2.5" fill="#1C1917"/>
{/* Mouth */}<path d={mouthD} fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round">
{state==='talking'&&<animate attributeName="d" values="M 30 58 Q 40 68 50 58;M 32 56 Q 40 62 48 56;M 30 58 Q 40 68 50 58" dur="0.4s" repeatCount="indefinite"/>}
</path>
{/* Celebration sparkles */}{state==='celebrating'&&<>{[{x:10,y:12,d:0.1},{x:68,y:8,d:0.3},{x:5,y:50,d:0.5},{x:72,y:45,d:0.2}].map((s,i)=><circle key={i} cx={s.x} cy={s.y} r="2" fill="#F59E0B"><animate attributeName="opacity" values="0;1;0" dur="0.8s" begin={`${s.d}s`} repeatCount="indefinite"/><animate attributeName="r" values="1;3;1" dur="0.8s" begin={`${s.d}s`} repeatCount="indefinite"/></circle>)}</>}
{/* Encouraging flexed arm */}{state==='encouraging'&&<text x="64" y="66" fontSize="14" style={{animation:'alfBounce 1s infinite'}}>💪</text>}
</svg>}
// FOXY CHAT — Phase 2: Animated Avatar + Auto TTS + Avatar Selection + Persona Switching
const AVATARS=[{id:'foxy',name:'Foxy',emoji:'🦊',color:'#E8590C',desc:'Playful & warm'},{id:'guru_ji',name:'Guru Ji',emoji:'👨‍🏫',color:'#1E40AF',desc:'Structured & detailed'},{id:'neha_maam',name:'Neha Ma\'am',emoji:'👩‍🏫',color:'#7C3AED',desc:'Patient & encouraging'},{id:'arjun_sir',name:'Arjun Sir',emoji:'🧑‍💻',color:'#059669',desc:'Fast & energetic'},{id:'olympia',name:'Olympia',emoji:'⭐',color:'#DC2626',desc:'Challenge-focused'}];
const PERSONAS=[{id:'friendly_primary',name:'Friendly',emoji:'😊',desc:'Warm & patient'},{id:'concept_master',name:'Concept',emoji:'🧠',desc:'Deep understanding'},{id:'exam_coach',name:'Exam Coach',emoji:'🎯',desc:'Score-focused'},{id:'olympiad_mentor',name:'Olympiad',emoji:'🏆',desc:'Problem-solving'},{id:'jee_neet_coach',name:'JEE/NEET',emoji:'🔬',desc:'Competitive prep'}];
function Foxy({p}:{p:Prof}){const subCode=SM[p.subject]||'math';const[msgs,setMsgs]=useState<any[]>([]);const[inp,setInp]=useState('');const[ld,setLd]=useState(false);const[initLd,setInitLd]=useState(true);const[hist,setHist]=useState<any[]>([]);const[spk,setSpk]=useState<number|null>(null);const[sesId,setSesId]=useState<string|null>(null);const end=useRef<HTMLDivElement>(null);const iR=useRef<HTMLTextAreaElement>(null);
const[listening,setListening]=useState(false);const[avatarSt,setAvatarSt]=useState<string>('idle');const[transcript,setTranscript]=useState('');const recognRef=useRef<any>(null);
const[curAvatar,setCurAvatar]=useState('foxy');const[curPersona,setCurPersona]=useState('friendly_primary');const[showPicker,setShowPicker]=useState<'avatar'|'persona'|null>(null);const[ttsPlaying,setTtsPlaying]=useState(false);const[celebration,setCelebration]=useState<string|null>(null);
const avInfo=AVATARS.find(a=>a.id===curAvatar)||AVATARS[0];
const startVoice=()=>{try{const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!SR){alert('Voice not supported in this browser. Try Chrome.');return}const r=new SR();r.continuous=false;r.interimResults=true;r.lang=p.language==='hi'?'hi-IN':'en-IN';r.onstart=()=>{setListening(true);setAvatarSt('listening');setTranscript('');if('speechSynthesis' in window)speechSynthesis.cancel()};r.onresult=(e:any)=>{let interim='';let final='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript}if(final){setTranscript(final);setInp(final)}else{setTranscript(interim)}};r.onerror=()=>{setListening(false);setAvatarSt('idle')};r.onend=()=>{setListening(false);if(transcript)setAvatarSt('thinking');else setAvatarSt('idle')};recognRef.current=r;r.start()}catch{alert('Voice input not available')}};
const stopVoice=()=>{if(recognRef.current){recognRef.current.stop();setListening(false)}};
// Browser-only speech (no ElevenLabs) — used only when student taps the speaker button
const speakText=(text:string,msgId?:number)=>{if(!('speechSynthesis' in window)){alert('Speech not supported');return}if(ttsPlaying){speechSynthesis.cancel();setTtsPlaying(false);setAvatarSt('idle');setSpk(null);return}const clean=text.replace(/<svg[\s\S]*?<\/svg>/gi,'').replace(/[*#`]/g,'').substring(0,800);if(!clean.trim())return;if(msgId)setSpk(msgId);setTtsPlaying(true);setAvatarSt('talking');const u=new SpeechSynthesisUtterance(clean);u.lang=p.language==='hi'?'hi-IN':'en-IN';u.rate=0.95;u.pitch=1.0;const voices=speechSynthesis.getVoices();const indianVoice=voices.find(v=>v.lang.includes('en-IN'))||voices.find(v=>v.lang.includes('en'));if(indianVoice)u.voice=indianVoice;u.onend=()=>{setTtsPlaying(false);setAvatarSt('idle');setSpk(null)};u.onerror=()=>{setTtsPlaying(false);setAvatarSt('idle');setSpk(null)};speechSynthesis.speak(u)};
const triggerCelebration=(type:string)=>{setCelebration(type);snd(type==='correct'?'correct':type==='streak'?'streak':'badge');setTimeout(()=>setCelebration(null),2500)};
useEffect(()=>{(async()=>{if(!p.studentId){setMsgs([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor for ${p.grade}. Ask me anything!`,isUser:false,ts:Date.now()}]);setInitLd(false);return}try{const r=await api('chat-history',{action:'get_or_create',student_id:p.studentId,subject:subCode,grade:p.grade});if(r.session){setSesId(r.session.id);const savedMsgs=r.session.messages||[];if(savedMsgs.length>0){setMsgs(savedMsgs);const h=savedMsgs.filter((m:any)=>!m.isSystem).map((m:any)=>({role:m.isUser?'user':'assistant',content:m.text}));setHist(h)}else{setMsgs([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor for ${p.grade}. Ask me anything!`,isUser:false,ts:Date.now()}])}}else{setMsgs([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor for ${p.grade}. Ask me anything!`,isUser:false,ts:Date.now()}])}}catch(e){console.error('Foxy init error:',e);setMsgs([{id:1,text:`Hey ${p.name}! I'm Foxy, your ${p.subject} tutor for ${p.grade}. Ask me anything!`,isUser:false,ts:Date.now()}])}setInitLd(false);
})()},[p.studentId,p.subject]);
// Detect chapter context from Learning Journey AFTER component is fully rendered
const[pendingChapter,setPendingChapter]=useState<string|null>(null);
useEffect(()=>{if(initLd)return;try{const chCtx=localStorage.getItem('alfanumrik_foxy_chapter');if(chCtx){localStorage.removeItem('alfanumrik_foxy_chapter');const ch=JSON.parse(chCtx);if(ch.title&&ch.chapter){setPendingChapter(`Teach me Chapter ${ch.chapter}: ${ch.title}. Start from the basics and explain the key concepts step by step.`)}}}catch{}},[initLd]);
useEffect(()=>{if(pendingChapter&&!ld&&!initLd&&msgs.length>0){const msg=pendingChapter;setPendingChapter(null);send(msg)}},[pendingChapter,ld,initLd,msgs.length]);
useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'})},[msgs]);
const saveToDb=useCallback(async(newMsgs:any[],sid:string|null)=>{if(!p.studentId||!sid||newMsgs.length<=1)return;await api('chat-history',{action:'save_messages',student_id:p.studentId,session_id:sid,messages:newMsgs,title:newMsgs.find((m:any)=>m.isUser)?.text?.substring(0,40)||'Chat'})},[p.studentId]);
const speak=async(id:number,t:string)=>{speakText(t,id)};
const renderMsg=(t:string)=>{if(!t?.includes('<svg'))return t||'';const parts=t.split(/(<svg[\s\S]*?<\/svg>)/gi);return <>{parts.map((pt,i)=>pt.startsWith('<svg')?<div key={i} style={{margin:'8px 0',maxWidth:400}} dangerouslySetInnerHTML={{__html:pt}}/>:<span key={i}>{pt}</span>)}</>};
const saveNote=async(text:string)=>{if(!p.studentId)return;await api('student-notes',{action:'create',student_id:p.studentId,subject:subCode,grade:p.grade,title:'Foxy: '+text.substring(0,40)+'...',content:text.replace(/<svg[\s\S]*?<\/svg>/gi,''),note_type:'summary',source:'foxy_chat',color:'#E8590C'});snd('ok')};
const newChat=async()=>{if(!p.studentId)return;const r=await api('chat-history',{action:'new_chat',student_id:p.studentId,subject:subCode,grade:p.grade});if(r.session){setSesId(r.session.id);setMsgs([{id:Date.now(),text:`Fresh start! What would you like to learn, ${p.name}?`,isUser:false,ts:Date.now()}]);setHist([]);snd('ok')}};
const send=async(t:string)=>{if(!t.trim()||ld)return;const m=t.trim();snd('send');setTranscript('');const userMsg={id:Date.now(),text:m,isUser:true,ts:Date.now()};const newMsgs=[...msgs,userMsg];setMsgs(newMsgs);setInp('');setLd(true);setAvatarSt('thinking');snd('think');const nh=[...hist,{role:'user',content:m}];const res=await api('foxy-tutor',{messages:nh,student_name:p.name,grade:p.grade,subject:p.subject,language:p.language,student_id:p.studentId||null,avatar_id:curAvatar,persona_id:curPersona});const txt=res.text||'Foxy had a hiccup!';snd('recv');const hasQ=txt.includes('?');const hasPraise=/correct|right|exactly|well done|great|perfect|excellent|bahut/i.test(txt);if(hasPraise){setAvatarSt('celebrating');triggerCelebration('correct')}else if(hasQ){setAvatarSt('asking')}else{setAvatarSt('explaining')};const botMsg={id:Date.now()+1,text:txt,isUser:false,ts:Date.now()};const allMsgs=[...newMsgs,botMsg];setMsgs(allMsgs);setHist([...nh,{role:'assistant',content:txt}]);saveToDb(allMsgs,sesId);setLd(false);setTimeout(()=>setAvatarSt('idle'),3000);if(iR.current){iR.current.focus();iR.current.style.height='auto'}};
if(initLd)return<div className="a-center" style={{background:'#fff'}}><FoxyAvatar state="idle" size={64} color={avInfo.color}/><p style={{color:'#A8A29E',marginTop:12}}>Loading your conversation...</p></div>;
return(<div className="a-chat" style={{position:'relative'}}>{/* Celebration overlay */}{celebration&&<div style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:50,pointerEvents:'none',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:72,animation:'alfBounce 0.6s',textShadow:'0 4px 20px rgba(0,0,0,.2)'}}>{celebration==='correct'?'🎉':celebration==='streak'?'🔥':'⭐'}</div></div>}
{/* Header with animated avatar */}<div className="a-chat-hdr" style={{gap:10}}>
<div onClick={()=>setShowPicker(showPicker==='avatar'?null:'avatar')} style={{cursor:'pointer',position:'relative',flexShrink:0}}><FoxyAvatar state={avatarSt} size={48} color={avInfo.color}/>{listening&&<span style={{position:'absolute',bottom:0,right:0,width:12,height:12,borderRadius:'50%',background:'#EF4444',border:'2px solid #fff',animation:'alfPulse 1s infinite'}}/>}{ttsPlaying&&<span style={{position:'absolute',bottom:0,right:0,width:12,height:12,borderRadius:'50%',background:'#16A34A',border:'2px solid #fff',animation:'alfPulse 1.5s infinite'}}/>}</div>
<div style={{flex:1,minWidth:0}}><p style={{fontSize:15,fontWeight:700,display:'flex',alignItems:'center',gap:6}}>{avInfo.name} <span style={{fontSize:11,fontWeight:600,color:'#A8A29E',cursor:'pointer',background:'#F5F4F0',padding:'2px 8px',borderRadius:8}} onClick={()=>setShowPicker(showPicker==='persona'?null:'persona')}>{PERSONAS.find(pp=>pp.id===curPersona)?.emoji} {PERSONAS.find(pp=>pp.id===curPersona)?.name} ▾</span></p><p style={{fontSize:12,color:'#A8A29E'}}>{listening?<span style={{color:'#EF4444',fontWeight:700}}>🎙️ Listening...</span>:ttsPlaying?<span style={{color:'#16A34A',fontWeight:700}}>🔊 Speaking...</span>:avatarSt!=='idle'?<span style={{color:avInfo.color,fontWeight:600}}>{avatarSt}</span>:<>{p.subject} · {p.grade}</>}</p></div>
<div style={{display:'flex',gap:4,flexShrink:0}}><button onClick={newChat} style={{padding:'6px 12px',borderRadius:10,border:'1px solid #E7E5E4',background:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#57534E',minHeight:36}}>+ New</button></div></div>
{/* Avatar picker */}{showPicker==='avatar'&&<div style={{padding:12,background:'#FAFAF8',borderBottom:'1px solid #E7E5E4',display:'flex',gap:8,overflowX:'auto'}}>{AVATARS.map(a=><button key={a.id} onClick={()=>{setCurAvatar(a.id);setShowPicker(null);snd('click')}} style={{padding:'10px 14px',borderRadius:14,border:curAvatar===a.id?`2px solid ${a.color}`:'1.5px solid #E7E5E4',background:curAvatar===a.id?`${a.color}10`:'#fff',cursor:'pointer',fontFamily:'inherit',textAlign:'center',minWidth:80,flexShrink:0}}><div style={{fontSize:28}}>{a.emoji}</div><div style={{fontSize:11,fontWeight:700,marginTop:4,color:curAvatar===a.id?a.color:'#1C1917'}}>{a.name}</div><div style={{fontSize:9,color:'#A8A29E'}}>{a.desc}</div></button>)}</div>}
{/* Persona picker */}{showPicker==='persona'&&<div style={{padding:12,background:'#FAFAF8',borderBottom:'1px solid #E7E5E4',display:'flex',gap:8,overflowX:'auto'}}>{PERSONAS.map(pp=><button key={pp.id} onClick={()=>{setCurPersona(pp.id);setShowPicker(null);snd('click')}} style={{padding:'10px 14px',borderRadius:14,border:curPersona===pp.id?`2px solid ${avInfo.color}`:'1.5px solid #E7E5E4',background:curPersona===pp.id?`${avInfo.color}10`:'#fff',cursor:'pointer',fontFamily:'inherit',textAlign:'center',minWidth:80,flexShrink:0}}><div style={{fontSize:24}}>{pp.emoji}</div><div style={{fontSize:11,fontWeight:700,marginTop:4,color:curPersona===pp.id?avInfo.color:'#1C1917'}}>{pp.name}</div><div style={{fontSize:9,color:'#A8A29E'}}>{pp.desc}</div></button>)}</div>}
{transcript&&listening&&<div style={{padding:'8px 16px',background:'#FEF3C7',borderBottom:'1px solid #FDE68A',fontSize:13,color:'#92400E'}}>🎙️ {transcript}</div>}
<div className="a-chat-body">{msgs.map(m=>(<div key={m.id} className={`a-msg ${m.isUser?'u':'b'}`}>{!m.isUser&&<div className="a-msg-av"><FoxyAvatar state={m.id===msgs[msgs.length-1]?.id&&!m.isUser&&(ld||ttsPlaying)?avatarSt:'idle'} size={32} color={avInfo.color}/></div>}<div><div className={`a-bub ${m.isUser?'u':'b'}`}>{m.isUser?m.text:renderMsg(m.text)}</div>{!m.isUser&&m.id!==1&&<div style={{display:'flex',gap:6,marginTop:4}}><button onClick={()=>speak(m.id,m.text)} className="a-speak-btn" style={{minHeight:32,minWidth:36}}>{spk===m.id&&ttsPlaying?'⏹️':'🔊'}</button><button onClick={()=>saveNote(m.text)} className="a-speak-btn" style={{minHeight:32,minWidth:36}}>🗒️</button></div>}</div></div>))}{ld&&<div className="a-msg b"><div className="a-msg-av"><FoxyAvatar state="thinking" size={32} color={avInfo.color}/></div><div className="a-typing"><span/><span/><span/></div></div>}<div ref={end}/></div>{msgs.length<=2&&<div className="a-chips">{['Explain a concept','Draw a diagram','Give me a question','Quiz me','Revise last topic'].map(c=><button key={c} onClick={()=>send(c)} className="a-chip" style={{minHeight:40,fontSize:14}}>{c}</button>)}</div>}
{inp.length>0&&<div style={{padding:'0 24px 4px',display:'flex',gap:6,flexWrap:'wrap'}}>{[
...(p.subject==='Mathematics'||p.subject==='Physics'||p.subject==='Chemistry'?[{l:'1.',v:'\n1. '},{l:'\u2234',v:' \u2234 '},{l:'\u221A',v:'\u221A'},{l:'\u00B2',v:'\u00B2'},{l:'\u00B3',v:'\u00B3'},{l:'\u03C0',v:'\u03C0'},{l:'\u2248',v:' \u2248 '},{l:'\u2260',v:' \u2260 '},{l:'\u2264',v:' \u2264 '},{l:'\u2265',v:' \u2265 '},{l:'\u00B0',v:'\u00B0'}]:[]),
...(p.subject==='Science'||p.subject==='Biology'?[{l:'1.',v:'\n1. '},{l:'\u2192',v:' \u2192 '},{l:'H\u2082O',v:'H\u2082O'},{l:'CO\u2082',v:'CO\u2082'},{l:'O\u2082',v:'O\u2082'},{l:'\u0394',v:'\u0394'}]:[]),
...(p.subject==='English'||p.subject==='Hindi'||p.subject==='Social Studies'?[{l:'1.',v:'\n1. '},{l:'\u2022',v:'\n\u2022 '},{l:'i)',v:'\ni) '},{l:'Ans:',v:'Ans: '}]:[]),
...(!['Mathematics','Physics','Chemistry','Science','Biology','English','Hindi','Social Studies'].includes(p.subject)?[{l:'1.',v:'\n1. '},{l:'\u2022',v:'\n\u2022 '},{l:'Ans:',v:'Ans: '}]:[])
].map(b=><button key={b.l} onClick={()=>{setInp(v=>v+b.v);iR.current?.focus()}} style={{padding:'4px 10px',borderRadius:8,border:'1px solid #E7E5E4',background:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',color:'#57534E',minHeight:32}}>{b.l}</button>)}</div>}<div className="a-chat-bar"><button onClick={listening?stopVoice:startVoice} style={{width:48,height:48,borderRadius:'50%',border:listening?'2px solid #EF4444':'1px solid #E7E5E4',background:listening?'#FEE2E2':'#fff',fontSize:20,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,animation:listening?'alfPulse 1s infinite':'none'}}>{listening?'\uD83D\uDD34':'\uD83C\uDF99\uFE0F'}</button><textarea ref={iR} value={inp} onChange={e=>{setInp(e.target.value);const t=e.target;t.style.height='auto';t.style.height=Math.min(t.scrollHeight,160)+'px'}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(inp)}}} placeholder={listening?'Listening... speak now':'Ask Foxy anything...'} className="a-chat-inp" rows={1} style={{minHeight:48,maxHeight:160,resize:'none',lineHeight:1.5}}/><button onClick={()=>send(inp)} disabled={!inp.trim()||ld} className="a-chat-go" style={{width:48,height:48,alignSelf:'flex-end'}}>{'\u2191'}</button></div></div>)}
// QUIZ — with bigger option buttons
function Quiz({p,onDone}:{p:Prof;onDone:()=>void}){const[phase,setPhase]=useState<'setup'|'play'|'done'>('setup');const[qs,setQs]=useState<any[]>([]);const[ci,setCi]=useState(0);const[sel,setSel]=useState<number|null>(null);const[score,setScore]=useState(0);const[rev,setRev]=useState(false);const[sesId,setSesId]=useState<string|null>(null);const[resps,setResps]=useState<any[]>([]);const[result,setResult]=useState<any>(null);const[qStart,setQStart]=useState(Date.now());const[qzStart,setQzStart]=useState(Date.now());const[ld,setLd]=useState(false);const[chs,setChs]=useState<any[]>([]);const[selCh,setSelCh]=useState<number|null>(null);const[selN,setSelN]=useState(10);useEffect(()=>{(async()=>{const d=await api('quiz-engine',{subject:p.subject,grade:p.grade,count:0,student_id:p.studentId});setChs(d.chapters||[]);
// Check if coming from Learning Journey with chapter pre-selected
try{const chCtx=localStorage.getItem('alfanumrik_quiz_chapter');if(chCtx){localStorage.removeItem('alfanumrik_quiz_chapter');const ch=JSON.parse(chCtx);if(ch.chapter)setSelCh(ch.chapter)}}catch{}
})()},[p.grade,p.subject]);const start=async()=>{setLd(true);const d=await api('quiz-engine',{subject:p.subject,grade:p.grade,count:selN,student_id:p.studentId,chapter_number:selCh||undefined});setQs(d.questions||[]);setSesId(d.session_id||null);setLd(false);if(d.questions?.length){setPhase('play');setQStart(Date.now());setQzStart(Date.now())}};const pick=(i:number)=>{if(rev)return;setSel(i);setRev(true);const q=qs[ci];const ok=i===q.correct_answer_index;if(ok){setScore(s=>s+1);snd('correct')}else snd('wrong');setResps(v=>[...v,{question_number:ci+1,question_text:q.question_text,question_type:'mcq',options:q.options,correct_answer_index:q.correct_answer_index,correct_answer_text:q.options?.[q.correct_answer_index]||'',student_answer_index:i,student_answer_text:q.options?.[i]||'',is_correct:ok,time_taken_seconds:Math.round((Date.now()-qStart)/1000),marks:1,explanation:q.explanation||'',topic_tag:q.topic_tag||'general',bloom_level:q.bloom_level||'understand',difficulty:q.difficulty||2,subject:p.subject,grade:p.grade}])};const next=async()=>{if(ci<qs.length-1){setCi(v=>v+1);setSel(null);setRev(false);snd('click');setQStart(Date.now())}else{setPhase('done');snd('badge');if(p.studentId){const r=await api('quiz-submit',{session_id:sesId,student_id:p.studentId,responses:resps,total_time_seconds:Math.round((Date.now()-qzStart)/1000)});setResult(r);if(r.success){onDone();
// Auto-create spaced repetition cards from wrong answers
const wrongAnswers=resps.filter(r=>!r.is_correct);
if(wrongAnswers.length>0){api('study-plan',{action:'create_cards_from_quiz',student_id:p.studentId,quiz_responses:wrongAnswers.map(w=>({...w,chapter_number:selCh})),subject:p.subject,grade:p.grade}).catch(()=>{})}}}}};const reset=()=>{setPhase('setup');setCi(0);setSel(null);setRev(false);setScore(0);setResps([]);setResult(null);setQs([])};
if(phase==='setup')return(<div className="a-page"><div className="a-hdr"><div><h1 className="a-title">Custom Quiz</h1><p className="a-greet">{p.subject} &middot; {p.grade}</p></div></div><div className="a-card" style={{maxWidth:600}}><h3 className="a-section-title">CONFIGURE YOUR QUIZ</h3><label className="a-label">Chapter</label><div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}><button onClick={()=>setSelCh(null)} className={`a-pill${!selCh?' on':''}`} style={{minHeight:40}}>All</button>{chs.map(c=><button key={c.chapter} onClick={()=>{setSelCh(c.chapter);snd('click')}} className={`a-pill${selCh===c.chapter?' on':''}`} style={{minHeight:40}}>Ch{c.chapter}: {c.title?.substring(0,18)}</button>)}</div><label className="a-label">Questions</label><div style={{display:'flex',gap:8,marginBottom:16}}>{[5,10,15,20,25].map(n=><button key={n} onClick={()=>{setSelN(n);snd('click')}} className={`a-pill-n${selN===n?' on':''}`} style={{minHeight:44,minWidth:48}}>{n}</button>)}</div><button onClick={start} disabled={ld} className="a-btn-primary" style={{width:'100%',minHeight:52}}>{ld?'Generating...':'Start Quiz \uD83C\uDFAF'}</button></div></div>);
if(phase==='done'){const pct=qs.length?Math.round((score/qs.length)*100):0;return<div className="a-page" style={{textAlign:'center',paddingTop:40}}><div style={{fontSize:64,marginBottom:12,animation:'alfBounce 1s'}}>{pct>=80?'\uD83C\uDF89':pct>=50?'\uD83D\uDC4D':'\uD83D\uDCAA'}</div><h2 style={{fontSize:28,fontWeight:900}}>Quiz Complete!</h2><p style={{color:'#A8A29E',margin:'8px 0 20px'}}>{score}/{qs.length} ({pct}%){result?.xp_earned?' \u2022 +'+result.xp_earned+' XP':''}</p>{result?.topic_mastery?.length>0&&<div className="a-card" style={{maxWidth:400,margin:'0 auto 20px',textAlign:'left'}}><h3 className="a-section-title">MASTERY UPDATE</h3>{result.topic_mastery.map((t:any,i:number)=><div key={i} style={{marginBottom:8}}><div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,fontWeight:600}}>{t.topic?.replace(/_/g,' ')}</span><span style={{fontSize:12,fontWeight:700,color:t.mastery>=70?'#16A34A':'#D97706'}}>{t.mastery}%</span></div><div style={{height:5,borderRadius:3,background:'#F5F4F0'}}><div style={{height:'100%',borderRadius:3,width:`${t.mastery}%`,background:t.mastery>=70?'#16A34A':t.mastery>=40?'#D97706':'#DC2626'}}/></div></div>)}</div>}<button onClick={reset} className="a-btn-primary" style={{maxWidth:300,margin:'0 auto',display:'block',minHeight:52}}>Another Quiz</button></div>}
const q=qs[ci];if(!q)return<div className="a-page" style={{textAlign:'center',paddingTop:80}}><p style={{fontSize:48}}>&#x1F614;</p><button onClick={reset} className="a-btn-primary" style={{maxWidth:200,margin:'20px auto',minHeight:48}}>Back</button></div>;
return(<div className="a-page"><div className="a-hdr"><div><h1 className="a-title">Quiz</h1><p className="a-greet">{q.topic_tag?.replace(/_/g,' ')}</p></div><div className="a-badge">Q{ci+1}/{qs.length}</div></div><div className="a-card" style={{maxWidth:700}}><div style={{display:'flex',gap:3,marginBottom:16}}>{qs.map((_:any,i:number)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<ci?(resps[i]?.is_correct?'#16A34A':'#DC2626'):i===ci?'#E8590C':'#EDEBE6'}}/>)}</div><h3 style={{fontSize:17,fontWeight:700,marginBottom:18,lineHeight:1.5}}>{q.question_text}</h3><div style={{display:'flex',flexDirection:'column',gap:10}}>{(q.options as string[]).map((opt:string,idx:number)=>{let bg='#fff',bd='1.5px solid #E7E5E4',cl='#1C1917';if(rev&&idx===q.correct_answer_index){bg='#DCFCE7';bd='2px solid #16A34A';cl='#15803D'}else if(rev&&idx===sel&&idx!==q.correct_answer_index){bg='#FEE2E2';bd='2px solid #DC2626';cl='#B91C1C'}else if(idx===sel){bg='#FFF7ED';bd='2px solid #E8590C';cl='#E8590C'};return<button key={idx} onClick={()=>pick(idx)} style={{padding:'14px 16px',borderRadius:14,background:bg,border:bd,color:cl,fontSize:15,fontWeight:600,textAlign:'left',cursor:rev?'default':'pointer',fontFamily:'inherit',minHeight:52,transition:'all .15s'}}>{String.fromCharCode(65+idx)}. {opt}</button>})}</div>{rev&&<div style={{marginTop:14,padding:14,borderRadius:14,background:sel===q.correct_answer_index?'#F0FDF4':'#FEF2F2'}}><p style={{fontSize:14,fontWeight:700,color:sel===q.correct_answer_index?'#16A34A':'#DC2626',marginBottom:4}}>{sel===q.correct_answer_index?'\u2705 Correct!':'\u274C Not quite'}</p>{q.explanation&&<p style={{fontSize:13,color:'#57534E',lineHeight:1.5}}>{q.explanation}</p>}</div>}{rev&&<button onClick={next} className="a-btn-primary" style={{marginTop:14,width:'100%',minHeight:52}}>{ci<qs.length-1?'Next \u2192':'Finish \uD83C\uDF89'}</button>}</div></div>)}
// NOTES
function Notes({p}:{p:Prof}){const subCode=SM[p.subject]||'math';const[notes,setNotes]=useState<Note[]>([]);const[ld,setLd]=useState(true);const[view,setView]=useState<'grid'|'edit'>('grid');const[editNote,setEditNote]=useState<Note|null>(null);const[title,setTitle]=useState('');const[content,setContent]=useState('');const[noteType,setNoteType]=useState('manual');const[noteColor,setNoteColor]=useState('#E8590C');const[genLd,setGenLd]=useState(false);const[chs,setChs]=useState<any[]>([]);const[filterCh,setFilterCh]=useState<number|null>(null);const[expanded,setExpanded]=useState<string|null>(null);
useEffect(()=>{loadNotes();loadChs()},[p.studentId,p.subject]);
const loadNotes=async()=>{if(!p.studentId)return;setLd(true);const r=await api('student-notes',{action:'list',student_id:p.studentId,subject:subCode,chapter_number:filterCh||undefined});setNotes(r.notes||[]);setLd(false)};
const loadChs=async()=>{try{const{data:s}=await sb.from('subjects').select('id').eq('code',subCode).single();if(!s)return;const{data}=await sb.from('curriculum_topics').select('chapter_number,title').eq('subject_id',s.id).eq('grade',p.grade).eq('is_active',true).order('chapter_number');setChs(data||[])}catch{}};
useEffect(()=>{if(p.studentId)loadNotes()},[filterCh]);
const saveNote=async()=>{if(!p.studentId||!title.trim())return;if(editNote){await api('student-notes',{action:'update',student_id:p.studentId,note_id:editNote.id,title,content,color:noteColor})}else{await api('student-notes',{action:'create',student_id:p.studentId,subject:subCode,grade:p.grade,chapter_number:filterCh||1,title,content,note_type:noteType,color:noteColor,source:'manual'})};snd('ok');setView('grid');setEditNote(null);setTitle('');setContent('');loadNotes()};
const deleteNote=async(id:string)=>{await api('student-notes',{action:'delete',student_id:p.studentId,note_id:id});snd('click');loadNotes()};
const pinNote=async(n:Note)=>{await api('student-notes',{action:'update',student_id:p.studentId,note_id:n.id,is_pinned:!n.is_pinned});loadNotes()};
const generateNotes=async(ch:any)=>{if(!p.studentId)return;setGenLd(true);await api('student-notes',{action:'generate',student_id:p.studentId,subject:p.subject,grade:p.grade,chapter_number:ch.chapter_number,chapter_title:ch.title});setGenLd(false);snd('badge');loadNotes()};
const openEdit=(n?:Note)=>{if(n){setEditNote(n);setTitle(n.title);setContent(n.content);setNoteColor(n.color);setNoteType(n.note_type)}else{setEditNote(null);setTitle('');setContent('');setNoteColor('#E8590C');setNoteType('manual')};setView('edit')};
const typeIcon=(t:string)=>({manual:'\u270F\uFE0F',formula:'\uD83D\uDCD0',definition:'\uD83D\uDCD6',trick:'\uD83D\uDCA1',summary:'\uD83D\uDCCB',foxy_generated:'\uD83E\uDD8A',quiz_correction:'\uD83C\uDFAF'}[t]||'\uD83D\uDCDD');
if(view==='edit')return(<div className="a-page"><div className="a-hdr"><div><h1 className="a-title">{editNote?'Edit Note':'New Note'}</h1></div><button onClick={()=>{setView('grid');setEditNote(null)}} className="a-badge" style={{cursor:'pointer'}}>{'\u2715'} Cancel</button></div><div className="a-card" style={{maxWidth:640}}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Note title..." style={{width:'100%',padding:'12px 0',border:'none',borderBottom:'2px solid #E7E5E4',fontSize:18,fontWeight:700,outline:'none',fontFamily:'inherit',background:'transparent',marginBottom:16}}/><div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>{[{v:'manual',l:'\u270F\uFE0F Note'},{v:'formula',l:'\uD83D\uDCD0 Formula'},{v:'definition',l:'\uD83D\uDCD6 Definition'},{v:'trick',l:'\uD83D\uDCA1 Trick'},{v:'summary',l:'\uD83D\uDCCB Summary'}].map(t=><button key={t.v} onClick={()=>setNoteType(t.v)} className={`a-pill${noteType===t.v?' on':''}`} style={{minHeight:36}}>{t.l}</button>)}</div><div style={{display:'flex',gap:6,marginBottom:16}}>{NC.map(c=><button key={c} onClick={()=>setNoteColor(c)} style={{width:32,height:32,borderRadius:10,background:c,border:noteColor===c?'3px solid #1C1917':'2px solid transparent',cursor:'pointer'}}/>)}</div><textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Write your note..." style={{width:'100%',minHeight:200,padding:14,borderRadius:12,border:'1.5px solid #E7E5E4',fontSize:14,lineHeight:1.7,outline:'none',fontFamily:'inherit',resize:'vertical',background:'#FAFAF8'}}/><div style={{display:'flex',gap:10,marginTop:16}}><button onClick={saveNote} disabled={!title.trim()} className="a-btn-primary" style={{flex:1,minHeight:52}}>{editNote?'Update':'Save Note'}</button>{editNote&&<button onClick={()=>{deleteNote(editNote.id);setView('grid');setEditNote(null)}} style={{padding:14,borderRadius:14,border:'none',background:'#FEE2E2',color:'#DC2626',fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:52,minWidth:52,fontSize:18}}>{'\uD83D\uDDD1\uFE0F'}</button>}</div></div></div>);
const grouped:Record<string,Note[]>={};notes.forEach(n=>{const k=n.chapter_number?`Ch ${n.chapter_number}`:'General';if(!grouped[k])grouped[k]=[];grouped[k].push(n)});
return(<div className="a-page"><div className="a-hdr"><div><h1 className="a-title">Notes</h1><p className="a-greet">{p.subject} &middot; {notes.length} notes</p></div><button onClick={()=>openEdit()} className="a-btn-primary" style={{fontSize:13,padding:'8px 16px',minHeight:40}}>+ New</button></div><div style={{display:'flex',gap:6,marginBottom:16,overflowX:'auto',paddingBottom:4}}><button onClick={()=>setFilterCh(null)} className={`a-pill${!filterCh?' on':''}`}>All</button>{chs.slice(0,10).map(c=><button key={c.chapter_number} onClick={()=>{setFilterCh(c.chapter_number);snd('click')}} className={`a-pill${filterCh===c.chapter_number?' on':''}`}>Ch{c.chapter_number}</button>)}</div>{chs.length>0&&<div className="a-card" style={{padding:14,marginBottom:16,background:'linear-gradient(135deg,#1C1917,#292524)',border:'none'}}><p style={{fontSize:13,fontWeight:700,color:'#E8590C',marginBottom:8}}>{'\uD83E\uDD8A'} Foxy can generate revision notes!</p><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{chs.slice(0,6).map(c=><button key={c.chapter_number} onClick={()=>generateNotes(c)} disabled={genLd} style={{padding:'8px 14px',borderRadius:10,border:'1px solid rgba(255,255,255,.15)',background:'rgba(255,255,255,.08)',color:'rgba(255,255,255,.8)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',minHeight:36}}>Gen Ch{c.chapter_number}</button>)}</div>{genLd&&<p style={{fontSize:12,color:'#E8590C',marginTop:8}}>Generating notes...</p>}</div>}{ld?<p style={{textAlign:'center',color:'#A8A29E',padding:40}}>Loading...</p>:notes.length===0?<div style={{textAlign:'center',padding:60}}><p style={{fontSize:48}}>{'\uD83D\uDDD2\uFE0F'}</p><p style={{fontWeight:700,marginTop:12}}>No notes yet</p></div>:Object.entries(grouped).map(([group,gNotes])=>(<div key={group} style={{marginBottom:20}}><h3 className="a-section-title">{group.toUpperCase()}</h3><div className="a-notes-grid">{gNotes.map(n=>(<div key={n.id} className="a-note-card" style={{borderTop:`4px solid ${n.color}`}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><div style={{display:'flex',alignItems:'center',gap:6}}><span>{typeIcon(n.note_type)}</span><h4 style={{fontSize:14,fontWeight:700}}>{n.title}</h4></div><button onClick={()=>pinNote(n)} className="a-note-act">{n.is_pinned?'\uD83D\uDCCC':'\uD83D\uDD73\uFE0F'}</button></div><p className="a-note-body" onClick={()=>setExpanded(expanded===n.id?null:n.id)} style={{maxHeight:expanded===n.id?'none':'80px',overflow:'hidden',cursor:'pointer'}}>{n.content}</p><div style={{display:'flex',justifyContent:'space-between',marginTop:8,paddingTop:8,borderTop:'1px solid #F5F4F0'}}><span style={{fontSize:10,color:'#A8A29E'}}>{n.word_count}w &middot; {new Date(n.updated_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span><button onClick={()=>openEdit(n)} style={{fontSize:11,color:'#E8590C',fontWeight:700,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>Edit</button></div></div>))}</div></div>))}</div>)}
// PROGRESS
function Progress({p,stats}:{p:Prof;stats:Stats}){const[mastery,setMastery]=useState<any[]>([]);useEffect(()=>{if(p.studentId)getTopicMastery(p.studentId,SM[p.subject]||'math').then(setMastery)},[p.studentId,p.subject]);const acc=stats.asked>0?Math.round((stats.correct/stats.asked)*100):0;return(<div className="a-page"><div className="a-hdr"><div><h1 className="a-title">Progress</h1><p className="a-greet">{p.subject} &middot; {p.grade}</p></div></div><div className="a-stats" style={{marginBottom:20}}>{[{v:String(stats.xp),l:'XP',i:'\u26A1'},{v:String(stats.streak),l:'Streak',i:'\uD83D\uDD25'},{v:String(stats.sessions),l:'Quizzes',i:'\uD83D\uDCDA'},{v:`${acc}%`,l:'Accuracy',i:'\uD83C\uDFAF'},{v:String(stats.minutes),l:'Minutes',i:'\u23F1'},{v:String(stats.asked),l:'Questions',i:'\u2753'}].map(x=>(<div key={x.l} className="a-stat"><span style={{fontSize:18}}>{x.i}</span><p className="a-stat-v">{x.v}</p><p className="a-stat-l">{x.l}</p></div>))}</div>{mastery.length>0?<div className="a-card"><h3 className="a-section-title">SKILL MASTERY</h3>{mastery.map((t:any,i:number)=><div key={i} style={{marginBottom:12}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:13,fontWeight:600}}>{t.topic_tag?.replace(/_/g,' ')}</span><span style={{fontSize:12,fontWeight:700,color:t.mastery_percent>=70?'#16A34A':t.mastery_percent>=40?'#D97706':'#DC2626'}}>{t.mastery_percent}% {t.mastery_level}</span></div><div style={{height:6,borderRadius:3,background:'#F5F4F0'}}><div style={{height:'100%',borderRadius:3,width:`${t.mastery_percent}%`,background:t.mastery_percent>=70?'#16A34A':t.mastery_percent>=40?'#D97706':'#DC2626'}}/></div></div>)}</div>:<div className="a-card" style={{textAlign:'center',padding:40}}><p style={{fontSize:40}}>&#x1F4CA;</p><p style={{fontWeight:700,marginTop:8}}>No mastery data yet</p><p style={{color:'#A8A29E',fontSize:13}}>Complete a quiz to see progress!</p></div>}</div>)}
// PROFILE
// LINK CODE — Shows student's parent linking code
function LinkCode({studentId}:{studentId?:string}){const[code,setCode]=useState<string>('');const[copied,setCopied]=useState(false);
useEffect(()=>{if(!studentId)return;sb.from('students').select('link_code').eq('id',studentId).single().then(({data})=>{if(data?.link_code)setCode(data.link_code)})},[studentId]);
if(!code)return<p style={{fontSize:12,color:'#A8A29E'}}>Loading...</p>;
return<div><p style={{fontSize:32,fontWeight:900,color:'#8B5CF6',letterSpacing:8,fontFamily:'monospace'}}>{code}</p>
<button onClick={()=>{navigator.clipboard?.writeText(code).then(()=>{setCopied(true);snd('ok');setTimeout(()=>setCopied(false),2000)}).catch(()=>{})}} style={{marginTop:8,padding:'6px 16px',borderRadius:8,border:'1px solid #8B5CF630',background:'#fff',color:'#8B5CF6',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{copied?'✅ Copied!':'📋 Copy Code'}</button></div>}
function ProfileScr({p,onUp,out,stats}:{p:Prof;onUp:(p:Prof)=>void;out:()=>void;stats:Stats}){const[ed,setEd]=useState<string|null>(null);const[nm,setNm]=useState(p.name);const[gr,setGr]=useState(p.grade);const[su,setSu]=useState(p.subject);const[la,setLa]=useState(p.language);const save=()=>{snd('ok');onUp({...p,name:nm,grade:gr,subject:su,language:la});setEd(null)};const acc=stats.asked>0?Math.round((stats.correct/stats.asked)*100):0;return(<div className="a-page"><div style={{textAlign:'center',padding:'16px 0 20px'}}><div style={{width:80,height:80,borderRadius:'50%',margin:'0 auto 10px',background:'linear-gradient(135deg,#E8590C,#EC4899)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,fontWeight:900}}>{nm.charAt(0).toUpperCase()}</div><h1 style={{fontSize:24,fontWeight:900}}>{nm}</h1><p style={{fontSize:13,color:'#A8A29E',marginTop:4}}>{gr} &middot; {su}</p><div style={{display:'flex',justifyContent:'center',gap:24,marginTop:16}}>{[{v:String(stats.xp),l:'XP'},{v:String(stats.sessions),l:'Quizzes'},{v:`${acc}%`,l:'Accuracy'}].map(x=>(<div key={x.l}><p style={{fontSize:20,fontWeight:900}}>{x.v}</p><p style={{fontSize:10,color:'#A8A29E',fontWeight:600}}>{x.l}</p></div>))}</div></div><div style={{maxWidth:520,margin:'0 auto'}}>{[{k:'name',l:'Name',v:nm},{k:'grade',l:'Grade',v:gr},{k:'subject',l:'Subject',v:su},{k:'lang',l:'Language',v:LANGS.find(l=>l.code===la)?.label||la}].map(f=><div key={f.k} className="a-card" style={{padding:0,overflow:'hidden',marginBottom:10}}><div className="a-pr" onClick={()=>{setEd(ed===f.k?null:f.k);snd('click')}} style={{minHeight:52}}><span className="a-pr-l">{f.l}</span><span className="a-pr-v">{ed===f.k?'':f.v}</span><span style={{color:'#A8A29E'}}>{ed===f.k?'\u2715':'\u270E'}</span></div>{ed===f.k&&<div className="a-ed">{f.k==='name'&&<><input value={nm} onChange={e=>setNm(e.target.value)} className="a-ed-inp" autoFocus/><button onClick={save} disabled={!nm.trim()} className="a-btn-primary" style={{fontSize:13,padding:'8px 20px',minHeight:40}}>Save</button></>}{f.k==='grade'&&<><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);snd('click')}} className={`a-pill-n${gr===g?' on':''}`} style={{minHeight:40}}>{g}</button>)}</div><button onClick={save} className="a-btn-primary" style={{marginTop:8,fontSize:13,padding:'8px 20px',minHeight:40}}>Save</button></>}{f.k==='subject'&&<><div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:6}}>{SUBJ.filter(x=>{const g=parseInt(gr.replace(/\D/g,'')||'6');return g>=11?['Mathematics','Physics','Chemistry','Biology','English','Computer Science','Accountancy','Economics'].includes(x.id):['Mathematics','Science','English','Hindi','Social Studies'].includes(x.id)}).map(x=><button key={x.id} onClick={()=>{setSu(x.id);snd('click')}} style={{padding:'10px 12px',borderRadius:12,border:su===x.id?'none':'1px solid #E7E5E4',background:su===x.id?x.c:'#fff',color:su===x.id?'#fff':'#1C1917',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:44}}><span>{x.icon}</span> {x.id}</button>)}</div><button onClick={save} className="a-btn-primary" style={{marginTop:8,fontSize:13,padding:'8px 20px',minHeight:40}}>Save</button></>}{f.k==='lang'&&<><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);snd('click')}} className={`a-pill-n${la===l.code?' on':''}`} style={{minHeight:40}}>{l.label}</button>)}</div><button onClick={save} className="a-btn-primary" style={{marginTop:8,fontSize:13,padding:'8px 20px',minHeight:40}}>Save</button></>}</div>}</div>)}<button onClick={()=>{snd('click');out()}} style={{width:'100%',marginTop:8,padding:14,borderRadius:14,border:'none',background:'#FEE2E2',color:'#DC2626',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:52}}>Sign Out</button>
{/* Parent Link Code */}
<div className="a-card" style={{marginTop:16,textAlign:'center',background:'linear-gradient(135deg,#FAF5FF,#EDE9FE)',border:'2px solid #8B5CF620'}}>
<p style={{fontSize:11,fontWeight:700,color:'#8B5CF6',letterSpacing:'.05em',marginBottom:8}}>🔗 PARENT LINK CODE</p>
<p style={{fontSize:11,color:'#78716C',marginBottom:10}}>Share this code with your parent so they can track your progress</p>
<LinkCode studentId={p.studentId}/>
</div>
<p style={{textAlign:'center',fontSize:10,color:'#D4D0C8',marginTop:20}}>Alfanumrik&reg; v6.0 &middot; CusioSense Learning India Private Limited</p></div></div>)}
// ═══════════════════════════════════════════════════════
// STUDY PLAN + SPACED REPETITION — Phase 3B
// ═══════════════════════════════════════════════════════
function StudyPlan({p,nav}:{p:Prof;nav:(s:Screen)=>void}){
const subCode=SM[p.subject]||'math';
const[plan,setPlan]=useState<any>(null);const[tasks,setTasks]=useState<any[]>([]);const[todayTasks,setTodayTasks]=useState<any[]>([]);const[dueCards,setDueCards]=useState<any[]>([]);const[goal,setGoal]=useState<any>({});const[loading,setLoading]=useState(true);const[generating,setGenerating]=useState(false);const[tab,setTab]=useState<'today'|'plan'|'review'>('today');const[reviewCard,setReviewCard]=useState<any>(null);const[showAnswer,setShowAnswer]=useState(false);const[reviewIdx,setReviewIdx]=useState(0);
useEffect(()=>{loadData()},[p.studentId,p.subject]);
const loadData=async()=>{setLoading(true);
const[planRes,todayRes]=await Promise.all([
  api('study-plan',{action:'get_plan',student_id:p.studentId,subject:p.subject}),
  api('study-plan',{action:'get_today',student_id:p.studentId})
]);
if(planRes.plan){setPlan(planRes.plan);setTasks(planRes.tasks||[])}
setTodayTasks(todayRes.tasks||[]);setDueCards(todayRes.due_cards||[]);setGoal(todayRes.goal||{});
setLoading(false)};
const generatePlan=async(type:string)=>{setGenerating(true);
const d=await api('study-plan',{action:'generate_plan',student_id:p.studentId,subject:p.subject,grade:p.grade,plan_type:type,days:type==='daily'?1:7});
setGenerating(false);if(d.success){await loadData();setTab('plan')}};
const completeTask=async(taskId:string)=>{snd('correct');
await api('study-plan',{action:'complete_task',task_id:taskId,student_id:p.studentId,time_spent_minutes:15});
await loadData()};
const handleTaskAction=(task:any)=>{
  if(task.task_type==='learn'){try{localStorage.setItem('alfanumrik_foxy_chapter',JSON.stringify({chapter:task.chapter_number,title:task.chapter_title,subject:p.subject,grade:p.grade}))}catch{};nav('foxy' as Screen)}
  else if(task.task_type==='quiz'){try{localStorage.setItem('alfanumrik_quiz_chapter',JSON.stringify({chapter:task.chapter_number,title:task.chapter_title,subject:p.subject,grade:p.grade}))}catch{};nav('quiz' as Screen)}
  else if(task.task_type==='review'){setTab('review')}
  else{completeTask(task.id)}
};
const reviewAnswer=(quality:number)=>{if(!reviewCard)return;
api('study-plan',{action:'review_card',card_id:reviewCard.id,student_id:p.studentId,quality}).then(()=>{
  const next=reviewIdx+1;if(next<dueCards.length){setReviewIdx(next);setReviewCard(dueCards[next]);setShowAnswer(false)}else{setReviewCard(null);setReviewIdx(0);snd('badge');loadData()}
})};
const TI:Record<string,{emoji:string;color:string;bg:string}>={learn:{emoji:'📖',color:'#3B82F6',bg:'#EFF6FF'},quiz:{emoji:'🎯',color:'#8B5CF6',bg:'#FAF5FF'},review:{emoji:'🔄',color:'#22C55E',bg:'#F0FDF4'},practice:{emoji:'💪',color:'#F59E0B',bg:'#FFFBEB'},revision:{emoji:'📝',color:'#E8590C',bg:'#FFF7ED'},foxy_chat:{emoji:'🦊',color:'#E8590C',bg:'#FFF7ED'},challenge:{emoji:'⚡',color:'#EF4444',bg:'#FEF2F2'},notes:{emoji:'📝',color:'#F59E0B',bg:'#FFFBEB'}};
if(loading)return<div style={{padding:60,textAlign:'center'}}><div style={{fontSize:36,animation:'alfPulse 1.5s infinite'}}>📋</div><p style={{color:'#A8A29E',marginTop:8}}>Loading your study plan...</p></div>;
// Group tasks by day
const dayMap:Record<number,any[]>={};tasks.forEach(t=>{if(!dayMap[t.day_number])dayMap[t.day_number]=[];dayMap[t.day_number].push(t)});
const completedToday=todayTasks.filter(t=>t.status==='completed').length;
const goalPct=goal.tasks_target>0?Math.min(100,Math.round(completedToday/goal.tasks_target*100)):0;
return(<div style={{padding:'20px 24px 120px',maxWidth:900,animation:'alfFadeIn .4s'}}>
{/* Header */}
<div style={{marginBottom:16}}><h1 style={{fontSize:24,fontWeight:900}}>📋 Study Plan</h1><p style={{fontSize:13,color:'#78716C',marginTop:4}}>{p.subject} · {p.grade}</p></div>
{/* Tabs */}
<div style={{display:'flex',gap:6,marginBottom:16}}>
{[{id:'today' as const,l:`Today (${todayTasks.length})`,i:'📅'},{id:'plan' as const,l:'Full Plan',i:'📋'},{id:'review' as const,l:`Review (${dueCards.length})`,i:'🔄'}].map(t=><button key={t.id} onClick={()=>{setTab(t.id);snd('click')}} style={{flex:1,padding:'10px 12px',borderRadius:12,border:tab===t.id?'2px solid #22C55E':'1px solid #E7E5E4',background:tab===t.id?'#22C55E10':'#fff',color:tab===t.id?'#22C55E':'#78716C',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:44}}>{t.i} {t.l}</button>)}
</div>
{/* Daily Goal Progress */}
<div style={{background:'linear-gradient(135deg,#1C1917,#292524)',borderRadius:16,padding:16,marginBottom:16,color:'#fff',display:'flex',alignItems:'center',gap:16}}>
<div style={{width:56,height:56,borderRadius:'50%',border:'3px solid #22C55E40',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',flexShrink:0}}>
<svg viewBox="0 0 36 36" width={56} height={56} style={{position:'absolute'}}><path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#22C55E" strokeWidth="3" strokeDasharray={`${goalPct}, 100`} strokeLinecap="round"/></svg>
<span style={{fontSize:14,fontWeight:900}}>{goalPct}%</span>
</div>
<div style={{flex:1}}><p style={{fontSize:13,fontWeight:700,color:'#22C55E'}}>TODAY'S GOAL</p><p style={{fontSize:11,color:'#A8A29E',marginTop:2}}>{completedToday}/{todayTasks.length} tasks done{dueCards.length>0?` · ${dueCards.length} cards to review`:''}</p></div>
{dueCards.length>0&&<button onClick={()=>{setReviewCard(dueCards[0]);setReviewIdx(0);setShowAnswer(false);setTab('review')}} style={{padding:'8px 14px',borderRadius:10,border:'none',background:'#22C55E',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:36}}>Review</button>}
</div>
{/* TODAY TAB */}
{tab==='today'&&<div>
{todayTasks.length===0&&!plan&&<div style={{textAlign:'center',padding:40}}>
<FoxyAvatar state="encouraging" size={64} color="#22C55E"/>
<p style={{fontSize:16,fontWeight:800,marginTop:12}}>No study plan yet!</p>
<p style={{fontSize:13,color:'#78716C',marginTop:6,lineHeight:1.5}}>Generate an AI-powered study plan tailored to your strengths and weaknesses.</p>
<div style={{display:'flex',gap:8,marginTop:16,justifyContent:'center',flexWrap:'wrap'}}>
{[{t:'weekly',l:'📅 Weekly Plan',c:'#22C55E'},{t:'exam_prep',l:'📝 Exam Prep',c:'#8B5CF6'},{t:'revision',l:'🔄 Revision',c:'#E8590C'}].map(x=><button key={x.t} onClick={()=>generatePlan(x.t)} disabled={generating} style={{padding:'12px 20px',borderRadius:14,border:'none',background:x.c,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:44,opacity:generating?.5:1}}>{generating?'Generating...':x.l}</button>)}
</div></div>}
{todayTasks.length===0&&plan&&<div style={{textAlign:'center',padding:30,color:'#78716C'}}><p style={{fontSize:32}}>✅</p><p style={{fontWeight:700,marginTop:8}}>No tasks scheduled for today</p><p style={{fontSize:13,marginTop:4}}>Check the Full Plan tab to see upcoming tasks.</p></div>}
{todayTasks.map((task,i)=>{const ti=TI[task.task_type]||TI.learn;const done=task.status==='completed';
return<div key={task.id} style={{padding:14,borderRadius:14,border:`1.5px solid ${done?'#22C55E30':ti.color+'30'}`,background:done?'#F0FDF410':ti.bg,marginBottom:10,opacity:done?.6:1,animation:`alfSlideUp .3s ease ${i*.05}s both`}}>
<div style={{display:'flex',alignItems:'center',gap:10}}>
<div style={{width:36,height:36,borderRadius:10,background:done?'#22C55E':ti.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,color:'#fff'}}>{done?'✓':ti.emoji}</div>
<div style={{flex:1}}>
<p style={{fontSize:14,fontWeight:700,textDecoration:done?'line-through':'none'}}>{task.title}</p>
<p style={{fontSize:11,color:'#78716C'}}>{task.description} · {task.duration_minutes}min · +{task.xp_reward}XP</p>
</div>
{!done&&<button onClick={()=>handleTaskAction(task)} style={{padding:'8px 14px',borderRadius:10,border:'none',background:ti.color,color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:36,whiteSpace:'nowrap'}}>
{task.task_type==='learn'?'Learn':task.task_type==='quiz'?'Quiz':task.task_type==='review'?'Review':'Start'}
</button>}
</div></div>})}
</div>}
{/* PLAN TAB */}
{tab==='plan'&&<div>
{plan&&<div style={{padding:14,borderRadius:14,background:'#F0FDF4',border:'1px solid #DCFCE7',marginBottom:16}}>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
<div><p style={{fontSize:15,fontWeight:800}}>{plan.title}</p><p style={{fontSize:12,color:'#78716C',marginTop:2}}>{plan.description}</p></div>
<div style={{textAlign:'right'}}><p style={{fontSize:22,fontWeight:900,color:'#22C55E'}}>{plan.progress_percent||0}%</p><p style={{fontSize:10,color:'#78716C'}}>{plan.completed_tasks}/{plan.total_tasks} done</p></div>
</div>
<div style={{height:6,borderRadius:3,background:'#22C55E20',marginTop:10}}><div style={{height:'100%',borderRadius:3,background:'#22C55E',width:`${plan.progress_percent||0}%`,transition:'width .5s'}}/></div>
</div>}
{Object.entries(dayMap).map(([day,dayTasks])=>{const d=parseInt(day);const date=dayTasks[0]?.scheduled_date;const isToday=date===new Date().toISOString().split('T')[0];const allDone=(dayTasks as any[]).every((t:any)=>t.status==='completed');
return<div key={day} style={{marginBottom:12}}>
<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
<div style={{width:28,height:28,borderRadius:'50%',background:allDone?'#22C55E':isToday?'#E8590C':'#E7E5E4',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:900}}>{allDone?'✓':d}</div>
<span style={{fontSize:13,fontWeight:700,color:isToday?'#E8590C':'#44403C'}}>Day {d}{isToday?' (Today)':''}</span>
{date&&<span style={{fontSize:11,color:'#A8A29E'}}>{new Date(date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}</span>}
</div>
{(dayTasks as any[]).map((task:any)=>{const ti=TI[task.task_type]||TI.learn;const done=task.status==='completed';
return<div key={task.id} style={{padding:10,borderRadius:10,background:done?'#F0FDF408':ti.bg,marginBottom:6,marginLeft:36,borderLeft:`3px solid ${done?'#22C55E':ti.color}`,display:'flex',alignItems:'center',gap:8}}>
<span style={{fontSize:14}}>{done?'✅':ti.emoji}</span>
<div style={{flex:1}}><p style={{fontSize:12,fontWeight:600,textDecoration:done?'line-through':'none'}}>{task.title}</p><p style={{fontSize:10,color:'#A8A29E'}}>{task.duration_minutes}min · +{task.xp_reward}XP</p></div>
{!done&&isToday&&<button onClick={()=>handleTaskAction(task)} style={{padding:'4px 10px',borderRadius:8,border:'none',background:ti.color,color:'#fff',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Go</button>}
{done&&task.score_percent!==null&&<span style={{fontSize:11,fontWeight:800,color:'#22C55E'}}>{task.score_percent}%</span>}
</div>})}
</div>})}
{!plan&&<div style={{textAlign:'center',padding:40}}>
<p style={{fontSize:13,color:'#78716C'}}>No active plan. Generate one from the Today tab!</p>
</div>}
</div>}
{/* REVIEW TAB — Spaced Repetition */}
{tab==='review'&&<div>
{reviewCard?<div style={{maxWidth:440,margin:'0 auto'}}>
<p style={{fontSize:12,color:'#78716C',textAlign:'center',marginBottom:12}}>Card {reviewIdx+1} of {dueCards.length}</p>
<div style={{borderRadius:20,overflow:'hidden',border:'2px solid #22C55E30',background:'#fff',minHeight:280}}>
{/* Front */}
<div style={{padding:24,background:'linear-gradient(135deg,#F0FDF4,#DCFCE7)',minHeight:140}}>
<p style={{fontSize:10,fontWeight:700,color:'#22C55E',letterSpacing:'.05em',marginBottom:8}}>QUESTION</p>
<p style={{fontSize:16,fontWeight:600,color:'#1C1917',lineHeight:1.5}}>{reviewCard.front_text}</p>
{reviewCard.hint&&!showAnswer&&<p style={{fontSize:12,color:'#78716C',marginTop:8,fontStyle:'italic'}}>💡 Hint: {reviewCard.hint}</p>}
</div>
{/* Back */}
{showAnswer&&<div style={{padding:24,borderTop:'1px solid #E7E5E4'}}>
<p style={{fontSize:10,fontWeight:700,color:'#3B82F6',letterSpacing:'.05em',marginBottom:8}}>ANSWER</p>
<p style={{fontSize:14,color:'#1C1917',lineHeight:1.6}}>{reviewCard.back_text}</p>
</div>}
</div>
{!showAnswer?<button onClick={()=>{setShowAnswer(true);snd('click')}} style={{width:'100%',padding:16,borderRadius:14,border:'none',background:'#22C55E',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginTop:12,minHeight:52}}>Show Answer</button>
:<div style={{display:'flex',gap:8,marginTop:12}}>
{[{q:1,l:'😫 Again',c:'#EF4444'},{q:3,l:'🤔 Hard',c:'#F59E0B'},{q:4,l:'😊 Good',c:'#3B82F6'},{q:5,l:'🎯 Easy',c:'#22C55E'}].map(x=>
<button key={x.q} onClick={()=>{snd(x.q>=3?'correct':'wrong');reviewAnswer(x.q)}} style={{flex:1,padding:'12px 8px',borderRadius:12,border:'none',background:x.c,color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:48}}>{x.l}</button>)}
</div>}
<p style={{fontSize:11,color:'#A8A29E',textAlign:'center',marginTop:8}}>Streak: {reviewCard.streak} · Reviews: {reviewCard.total_reviews}</p>
</div>
:dueCards.length>0?<div style={{textAlign:'center',padding:30}}>
<p style={{fontSize:48}}>🎉</p><p style={{fontSize:18,fontWeight:800,marginTop:8}}>All cards reviewed!</p><p style={{fontSize:13,color:'#78716C',marginTop:4}}>Great job! Come back tomorrow for more.</p>
</div>
:<div style={{textAlign:'center',padding:40}}>
<p style={{fontSize:48}}>📚</p><p style={{fontSize:16,fontWeight:700,marginTop:8}}>No cards to review today</p>
<p style={{fontSize:13,color:'#78716C',marginTop:6,lineHeight:1.5}}>Review cards are created automatically from quiz mistakes and chapter key points. Take a quiz to start building your review deck!</p>
</div>}
</div>}
{/* Generate new plan button */}
{plan&&tab!=='review'&&<div style={{marginTop:16,textAlign:'center'}}>
<button onClick={()=>generatePlan('weekly')} disabled={generating} style={{padding:'10px 20px',borderRadius:12,border:'1px solid #E7E5E4',background:'#fff',color:'#78716C',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',minHeight:40}}>{generating?'Generating...':'🔄 Generate New Plan'}</button>
</div>}
</div>)}
// NAV — colorful with bigger mobile touch targets
function Nav({active,nav,p}:{active:Screen;nav:(s:Screen)=>void;p:Prof}){const tabs=[{sc:'home' as Screen,l:'Home',i:'\uD83C\uDFE0',ac:'#E8590C'},{sc:'foxy' as Screen,l:'Foxy',i:'\uD83E\uDD8A',ac:'#E8590C'},{sc:'quiz' as Screen,l:'Quiz',i:'\uD83C\uDFAF',ac:'#8B5CF6'},{sc:'skills' as Screen,l:'Skills',i:'\u2B50',ac:'#0EA5E9'},{sc:'plan' as Screen,l:'Plan',i:'\uD83D\uDCCB',ac:'#22C55E'},{sc:'notes' as Screen,l:'Notes',i:'\uD83D\uDCDD',ac:'#F59E0B'},{sc:'profile' as Screen,l:'Me',i:'\uD83D\uDC64',ac:'#EC4899'}];const botTabs=tabs.filter(t=>['home','foxy','quiz','skills','profile'].includes(t.sc));return(<><nav className="a-side"><div className="a-side-brand"><span style={{fontSize:28}}>{'\uD83E\uDD8A'}</span><div><span style={{fontSize:17,fontWeight:900,color:'#E8590C'}}>Alfanumrik</span><p style={{fontSize:10,color:'#A8A29E',fontWeight:600,marginTop:1}}>{p.grade} &middot; {p.subject}</p></div></div><div className="a-side-nav">{tabs.map(t=>{const on=active===t.sc;return<button key={t.sc} onClick={()=>{snd('nav');nav(t.sc)}} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderRadius:14,border:'none',background:on?`${t.ac}10`:'transparent',cursor:'pointer',fontFamily:'inherit',fontSize:14,fontWeight:600,color:on?t.ac:'#78716C',width:'100%',textAlign:'left',transition:'all .15s'}}><span style={{fontSize:20,width:28,textAlign:'center'}}>{t.i}</span><span>{t.l}</span>{on&&<div style={{marginLeft:'auto',width:6,height:6,borderRadius:'50%',background:t.ac}}/>}</button>})}</div><div className="a-side-user"><div className="a-side-av">{p.name.charAt(0)}</div><div><p style={{fontSize:13,fontWeight:700}}>{p.name}</p><p style={{fontSize:11,color:'#A8A29E'}}>{p.grade}</p></div></div></nav><nav className="a-bot">{botTabs.map(t=>{const on=active===t.sc;return<button key={t.sc} onClick={()=>{snd('nav');nav(t.sc)}} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 12px',minWidth:52,minHeight:48,border:'none',background:on?`${t.ac}10`:'none',cursor:'pointer',fontFamily:'inherit',borderRadius:12,transition:'all .2s'}}><span style={{fontSize:22,filter:on?'none':'grayscale(.6) opacity(.5)',transition:'all .2s',transform:on?'scale(1.15)':'scale(1)'}}>{t.i}</span><span style={{fontSize:10,fontWeight:700,color:on?t.ac:'#A8A29E'}}>{t.l}</span></button>})}</nav></>)}
// ═══════════════════════════════════════════════════════
// LANDING PAGE — Role Selection
// ═══════════════════════════════════════════════════════
function Landing({onRole}:{onRole:(r:'student'|'parent'|'admin')=>void}){
return(<div className="a-landing">
<div className="a-landing-bg"/>
<div className="a-landing-content">
<div style={{fontSize:64,marginBottom:8,animation:'alfBounce 2s infinite'}}>{'\uD83E\uDD8A'}</div>
<h1 style={{fontSize:42,fontWeight:900,color:'#fff',letterSpacing:'-.03em'}}>Alfanumrik</h1>
<p style={{fontSize:16,color:'rgba(255,255,255,.5)',marginTop:8,marginBottom:40}}>AI-powered adaptive learning by CusioSense Learning India Pvt. Ltd.</p>
<div style={{display:'flex',flexDirection:'column',gap:14,maxWidth:360,width:'100%'}}>
<button onClick={()=>{snd('click');onRole('student')}} className="a-role-btn" style={{background:'linear-gradient(135deg,#E8590C,#DC2626)'}}>
<span style={{fontSize:32}}>{'\uD83C\uDF93'}</span><div><strong style={{fontSize:18}}>I am a Student</strong><p style={{fontSize:12,opacity:.7,marginTop:2}}>Learn with Foxy AI Tutor</p></div><span style={{marginLeft:'auto',fontSize:20}}>{'\u2192'}</span>
</button>
<button onClick={()=>{snd('click');onRole('parent')}} className="a-role-btn" style={{background:'linear-gradient(135deg,#8B5CF6,#6D28D9)'}}>
<span style={{fontSize:32}}>{'\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67'}</span><div><strong style={{fontSize:18}}>I am a Parent</strong><p style={{fontSize:12,opacity:.7,marginTop:2}}>Track your child's progress</p></div><span style={{marginLeft:'auto',fontSize:20}}>{'\u2192'}</span>
</button>
<button onClick={()=>{snd('click');onRole('admin')}} className="a-role-btn" style={{background:'linear-gradient(135deg,#1C1917,#44403C)',border:'1px solid rgba(255,255,255,.1)'}}>
<span style={{fontSize:32}}>{'\u2699\uFE0F'}</span><div><strong style={{fontSize:18}}>Admin</strong><p style={{fontSize:12,opacity:.7,marginTop:2}}>Platform management</p></div><span style={{marginLeft:'auto',fontSize:20}}>{'\u2192'}</span>
</button>
</div>
<p style={{fontSize:11,color:'rgba(255,255,255,.25)',marginTop:32}}>{'\u00A9'} 2026 CusioSense Learning India Private Limited</p>
</div>
</div>)}
// ═══════════════════════════════════════════════════════
// PARENT PORTAL
// ═══════════════════════════════════════════════════════
// PARENT LOGIN — Link code only, no Supabase auth needed
function ParentCodeLogin({onLogin,onBack}:{onLogin:(data:any)=>void;onBack:()=>void}){const[code,setCode]=useState('');const[name,setName]=useState('');const[ld,setLd]=useState(false);const[err,setErr]=useState('');const[step,setStep]=useState<'code'|'name'>('code');const[studentInfo,setStudentInfo]=useState<any>(null);
const checkCode=async()=>{if(code.length<4)return;setLd(true);setErr('');const d=await api('parent-portal',{action:'parent_login',link_code:code,parent_name:'Parent'});setLd(false);if(d.error){setErr(d.error)}else if(d.success){setStudentInfo(d.student);setStep('name');setErr('')}};
const finish=async()=>{if(!name.trim()){onLogin({guardian:studentInfo?._g,student:studentInfo});return}setLd(true);const d=await api('parent-portal',{action:'parent_login',link_code:code,parent_name:name.trim()});setLd(false);if(d.success){onLogin({guardian:d.guardian,student:d.student})}};
return(<div className="a-center-dark" style={{maxWidth:440,padding:'40px 24px'}}>
<div style={{fontSize:56,marginBottom:16,animation:'alfBounce 2s infinite'}}>{step==='code'?'\uD83D\uDD17':'\uD83D\uDC4B'}</div>
{step==='code'?<>
<h2 style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>Parent Access</h2>
<p style={{fontSize:14,color:'rgba(255,255,255,.5)',marginBottom:24}}>Enter your child's link code to view their progress</p>
{err&&<div className="a-err">{err}</div>}
<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Enter link code" maxLength={8} className="a-ob-inp" style={{textAlign:'center',letterSpacing:8,fontSize:24}} onKeyDown={e=>e.key==='Enter'&&checkCode()} autoFocus/>
<p style={{fontSize:11,color:'rgba(255,255,255,.3)',marginTop:8,textAlign:'center'}}>Ask your child: Profile → Link Code</p>
<button onClick={checkCode} disabled={code.length<4||ld} className="a-ob-next" style={{width:'100%',marginTop:20,background:'linear-gradient(135deg,#8B5CF6,#6D28D9)',minHeight:52}}>{ld?'Verifying...':'Continue'}</button>
</>:<>
<h2 style={{fontSize:22,fontWeight:800,color:'#fff',marginBottom:8}}>Welcome! You're viewing</h2>
<div style={{padding:16,borderRadius:16,background:'rgba(255,255,255,.08)',marginBottom:20,textAlign:'center'}}>
<p style={{fontSize:20,fontWeight:900,color:'#C4B5FD'}}>{studentInfo?.name}</p>
<p style={{fontSize:13,color:'rgba(255,255,255,.5)'}}>{studentInfo?.grade} · {studentInfo?.subject}</p>
</div>
<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name (optional)" className="a-ob-inp" style={{marginBottom:12}} autoFocus onKeyDown={e=>e.key==='Enter'&&finish()}/>
<button onClick={finish} disabled={ld} className="a-ob-next" style={{width:'100%',background:'linear-gradient(135deg,#8B5CF6,#6D28D9)',minHeight:52}}>{ld?'Opening...':'View Dashboard \u2192'}</button>
</>}
<button onClick={onBack} style={{width:'100%',marginTop:12,padding:12,background:'none',border:'none',color:'rgba(255,255,255,.4)',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>{'\u2190'} Back</button>
</div>)}

function ParentDash({guardian,onLogout}:{guardian:any;onLogout:()=>void}){
const[children,setChildren]=useState<any[]>([]);const[selChild,setSelChild]=useState<any>(null);const[report,setReport]=useState<any>(null);const[tips,setTips]=useState<any[]>([]);const[weeklyReport,setWeeklyReport]=useState<any>(null);const[tab,setTab]=useState<'overview'|'report'|'tips'>('overview');const[ld,setLd]=useState(true);
useEffect(()=>{loadData()},[]);
const loadData=async()=>{setLd(true);
// First try loading children from DB link
const d=await api('parent-portal',{action:'get_children',guardian_id:guardian.id});
let kids=d.children||[];
// If no children from DB but we have linkedStudent from login, use that
if(kids.length===0&&guardian.linkedStudent){
  kids=[{...guardian.linkedStudent,xp:0,sessions:0,asked:0,correct:0,accuracy:0,streak:0,minutes:0,preferred_subject:guardian.linkedStudent.subject}];
}
setChildren(kids);
if(kids.length>0){setSelChild(kids[0]);loadReport(kids[0].id);loadWeekly(kids[0].id)}
setLd(false);
const t=await api('parent-portal',{action:'get_tips',grade:kids?.[0]?.grade});setTips(t.tips||[]);
};
const loadReport=async(sid:string)=>{const d=await api('parent-portal',{action:'get_child_report',student_id:sid});setReport(d)};
const loadWeekly=async(sid:string)=>{const d=await api('parent-portal',{action:'get_weekly_report',student_id:sid});setWeeklyReport(d.week)};
const selectChild=(c:any)=>{setSelChild(c);loadReport(c.id);loadWeekly(c.id);setTab('overview')};
const ptabs=[{id:'overview' as const,i:'\uD83C\uDFE0',l:'Overview'},{id:'report' as const,i:'\uD83D\uDCCA',l:'Analysis'},{id:'tips' as const,i:'\uD83D\uDCA1',l:'Tips'}];
if(ld)return<div className="a-center" style={{background:'#FAFAF8'}}><div style={{fontSize:48,animation:'alfPulse 1.5s infinite'}}>{'\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67'}</div><p style={{color:'#A8A29E',marginTop:8}}>Loading...</p></div>;
return(<div className="a-shell"><nav className="a-side" style={{borderColor:'#8B5CF615'}}><div className="a-side-brand"><span style={{fontSize:28}}>{'\uD83E\uDD8A'}</span><div><span style={{fontSize:17,fontWeight:900,color:'#8B5CF6'}}>Parent Portal</span><p style={{fontSize:10,color:'#A8A29E',fontWeight:600,marginTop:1}}>{guardian.name}</p></div></div>
{children.length>0&&<div style={{padding:'12px 12px 0'}}><p style={{fontSize:10,fontWeight:800,color:'#A8A29E',letterSpacing:'.06em',padding:'0 4px',marginBottom:6}}>YOUR CHILDREN</p>
{children.map(c=><button key={c.id} onClick={()=>selectChild(c)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:12,border:'none',background:selChild?.id===c.id?'#8B5CF610':'transparent',cursor:'pointer',fontFamily:'inherit',width:'100%',textAlign:'left',marginBottom:2}}>
<div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,#8B5CF6,#EC4899)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{c.name?.charAt(0)}</div>
<div><p style={{fontSize:13,fontWeight:700,color:selChild?.id===c.id?'#8B5CF6':'#1C1917'}}>{c.name}</p><p style={{fontSize:10,color:'#A8A29E'}}>{c.grade}</p></div>
</button>)}</div>}
<div className="a-side-nav" style={{marginTop:8}}>{ptabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={`nav-btn ${tab===t.id?'active':''}`} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,border:'none',background:tab===t.id?'#8B5CF610':'transparent',color:tab===t.id?'#8B5CF6':'#78716C',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',width:'100%',textAlign:'left'}}><span style={{fontSize:18}}>{t.i}</span>{t.l}</button>)}</div>
<div className="a-side-user"><button onClick={onLogout} style={{width:'100%',padding:10,borderRadius:10,border:'1px solid #E7E5E4',background:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#57534E'}}>Sign Out</button></div>
</nav>
<nav className="a-bot">{ptabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 12px',minWidth:52,minHeight:48,border:'none',background:tab===t.id?'#8B5CF610':'none',cursor:'pointer',fontFamily:'inherit',borderRadius:12}}><span style={{fontSize:22,filter:tab===t.id?'none':'grayscale(.6) opacity(.5)'}}>{t.i}</span><span style={{fontSize:10,fontWeight:700,color:tab===t.id?'#8B5CF6':'#A8A29E'}}>{t.l}</span></button>)}</nav>
<main className="a-main">{tab==='overview'&&<ParentOverview child={selChild} weekly={weeklyReport}/>}{tab==='report'&&<ParentReport report={report} child={selChild}/>}{tab==='tips'&&<ParentTips tips={tips} child={selChild}/>}</main>
</div>)}

function ParentOverview({child,weekly}:{child:any;weekly:any}){
if(!child)return<div className="a-page" style={{textAlign:'center',paddingTop:80}}><p style={{fontSize:48}}>🔗</p><h3 style={{marginTop:12}}>No data yet</h3><p style={{color:'#A8A29E',fontSize:14,marginTop:4}}>Your child hasn't started any activities yet. Check back soon!</p></div>;
const[dash,setDash]=useState<any>(null);const[dLd,setDLd]=useState(true);
useEffect(()=>{if(child?.id){setDLd(true);api('parent-portal',{action:'get_child_dashboard',student_id:child.id}).then(d=>{setDash(d);setDLd(false)}).catch(()=>setDLd(false))}},[child?.id]);
if(dLd)return<div style={{padding:60,textAlign:'center'}}><div style={{fontSize:36,animation:'alfPulse 1.5s infinite'}}>📊</div><p style={{color:'#A8A29E',marginTop:8}}>Loading {child.name}'s dashboard...</p></div>;
const st=dash?.stats||{};const acc=st.asked>0?Math.round(st.correct/st.asked*100):0;
return(<div className="a-page">
{/* Hero Card */}
<div style={{background:'linear-gradient(135deg,#8B5CF6,#EC4899)',borderRadius:24,padding:'24px 20px',color:'#fff',marginBottom:16,position:'relative',overflow:'hidden'}}>
<div style={{position:'absolute',top:-30,right:-30,width:120,height:120,borderRadius:'50%',background:'rgba(255,255,255,.1)'}}/>
<p style={{fontSize:13,opacity:.8}}>{child.grade} · {child.preferred_subject}</p>
<h1 style={{fontSize:24,fontWeight:900,margin:'4px 0 14px'}}>{child.name}'s Dashboard</h1>
<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
{[{v:String(st.xp||0),l:'XP',i:'⚡'},{v:String(st.streak||0),l:'Streak',i:'🔥'},{v:`${acc}%`,l:'Accuracy',i:'🎯'},{v:String(st.sessions||0),l:'Quizzes',i:'📚'},{v:`${Math.round((st.minutes||0)/60)}h`,l:'Study',i:'⏱'}].map(x=>(
<div key={x.l} style={{background:'rgba(255,255,255,.15)',borderRadius:12,padding:'8px 12px',display:'flex',alignItems:'center',gap:6}}>
<span style={{fontSize:16}}>{x.i}</span><div><p style={{fontSize:16,fontWeight:900,lineHeight:1}}>{x.v}</p><p style={{fontSize:9,opacity:.7,fontWeight:600}}>{x.l}</p></div></div>))}
</div></div>

{/* AI Insights */}
{dash?.insights?.length>0&&<div style={{marginBottom:16}}>
{dash.insights.map((insight:string,i:number)=><div key={i} style={{padding:'12px 16px',borderRadius:14,background:insight.startsWith('⚠')?'#FEF2F2':insight.startsWith('🏆')?'#F0FDF4':insight.startsWith('🔥')?'#FFF7ED':'#EFF6FF',border:`1px solid ${insight.startsWith('⚠')?'#FECACA':insight.startsWith('🏆')?'#BBF7D0':insight.startsWith('🔥')?'#FED7AA':'#BFDBFE'}`,marginBottom:8,fontSize:13,color:'#1C1917',lineHeight:1.5,fontWeight:500}}>{insight}</div>)}
</div>}

{/* Weekly Activity Chart */}
{dash?.dailyActivity&&<div className="a-card" style={{marginBottom:16}}>
<h3 style={{fontSize:13,fontWeight:800,color:'#78716C',letterSpacing:'.05em',marginBottom:14}}>📊 THIS WEEK'S ACTIVITY</h3>
<div style={{display:'flex',gap:6,alignItems:'flex-end',height:100,marginBottom:8}}>
{dash.dailyActivity.map((d:any)=>{const h=Math.max(d.quizzes*25+d.chats*15,d.active?10:4);return<div key={d.date} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
<div style={{width:'100%',height:h,maxHeight:90,borderRadius:6,background:d.active?'linear-gradient(to top,#8B5CF6,#C4B5FD)':'#F0EDE8',transition:'height .3s'}}/>
<span style={{fontSize:9,color:'#A8A29E',fontWeight:600}}>{d.label}</span>
</div>})}
</div>
<div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#78716C'}}>
<span>📝 {dash.weekSummary?.quizzes||0} quizzes · Avg {dash.weekSummary?.avgScore||0}%</span>
<span>🦊 {dash.weekSummary?.chats||0} Foxy chats</span>
</div>
</div>}

{/* Chapter Mastery Grid */}
{dash?.chapters?.length>0&&<div className="a-card" style={{marginBottom:16}}>
<h3 style={{fontSize:13,fontWeight:800,color:'#78716C',letterSpacing:'.05em',marginBottom:14}}>📚 CHAPTER MASTERY — {child.preferred_subject}</h3>
<div style={{display:'flex',flexDirection:'column',gap:8}}>
{dash.chapters.map((ch:any)=>{
const colors:Record<string,{bg:string;bar:string;text:string}>={mastered:{bg:'#F0FDF4',bar:'#16A34A',text:'Mastered'},proficient:{bg:'#ECFDF5',bar:'#059669',text:'Proficient'},learning:{bg:'#EFF6FF',bar:'#3B82F6',text:'Learning'},needs_work:{bg:'#FEF2F2',bar:'#EF4444',text:'Needs Practice'},not_started:{bg:'#F5F4F0',bar:'#D4D0C8',text:'Not Started'}};
const c=colors[ch.status]||colors.no_content;
return<div key={ch.chapter_number} style={{padding:'10px 14px',borderRadius:12,background:c.bg}}>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
<span style={{fontSize:12,fontWeight:700}}>Ch {ch.chapter_number}: {ch.title}</span>
{ch.best_score>0&&<span style={{fontSize:12,fontWeight:900,color:c.bar}}>{ch.best_score}%</span>}
{ch.best_score===0&&<span style={{fontSize:10,fontWeight:600,color:'#A8A29E'}}>{c.text}</span>}
</div>
<div style={{height:4,borderRadius:2,background:`${c.bar}20`}}><div style={{height:'100%',borderRadius:2,background:c.bar,width:`${Math.max(ch.best_score,ch.rag_content>0?3:0)}%`,transition:'width .5s'}}/></div>
{ch.quiz_sessions>0&&<p style={{fontSize:10,color:'#78716C',marginTop:3}}>{ch.quiz_sessions} quiz{ch.quiz_sessions>1?'zes':''} · {ch.correct_questions}/{ch.total_questions} correct</p>}
</div>})}
</div></div>}

{/* Recent Activity Timeline */}
{dash?.activityLog?.length>0&&<div className="a-card" style={{marginBottom:16}}>
<h3 style={{fontSize:13,fontWeight:800,color:'#78716C',letterSpacing:'.05em',marginBottom:14}}>🕐 RECENT ACTIVITY</h3>
{dash.activityLog.slice(0,10).map((a:any,i:number)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<9?'1px solid #F5F4F0':'none'}}>
<span style={{fontSize:18,width:28,textAlign:'center'}}>{a.type==='quiz'?'🎯':a.type==='chat'?'🦊':'📝'}</span>
<div style={{flex:1}}>
<p style={{fontSize:13,fontWeight:600}}>{a.type==='quiz'?`Quiz: ${a.subject} Ch${a.chapter||'?'} — ${a.score}% (${a.correct}/${a.questions})`:a.type==='chat'?`Foxy Chat: ${a.title||a.subject}`:a.title||'Note'}</p>
<p style={{fontSize:10,color:'#A8A29E'}}>{new Date(a.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
</div>
{a.type==='quiz'&&<div style={{padding:'4px 10px',borderRadius:8,fontSize:13,fontWeight:900,background:a.score>=70?'#F0FDF4':a.score>=40?'#FFFBEB':'#FEF2F2',color:a.score>=70?'#16A34A':a.score>=40?'#D97706':'#DC2626'}}>{a.score}%</div>}
</div>)}
</div>}

{/* Encouragement */}
<div style={{background:'linear-gradient(135deg,#1C1917,#292524)',borderRadius:20,padding:20,color:'#D6D3D1',lineHeight:1.7,fontSize:13}}>
<p style={{fontSize:11,fontWeight:800,color:'#8B5CF6',letterSpacing:'.08em',marginBottom:8}}>💡 PARENT TIP</p>
<p>Focus on celebrating effort, not just results. When {child.name} maintains a streak or tries a difficult topic, that's worth acknowledging!</p>
</div></div>)}

function ParentReport({report,child}:{report:any;child:any}){
if(!report||!child)return<div className="a-page" style={{textAlign:'center',paddingTop:80}}><p style={{fontSize:48}}>📊</p><p style={{color:'#A8A29E',marginTop:8}}>Select a child to view report</p></div>;
return(<div className="a-page"><h1 className="a-title">📊 Detailed Analysis — {child.name}</h1><p className="a-greet" style={{marginBottom:20}}>{child.grade} · {child.preferred_subject}</p>
{report.weakTopics?.length>0&&<div className="a-card" style={{borderLeft:'4px solid #EF4444'}}><h3 className="a-section-title">⚠️ NEEDS ATTENTION ({report.weakTopics.length} topics)</h3>
{report.weakTopics.slice(0,8).map((t:any,i:number)=><div key={i} style={{marginBottom:10}}><div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,fontWeight:600}}>{t.topic_tag?.replace(/_/g,' ')}</span><span style={{fontSize:12,fontWeight:700,color:'#DC2626'}}>{t.mastery_percent}%</span></div><div style={{height:5,borderRadius:3,background:'#FEE2E2'}}><div style={{height:'100%',borderRadius:3,width:`${t.mastery_percent}%`,background:'#EF4444'}}/></div></div>)}</div>}
{report.strongTopics?.length>0&&<div className="a-card" style={{borderLeft:'4px solid #22C55E'}}><h3 className="a-section-title">⭐ STRONG AREAS ({report.strongTopics.length} topics)</h3>
{report.strongTopics.slice(0,6).map((t:any,i:number)=><div key={i} style={{marginBottom:10}}><div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:13,fontWeight:600}}>{t.topic_tag?.replace(/_/g,' ')}</span><span style={{fontSize:12,fontWeight:700,color:'#16A34A'}}>{t.mastery_percent}%</span></div><div style={{height:5,borderRadius:3,background:'#DCFCE7'}}><div style={{height:'100%',borderRadius:3,width:`${t.mastery_percent}%`,background:'#22C55E'}}/></div></div>)}</div>}
{report.quizzes?.length>0&&<div className="a-card"><h3 className="a-section-title">🎯 RECENT QUIZZES</h3>
{report.quizzes.slice(0,10).map((q:any)=><div key={q.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid #F5F4F0'}}>
<div><p style={{fontSize:13,fontWeight:600}}>{q.subject}{q.chapter_number?` · Ch${q.chapter_number}`:''}</p><p style={{fontSize:11,color:'#A8A29E'}}>{new Date(q.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p></div>
<div style={{fontSize:15,fontWeight:900,padding:'4px 12px',borderRadius:10,background:q.score_percent>=70?'#F0FDF4':q.score_percent>=40?'#FFFBEB':'#FEF2F2',color:q.score_percent>=70?'#16A34A':q.score_percent>=40?'#D97706':'#DC2626'}}>{q.score_percent}%</div>
</div>)}</div>}
{report.moments?.length>0&&<div className="a-card"><h3 className="a-section-title">✨ ACHIEVEMENTS</h3>
{report.moments.slice(0,6).map((m:any,i:number)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid #F5F4F0'}}><span style={{fontSize:20}}>{m.moment_type==='concept_mastered'?'⭐':m.moment_type==='streak_milestone'?'🔥':'🎉'}</span><div><p style={{fontSize:13,fontWeight:600}}>{m.title}</p><p style={{fontSize:11,color:'#A8A29E'}}>{m.description?.substring(0,60)}</p></div><span style={{marginLeft:'auto',fontSize:12,fontWeight:800,color:'#E8590C'}}>+{m.xp_awarded} XP</span></div>)}</div>}
</div>)}

function ParentTips({tips,child}:{tips:any[];child:any}){
const cats=[{id:'all',l:'All'},{id:'academic',l:'📚 Academic'},{id:'motivational',l:'💪 Motivational'},{id:'behavioral',l:'🧠 Behavioral'},{id:'exam_prep',l:'📝 Exam Prep'},{id:'health',l:'❤️ Health'}];
const[cat,setCat]=useState('all');
const filtered=cat==='all'?tips:tips.filter(t=>t.category===cat);
return(<div className="a-page"><h1 className="a-title">💡 Guidelines & Tips</h1><p className="a-greet" style={{marginBottom:16}}>Expert advice for supporting {child?.name||'your child'}'s learning</p>
<div style={{display:'flex',gap:6,overflowX:'auto',marginBottom:20,paddingBottom:4}}>{cats.map(c=><button key={c.id} onClick={()=>setCat(c.id)} className={`a-pill${cat===c.id?' on':''}`} style={{whiteSpace:'nowrap'}}>{c.l}</button>)}</div>
{filtered.length>0?filtered.map((t:any)=><div key={t.id} className="a-card" style={{borderLeft:`4px solid ${t.category==='academic'?'#3B82F6':t.category==='motivational'?'#22C55E':t.category==='exam_prep'?'#F59E0B':t.category==='health'?'#EC4899':'#8B5CF6'}`}}>
<h3 style={{fontSize:15,fontWeight:800,marginBottom:6}}>{t.title}</h3>
<p style={{fontSize:14,color:'#57534E',lineHeight:1.7}}>{t.content}</p>
<p style={{fontSize:11,color:'#A8A29E',marginTop:8,fontWeight:600}}>{t.category?.toUpperCase()}</p>
</div>):<div style={{textAlign:'center',padding:40,color:'#A8A29E'}}><p style={{fontSize:32}}>💡</p><p>No tips in this category yet</p></div>}
</div>)}
// ═══════════════════════════════════════════════════════
// ADMIN PORTAL
// ═══════════════════════════════════════════════════════
function AdminPanel({user,onLogout}:{user:any;onLogout:()=>void}){
const[admin,setAdmin]=useState<any>(null);const[tab,setTab]=useState('dashboard');const[data,setData]=useState<any>({});const[ld,setLd]=useState(true);const[modal,setModal]=useState<any>(null);
const adminAPI=async(action:string,extra:any={})=>{const d=await api('super-admin',{action,auth_user_id:user.id,...extra});return d};
useEffect(()=>{(async()=>{const d=await adminAPI('get_dashboard');if(d?.admin){setAdmin(d.admin);setData(v=>({...v,dashboard:d}))}else{alert('Not an admin account')}setLd(false)})()},[]);
const loadTab=async(t:string)=>{setTab(t);switch(t){case'dashboard':{const d=await adminAPI('get_dashboard');setData((v:any)=>({...v,dashboard:d}));break}case'rag':{const[stats,syl]=await Promise.all([api('pdf-processor',{mode:'rag_stats'}),api('pdf-processor',{mode:'syllabus_status'})]);setData((v:any)=>({...v,ragStats:stats,ragSyllabus:syl?.syllabus||[]}));break}case'students':{const d=await adminAPI('list_students');setData((v:any)=>({...v,students:d.students}));break}case'questions':{const d=await adminAPI('list_questions',{limit:100});setData((v:any)=>({...v,questions:d.questions}));break}case'ai_logs':{const d=await adminAPI('list_ai_logs',{limit:50});setData((v:any)=>({...v,aiLogs:d}));break}case'system':{const d=await adminAPI('system_health');setData((v:any)=>({...v,system:d}));break}case'audit':{const d=await adminAPI('get_audit_log',{limit:50});setData((v:any)=>({...v,audit:d.audit}));break}}};
if(ld)return<div className="a-center" style={{background:'#0F0F12'}}><div style={{fontSize:48,animation:'alfPulse 1.5s infinite'}}>{'\u2699\uFE0F'}</div><p style={{color:'#71717A',marginTop:8}}>Loading admin...</p></div>;
if(!admin)return<div className="a-center" style={{background:'#0F0F12'}}><p style={{color:'#EF4444',fontSize:16,fontWeight:700}}>Access denied. Not an admin.</p><button onClick={onLogout} className="a-btn-primary" style={{marginTop:16}}>Back</button></div>;
const tabs=[{id:'dashboard',i:'\uD83D\uDCCA',l:'Dashboard'},{id:'rag',i:'\uD83E\uDDE0',l:'RAG'},{id:'students',i:'\uD83D\uDC65',l:'Students'},{id:'questions',i:'\u2753',l:'Questions'},{id:'ai_logs',i:'\uD83E\uDD16',l:'AI Logs'},{id:'system',i:'\u2699\uFE0F',l:'System'},{id:'audit',i:'\uD83D\uDCCB',l:'Audit'}];
const st=data.dashboard?.stats;
return(<div className="a-shell" style={{background:'#0F0F12'}}><nav className="a-side" style={{background:'#18181B',borderColor:'#27272A'}}>
<div className="a-side-brand"><span style={{fontSize:28}}>{'\uD83E\uDD8A'}</span><div><span style={{fontSize:17,fontWeight:900,color:'#E8590C'}}>Super Admin</span><p style={{fontSize:10,color:'#71717A',fontWeight:600,marginTop:1}}>{admin.name}</p></div></div>
<div className="a-side-nav">{tabs.map(t=><button key={t.id} onClick={()=>loadTab(t.id)} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,border:'none',background:tab===t.id?'#E8590C15':'transparent',color:tab===t.id?'#E8590C':'#A1A1AA',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',width:'100%',textAlign:'left'}}><span style={{fontSize:18}}>{t.i}</span>{t.l}</button>)}</div>
<div className="a-side-user"><button onClick={onLogout} style={{width:'100%',padding:10,borderRadius:10,border:'1px solid #27272A',background:'#18181B',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#A1A1AA'}}>Logout</button></div>
</nav>
<nav className="a-bot" style={{background:'rgba(15,15,18,.97)',borderColor:'#27272A'}}>{tabs.map(t=><button key={t.id} onClick={()=>loadTab(t.id)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 10px',minWidth:48,minHeight:48,border:'none',background:tab===t.id?'#E8590C15':'none',cursor:'pointer',fontFamily:'inherit',borderRadius:12}}><span style={{fontSize:20,filter:tab===t.id?'none':'grayscale(.6) opacity(.5)'}}>{t.i}</span><span style={{fontSize:9,fontWeight:700,color:tab===t.id?'#E8590C':'#71717A'}}>{t.l}</span></button>)}</nav>
<main className="a-main" style={{color:'#E4E4E7'}}>
{tab==='dashboard'&&st&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\uD83D\uDCCA'} Dashboard</h1>
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20}}>
{[{v:st.total_students,l:'Students',i:'\uD83D\uDC65'},{v:st.total_quizzes,l:'Quizzes',i:'\uD83C\uDFAF'},{v:st.total_ai_calls,l:'AI Calls',i:'\uD83E\uDD16'},{v:st.active_questions,l:'Questions',i:'\u2753'},{v:st.active_topics,l:'Topics',i:'\uD83D\uDCDA'},{v:st.graph_nodes,l:'Graph Nodes',i:'\uD83C\uDF1F'},{v:st.cached_responses,l:'Cached',i:'\uD83D\uDCBE'},{v:st.total_xp_earned,l:'Total XP',i:'\u2B50'}].map(c=><div key={c.l} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16}}><span style={{fontSize:18}}>{c.i}</span><p style={{fontSize:24,fontWeight:900,color:'#fff',margin:'6px 0 2px'}}>{c.v}</p><p style={{fontSize:11,color:'#71717A',fontWeight:600}}>{c.l}</p></div>)}
</div></div>}
{tab==='students'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\uD83D\uDC65'} Students ({data.students?.length||0})</h1>
{(data.students||[]).map((s:any)=><div key={s.id} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
<div><p style={{fontWeight:700,color:'#fff'}}>{s.name}</p><p style={{fontSize:12,color:'#71717A'}}>{s.grade} · {s.preferred_subject} · {s.total_xp||0} XP · {s.accuracy||0}% acc</p></div>
<span style={{fontSize:12,fontWeight:700,color:s.accuracy>=70?'#22C55E':s.accuracy>=40?'#F59E0B':'#EF4444',padding:'4px 10px',borderRadius:8,background:s.accuracy>=70?'#22C55E15':s.accuracy>=40?'#F59E0B15':'#EF444415'}}>{s.total_sessions||0} quizzes</span>
</div>)}</div>}
{tab==='questions'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\u2753'} Questions ({data.questions?.length||0})</h1>
{(data.questions||[]).slice(0,40).map((q:any)=><div key={q.id} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:14,marginBottom:6}}>
<p style={{fontSize:13,fontWeight:600,color:'#E4E4E7'}}>{q.question_text?.substring(0,100)}</p>
<p style={{fontSize:11,color:'#71717A',marginTop:4}}>{q.subject} · {q.grade} · L{q.difficulty} · {q.is_active?'\u2705 Active':'\u274C Disabled'}</p>
<p style={{fontSize:12,color:'#22C55E',marginTop:4}}>Answer: {q.correct_answer_text?.substring(0,60)}</p>
</div>)}</div>}
{tab==='ai_logs'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:8}}>{'\uD83E\uDD16'} AI Logs</h1>
<button onClick={async()=>{if(confirm('Clear all cached responses?')){const d=await adminAPI('clear_cache');if(d)alert('Cleared '+d.cleared+' cached responses')}}} style={{padding:'8px 16px',borderRadius:10,border:'1px solid #EF444430',background:'#EF444415',color:'#EF4444',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginBottom:16}}>{'\uD83D\uDDD1\uFE0F'} Clear Cache</button>
{(data.aiLogs?.logs||[]).slice(0,30).map((l:any,i:number)=><div key={i} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:10,padding:12,marginBottom:4,fontSize:12}}>
<span style={{color:'#3B82F6',fontWeight:700}}>{l.interaction_type||'tutor'}</span> · <span style={{color:'#71717A'}}>{l.model}</span> · <span>{l.latency_ms}ms</span>
<p style={{color:'#A1A1AA',marginTop:4,fontSize:11}}>{l.user_message?.substring(0,80)}</p>
</div>)}</div>}
{tab==='system'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\u2699\uFE0F'} System Health</h1>
{data.system?.functions&&<div style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16,marginBottom:16}}><p style={{fontSize:12,fontWeight:800,color:'#71717A',letterSpacing:'.06em',marginBottom:12}}>EDGE FUNCTIONS ({data.system.functions.length})</p>
<div style={{display:'flex',flexWrap:'wrap',gap:6}}>{data.system.functions.map((f:string)=><span key={f} style={{padding:'6px 12px',borderRadius:8,background:'#22C55E15',color:'#22C55E',fontSize:11,fontWeight:700}}>{'\u2705'} {f}</span>)}</div></div>}
{data.system?.tableCounts&&<div style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16}}><p style={{fontSize:12,fontWeight:800,color:'#71717A',letterSpacing:'.06em',marginBottom:12}}>DATABASE TABLES ({data.system.totalTables})</p>
{Object.entries(data.system.tableCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).map(([t,c]:any)=><div key={t} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #27272A20',fontSize:12}}><span style={{fontFamily:'monospace',color:'#A1A1AA'}}>{t}</span><strong style={{color:'#fff'}}>{c}</strong></div>)}</div>}
</div>}
{tab==='rag'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\uD83E\uDDE0'} RAG Knowledge Base</h1>
{data.ragStats&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10,marginBottom:20}}>
{[{v:data.ragStats.total_chunks,l:'Total Chunks',i:'\uD83D\uDCE6'},{v:data.ragStats.embedded_chunks,l:'Embedded',i:'\uD83E\uDDF2'},{v:data.ragStats.embedding_coverage,l:'Coverage',i:'\uD83D\uDCCA'},{v:data.ragStats.source_count,l:'Sources',i:'\uD83D\uDCDA'},{v:data.ragStats.total_queries,l:'Queries',i:'\uD83D\uDD0D'},{v:data.ragStats.grounding_rate,l:'Grounding',i:'\u2705'},{v:data.ragStats.syllabus_chapters,l:'Chapters',i:'\uD83D\uDCD6'},{v:data.ragStats.syllabus_coverage,l:'Syllabus %',i:'\uD83C\uDFAF'}].map(c=><div key={c.l} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:14}}><span style={{fontSize:16}}>{c.i}</span><p style={{fontSize:20,fontWeight:900,color:'#fff',margin:'4px 0 2px'}}>{c.v??'--'}</p><p style={{fontSize:10,color:'#71717A',fontWeight:600}}>{c.l}</p></div>)}
</div>}
<div style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16,marginBottom:16}}>
<p style={{fontSize:13,fontWeight:800,color:'#71717A',letterSpacing:'.06em',marginBottom:12}}>INGEST CONTENT</p>
<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
<select id="rag_grade" style={{padding:10,borderRadius:8,border:'1px solid #27272A',background:'#0F0F12',color:'#E4E4E7',fontSize:13}}>
{['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'].map(g=><option key={g} value={g}>{g}</option>)}
</select>
<select id="rag_subject" style={{padding:10,borderRadius:8,border:'1px solid #27272A',background:'#0F0F12',color:'#E4E4E7',fontSize:13}}>
{['Mathematics','Science','Physics','Chemistry','Biology','English','Hindi','Social Studies'].map(s=><option key={s} value={s}>{s}</option>)}
</select>
</div>
<div style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:8,marginBottom:12}}>
<input id="rag_ch_num" type="number" placeholder="Ch#" style={{padding:10,borderRadius:8,border:'1px solid #27272A',background:'#0F0F12',color:'#E4E4E7',fontSize:13}}/>
<input id="rag_ch_title" type="text" placeholder="Chapter Title" style={{padding:10,borderRadius:8,border:'1px solid #27272A',background:'#0F0F12',color:'#E4E4E7',fontSize:13}}/>
</div>
<textarea id="rag_content" placeholder="Paste chapter content here... (from NCERT textbook or approved source)" rows={6} style={{width:'100%',padding:10,borderRadius:8,border:'1px solid #27272A',background:'#0F0F12',color:'#E4E4E7',fontSize:13,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
<div style={{display:'flex',gap:8,marginTop:10}}>
<button onClick={async()=>{const g=(document.getElementById('rag_grade') as HTMLSelectElement).value;const sub=(document.getElementById('rag_subject') as HTMLSelectElement).value;const ch=parseInt((document.getElementById('rag_ch_num') as HTMLInputElement).value)||undefined;const title=(document.getElementById('rag_ch_title') as HTMLInputElement).value;const content=(document.getElementById('rag_content') as HTMLTextAreaElement).value;if(!content||content.length<50){alert('Content too short. Paste at least 50 characters.');return}const r=await api('pdf-processor',{mode:'rag_ingest_text',grade:g,subject:sub,chapter_number:ch,chapter_title:title||undefined,content,topic:title||undefined});if(r.success){alert(`Ingested! ${r.chunks_created} chunks created and embedded.`);(document.getElementById('rag_content') as HTMLTextAreaElement).value='';loadTab('rag')}else{alert('Error: '+(r.error||'Unknown'))}}} style={{flex:1,padding:12,borderRadius:10,border:'none',background:'#E8590C',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{'\uD83D\uDE80'} Ingest Content</button>
<button onClick={async()=>{const r=await api('rag-engine',{action:'reindex',batch_size:20});alert(`Re-embedded ${r.reindexed||0} chunks`)}} style={{padding:12,borderRadius:10,border:'1px solid #27272A',background:'#18181B',color:'#A1A1AA',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{'\uD83D\uDD04'} Re-embed</button>
</div>
</div>
<div style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16,marginBottom:16}}>
<p style={{fontSize:13,fontWeight:800,color:'#71717A',letterSpacing:'.06em',marginBottom:12}}>SYLLABUS COVERAGE ({data.ragSyllabus?.length||0} chapters)</p>
<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
{['All',...new Set((data.ragSyllabus||[]).map((s:any)=>s.grade))].map((g:string)=><button key={g} onClick={()=>{setData((v:any)=>({...v,ragFilter:g==='All'?null:g}))}} style={{padding:'5px 12px',borderRadius:8,border:'1px solid #27272A',background:data.ragFilter===g||(g==='All'&&!data.ragFilter)?'#E8590C20':'#0F0F12',color:data.ragFilter===g||(g==='All'&&!data.ragFilter)?'#E8590C':'#71717A',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{g}</button>)}
</div>
{(data.ragSyllabus||[]).filter((s:any)=>!data.ragFilter||s.grade===data.ragFilter).map((s:any)=><div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid #27272A15',fontSize:12}}>
<span style={{width:20,textAlign:'center',fontSize:14}}>{s.chunk_count>0?'\u2705':'\u26AA'}</span>
<span style={{color:'#71717A',minWidth:60}}>{s.grade}</span>
<span style={{color:'#A1A1AA',minWidth:80}}>{s.subject}</span>
<span style={{color:'#fff',fontWeight:600,flex:1}}>Ch{s.chapter_number}: {s.chapter_title}</span>
<span style={{color:s.chunk_count>0?'#22C55E':'#52525B',fontWeight:700,fontSize:11}}>{s.chunk_count>0?`${s.chunk_count} chunks`:'No content'}</span>
{s.is_nep_updated&&<span style={{padding:'2px 6px',borderRadius:4,background:'#3B82F620',color:'#3B82F6',fontSize:9,fontWeight:800}}>NEP</span>}
</div>)}
</div>
{data.ragStats?.sources?.length>0&&<div style={{background:'#18181B',border:'1px solid #27272A',borderRadius:14,padding:16}}>
<p style={{fontSize:13,fontWeight:800,color:'#71717A',letterSpacing:'.06em',marginBottom:12}}>CONTENT SOURCES ({data.ragStats.sources.length})</p>
{data.ragStats.sources.map((s:any)=><div key={s.id} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #27272A15',fontSize:12}}>
<span style={{color:'#E4E4E7',fontWeight:600}}>{s.name}</span>
<span style={{color:s.approval_status==='approved'?'#22C55E':'#F59E0B',fontWeight:700}}>{s.approval_status}</span>
</div>)}
</div>}
</div>}
{tab==='audit'&&<div className="a-page"><h1 style={{fontSize:24,fontWeight:900,color:'#fff',marginBottom:20}}>{'\uD83D\uDCCB'} Audit Log</h1>
{(data.audit||[]).map((a:any,i:number)=><div key={i} style={{background:'#18181B',border:'1px solid #27272A',borderRadius:10,padding:12,marginBottom:4,fontSize:12}}>
<span style={{color:'#8B5CF6',fontWeight:700}}>{a.action}</span> · <span style={{color:'#71717A'}}>{a.entity_type}</span>
<p style={{color:'#52525B',fontSize:11,marginTop:2}}>{new Date(a.created_at).toLocaleString('en-IN')}</p>
</div>)}</div>}
</main></div>)}
// ═══════════════════════════════════════════════════════
// MAIN APP — 3-Portal Router
// ═══════════════════════════════════════════════════════
export default function App(){
  const[portal,setPortal]=useState<'landing'|'student'|'parent'|'admin'>('landing')
  const[sc,setSc]=useState<Screen>('loading')
  const[user,setUser]=useState<any>(null)
  const[prof,setProf]=useState<Prof|null>(null)
  const[stats,setStats]=useState<Stats>({xp:0,streak:0,sessions:0,correct:0,asked:0,minutes:0})
  const[history,setHistory]=useState<any>(null)
  const[guardian,setGuardian]=useState<any>(null)
  const[parentStep,setParentStep]=useState<'code'|'dash'>('code')
  const loadAll=useCallback(async(p:Prof)=>{if(!p.studentId)return;try{const[s,h]=await Promise.all([getStats(p.studentId),api('chat-history',{action:'get_history',student_id:p.studentId})]);setStats(s);setHistory(h)}catch(e){console.error('loadAll failed:',e)}},[])

  // Check saved portal choice
  useEffect(()=>{
    if(typeof window==='undefined')return
    const params=new URLSearchParams(window.location.search)
    if(params.get('reset')==='true'||window.location.hash.includes('type=recovery')){setPortal('student');setSc('reset');return}
    const savedPortal=localStorage.getItem('alfn_portal') as any
    if(savedPortal==='student'||savedPortal==='parent'||savedPortal==='admin'){setPortal(savedPortal)}
    // FAST PATH for students
    if(savedPortal==='student'){
      const savedProfile=localStorage.getItem('alfanumrik_profile')
      const savedToken=localStorage.getItem('sb-dxipobqngyfpqbbznojz-auth-token')
      if(savedProfile&&savedToken){try{const p=JSON.parse(savedProfile) as Prof;const token=JSON.parse(savedToken);if(token.access_token&&p.name){
        // Check if token is obviously expired (more than 1 hour old)
        const tokenExpiry=token.expires_at?token.expires_at*1000:0;
        const isTokenExpired=tokenExpiry>0&&tokenExpiry<Date.now()-3600000;
        if(isTokenExpired){
          // Token is definitely expired — go straight to auth
          localStorage.removeItem('alfanumrik_profile');
          localStorage.removeItem('sb-dxipobqngyfpqbbznojz-auth-token');
          setSc('auth');return;
        }
        // Show loading while we resolve session + studentId
        setSc('loading');
        sb.auth.getSession().then(async({data:{session}})=>{
          if(session?.user){
            setUser(session.user);
            // ALWAYS ensure studentId is resolved from DB
            const sid=p.studentId||await ensureStudent(session.user.id,p).catch(()=>null);
            const wp={...p,studentId:sid||undefined};
            setProf(wp);
            localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));
            await loadAll(wp);
            setSc('home');
          }else{
            localStorage.removeItem('alfanumrik_profile');
            setProf(null);setSc('auth');
          }
        }).catch(()=>{
          // Session check failed — likely expired. Go to auth.
          localStorage.removeItem('alfanumrik_profile');
          localStorage.removeItem('sb-dxipobqngyfpqbbznojz-auth-token');
          setSc('auth');
        });
        const{data:{subscription}}=sb.auth.onAuthStateChange(async(ev,s)=>{if(!s?.user&&ev==='SIGNED_OUT'){setUser(null);setProf(null);setSc('auth');localStorage.removeItem('alfanumrik_profile')}else if(s?.user)setUser(s.user)});return()=>subscription.unsubscribe()}}catch{}}
      setSc('auth')
    }
    // FAST PATH for parents — no auth, just check saved guardian+student
    if(savedPortal==='parent'){
      const savedGuardian=localStorage.getItem('alfn_guardian')
      const savedStudent=localStorage.getItem('alfn_parent_student')
      if(savedGuardian&&savedStudent){try{setGuardian(JSON.parse(savedGuardian));setParentStep('dash')}catch{setParentStep('code')}}else{setParentStep('code')}
    }
    // Admin — just need auth
    if(savedPortal==='admin'){
      sb.auth.getSession().then(({data:{session}})=>{if(session?.user)setUser(session.user);else setSc('auth')}).catch(()=>setSc('auth'))
    }
  },[loadAll])

  const selectRole=(role:'student'|'parent'|'admin')=>{setPortal(role);localStorage.setItem('alfn_portal',role);if(role==='student')setSc('auth');if(role==='parent')setParentStep('code');if(role==='admin')setSc('auth')}
  const goLanding=()=>{setPortal('landing');localStorage.removeItem('alfn_portal')}

  // STUDENT AUTH
  const onStudentAuth=async(u:any)=>{try{setUser(u);const saved=localStorage.getItem('alfanumrik_profile');if(saved){const p=JSON.parse(saved) as Prof;const sid=await ensureStudent(u.id,p);const wp={...p,studentId:sid||undefined};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp);setSc('home');return}const dbProf=await loadProfileFromDB(u.id);if(dbProf){setProf(dbProf);localStorage.setItem('alfanumrik_profile',JSON.stringify(dbProf));await loadAll(dbProf);setSc('home');return}setSc('onboard')}catch(e){console.error('onAuth failed:',e);setSc('auth')}}
  const onStudentOnboard=async(p:Prof)=>{if(user){const sid=await ensureStudent(user.id,p);const wp={...p,studentId:sid||undefined};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp);setSc('home')}}
  const onProfUp=async(p:Prof)=>{setProf(p);localStorage.setItem('alfanumrik_profile',JSON.stringify(p));if(p.studentId){await sb.from('students').update({name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject}).eq('id',p.studentId);await loadAll(p)}}
  const refreshStats=async()=>{if(prof?.studentId){const s=await getStats(prof.studentId);setStats(s);const h=await api('chat-history',{action:'get_history',student_id:prof.studentId});setHistory(h)}}
  const studentLogout=async()=>{await sb.auth.signOut();localStorage.removeItem('alfanumrik_profile');setUser(null);setProf(null);setSc('auth')}

  // PARENT LOGIN — link code only, no Supabase auth
  const onParentLogin=(data:any)=>{const g=data.guardian;const st=data.student;setGuardian({...g,linkedStudent:st});localStorage.setItem('alfn_guardian',JSON.stringify({...g,linkedStudent:st}));localStorage.setItem('alfn_parent_student',JSON.stringify(st));setParentStep('dash')}
  const parentLogout=()=>{localStorage.removeItem('alfn_guardian');localStorage.removeItem('alfn_parent_student');setGuardian(null);setParentStep('code')}

  // ADMIN AUTH
  const onAdminAuth=async(u:any)=>{setUser(u);setSc('home')}
  const adminLogout=async()=>{await sb.auth.signOut();setUser(null);setSc('auth')}

  // Loading timeout
  useEffect(()=>{if(portal==='student'&&sc==='loading'){const t=setTimeout(()=>{setSc('auth')},8000);return()=>clearTimeout(t)}},[sc,portal])

  // ─── RENDER ───
  // LANDING
  if(portal==='landing')return<><CSS/><Landing onRole={selectRole}/></>

  // STUDENT PORTAL
  if(portal==='student'){
    if(sc==='loading')return<><CSS/><div className="a-center"><div style={{fontSize:56,animation:'alfBounce 1.5s infinite'}}>{'\uD83E\uDD8A'}</div><p style={{color:'#A8A29E',marginTop:8,fontWeight:600}}>Loading...</p></div></>
    if(sc==='auth')return<><CSS/><Auth onAuth={onStudentAuth} onConfirm={()=>setSc('confirm')}/><div style={{position:'fixed',top:16,left:16}}><button onClick={goLanding} style={{padding:'8px 16px',borderRadius:10,background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.5)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{'\u2190'} Back</button></div></>
    if(sc==='confirm')return<><CSS/><ConfirmScreen onBack={()=>setSc('auth')}/></>
    if(sc==='reset')return<><CSS/><ResetScreen/></>
    if(sc==='onboard')return<><CSS/><Onboard user={user} done={onStudentOnboard}/></>
    return<><CSS/><div className="a-shell">{prof&&<Nav active={sc} nav={setSc} p={prof}/>}<main className="a-main">{sc==='home'&&prof&&<Home p={prof} nav={setSc} stats={stats} history={history}/>}{sc==='foxy'&&prof&&<Foxy p={prof}/>}{sc==='quiz'&&prof&&<Quiz p={prof} onDone={refreshStats}/>}{sc==='skills'&&prof&&<SkillTree p={prof} nav={setSc}/>}{sc==='plan'&&prof&&<StudyPlan p={prof} nav={setSc}/>}{sc==='notes'&&prof&&<Notes p={prof}/>}{sc==='progress'&&prof&&<Progress p={prof} stats={stats}/>}{sc==='profile'&&prof&&<ProfileScr p={prof} onUp={onProfUp} out={studentLogout} stats={stats}/>}</main></div></>
  }

  // PARENT PORTAL — link code only
  if(portal==='parent'){
    if(parentStep==='code')return<><CSS/><ParentCodeLogin onLogin={onParentLogin} onBack={goLanding}/></>
    if(parentStep==='dash'&&guardian)return<><CSS/><ParentDash guardian={guardian} onLogout={parentLogout}/></>
    return<><CSS/><ParentCodeLogin onLogin={onParentLogin} onBack={goLanding}/></>
  }

  // ADMIN PORTAL
  if(portal==='admin'){
    if(!user||sc==='auth')return<><CSS/><Auth onAuth={onAdminAuth} onConfirm={()=>setSc('auth')}/><div style={{position:'fixed',top:16,left:16}}><button onClick={goLanding} style={{padding:'8px 16px',borderRadius:10,background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.5)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{'\u2190'} Back</button></div></>
    return<><CSS/><AdminPanel user={user} onLogout={adminLogout}/></>
  }

  return<><CSS/><Landing onRole={selectRole}/></>
}
function CSS(){return<style>{`
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}body{font-family:'Nunito',sans-serif;background:#FAFAF8;color:#1C1917;-webkit-font-smoothing:antialiased;overflow-x:hidden}::selection{background:#E8590C;color:#fff}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#E7E5E4;border-radius:3px}
@keyframes alfFadeIn{from{opacity:0}to{opacity:1}}@keyframes alfSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes alfPulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes alfBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes alfPulseBorder{0%,100%{border-color:#EF444450}50%{border-color:#EF4444}}
.a-landing{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0F0F12 0%,#1C1917 40%,#292524 100%);position:relative;overflow:hidden}
.a-landing-bg{position:absolute;top:-50%;right:-30%;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,#E8590C08 0%,transparent 70%);pointer-events:none}
.a-landing-content{position:relative;z-index:1;text-align:center;padding:24px;animation:alfFadeIn .6s}
.a-role-btn{display:flex;align-items:center;gap:16px;padding:20px 24px;border-radius:18px;border:none;color:#fff;font-family:inherit;cursor:pointer;transition:all .2s;text-align:left;width:100%;min-height:72px}.a-role-btn:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.3)}
.a-center{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.a-center-dark{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1C1917,#292524);padding:24px;text-align:center}
.a-auth{min-height:100vh;display:flex}.a-auth-l{flex:1;background:linear-gradient(135deg,#1C1917 0%,#292524 50%,#E8590C 200%);padding:60px;display:flex;flex-direction:column;justify-content:center;color:#fff}.a-auth-r{flex:1;display:flex;align-items:center;justify-content:center;padding:40px}
.a-tabs{display:flex;gap:4px;background:#F3F2EE;border-radius:14px;padding:4px;margin-bottom:20px}.a-tab{flex:1;padding:12px;border-radius:12px;border:none;font-size:14px;font-weight:700;cursor:pointer;background:transparent;color:#A8A29E;font-family:inherit;min-height:44px}.a-tab.on{background:#fff;color:#1C1917;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.a-err{background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;border-radius:14px;padding:12px 16px;font-size:13px;margin-bottom:14px;font-weight:600}.a-ok-msg{background:#DCFCE7;color:#15803D;border:1px solid #BBF7D0;border-radius:14px;padding:12px 16px;font-size:13px;margin-bottom:14px;font-weight:600}
.a-inp{width:100%;padding:16px 18px;border-radius:14px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:15px;outline:none;margin-bottom:12px;font-family:inherit;color:#1C1917;min-height:52px}.a-inp:focus{border-color:#E8590C;box-shadow:0 0 0 3px rgba(232,89,12,.08)}
.a-btn-primary{padding:14px 24px;border-radius:14px;border:none;background:linear-gradient(135deg,#E8590C,#DC2626);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;display:block}.a-btn-primary:hover{opacity:.9;transform:translateY(-1px)}.a-btn-primary:disabled{opacity:.4;transform:none}
.a-link{width:100%;margin-top:8px;padding:10px;background:none;border:none;color:#E8590C;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:block;text-align:center}.a-divider{display:flex;align-items:center;gap:12px;margin:16px 0}.a-divider span{font-size:12px;color:#A8A29E}.a-divider::before,.a-divider::after{content:'';flex:1;height:1px;background:#E7E5E4}
.a-ggl{width:100%;padding:14px;border-radius:14px;border:1px solid #E7E5E4;background:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;color:#1C1917;transition:all .15s}.a-ggl:hover{background:#F5F4F0}
.a-ob-inp{width:100%;padding:18px;border-radius:18px;border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#fff;font-size:20px;font-weight:700;text-align:center;outline:none;font-family:inherit}.a-ob-g3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.a-ob-g2{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.a-ob-ch{padding:16px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:8px;transition:all .15s}.a-ob-ch.on{background:#E8590C;color:#fff;border-color:transparent;transform:scale(1.02)}.a-ob-back{flex:1;padding:16px;border-radius:16px;border:none;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}.a-ob-next{flex:2;padding:16px;border-radius:16px;border:none;background:#E8590C;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}.a-ob-next:hover{transform:translateY(-1px)}.a-ob-next:disabled{opacity:.3}
.a-shell{display:flex;min-height:100vh}.a-main{flex:1;margin-left:220px;min-height:100vh;overflow-y:auto}
.a-side{width:220px;background:#fff;border-right:1px solid #F0EDE8;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50}.a-side-brand{padding:24px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #F0EDE8}.a-side-nav{flex:1;padding:12px 8px;display:flex;flex-direction:column;gap:2px}.a-side-user{padding:16px;border-top:1px solid #F0EDE8;display:flex;align-items:center;gap:10px}.a-side-av{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,#E8590C,#EC4899);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0}
.a-bot{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,.97);backdrop-filter:blur(20px);border-top:1px solid #F0EDE8;padding:8px 4px calc(env(safe-area-inset-bottom,8px) + 4px);z-index:50;justify-content:space-around}
.a-page{padding:24px 28px 120px;max-width:1200px;animation:alfFadeIn .3s}.a-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px}.a-greet{font-size:14px;font-weight:500;color:#A8A29E}.a-title{font-size:28px;font-weight:900;margin-top:2px;letter-spacing:-.02em}.a-badge{padding:6px 14px;border-radius:12px;background:#F5F4F0;font-size:13px;font-weight:600;color:#57534E}
.a-section-title{font-size:12px;font-weight:800;color:#A8A29E;letter-spacing:.08em;margin-bottom:12px}
.a-card{background:#fff;border:1px solid #F0EDE8;border-radius:20px;padding:24px;margin-bottom:16px}
.a-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.a-stat{padding:16px;border-radius:18px;background:#F5F4F0;text-align:center}.a-stat-v{font-size:22px;font-weight:900;margin:4px 0 0}.a-stat-l{font-size:10px;color:#A8A29E;font-weight:600}
.a-label{font-size:13px;font-weight:700;color:#57534E;display:block;margin-bottom:6px}
.a-pill{padding:8px 14px;border-radius:10px;border:1px solid #E7E5E4;background:#fff;color:#57534E;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s}.a-pill.on{border-color:#E8590C;background:#FFF7ED;color:#E8590C;border-width:2px}
.a-pill-n{padding:10px 18px;border-radius:12px;border:1px solid #E7E5E4;background:#fff;color:#57534E;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}.a-pill-n.on{border:2px solid #E8590C;background:#E8590C;color:#fff}
.a-chat{display:flex;flex-direction:column;height:100vh;animation:alfFadeIn .3s}.a-chat-hdr{padding:16px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #F0EDE8;background:#fff}.a-chat-av{width:40px;height:40px;border-radius:14px;background:linear-gradient(135deg,#E8590C,#EC4899);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}.a-chat-body{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px}
.a-msg{display:flex;max-width:720px}.a-msg.u{justify-content:flex-end;align-self:flex-end;margin-left:auto}.a-msg-av{width:32px;height:32px;border-radius:12px;background:linear-gradient(135deg,#E8590C,#EC4899);display:flex;align-items:center;justify-content:center;font-size:16px;margin-right:8px;margin-top:4px;flex-shrink:0}
.a-bub{padding:14px 18px;border-radius:18px;font-size:15px;line-height:1.6;white-space:pre-wrap;max-width:600px}.a-bub.u{background:linear-gradient(135deg,#1C1917,#292524);color:#fff;border-bottom-right-radius:4px}.a-bub.b{background:#fff;color:#1C1917;border:1px solid #F0EDE8;border-bottom-left-radius:4px}
.a-typing{display:flex;gap:5px;padding:10px 14px}.a-typing span{width:8px;height:8px;border-radius:50%;background:#E8590C;animation:alfPulse 1s infinite}.a-typing span:nth-child(2){animation-delay:.2s}.a-typing span:nth-child(3){animation-delay:.4s}
.a-chips{padding:0 24px 12px;display:flex;gap:8px;flex-wrap:wrap}.a-chip{padding:10px 16px;border-radius:20px;background:#F5F4F0;border:1px solid #E7E5E4;font-size:14px;font-weight:600;color:#57534E;cursor:pointer;font-family:inherit;transition:all .15s}.a-chip:hover{background:#E7E5E4;transform:translateY(-1px)}
.a-speak-btn{padding:4px 10px;border-radius:10px;border:1px solid #E7E5E4;background:#fff;font-size:15px;cursor:pointer;line-height:1;transition:all .15s}.a-speak-btn:hover{background:#FFF7ED;border-color:#FDBA74}
.a-chat-bar{padding:14px 24px 24px;display:flex;gap:8px;align-items:flex-end;background:#fff;border-top:1px solid #F0EDE8}.a-chat-inp{flex:1;padding:14px 18px;border-radius:16px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:15px;outline:none;font-family:inherit;color:#1C1917;overflow-y:auto;scrollbar-width:thin}.a-chat-inp:focus{border-color:#E8590C;box-shadow:0 0 0 3px rgba(232,89,12,.08)}.a-chat-go{width:48px;height:48px;border-radius:14px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;background:linear-gradient(135deg,#E8590C,#DC2626);color:#fff;font-size:20px;font-weight:900;transition:all .15s}.a-chat-go:hover{transform:scale(1.05)}.a-chat-go:disabled{background:#F5F4F0;color:#A8A29E;transform:none}
.a-notes-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.a-note-card{background:#fff;border:1px solid #F0EDE8;border-radius:16px;padding:16px;transition:all .15s}.a-note-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
.a-note-body{font-size:13px;color:#57534E;line-height:1.6;white-space:pre-wrap}
.a-note-act{background:none;border:none;font-size:14px;cursor:pointer;padding:2px;opacity:.5}.a-note-act:hover{opacity:1}
.a-pr{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;transition:background .15s}.a-pr:hover{background:#FAFAF8}.a-pr-l{font-size:14px;font-weight:600}.a-pr-v{font-size:14px;color:#78766F;flex:1;text-align:right;margin-right:8px}.a-ed{padding:12px 20px 16px;border-top:1px solid #F5F4F0;background:#FAFAF8}.a-ed-inp{width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #E7E5E4;font-size:14px;outline:none;font-family:inherit;color:#1C1917;margin-bottom:8px;min-height:44px}.a-ed-inp:focus{border-color:#E8590C}
@media(max-width:900px){.a-side{display:none!important}.a-main{margin-left:0!important}.a-bot{display:flex!important}.a-page{padding:20px 16px 100px}.a-title{font-size:24px}.a-auth{flex-direction:column}.a-auth-l{padding:40px 24px;min-height:auto}.a-auth-l h1{font-size:28px!important}.a-auth-r{padding:24px}.a-chat{height:calc(100vh - 70px)}.a-chat-bar{padding:12px 16px 20px}.a-notes-grid{grid-template-columns:1fr}}
@media(min-width:901px){.a-bot{display:none!important}}
`}</style>}
