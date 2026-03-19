'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
const sb = createClient(SB, SK)
const SITE = typeof window!=='undefined'?window.location.origin+'/app':'https://alfanumrik-learning-os.vercel.app/app'
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

type Screen='loading'|'auth'|'confirm'|'reset'|'register'|'onboard'|'onboard_pricing'|'credentials'|'home'|'foxy'|'quiz'|'notes'|'progress'|'skills'|'profile'|'plan'|'pricing'
type Prof={name:string;grade:string;subject:string;language:string;studentId?:string}
type Stats={xp:number;streak:number;sessions:number;correct:number;asked:number;minutes:number}
type Note={id:string;title:string;content:string;note_type:string;color:string;chapter_number?:number;chapter_title?:string;is_pinned:boolean;is_starred:boolean;word_count:number;updated_at:string}
const GRADES=['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const SUBJ=[{id:'Mathematics',icon:'\u2211',c:'#E8590C'},{id:'Science',icon:'\u269B',c:'#0EA5E9'},{id:'English',icon:'Aa',c:'#8B5CF6'},{id:'Hindi',icon:'\u0905',c:'#F59E0B'},{id:'Social Studies',icon:'\uD83C\uDF0D',c:'#10B981'},{id:'Physics',icon:'\u26A1',c:'#3B82F6'},{id:'Chemistry',icon:'\uD83E\uDDEA',c:'#EF4444'},{id:'Biology',icon:'\uD83E\uDDEC',c:'#22C55E'},{id:'Computer Science',icon:'\uD83D\uDCBB',c:'#14B8A6'},{id:'Accountancy',icon:'\uD83D\uDCCA',c:'#8B5CF6'},{id:'Economics',icon:'\uD83D\uDCC8',c:'#F59E0B'}]
const LANGS=[{code:'en',label:'English'},{code:'hi',label:'हिन्दी (Hindi)'},{code:'hinglish',label:'Hinglish'}]
const NC=['#E8590C','#3B82F6','#8B5CF6','#F59E0B','#10B981','#EF4444','#14B8A6','#EC4899']
const SM:Record<string,string>={Mathematics:'math',Science:'science',English:'english',Hindi:'hindi','Social Studies':'social_studies',Physics:'physics',Chemistry:'chemistry',Biology:'biology','Computer Science':'computer_science'}
async function api(fn:string,body:any,retries=2):Promise<any>{for(let i=0;i<=retries;i++){try{const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),30000);const r=await fetch(`${EF}/${fn}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});clearTimeout(timer);if(r.ok)return await r.json();if(r.status>=500&&i<retries){await new Promise(r=>setTimeout(r,1000*(i+1)));continue}return await r.json().catch(()=>({error:`HTTP ${r.status}`}))}catch(e:any){if(i<retries&&e.name!=='AbortError'){await new Promise(r=>setTimeout(r,1000*(i+1)));continue}return{error:e.name==='AbortError'?'Request timeout':'Network error'}}}return{error:'Failed after retries'}}
async function ensureStudent(uid:string,p:Prof):Promise<string|null>{
  // Attempt 1: Direct lookup (works if user has active session)
  try{const{data:ex}=await sb.from('students').select('id').eq('auth_user_id',uid).eq('is_active',true).maybeSingle();
  if(ex?.id){await sb.from('students').update({name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject,onboarding_completed:true}).eq('id',ex.id).catch(()=>{});return ex.id}}catch(e){console.warn('ensureStudent lookup:',e)}
  // Attempt 2: Create new (works if user has active session matching RLS)
  try{const{data:cr,error}=await sb.from('students').insert({auth_user_id:uid,name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject,onboarding_completed:true,is_active:true}).select('id').single();
  if(cr?.id)return cr.id;if(error)console.warn('ensureStudent insert:',error.message)}catch(e){console.warn('ensureStudent create:',e)}
  // Attempt 3: Race condition — another insert happened, re-lookup
  try{const{data:retry}=await sb.from('students').select('id').eq('auth_user_id',uid).eq('is_active',true).maybeSingle();if(retry?.id)return retry.id}catch{}
  // Attempt 4: Use edge function (bypasses RLS — works for unconfirmed email users)
  try{
    const r=await api('foxy-tutor',{action:'ensure_student',auth_user_id:uid,name:p.name,grade:p.grade,subject:p.subject,language:p.language});
    if(r?.student_id)return r.student_id;
  }catch(e){console.warn('ensureStudent API:',e)}
  console.error('CRITICAL: Could not ensure student for auth_user_id:',uid);return null
}
const RS:Record<string,string>={math:'Mathematics',science:'Science',english:'English',hindi:'Hindi',social_studies:'Social Studies',physics:'Physics',chemistry:'Chemistry',biology:'Biology',computer_science:'Computer Science'}
async function loadProfileFromDB(uid:string):Promise<Prof|null>{try{const{data}=await sb.from('students').select('id,name,grade,preferred_language,preferred_subject,onboarding_completed').eq('auth_user_id',uid).eq('is_active',true).maybeSingle();if(!data||!data.onboarding_completed)return null;const sub=RS[data.preferred_subject]||data.preferred_subject||'Mathematics';return{name:data.name||'Student',grade:data.grade||'Grade 6',subject:sub,language:data.preferred_language||'en',studentId:data.id}}catch{return null}}
async function getStats(sid:string):Promise<Stats>{const z:Stats={xp:0,streak:0,sessions:0,correct:0,asked:0,minutes:0};if(!sid)return z;try{const{data}=await sb.from('student_overall_stats').select('total_xp,streak_days,total_sessions,total_questions_asked,total_questions_answered_correctly,total_time_minutes').eq('student_id',sid).maybeSingle();if(!data)return z;return{xp:data.total_xp||0,streak:data.streak_days||0,sessions:data.total_sessions||0,correct:data.total_questions_answered_correctly||0,asked:data.total_questions_asked||0,minutes:data.total_time_minutes||0}}catch{return z}}
async function getTopicMastery(sid:string,sub:string){try{const{data}=await sb.from('topic_mastery').select('topic_tag,mastery_percent,mastery_level,total_attempts,correct_attempts').eq('student_id',sid).eq('subject',sub).order('mastery_percent',{ascending:false}).limit(20);return data||[]}catch{return[]}}
// AUTH — Login screen (for returning users)
function Auth({onAuth,onConfirm,onSignup}:{onAuth:(u:any)=>void;onConfirm:()=>void;onSignup:()=>void}){const[mode,setMode]=useState<'login'|'forgot'>('login');const[email,setEmail]=useState('');const[pw,setPw]=useState('');const[ld,setLd]=useState(false);const[err,setErr]=useState('');const[msg,setMsg]=useState('');const go=async()=>{setErr('');setMsg('');setLd(true);try{if(mode==='forgot'){const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:`${SITE}?reset=true`});if(error)throw error;setMsg('Reset link sent!');setLd(false);return}if(pw.length<6)throw new Error('6+ chars');const{data,error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw error;snd('ok');onAuth(data.user)}catch(e:any){snd('click');setErr(e.message?.includes('Invalid')?'Wrong email or password':e.message||'Error')};setLd(false)};return(<div className="a-auth"><div className="a-auth-l"><div style={{fontSize:56}}>&#x1F98A;</div><h1 style={{fontSize:42,fontWeight:900,marginTop:16}}>Alfanumrik</h1><p style={{fontSize:16,color:'rgba(255,255,255,.5)',marginTop:8}}>AI-powered adaptive learning by CusioSense Learning India Private Limited</p><div style={{marginTop:32}}><CertBadges size="sm" theme="dark"/></div></div><div className="a-auth-r"><div style={{width:'100%',maxWidth:400}}><h2 style={{fontSize:28,fontWeight:800,marginBottom:24,textAlign:'center'}}>{mode==='forgot'?'Reset password':'Welcome back'}</h2>{err&&<div className="a-err">{err}</div>}{msg&&<div className="a-ok-msg">{msg}</div>}<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" className="a-inp"/>{mode!=='forgot'&&<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="a-inp" onKeyDown={e=>e.key==='Enter'&&go()}/>}<button onClick={go} disabled={ld} className="a-btn-primary" style={{width:'100%',minHeight:52}}>{ld?'Please wait...':{login:'Log In',forgot:'Send Reset Link'}[mode]}</button>{mode==='login'&&<button onClick={()=>setMode('forgot')} className="a-link">Forgot password?</button>}{mode==='forgot'&&<button onClick={()=>setMode('login')} className="a-link">Back to login</button>}{mode!=='forgot'&&<><div className="a-divider"><span>new here?</span></div><button onClick={onSignup} className="a-ggl" style={{minHeight:48,borderColor:'#E8590C40',color:'#E8590C',fontWeight:800}}>&#x1F393; Register Your Child &rarr;</button></>}</div></div></div>)}
function ConfirmScreen({onBack}:{onBack:()=>void}){return(<div className="a-center-dark"><div style={{fontSize:64,marginBottom:16}}>&#x2709;&#xFE0F;</div><h2 style={{fontSize:24,fontWeight:800,color:'#fff',marginBottom:8}}>Check your email!</h2><p style={{fontSize:15,color:'rgba(255,255,255,.6)',marginBottom:24}}>Click the verification link to activate your account.</p><button onClick={onBack} className="a-btn-primary" style={{maxWidth:200,minHeight:48}}>Back to Login</button></div>)}
function ResetScreen(){const[pw,setPw]=useState('');const[pw2,setPw2]=useState('');const[ld,setLd]=useState(false);const[msg,setMsg]=useState('');const[err,setErr]=useState('');const go=async()=>{if(pw.length<6||pw!==pw2){setErr("Passwords don't match or too short");return}setLd(true);const{error}=await sb.auth.updateUser({password:pw});if(error)setErr(error.message);else{setMsg('Updated! Redirecting...');setTimeout(()=>window.location.href=SITE,2000)}setLd(false)};return(<div className="a-center-dark"><div style={{fontSize:48}}>&#x1F510;</div><h2 style={{fontSize:22,fontWeight:800,color:'#fff',margin:'12px 0 24px'}}>Set new password</h2>{err&&<div className="a-err">{err}</div>}{msg&&<div className="a-ok-msg">{msg}</div>}<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="New password" className="a-inp" style={{background:'rgba(255,255,255,.06)',color:'#fff',borderColor:'rgba(255,255,255,.1)'}}/><input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Confirm" className="a-inp" style={{background:'rgba(255,255,255,.06)',color:'#fff',borderColor:'rgba(255,255,255,.1)'}} onKeyDown={e=>e.key==='Enter'&&go()}/><button onClick={go} disabled={ld} className="a-btn-primary" style={{minHeight:48}}>{ld?'Updating...':'Update Password'}</button></div>)}
// ═══════════════════════════════════════════════════════
// CREDENTIALS CARD — shown after registration to share login details
// ═══════════════════════════════════════════════════════
function CredentialsCard({studentName,parentName,parentPhone,loginEmail,onContinue}:{studentName:string;parentName:string;parentPhone:string;loginEmail:string;onContinue:()=>void}){
const[copied,setCopied]=useState(false);
const[emailSent,setEmailSent]=useState(false);
const loginUrl='https://alfanumrik-learning-os.vercel.app/app';
const credText=`Alfanumrik Learning OS\n\nStudent: ${studentName}\nLogin URL: ${loginUrl}\nLogin Email: ${loginEmail}\nPassword: (the password you set during registration)\n\nDownload the app & start learning with Foxy AI Tutor!`;
const copy=()=>{navigator.clipboard.writeText(credText).then(()=>{setCopied(true);snd('ok');setTimeout(()=>setCopied(false),3000)}).catch(()=>{})};
const shareWhatsApp=()=>{const msg=encodeURIComponent(`*Alfanumrik Learning OS* \u{1F98A}\n\nHi! ${studentName}'s learning account is ready!\n\n\u{1F517} *Login:* ${loginUrl}\n\u{1F4E7} *Email:* ${loginEmail}\n\u{1F511} *Password:* (set during registration)\n\nStart learning with Foxy AI Tutor! \u{1F680}`);window.open(`https://wa.me/${parentPhone.length===10?'91':''}${parentPhone}?text=${msg}`,'_blank')};
const sendWelcomeEmail=async()=>{try{const r=await fetch(`${EF}/welcome-email`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${(await sb.auth.getSession()).data.session?.access_token}`},body:JSON.stringify({student_name:studentName,parent_name:parentName,parent_email:loginEmail,login_url:loginUrl})});if(r.ok){setEmailSent(true);snd('ok')}else{snd('click')}}catch(e){console.error('Email send failed:',e)}};
useEffect(()=>{sendWelcomeEmail()},[]);
return(<div className="a-center-dark" style={{padding:'32px 24px',minHeight:'100vh'}}>
<div style={{maxWidth:440,width:'100%',textAlign:'center'}}>
<div style={{fontSize:64,marginBottom:8,animation:'alfBounce 2s infinite'}}>{'\u{1F389}'}</div>
<h2 style={{fontSize:26,fontWeight:900,color:'#fff',marginBottom:6}}>Account Created!</h2>
<p style={{fontSize:14,color:'rgba(255,255,255,.5)',marginBottom:24}}>Save these login details for {studentName}</p>
<div style={{background:'rgba(255,255,255,.06)',borderRadius:20,padding:24,marginBottom:20,border:'1px solid rgba(255,255,255,.08)'}}>
<div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
<div style={{width:48,height:48,borderRadius:'50%',background:'linear-gradient(135deg,#E8590C,#EC4899)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0}}>{studentName.charAt(0).toUpperCase()}</div>
<div style={{textAlign:'left'}}>
<p style={{fontSize:16,fontWeight:800,color:'#fff'}}>{studentName}</p>
<p style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>Student Account</p>
</div>
</div>
<div style={{background:'rgba(0,0,0,.2)',borderRadius:12,padding:16,textAlign:'left'}}>
<div style={{marginBottom:12}}>
<p style={{fontSize:10,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.1em',marginBottom:4}}>LOGIN URL</p>
<p style={{fontSize:13,color:'#E8590C',fontWeight:600,wordBreak:'break-all'}}>{loginUrl}</p>
</div>
<div style={{marginBottom:12}}>
<p style={{fontSize:10,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.1em',marginBottom:4}}>EMAIL</p>
<p style={{fontSize:15,color:'#fff',fontWeight:700}}>{loginEmail}</p>
</div>
<div>
<p style={{fontSize:10,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.1em',marginBottom:4}}>PASSWORD</p>
<p style={{fontSize:13,color:'rgba(255,255,255,.5)'}}>The password you set during registration</p>
</div>
</div>
</div>
{emailSent&&<p style={{fontSize:12,color:'#22C55E',marginBottom:12,fontWeight:600}}>{'\u2705'} Welcome email sent to {loginEmail}</p>}
<div style={{display:'flex',gap:10,marginBottom:16}}>
<button onClick={copy} style={{flex:1,padding:'14px 16px',borderRadius:14,border:'1px solid rgba(255,255,255,.1)',background:copied?'rgba(34,197,94,.15)':'rgba(255,255,255,.06)',color:copied?'#22C55E':'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',transition:'all .2s'}}>{copied?'\u2705 Copied!':'\u{1F4CB} Copy Details'}</button>
<button onClick={shareWhatsApp} style={{flex:1,padding:'14px 16px',borderRadius:14,border:'none',background:'#25D366',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.624-1.467A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-2.168 0-4.183-.69-5.83-1.862l-.418-.311-2.73.867.866-2.655-.342-.433A9.775 9.775 0 012.182 12c0-5.423 4.395-9.818 9.818-9.818 5.423 0 9.818 4.395 9.818 9.818 0 5.423-4.395 9.818-9.818 9.818z"/></svg>WhatsApp</button>
</div>
<button onClick={()=>{snd('click');onContinue()}} className="a-btn-primary" style={{width:'100%',minHeight:52,fontSize:16}}>{'\u{1F680}'} Continue to Choose Plan</button>
<p style={{fontSize:11,color:'rgba(255,255,255,.25)',marginTop:16,lineHeight:1.5}}>You can always use &ldquo;Forgot Password&rdquo; on the login screen to reset your password via email.</p>
</div>
</div>)}
const BOARDS=['CBSE','ICSE','State Board','IB','Other']
const TARGETS=['Board Exams','JEE','NEET','Olympiad','None']
const STATES=['Delhi','Maharashtra','Karnataka','Tamil Nadu','Uttar Pradesh','Rajasthan','Gujarat','West Bengal','Telangana','Kerala','Madhya Pradesh','Bihar','Haryana','Punjab','Andhra Pradesh','Other']
// ═══════════════════════════════════════════════════════
// REGISTRATION — Parent fills combined form (Parent KYC + Student details) → Account creation
// ═══════════════════════════════════════════════════════
function Registration({onComplete,onBack}:{onComplete:(u:any,p:Prof,reg:{studentName:string;parentName:string;parentPhone:string;loginEmail:string})=>void;onBack:()=>void}){
const[s,setS]=useState(0);
// Parent KYC
const[parentName,setParentName]=useState('');const[parentPhone,setParentPhone]=useState('');const[parentEmail,setParentEmail]=useState('');const[parentRelation,setParentRelation]=useState('');const[parentCity,setParentCity]=useState('');const[parentState,setParentState]=useState('');
// Student details
const[studentName,setStudentName]=useState('');const[studentDob,setStudentDob]=useState('');const[gr,setGr]=useState('');const[su,setSu]=useState('');const[school,setSchool]=useState('');const[board,setBoard]=useState('CBSE');const[target,setTarget]=useState('');const[la,setLa]=useState('en');
// Account creation
const[pw,setPw]=useState('');const[pw2,setPw2]=useState('');const[referral,setReferral]=useState('');
const[ld,setLd]=useState(false);const[err,setErr]=useState('');
const RELATIONS=['Father','Mother','Guardian','Other'];
const steps=[
  {title:'Parent / Guardian Details',sub:'We need your details for your child\'s account security and progress reports',icon:'\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67'},
  {title:'Student Details',sub:'Tell us about your child so Foxy can personalise their learning',icon:'\uD83C\uDF93'},
  {title:'Academic Preferences',sub:'Help us tailor the right curriculum for your child',icon:'\uD83D\uDCDA'},
  {title:'School & Board',sub:'We align content with your child\'s education board',icon:'\uD83C\uDFEB'},
  {title:'Learning Language',sub:'Foxy can teach in your child\'s preferred language',icon:'\uD83C\uDF0D'},
  {title:'Create Account',sub:'Secure your child\'s learning journey with a password',icon:'\uD83D\uDD10'}
];
const ok=[
  !!parentName.trim()&&!!parentPhone.trim()&&parentPhone.length>=10&&!!parentEmail.trim()&&parentEmail.includes('@')&&!!parentRelation,
  !!studentName.trim()&&!!gr,
  !!su,
  !!board,
  true,
  pw.length>=6&&pw===pw2
][s];
const nx=()=>{setErr('');snd('click');setS(v=>v+1)};
const createAccount=async()=>{setErr('');setLd(true);try{
  const{data,error}=await sb.auth.signUp({email:parentEmail.trim(),password:pw,options:{data:{full_name:parentName.trim(),parent_name:parentName.trim(),student_name:studentName.trim(),relation:parentRelation},emailRedirectTo:SITE}});
  if(error)throw error;
  if(!data.user)throw new Error('Account creation failed. Please try again.');
  // Save all registration data to student record
  const prof:Prof={name:studentName.trim(),grade:gr,subject:su,language:la};
  const sid=await ensureStudent(data.user.id,prof);
  if(sid){
    await sb.from('students').update({
      parent_name:parentName.trim(),parent_phone:parentPhone.trim(),
      phone:parentPhone.trim(),email:parentEmail.trim(),
      school_name:school||null,city:parentCity||null,state:parentState||null,
      board:board||'CBSE',target_exam:target||null,referral_code:referral||null,
      date_of_birth:studentDob||null,
      father_name:parentRelation==='Father'?parentName.trim():null,
      mother_name:parentRelation==='Mother'?parentName.trim():null
    }).eq('id',sid);
    prof.studentId=sid;
  }
  snd('eureka');onComplete(data.user,prof,{studentName:studentName.trim(),parentName:parentName.trim(),parentPhone:parentPhone.trim(),loginEmail:parentEmail.trim()});
}catch(e:any){setErr(e.message||'Something went wrong');setLd(false)}};
return(<div className="a-center-dark" style={{maxWidth:'100%',padding:'32px 24px',minHeight:'100vh',justifyContent:'flex-start',paddingTop:50,alignItems:'center'}}>
<div style={{maxWidth:480,width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
<button onClick={onBack} style={{position:'fixed',top:16,left:16,padding:'8px 16px',borderRadius:10,background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.5)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',zIndex:50}}>{'\u2190'} Back</button>
{/* Progress bar */}
<div style={{display:'flex',gap:4,justifyContent:'center',marginBottom:24,width:'100%'}}>
{steps.map((_,i)=><div key={i} style={{height:6,borderRadius:3,flex:1,background:i<=s?'linear-gradient(135deg,#E8590C,#EC4899)':'rgba(255,255,255,.08)',transition:'all .3s',maxWidth:60}}/>)}
</div>
<div style={{fontSize:44,marginBottom:8,animation:'alfBounce 2s infinite'}}>{steps[s].icon}</div>
<p style={{fontSize:11,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.1em',marginBottom:4}}>STEP {s+1} OF {steps.length}</p>
<h2 style={{fontSize:22,fontWeight:800,color:'#fff',marginBottom:6,textAlign:'center'}}>{steps[s].title}</h2>
<p style={{fontSize:13,color:'rgba(255,255,255,.4)',marginBottom:24,textAlign:'center',lineHeight:1.5,maxWidth:360}}>{steps[s].sub}</p>
{err&&<div className="a-err" style={{marginBottom:16,width:'100%'}}>{err}</div>}
<div key={s} style={{animation:'alfSlideUp .3s',width:'100%'}}>
{/* STEP 0: Parent KYC */}
{s===0&&<>
<p style={{fontSize:11,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginBottom:10}}>YOUR RELATIONSHIP TO THE STUDENT</p>
<div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>{RELATIONS.map(r=><button key={r} onClick={()=>{setParentRelation(r);snd('click')}} className={`a-ob-ch${parentRelation===r?' on':''}`} style={{minHeight:40,padding:'8px 16px',fontSize:13,flex:'1 1 auto'}}>{r}</button>)}</div>
<input value={parentName} onChange={e=>setParentName(e.target.value)} placeholder="Your full name *" autoFocus className="a-ob-inp" style={{fontSize:16,textAlign:'left',padding:'14px 18px'}}/>
<input value={parentPhone} onChange={e=>setParentPhone(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="Your mobile number *" className="a-ob-inp" style={{marginTop:10,fontSize:16,textAlign:'left',padding:'14px 18px'}} inputMode="numeric"/>
<input type="email" value={parentEmail} onChange={e=>setParentEmail(e.target.value)} placeholder="Your email address *" className="a-ob-inp" style={{marginTop:10,fontSize:16,textAlign:'left',padding:'14px 18px'}}/>
<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
<input value={parentCity} onChange={e=>setParentCity(e.target.value)} placeholder="City" className="a-ob-inp" style={{fontSize:14,textAlign:'left',padding:'12px 14px'}}/>
<select value={parentState} onChange={e=>{setParentState(e.target.value);snd('click')}} className="a-ob-inp" style={{appearance:'auto',fontSize:14,textAlign:'left',padding:'12px 14px'}}><option value="">State</option>{STATES.map(st=><option key={st} value={st}>{st}</option>)}</select>
</div>
<p style={{fontSize:11,color:'rgba(255,255,255,.25)',marginTop:10,lineHeight:1.5}}>* Required fields. Your email will be used for account login and progress reports.</p>
</>}
{/* STEP 1: Student Details */}
{s===1&&<>
<input value={studentName} onChange={e=>setStudentName(e.target.value)} placeholder="Student's full name *" autoFocus className="a-ob-inp" style={{fontSize:16,textAlign:'left',padding:'14px 18px'}}/>
<input type="date" value={studentDob} onChange={e=>setStudentDob(e.target.value)} className="a-ob-inp" style={{marginTop:10,fontSize:14,textAlign:'left',padding:'14px 18px',color:studentDob?'#fff':'rgba(255,255,255,.4)'}}/>
<p style={{fontSize:11,color:'rgba(255,255,255,.3)',marginTop:4,marginBottom:16}}>Date of birth (optional)</p>
<p style={{fontSize:12,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginBottom:10}}>STUDENT&apos;S GRADE *</p>
<div className="a-ob-g3">{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);snd('click')}} className={`a-ob-ch${gr===g?' on':''}`} style={{minHeight:44}}>{g}</button>)}</div>
</>}
{/* STEP 2: Subject */}
{s===2&&<div className="a-ob-g2">{SUBJ.filter(x=>{const g=parseInt(gr.replace(/\D/g,'')||'6');return g>=11?['Mathematics','Physics','Chemistry','Biology','English','Computer Science','Accountancy','Economics'].includes(x.id):['Mathematics','Science','English','Hindi','Social Studies'].includes(x.id)}).map(x=><button key={x.id} onClick={()=>{setSu(x.id);snd('click')}} className={`a-ob-ch${su===x.id?' on':''}`} style={{minHeight:52,...(su===x.id?{background:x.c}:{})}}><span style={{fontSize:18}}>{x.icon}</span>{x.id}</button>)}</div>}
{/* STEP 3: School & Board */}
{s===3&&<>
<input value={school} onChange={e=>setSchool(e.target.value)} placeholder="School name (optional)" className="a-ob-inp" style={{fontSize:14,textAlign:'left',padding:'14px 18px'}}/>
<p style={{fontSize:12,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginTop:16,marginBottom:10}}>EDUCATION BOARD *</p>
<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{BOARDS.map(b=><button key={b} onClick={()=>{setBoard(b);snd('click')}} className={`a-ob-ch${board===b?' on':''}`} style={{minHeight:40,padding:'8px 16px',fontSize:13}}>{b}</button>)}</div>
<p style={{fontSize:12,color:'rgba(255,255,255,.4)',marginTop:16,marginBottom:8}}>Target Exam (optional)</p>
<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{TARGETS.map(t=><button key={t} onClick={()=>{setTarget(t);snd('click')}} className={`a-ob-ch${target===t?' on':''}`} style={{minHeight:36,padding:'6px 14px',fontSize:12}}>{t}</button>)}</div>
</>}
{/* STEP 4: Language */}
{s===4&&<div className="a-ob-g2">{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);snd('click')}} className={`a-ob-ch${la===l.code?' on':''}`} style={{minHeight:52,fontSize:16}}>{l.label}</button>)}</div>}
{/* STEP 5: Account creation */}
{s===5&&<>
<div style={{padding:16,borderRadius:16,background:'rgba(255,255,255,.06)',marginBottom:20,textAlign:'center'}}>
<p style={{fontSize:11,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.05em',marginBottom:6}}>REGISTERING</p>
<p style={{fontSize:20,fontWeight:900,color:'#E8590C'}}>{studentName||'Student'}</p>
<p style={{fontSize:13,color:'rgba(255,255,255,.5)'}}>{gr} &middot; {su} &middot; {board}</p>
<p style={{fontSize:12,color:'rgba(255,255,255,.35)',marginTop:4}}>Parent: {parentName} ({parentRelation})</p>
</div>
<p style={{fontSize:12,color:'rgba(255,255,255,.4)',marginBottom:8}}>Login email: <strong style={{color:'#fff'}}>{parentEmail}</strong></p>
<input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Create password (6+ characters)" className="a-ob-inp" style={{fontSize:14,textAlign:'left',padding:'14px 18px'}}/>
<input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Confirm password" className="a-ob-inp" style={{marginTop:10,fontSize:14,textAlign:'left',padding:'14px 18px'}} onKeyDown={e=>e.key==='Enter'&&ok&&createAccount()}/>
{pw.length>0&&pw.length<6&&<p style={{fontSize:11,color:'#F59E0B',marginTop:6}}>Password must be at least 6 characters</p>}
{pw2.length>0&&pw!==pw2&&<p style={{fontSize:11,color:'#EF4444',marginTop:6}}>Passwords don&apos;t match</p>}
<input value={referral} onChange={e=>setReferral(e.target.value.toUpperCase())} placeholder="Referral code (optional)" className="a-ob-inp" style={{marginTop:12,fontSize:13,textAlign:'center',letterSpacing:'.15em',padding:'10px 14px'}}/>
</>}
</div>
<div style={{display:'flex',gap:10,marginTop:24,width:'100%'}}>
{s>0&&<button onClick={()=>{setErr('');setS(v=>v-1)}} className="a-ob-back" style={{minHeight:48}}>Back</button>}
<button onClick={s<5?nx:createAccount} disabled={!ok||ld} className="a-ob-next" style={{minHeight:48}}>{ld?'Creating Account...':s<5?'Continue':'\uD83D\uDE80 Create Account & Start Learning!'}</button>
</div>
<p style={{fontSize:10,color:'rgba(255,255,255,.2)',marginTop:16,textAlign:'center',lineHeight:1.5}}>By creating an account, you agree to Alfanumrik&apos;s Terms of Service and Privacy Policy. &copy; 2026 CusioSense Learning India Pvt. Ltd.</p>
<div style={{marginTop:12}}><CertStamp theme="dark"/></div>
</div></div>)}
// ONBOARDING — for Google OAuth users who already have auth but no profile
function Onboard({user,done}:{user:any;done:(p:Prof)=>void}){
const[s,setS]=useState(0);const[nm,setNm]=useState(user?.user_metadata?.full_name||'');const[gr,setGr]=useState('');const[su,setSu]=useState('');const[la,setLa]=useState('en');
const[phone,setPhone]=useState('');const[parentName,setParentName]=useState('');const[parentPhone,setParentPhone]=useState('');const[parentRelation,setParentRelation]=useState('');const[school,setSchool]=useState('');const[city,setCity]=useState('');const[state,setState]=useState('');const[board,setBoard]=useState('CBSE');const[target,setTarget]=useState('');const[referral,setReferral]=useState('');
const RELATIONS=['Father','Mother','Guardian','Other'];
const steps=['Parent / Guardian Details','Student\'s Name & Grade','Pick main subject','School & Board','Choose language','Welcome to Alfanumrik!']
const ok=[!!parentName.trim()&&!!parentPhone.trim()&&parentPhone.length>=10&&!!parentRelation,!!nm.trim()&&!!gr,!!su,!!board,true,true][s]
const nx=()=>{snd('click');setS(v=>v+1)}
const saveToDB=async()=>{if(!user?.id)return;try{const{data:st}=await sb.from('students').select('id').eq('auth_user_id',user.id).maybeSingle();if(st){await sb.from('students').update({phone:phone||null,parent_name:parentName||null,parent_phone:parentPhone||null,school_name:school||null,city:city||null,state:state||null,board:board||'CBSE',target_exam:target||null,referral_code:referral||null,father_name:parentRelation==='Father'?parentName:null,mother_name:parentRelation==='Mother'?parentName:null}).eq('id',st.id)}}catch(e){console.error('Save extra:',e)}}
return(<div className="a-center-dark" style={{maxWidth:520,padding:'32px 24px',minHeight:'100vh',justifyContent:'flex-start',paddingTop:50}}>
<div style={{display:'flex',gap:4,justifyContent:'center',marginBottom:24,width:'100%'}}>{steps.map((_,i)=><div key={i} style={{height:6,borderRadius:3,flex:1,background:i<=s?'linear-gradient(135deg,#E8590C,#EC4899)':'rgba(255,255,255,.08)',transition:'all .3s',maxWidth:60}}/>)}</div>
<div style={{fontSize:48,marginBottom:12,animation:'alfBounce 2s infinite'}}>{'\uD83E\uDD8A'}</div>
<p style={{fontSize:11,color:'rgba(255,255,255,.3)',fontWeight:700,letterSpacing:'.1em',marginBottom:6}}>STEP {s+1} OF {steps.length}</p>
<h2 style={{fontSize:22,fontWeight:800,color:'#fff',marginBottom:24}}>{steps[s]}</h2>
<div key={s} style={{animation:'alfSlideUp .3s',width:'100%'}}>
{s===0&&<>
<p style={{fontSize:11,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginBottom:10}}>YOUR RELATIONSHIP TO THE STUDENT</p>
<div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>{RELATIONS.map(r=><button key={r} onClick={()=>{setParentRelation(r);snd('click')}} className={`a-ob-ch${parentRelation===r?' on':''}`} style={{minHeight:40,padding:'8px 16px',fontSize:13,flex:'1 1 auto'}}>{r}</button>)}</div>
<input value={parentName} onChange={e=>setParentName(e.target.value)} placeholder="Your full name (Parent/Guardian) *" autoFocus className="a-ob-inp" style={{fontSize:16,textAlign:'left',padding:'14px 18px'}}/>
<input value={parentPhone} onChange={e=>setParentPhone(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="Your mobile number *" className="a-ob-inp" style={{marginTop:10,fontSize:16,textAlign:'left',padding:'14px 18px'}} inputMode="numeric"/>
<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
<input value={city} onChange={e=>setCity(e.target.value)} placeholder="City" className="a-ob-inp" style={{fontSize:14,textAlign:'left',padding:'12px 14px'}}/>
<select value={state} onChange={e=>{setState(e.target.value);snd('click')}} className="a-ob-inp" style={{appearance:'auto',fontSize:14,textAlign:'left',padding:'12px 14px'}}><option value="">State</option>{STATES.map(st=><option key={st} value={st}>{st}</option>)}</select>
</div>
</>}
{s===1&&<><input value={nm} onChange={e=>setNm(e.target.value)} placeholder="Student's full name *" autoFocus className="a-ob-inp" style={{fontSize:16,textAlign:'left',padding:'14px 18px'}} onKeyDown={e=>e.key==='Enter'&&nm.trim()&&gr&&nx()}/>
<p style={{fontSize:12,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginTop:16,marginBottom:10}}>STUDENT&apos;S GRADE *</p>
<div className="a-ob-g3">{GRADES.map(g=><button key={g} onClick={()=>{setGr(g);snd('click')}} className={`a-ob-ch${gr===g?' on':''}`} style={{minHeight:44}}>{g}</button>)}</div></>}
{s===2&&<div className="a-ob-g2">{SUBJ.filter(x=>{const g=parseInt(gr.replace(/\D/g,'')||'6');return g>=11?['Mathematics','Physics','Chemistry','Biology','English','Computer Science','Accountancy','Economics'].includes(x.id):['Mathematics','Science','English','Hindi','Social Studies'].includes(x.id)}).map(x=><button key={x.id} onClick={()=>{setSu(x.id);snd('click')}} className={`a-ob-ch${su===x.id?' on':''}`} style={{minHeight:52,...(su===x.id?{background:x.c}:{})}}><span style={{fontSize:18}}>{x.icon}</span>{x.id}</button>)}</div>}
{s===3&&<><input value={school} onChange={e=>setSchool(e.target.value)} placeholder="School name (optional)" className="a-ob-inp" style={{fontSize:14,textAlign:'left',padding:'14px 18px'}}/><p style={{fontSize:12,color:'#E8590C',fontWeight:700,letterSpacing:'.05em',marginTop:16,marginBottom:10}}>EDUCATION BOARD *</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{BOARDS.map(b=><button key={b} onClick={()=>{setBoard(b);snd('click')}} className={`a-ob-ch${board===b?' on':''}`} style={{minHeight:40,padding:'8px 16px',fontSize:13}}>{b}</button>)}</div><p style={{fontSize:12,color:'rgba(255,255,255,.4)',marginTop:16,marginBottom:8}}>Target Exam (optional)</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{TARGETS.map(t=><button key={t} onClick={()=>{setTarget(t);snd('click')}} className={`a-ob-ch${target===t?' on':''}`} style={{minHeight:36,padding:'6px 14px',fontSize:12}}>{t}</button>)}</div></>}
{s===4&&<div className="a-ob-g2">{LANGS.map(l=><button key={l.code} onClick={()=>{setLa(l.code);snd('click')}} className={`a-ob-ch${la===l.code?' on':''}`} style={{minHeight:52,fontSize:16}}>{l.label}</button>)}</div>}
{s===5&&<div style={{textAlign:'center',color:'rgba(255,255,255,.7)',lineHeight:1.8,fontSize:14}}><p style={{marginBottom:16}}>Hey {nm}! Here&apos;s what Foxy can do for you:</p><div style={{display:'flex',flexDirection:'column',gap:10,textAlign:'left'}}>{[{e:'\uD83E\uDD8A',t:'AI Tutor (Foxy)',d:'Ask anything about your NCERT chapters'},{e:'\uD83C\uDFAF',t:'Adaptive Quizzes',d:'2,142 MCQs with smart difficulty adjustment'},{e:'\uD83D\uDDFA\uFE0F',t:'Learning Journey',d:'See every chapter and track your mastery'},{e:'\uD83D\uDCCB',t:'AI Study Plan',d:'Personalized daily plan based on your gaps'}].map(tip=><div key={tip.t} style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',borderRadius:12,background:'rgba(255,255,255,.06)'}}><span style={{fontSize:22}}>{tip.e}</span><div><p style={{fontWeight:700,color:'#fff',fontSize:13}}>{tip.t}</p><p style={{fontSize:11,opacity:.5}}>{tip.d}</p></div></div>)}</div><input value={referral} onChange={e=>setReferral(e.target.value.toUpperCase())} placeholder="Referral code (optional)" className="a-ob-inp" style={{marginTop:16,textAlign:'center',letterSpacing:'.15em'}}/></div>}
</div>
<div style={{display:'flex',gap:10,marginTop:24,width:'100%'}}>{s>0&&<button onClick={()=>setS(v=>v-1)} className="a-ob-back" style={{minHeight:48}}>Back</button>}<button onClick={s<5?nx:async()=>{snd('eureka');await saveToDB();done({name:nm.trim(),grade:gr,subject:su,language:la})}} disabled={!ok} className="a-ob-next" style={{minHeight:48}}>{s<5?'Continue':'\uD83D\uDE80 Start Learning!'}</button></div>
</div>)}
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
const[chapterCtx,setChapterCtx]=useState<{chapter:number;title:string}|null>(null);
useEffect(()=>{if(initLd)return;try{const chCtx=localStorage.getItem('alfanumrik_foxy_chapter');if(chCtx){localStorage.removeItem('alfanumrik_foxy_chapter');const ch=JSON.parse(chCtx);if(ch.title&&ch.chapter){setChapterCtx({chapter:ch.chapter,title:ch.title});setPendingChapter(`Teach me Chapter ${ch.chapter}: ${ch.title}. Start from the very beginning of this chapter. Cover all key concepts, definitions, and formulas in order. Do not skip any topic.`)}}}catch{}},[initLd]);
useEffect(()=>{if(pendingChapter&&!ld&&!initLd&&msgs.length>0){const msg=pendingChapter;setPendingChapter(null);send(msg)}},[pendingChapter,ld,initLd,msgs.length]);
useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'})},[msgs]);
const saveToDb=useCallback(async(newMsgs:any[],sid:string|null)=>{if(!p.studentId||!sid||newMsgs.length<=1)return;await api('chat-history',{action:'save_messages',student_id:p.studentId,session_id:sid,messages:newMsgs,title:newMsgs.find((m:any)=>m.isUser)?.text?.substring(0,40)||'Chat'})},[p.studentId]);
const speak=async(id:number,t:string)=>{speakText(t,id)};
const renderMsg=(t:string)=>{if(!t)return'';
// Check if message contains any HTML-like content (SVG, tables, etc.)
if(/<(svg|table|div|br|sup|sub|b |strong|em|u |hr|ol|ul|li|span|img|math)[>\s/]/i.test(t)){
  // Split on SVG blocks (keep them separate for max-width), render rest as HTML
  const parts=t.split(/(<svg[\s\S]*?<\/svg>)/gi);
  return <>{parts.map((pt,i)=>pt.startsWith('<svg')||pt.startsWith('<SVG')?
    <div key={i} style={{margin:'8px 0',maxWidth:400}} dangerouslySetInnerHTML={{__html:pt}}/>:
    <span key={i} dangerouslySetInnerHTML={{__html:pt}}/>)}</>;
}
// For plain text: convert basic formatting patterns to styled spans
let html=t
  // Convert **bold** or CAPS words to bold
  .replace(/\*\*(.*?)\*\*/g,'<b>$1</b>')
  // Convert formulas with = signs on their own lines to styled blocks
  .replace(/^(\s*[A-Za-z][A-Za-z₀-₉²³]*\s*=\s*.+)$/gm,'<div style="background:#FFF7ED;padding:8px 12px;border-radius:8px;margin:6px 0;font-family:monospace;border-left:3px solid #E8590C">$1</div>')
  // Convert numbered lists (1. 2. 3.) to proper formatting
  .replace(/^(\d+)\.\s+/gm,'<b style="color:#E8590C">$1.</b> ')
  // Convert bullet points
  .replace(/^[•●▸]\s+/gm,'<span style="color:#E8590C;margin-right:4px">▸</span>')
  // Convert section headers (ALL CAPS lines)
  .replace(/^([A-Z][A-Z\s]{5,}[A-Z])$/gm,'<div style="font-weight:800;color:#1C1917;margin:10px 0 4px;font-size:14px;border-bottom:1px solid #E7E5E4;padding-bottom:4px">$1</div>')
  // Line breaks
  .replace(/\n/g,'<br/>');
return <span dangerouslySetInnerHTML={{__html:html}}/>;
};
const saveNote=async(text:string)=>{if(!p.studentId)return;await api('student-notes',{action:'create',student_id:p.studentId,subject:subCode,grade:p.grade,title:'Foxy: '+text.substring(0,40)+'...',content:text.replace(/<svg[\s\S]*?<\/svg>/gi,''),note_type:'summary',source:'foxy_chat',color:'#E8590C'});snd('ok')};
const newChat=async()=>{if(!p.studentId)return;setChapterCtx(null);const r=await api('chat-history',{action:'new_chat',student_id:p.studentId,subject:subCode,grade:p.grade});if(r.session){setSesId(r.session.id);setMsgs([{id:Date.now(),text:`Fresh start! What would you like to learn, ${p.name}?`,isUser:false,ts:Date.now()}]);setHist([]);snd('ok')}};
const[chapterProgress,setChapterProgress]=useState<{current_section:number;total_sections:number;sections_completed:number;current_title:string;status:string}|null>(null);
const send=async(t:string)=>{if(!t.trim()||ld)return;const m=t.trim();snd('send');setTranscript('');const userMsg={id:Date.now(),text:m,isUser:true,ts:Date.now()};const newMsgs=[...msgs,userMsg];setMsgs(newMsgs);setInp('');setLd(true);setAvatarSt('thinking');snd('think');const nh=[...hist,{role:'user',content:m}];const res=await api('foxy-tutor',{messages:nh,student_name:p.name,grade:p.grade,subject:p.subject,language:p.language,student_id:p.studentId||null,avatar_id:curAvatar,persona_id:curPersona,chapter_context:chapterCtx||undefined});if(res.chapter_progress)setChapterProgress(res.chapter_progress);const txt=res.text||'Foxy had a hiccup!';snd('recv');const hasQ=txt.includes('?');const hasPraise=/correct|right|exactly|well done|great|perfect|excellent|bahut/i.test(txt);if(hasPraise){setAvatarSt('celebrating');triggerCelebration('correct')}else if(hasQ){setAvatarSt('asking')}else{setAvatarSt('explaining')};const botMsg={id:Date.now()+1,text:txt,isUser:false,ts:Date.now()};const allMsgs=[...newMsgs,botMsg];setMsgs(allMsgs);setHist([...nh,{role:'assistant',content:txt}]);saveToDb(allMsgs,sesId);setLd(false);setTimeout(()=>setAvatarSt('idle'),3000);if(iR.current){iR.current.focus();iR.current.style.height='auto'}};
if(initLd)return<div className="a-center" style={{background:'#fff'}}><FoxyAvatar state="idle" size={64} color={avInfo.color}/><p style={{color:'#A8A29E',marginTop:12}}>Loading your conversation...</p></div>;
return(<div className="a-chat" style={{position:'relative'}}>{/* Celebration overlay */}{celebration&&<div style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:50,pointerEvents:'none',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:72,animation:'alfBounce 0.6s',textShadow:'0 4px 20px rgba(0,0,0,.2)'}}>{celebration==='correct'?'🎉':celebration==='streak'?'🔥':'⭐'}</div></div>}
{/* Header with animated avatar */}{chapterCtx&&<div style={{padding:'10px 16px',background:'linear-gradient(135deg,#FFF7ED,#FEF3C7)',borderBottom:'1px solid #FDE68A'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:chapterProgress?6:0}}><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:16}}>📖</span><span style={{fontSize:12,fontWeight:700,color:'#92400E'}}>Ch {chapterCtx.chapter}: {chapterCtx.title}</span></div><button onClick={()=>{setChapterCtx(null);setChapterProgress(null);snd('click')}} style={{fontSize:10,color:'#A8A29E',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>✕ Exit</button></div>{chapterProgress&&<div><div style={{display:'flex',gap:2,marginBottom:4}}>{Array.from({length:chapterProgress.total_sections}).map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<chapterProgress.sections_completed?'#16A34A':i===chapterProgress.current_section?'#E8590C':'#E7E5E4',transition:'all .3s'}}/>)}</div><p style={{fontSize:10,color:'#92400E'}}>Section {chapterProgress.current_section+1}/{chapterProgress.total_sections}: {chapterProgress.current_title}{chapterProgress.status==='completed'?' ✅ Complete!':''}</p></div>}</div>}<div className="a-chat-hdr" style={{gap:10}}>
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
<p style={{textAlign:'center',fontSize:10,color:'#D4D0C8',marginTop:20}}>Alfanumrik&reg; v6.0 &middot; CusioSense Learning India Private Limited</p><div style={{marginTop:10}}><CertStamp theme="light"/></div></div></div>)}
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
// PRICING PAGE — "Once in a Lifetime" Launch Offer
// ═══════════════════════════════════════════════════════
function Pricing({studentId,onBack,onSelect}:{studentId?:string;onBack:()=>void;onSelect:(plan:string)=>void}){
const[plans,setPlans]=useState<any[]>([]);const[ld,setLd]=useState(true);const[billing,setBilling]=useState<'monthly'|'yearly'>('monthly');const[coupon,setCoupon]=useState('');const[couponResult,setCouponResult]=useState<any>(null);
useEffect(()=>{api('payments',{action:'get_plans'}).then(d=>{setPlans(d.plans||[]);setLd(false)})},[]);
const applyCoupon=async(code:string,planCode:string,amount:number)=>{if(!code.trim())return;const r=await api('payments',{action:'apply_coupon',code,plan_code:planCode,amount:amount*100});if(r.valid)setCouponResult(r);else{setCouponResult(null);alert(r.error||'Invalid coupon')}}
const[payStatus,setPayStatus]=useState<string|null>(null);
const startPayment=async(plan:any)=>{
  if(plan.plan_code==='free'){onSelect('free');return}
  if(!studentId){alert('Please sign in first');return}
  setPayStatus('Creating order...');
  const r=await api('payments',{action:'create_order',student_id:studentId,plan_code:plan.plan_code,billing_cycle:billing,coupon_code:coupon||undefined});
  if(r.error){setPayStatus(null);alert(r.error);return}
  setPayStatus(null);
  // Load Razorpay SDK
  const loadRz=():Promise<void>=>new Promise((resolve,reject)=>{
    if((window as any).Razorpay){resolve();return}
    const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';
    script.onload=()=>resolve();script.onerror=()=>reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(script);
  });
  try{await loadRz()}catch{alert('Could not load payment gateway. Please check your internet.');return}
  
  const orderId=r.order_id;
  const opts={
    key:r.key,
    amount:r.amount_paise,
    currency:'INR',
    name:'Alfanumrik',
    description:`${plan.name} Plan \u2014 ${billing==='yearly'?'Yearly':'Monthly'} (\u20B9${r.amount_rupees})`,
    order_id:orderId,
    prefill:r.prefill,
    theme:{color:'#E8590C'},
    handler:async(resp:any)=>{
      // Razorpay SDK callback \u2014 verify signature server-side
      setPayStatus('Verifying payment...');
      try{
        const v=await api('payments',{action:'verify_payment',razorpay_order_id:resp.razorpay_order_id,razorpay_payment_id:resp.razorpay_payment_id,razorpay_signature:resp.razorpay_signature,student_id:studentId,plan_code:plan.plan_code,billing_cycle:billing});
        if(v.success){
          snd('eureka');setPayStatus(null);
          alert('\u2705 Payment successful! '+plan.name+' plan activated. Entitlements: '+(v.entitlements?.foxy_chats_per_day===-1?'Unlimited':''+v.entitlements?.foxy_chats_per_day)+' Foxy chats/day, '+(v.entitlements?.quizzes_per_day===-1?'Unlimited':''+v.entitlements?.quizzes_per_day)+' quizzes/day.');
          onSelect(plan.plan_code);
        }else{
          setPayStatus(null);alert('Payment verification issue: '+(v.error||'Unknown error')+'. If money was debited, it will be reconciled automatically.');
        }
      }catch(e){
        setPayStatus(null);alert('Verification error. Your payment is safe \u2014 we will reconcile it.');
      }
    },
    modal:{
      ondismiss:async()=>{
        // Razorpay modal closed \u2014 poll to check if UPI payment completed in background
        setPayStatus('Checking payment status...');
        // Wait 3 seconds for Razorpay to process
        await new Promise(r=>setTimeout(r,3000));
        try{
          const rec=await api('payments',{action:'reconcile_payment',order_id:orderId});
          if(rec.success){
            snd('eureka');setPayStatus(null);
            alert('\u2705 Payment confirmed! '+plan.name+' plan activated.');
            onSelect(plan.plan_code);
          }else if(rec.status==='failed'){
            setPayStatus(null);
            alert('\u274C Payment failed: '+(rec.error||'Unknown error')+'. If money was debited from your account, it will auto-refund in 5-7 business days.');
          }else{
            setPayStatus(null);
            // Payment might still be processing (UPI can take time)
            // Offer to check again
            const retry=confirm('Payment status: '+(rec.status||'pending')+'. Would you like to check again?');
            if(retry){
              const rec2=await api('payments',{action:'reconcile_payment',order_id:orderId});
              if(rec2.success){snd('eureka');alert('\u2705 Payment confirmed! Plan activated.');onSelect(plan.plan_code)}
              else{alert('Still processing. Please check back in a few minutes from your Profile page.')}
            }
          }
        }catch{setPayStatus(null)}
      }
    }
  };
  new (window as any).Razorpay(opts).open();
}
if(ld)return<div className="a-center-dark"><div style={{fontSize:48,animation:'alfPulse 1.5s infinite'}}>{'\uD83E\uDD8A'}</div><p style={{color:'rgba(255,255,255,.5)',marginTop:8}}>Loading plans...</p></div>;
const isLaunch=plans.some(p=>p.launch_expires_at&&new Date(p.launch_expires_at)>new Date());
return(<div style={{minHeight:'100vh',background:'linear-gradient(180deg,#0F0F12 0%,#1C1917 100%)',padding:'24px 16px 60px',overflow:'auto'}}>
<button onClick={onBack} style={{position:'fixed',top:16,left:16,padding:'8px 16px',borderRadius:10,background:'rgba(255,255,255,.06)',border:'none',color:'rgba(255,255,255,.4)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',zIndex:50}}>{'\u2190'} Back</button>
<div style={{maxWidth:900,margin:'0 auto',textAlign:'center'}}>
{isLaunch&&<div style={{display:'inline-block',padding:'6px 20px',borderRadius:20,background:'linear-gradient(135deg,#E8590C,#EC4899)',color:'#fff',fontSize:12,fontWeight:800,letterSpacing:'.1em',marginBottom:16,animation:'alfPulse 2s infinite'}}>{'\uD83D\uDD25'} FOUNDING MEMBER LAUNCH — LIMITED SPOTS</div>}
<h1 style={{fontSize:32,fontWeight:900,color:'#fff',marginBottom:8}}>Choose Your Learning Plan</h1>
<p style={{fontSize:15,color:'rgba(255,255,255,.5)',marginBottom:24,maxWidth:500,margin:'0 auto 24px'}}>Join thousands of students who are transforming their NCERT scores with AI-powered learning</p>
<div style={{display:'inline-flex',borderRadius:12,background:'rgba(255,255,255,.06)',padding:4,marginBottom:32}}>
{(['monthly','yearly'] as const).map(b=><button key={b} onClick={()=>setBilling(b)} style={{padding:'10px 24px',borderRadius:10,border:'none',background:billing===b?'#E8590C':'transparent',color:billing===b?'#fff':'rgba(255,255,255,.4)',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{b==='monthly'?'Monthly':'Yearly (Save 33%)'}</button>)}
</div>
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14,textAlign:'left'}}>
{plans.filter(p=>p.is_active).map(plan=>{
  const isPopular=plan.badge==='MOST POPULAR';const hasLaunch=plan.launch_price&&plan.launch_expires_at&&new Date(plan.launch_expires_at)>new Date();
  // Price calculation: launch price respects billing toggle (yearly = launch × 10, saving 2 months)
  let price:number;let orig:number;let perLabel:string;
  if(hasLaunch){
    if(billing==='yearly'){price=plan.launch_price*10;orig=plan.price_monthly*12;perLabel='/yr'}
    else{price=plan.launch_price;orig=plan.price_monthly;perLabel='/mo'}
  }else{
    if(billing==='yearly'){price=plan.price_yearly;orig=plan.price_monthly*12;perLabel='/yr'}
    else{price=plan.price_monthly;orig=plan.original_price||0;perLabel='/mo'}
  }
  const perMonthEquiv=billing==='yearly'&&price>0?Math.round(price/12):0;
  return<div key={plan.id} style={{background:isPopular?'linear-gradient(135deg,#E8590C08,#EC489908)':'rgba(255,255,255,.03)',border:isPopular?'2px solid #E8590C40':'1px solid rgba(255,255,255,.08)',borderRadius:20,padding:'24px 20px',position:'relative',transition:'all .2s'}}>
    {plan.badge&&<div style={{position:'absolute',top:-10,right:16,padding:'4px 12px',borderRadius:8,background:isPopular?'#E8590C':plan.badge==='BEST VALUE'?'#8B5CF6':'#3B82F6',color:'#fff',fontSize:10,fontWeight:800,letterSpacing:'.06em'}}>{plan.badge}</div>}
    <h3 style={{fontSize:20,fontWeight:900,color:'#fff',marginBottom:4}}>{plan.name}</h3>
    <p style={{fontSize:12,color:'rgba(255,255,255,.4)',marginBottom:16}}>{plan.tagline}</p>
    <div style={{marginBottom:4}}>
      {orig>0&&price!==orig&&<span style={{fontSize:14,color:'rgba(255,255,255,.3)',textDecoration:'line-through',marginRight:8}}>{'\u20B9'}{orig}</span>}
      <span style={{fontSize:36,fontWeight:900,color:'#fff'}}>{price===0?'Free':`\u20B9${price}`}</span>
      {price>0&&<span style={{fontSize:13,color:'rgba(255,255,255,.4)'}}>{perLabel}</span>}
    </div>
    {perMonthEquiv>0&&<p style={{fontSize:12,color:'rgba(255,255,255,.35)',marginBottom:12}}>That&apos;s just {'\u20B9'}{perMonthEquiv}/month</p>}
    {billing==='yearly'&&price>0&&!perMonthEquiv&&<div style={{height:12}}/>}
    {hasLaunch&&<p style={{fontSize:11,color:'#E8590C',fontWeight:700,marginBottom:12}}>{plan.launch_tagline}{billing==='yearly'?' + 2 months FREE!':''}</p>}
    {plan.seats_remaining&&plan.seats_remaining<500&&<p style={{fontSize:11,color:'#F59E0B',fontWeight:700,marginBottom:12}}>Only {plan.seats_remaining} spots left at this price!</p>}
    <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
      {[
        {f:plan.foxy_chats_per_day===-1?'Unlimited Foxy chats':plan.foxy_chats_per_day+' Foxy chats/day',on:true},
        {f:plan.quizzes_per_day===-1?'Unlimited quizzes':plan.quizzes_per_day+' quizzes/day',on:true},
        {f:plan.subjects_allowed===-1?'All subjects':''+plan.subjects_allowed+' subject'+(plan.subjects_allowed>1?'s':''),on:true},
        {f:plan.chapters_unlocked==='all'?'All chapters unlocked':'First 3 chapters',on:plan.chapters_unlocked==='all'},
        {f:'AI Study Plan',on:plan.study_plan_access},{f:'Smart Notes',on:plan.notes_access},
        {f:'Parent Dashboard',on:plan.parent_dashboard},{f:'Voice Tutor',on:plan.voice_tutor},
        {f:'Priority Support',on:plan.priority_support}
      ].map(feat=><div key={feat.f} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:feat.on?'rgba(255,255,255,.7)':'rgba(255,255,255,.2)'}}><span style={{fontSize:14}}>{feat.on?'\u2705':'\u26AA'}</span>{feat.f}</div>)}
    </div>
    <button onClick={()=>startPayment(plan)} style={{width:'100%',padding:'14px 0',borderRadius:14,border:'none',background:isPopular?'#E8590C':plan.plan_code==='free'?'rgba(255,255,255,.08)':'rgba(255,255,255,.06)',color:isPopular?'#fff':'rgba(255,255,255,.6)',fontSize:14,fontWeight:800,cursor:'pointer',fontFamily:'inherit',transition:'all .15s'}}>{plan.plan_code==='free'?'Start Free':isPopular?'\uD83D\uDE80 Get '+plan.name+' Now':'Choose '+plan.name}</button>
  </div>})}
</div>
{/* Payment Status Overlay */}
{payStatus&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{background:'#1C1917',border:'2px solid #E8590C',borderRadius:24,padding:'40px 32px',textAlign:'center',maxWidth:360}}><div style={{fontSize:48,animation:'alfPulse 1.5s infinite',marginBottom:16}}>{'\uD83E\uDD8A'}</div><p style={{color:'#fff',fontSize:16,fontWeight:700}}>{payStatus}</p><p style={{color:'rgba(255,255,255,.4)',fontSize:12,marginTop:8}}>Please do not close this page</p></div></div>}
{/* Coupon */}
<div style={{marginTop:24,display:'flex',justifyContent:'center',gap:8}}>
<input value={coupon} onChange={e=>setCoupon(e.target.value.toUpperCase())} placeholder="Have a coupon code?" style={{padding:'10px 16px',borderRadius:10,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',fontSize:13,fontFamily:'inherit',width:200,textAlign:'center',letterSpacing:'.1em'}}/>
</div>
{/* Trust badges */}
<div style={{display:'flex',justifyContent:'center',gap:24,marginTop:32,flexWrap:'wrap'}}>
{[{i:'\uD83D\uDD12',t:'Secure Payment'},{i:'\uD83D\uDCB0',t:'7-Day Refund'},{i:'\u274C',t:'Cancel Anytime'},{i:'\uD83C\uDFC6',t:'2,142 MCQs'}].map(b=><div key={b.t} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'rgba(255,255,255,.3)',fontWeight:600}}><span>{b.i}</span>{b.t}</div>)}
</div>
{/* Certification Badges */}
<div style={{marginTop:24}}><CertBadges size="md" theme="dark"/></div>
<p style={{fontSize:11,color:'rgba(255,255,255,.2)',marginTop:20}}>Powered by Razorpay. GST included. CusioSense Learning India Pvt. Ltd.</p>
</div></div>)}
// ═══════════════════════════════════════════════════════
// LANDING PAGE — Role Selection
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// CERTIFICATION BADGES — ISO 27001, ISO 42001, PCI-DSS
// ═══════════════════════════════════════════════════════
function CertBadges({size='sm',theme='dark'}:{size?:'sm'|'md'|'lg';theme?:'dark'|'light'}){
const s=size==='lg'?{badge:52,font:7,gap:12,label:9}:size==='md'?{badge:44,font:6,gap:10,label:8}:{badge:36,font:5.5,gap:8,label:7};
const tc=theme==='dark'?{border:'rgba(255,255,255,.12)',text:'rgba(255,255,255,.4)',bg:'rgba(255,255,255,.04)',accent:'rgba(255,255,255,.6)'}:{border:'#E7E5E4',text:'#78716C',bg:'#FAFAF8',accent:'#44403C'};
const certs=[
{name:'ISO 27001',sub:'Information Security',color:'#2563EB',icon:<svg viewBox="0 0 24 24" width={s.badge*.4} height={s.badge*.4}><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1zm0 2.18l7 3.12V11c0 4.83-3.15 9.36-7 10.58C8.15 20.36 5 15.83 5 11V6.3l7-3.12zM11 7v2h2V7h-2zm0 4v6h2v-6h-2z" fill="currentColor"/></svg>},
{name:'ISO 42001',sub:'AI Management',color:'#7C3AED',icon:<svg viewBox="0 0 24 24" width={s.badge*.4} height={s.badge*.4}><path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1a6.887 6.887 0 000 9.79c2.73 2.7 7.15 2.7 9.88 0 1.36-1.35 2.04-3.11 2.04-4.89h2c0 2.34-.89 4.68-2.68 6.45-3.55 3.52-9.31 3.52-12.86 0s-3.55-9.23 0-12.75 9.31-3.52 12.86 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z" fill="currentColor"/></svg>},
{name:'PCI DSS',sub:'Payment Security',color:'#059669',icon:<svg viewBox="0 0 24 24" width={s.badge*.4} height={s.badge*.4}><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" fill="currentColor"/><circle cx="8" cy="15" r="1.5" fill="currentColor"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/></svg>}
];
return(<div style={{display:'flex',gap:s.gap,justifyContent:'center',alignItems:'center',flexWrap:'wrap'}}>
{certs.map(c=><div key={c.name} style={{display:'flex',alignItems:'center',gap:6,padding:`${s.badge*.15}px ${s.badge*.25}px`,borderRadius:s.badge*.25,border:`1px solid ${tc.border}`,background:tc.bg,transition:'all .2s'}}>
<div style={{width:s.badge*.5,height:s.badge*.5,borderRadius:'50%',background:`${c.color}15`,border:`1.5px solid ${c.color}40`,display:'flex',alignItems:'center',justifyContent:'center',color:c.color,flexShrink:0}}>{c.icon}</div>
<div style={{lineHeight:1.2}}>
<p style={{fontSize:s.font+2,fontWeight:800,color:tc.accent,letterSpacing:'.02em'}}>{c.name}</p>
<p style={{fontSize:s.font,color:tc.text,fontWeight:600}}>{c.sub}</p>
</div>
</div>)}
</div>)}
function CertStamp({theme='dark'}:{theme?:'dark'|'light'}){
const tc=theme==='dark'?{text:'rgba(255,255,255,.25)',accent:'rgba(255,255,255,.35)'}:{text:'#A8A29E',accent:'#78716C'};
return(<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap',marginTop:12}}>
<div style={{display:'flex',alignItems:'center',gap:5}}><svg viewBox="0 0 24 24" width={14} height={14}><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z" fill="none" stroke={tc.accent} strokeWidth="2"/><path d="M9 12l2 2 4-4" fill="none" stroke={tc.accent} strokeWidth="2" strokeLinecap="round"/></svg><span style={{fontSize:10,color:tc.text,fontWeight:600}}>ISO 27001 Certified</span></div>
<div style={{display:'flex',alignItems:'center',gap:5}}><svg viewBox="0 0 24 24" width={14} height={14}><circle cx="12" cy="12" r="10" fill="none" stroke={tc.accent} strokeWidth="2"/><path d="M12 6v6l4 2" fill="none" stroke={tc.accent} strokeWidth="2" strokeLinecap="round"/></svg><span style={{fontSize:10,color:tc.text,fontWeight:600}}>ISO 42001 AI Certified</span></div>
<div style={{display:'flex',alignItems:'center',gap:5}}><svg viewBox="0 0 24 24" width={14} height={14}><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke={tc.accent} strokeWidth="2"/><path d="M2 10h20" stroke={tc.accent} strokeWidth="2"/></svg><span style={{fontSize:10,color:tc.text,fontWeight:600}}>PCI DSS Compliant</span></div>
</div>)}
// ═══════════════════════════════════════════════════════
// LANDING PAGE — Role Selection
// ═══════════════════════════════════════════════════════
function Landing({onRole}:{onRole:(r:'student'|'parent')=>void}){
return(<div className="a-landing">
<div className="a-landing-bg"/>
<div className="a-landing-bg2"/>
<div className="a-landing-content">
<div style={{fontSize:64,marginBottom:12,animation:'alfBounce 2s infinite',filter:'drop-shadow(0 4px 24px rgba(232,89,12,.3))'}}>{'\uD83E\uDD8A'}</div>
<h1 style={{fontSize:44,fontWeight:900,color:'#fff',letterSpacing:'-.03em',lineHeight:1.1}}>Alfanumrik</h1>
<p style={{fontSize:15,color:'rgba(255,255,255,.45)',marginTop:10,marginBottom:36,lineHeight:1.5,maxWidth:340}}>AI-powered adaptive learning by CusioSense Learning India Pvt. Ltd.</p>
<div style={{display:'flex',flexDirection:'column',gap:14,width:'100%'}}>
<button onClick={()=>{snd('click');onRole('student')}} className="a-role-btn" style={{background:'linear-gradient(135deg,#E8590C,#DC2626)'}}>
<span style={{fontSize:32}}>{'\uD83C\uDF93'}</span><div style={{flex:1}}><strong style={{fontSize:17,display:'block'}}>I am a Student</strong><p style={{fontSize:12,opacity:.7,marginTop:3}}>Learn with Foxy AI Tutor</p></div><span style={{fontSize:20,opacity:.6}}>{'\u2192'}</span>
</button>
<button onClick={()=>{snd('click');onRole('parent')}} className="a-role-btn" style={{background:'linear-gradient(135deg,#8B5CF6,#6D28D9)'}}>
<span style={{fontSize:32}}>{'\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67'}</span><div style={{flex:1}}><strong style={{fontSize:17,display:'block'}}>I am a Parent</strong><p style={{fontSize:12,opacity:.7,marginTop:3}}>Track your child's progress</p></div><span style={{fontSize:20,opacity:.6}}>{'\u2192'}</span>
</button>
</div>
<div style={{marginTop:36,opacity:.8}}><CertBadges size="sm" theme="dark"/></div>
<p style={{fontSize:10,color:'rgba(255,255,255,.2)',marginTop:14}}>{'\u00A9'} 2026 CusioSense Learning India Private Limited</p>
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
// MAIN APP — 2-Portal Router (Student + Parent)
// ═══════════════════════════════════════════════════════
export default function App(){
  const[portal,setPortal]=useState<'landing'|'student'|'parent'>('landing')
  const[sc,setSc]=useState<Screen>('loading')
  const[user,setUser]=useState<any>(null)
  const[prof,setProf]=useState<Prof|null>(null)
  const[stats,setStats]=useState<Stats>({xp:0,streak:0,sessions:0,correct:0,asked:0,minutes:0})
  const[history,setHistory]=useState<any>(null)
  const[guardian,setGuardian]=useState<any>(null)
  const[offline,setOffline]=useState(false)
  const[appError,setAppError]=useState<string|null>(null)

  // Global error + offline handling
  useEffect(()=>{
    const onOff=()=>setOffline(true);const onOn=()=>setOffline(false);
    const onErr=(e:ErrorEvent)=>{console.error('Global error:',e.message);if(e.message.includes('ChunkLoadError')||e.message.includes('Loading chunk'))setAppError('update')};
    const onRej=(e:PromiseRejectionEvent)=>{console.error('Unhandled rejection:',e.reason)};
    window.addEventListener('offline',onOff);window.addEventListener('online',onOn);window.addEventListener('error',onErr);window.addEventListener('unhandledrejection',onRej);
    setOffline(!navigator.onLine);
    return()=>{window.removeEventListener('offline',onOff);window.removeEventListener('online',onOn);window.removeEventListener('error',onErr);window.removeEventListener('unhandledrejection',onRej)}
  },[])
  const[parentStep,setParentStep]=useState<'code'|'dash'>('code')
  const[regData,setRegData]=useState<{studentName:string;parentName:string;parentPhone:string;loginEmail:string}|null>(null)
  const loadAll=useCallback(async(p:Prof)=>{if(!p.studentId)return;try{const[s,h]=await Promise.all([getStats(p.studentId),api('chat-history',{action:'get_history',student_id:p.studentId})]);setStats(s);setHistory(h)}catch(e){console.error('loadAll failed:',e)}},[])

  // Check saved portal choice
  useEffect(()=>{
    if(typeof window==='undefined')return
    const params=new URLSearchParams(window.location.search)
    if(params.get('reset')==='true'||window.location.hash.includes('type=recovery')){setPortal('student');setSc('reset');return}
    const savedPortal=localStorage.getItem('alfn_portal') as any
    if(savedPortal==='student'||savedPortal==='parent'){setPortal(savedPortal)}
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
  },[loadAll])

  const selectRole=(role:'student'|'parent')=>{setPortal(role);localStorage.setItem('alfn_portal',role);if(role==='student')setSc('auth');if(role==='parent')setParentStep('code')}
  const goLanding=()=>{setPortal('landing');localStorage.removeItem('alfn_portal')}

  // STUDENT AUTH
  const onStudentAuth=async(u:any)=>{try{setUser(u);const saved=localStorage.getItem('alfanumrik_profile');if(saved){const p=JSON.parse(saved) as Prof;const sid=await ensureStudent(u.id,p);if(!sid){console.error('Failed to resolve studentId');localStorage.removeItem('alfanumrik_profile');setSc('onboard');return}const wp={...p,studentId:sid};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp);setSc('home');return}const dbProf=await loadProfileFromDB(u.id);if(dbProf&&dbProf.studentId){setProf(dbProf);localStorage.setItem('alfanumrik_profile',JSON.stringify(dbProf));await loadAll(dbProf);setSc('home');return}setSc('onboard')}catch(e){console.error('onAuth failed:',e);setSc('auth')}}
  const onStudentOnboard=async(p:Prof)=>{if(user){const sid=await ensureStudent(user.id,p);if(!sid){alert('Could not create your account. Please try again.');return}const wp={...p,studentId:sid};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp);setSc('onboard_pricing')}}
  // Registration complete — parent created account with all details, now show pricing
  const onRegistrationComplete=async(u:any,p:Prof,reg:{studentName:string;parentName:string;parentPhone:string;loginEmail:string})=>{
    setUser(u);
    setRegData(reg);
    // If studentId wasn't resolved during registration (RLS), try again with the authenticated session
    if(!p.studentId&&u?.id){
      // Wait a moment for the auth session to settle
      await new Promise(r=>setTimeout(r,500));
      const sid=await ensureStudent(u.id,p);
      if(sid)p={...p,studentId:sid};
    }
    setProf(p);localStorage.setItem('alfanumrik_profile',JSON.stringify(p));
    if(p.studentId)await loadAll(p);
    setSc('credentials');
  }
  // Handle plan selection from pricing — resolve studentId if needed before going home
  const onPlanSelected=async(plan:string)=>{
    snd('eureka');
    // If studentId still missing, try to resolve it one more time
    if(prof&&!prof.studentId&&user?.id){
      const sid=await ensureStudent(user.id,prof);
      if(sid){const wp={...prof,studentId:sid};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp)}
    }
    setSc('home');
  }
  const onProfUp=async(p:Prof)=>{setProf(p);localStorage.setItem('alfanumrik_profile',JSON.stringify(p));if(p.studentId){await sb.from('students').update({name:p.name,grade:p.grade,preferred_language:p.language,preferred_subject:p.subject}).eq('id',p.studentId);await loadAll(p)}}
  const refreshStats=async()=>{if(prof?.studentId){const s=await getStats(prof.studentId);setStats(s);const h=await api('chat-history',{action:'get_history',student_id:prof.studentId});setHistory(h)}}
  const studentLogout=async()=>{try{await sb.auth.signOut()}catch(e){}Object.keys(localStorage).filter(k=>k.startsWith('sb-')).forEach(k=>localStorage.removeItem(k));localStorage.removeItem('alfanumrik_profile');setUser(null);setProf(null);setSc('auth')}

  // PARENT LOGIN — link code only, no Supabase auth
  const onParentLogin=(data:any)=>{const g=data.guardian;const st=data.student;setGuardian({...g,linkedStudent:st});localStorage.setItem('alfn_guardian',JSON.stringify({...g,linkedStudent:st}));localStorage.setItem('alfn_parent_student',JSON.stringify(st));setParentStep('dash')}
  const parentLogout=()=>{localStorage.removeItem('alfn_guardian');localStorage.removeItem('alfn_parent_student');setGuardian(null);setParentStep('code')}

  // Loading timeout
  useEffect(()=>{if(portal==='student'&&sc==='loading'){const t=setTimeout(()=>{setSc('auth')},8000);return()=>clearTimeout(t)}},[sc,portal])

  // ─── RENDER ───
  // App error recovery
  if(appError==='update')return<><CSS/><div className="a-center"><div style={{textAlign:'center'}}><div style={{fontSize:56,marginBottom:16}}>{'\uD83D\uDD04'}</div><h2 style={{color:'#1C1917',fontSize:20,fontWeight:800,marginBottom:8}}>App Updated</h2><p style={{color:'#78716C',fontSize:14,marginBottom:20}}>A new version is available. Refresh to continue.</p><button onClick={()=>window.location.reload()} style={{padding:'12px 32px',borderRadius:12,border:'none',background:'#E8590C',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Refresh Now</button></div></div></>

  // Offline banner (shown as overlay, doesn't block UI)
  const offlineBanner=offline?<div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,background:'#DC2626',color:'#fff',textAlign:'center',padding:'8px 16px',fontSize:13,fontWeight:700,animation:'alfSlideUp .3s'}}>{'\u26A0\uFE0F'} You're offline. Some features may not work.</div>:null;

  // LANDING
  if(portal==='landing')return<><CSS/>{offlineBanner}<Landing onRole={selectRole}/></>

  // STUDENT PORTAL
  if(portal==='student'){
    if(sc==='loading')return<><CSS/><div className="a-center"><div style={{fontSize:56,animation:'alfBounce 1.5s infinite'}}>{'\uD83E\uDD8A'}</div><p style={{color:'#A8A29E',marginTop:8,fontWeight:600}}>Loading...</p></div></>
    if(sc==='auth')return<><CSS/><Auth onAuth={onStudentAuth} onConfirm={()=>setSc('confirm')} onSignup={()=>setSc('register')}/><div style={{position:'fixed',top:16,left:16}}><button onClick={goLanding} style={{padding:'8px 16px',borderRadius:10,background:'rgba(255,255,255,.08)',border:'none',color:'rgba(255,255,255,.5)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{'\u2190'} Back</button></div></>
    if(sc==='confirm')return<><CSS/><ConfirmScreen onBack={()=>setSc('auth')}/></>
    if(sc==='reset')return<><CSS/><ResetScreen/></>
    if(sc==='register')return<><CSS/><Registration onComplete={onRegistrationComplete} onBack={()=>setSc('auth')}/></>
    if(sc==='credentials'&&regData)return<><CSS/><CredentialsCard studentName={regData.studentName} parentName={regData.parentName} parentPhone={regData.parentPhone} loginEmail={regData.loginEmail} onContinue={()=>setSc('onboard_pricing')}/></>
    if(sc==='onboard')return<><CSS/><Onboard user={user} done={onStudentOnboard}/></>
    if(sc==='onboard_pricing')return<><CSS/><Pricing studentId={prof?.studentId} onBack={()=>{onPlanSelected('free')}} onSelect={onPlanSelected}/></>
    if(sc==='pricing')return<><CSS/><Pricing studentId={prof?.studentId} onBack={()=>setSc('home')} onSelect={(plan)=>{snd('eureka');setSc('home')}}/></>
    if(prof&&!prof.studentId){
      // CRITICAL: Profile loaded but studentId missing — auto-recover
      return<><CSS/><div className="a-center"><div style={{textAlign:'center'}}><div style={{fontSize:56,marginBottom:16}}>{'\uD83E\uDD8A'}</div><h2 style={{color:'#1C1917',fontSize:20,fontWeight:800,marginBottom:8}}>Setting up your account...</h2><p style={{color:'#78716C',fontSize:14,marginBottom:20}}>Please wait while Foxy prepares everything.</p><button onClick={async()=>{if(user){const sid=await ensureStudent(user.id,prof);if(sid){const wp={...prof,studentId:sid};setProf(wp);localStorage.setItem('alfanumrik_profile',JSON.stringify(wp));await loadAll(wp);setSc('home')}else{localStorage.removeItem('alfanumrik_profile');setSc('onboard')}}else{setSc('auth')}}} style={{padding:'12px 32px',borderRadius:12,border:'none',background:'#E8590C',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Retry</button></div></div></>
    }
    return<><CSS/>{offlineBanner}<div className="a-shell">{prof&&<Nav active={sc} nav={setSc} p={prof}/>}<main className="a-main">{sc==='home'&&prof&&<Home p={prof} nav={setSc} stats={stats} history={history}/>}{sc==='foxy'&&prof&&<Foxy p={prof}/>}{sc==='quiz'&&prof&&<Quiz p={prof} onDone={refreshStats}/>}{sc==='skills'&&prof&&<SkillTree p={prof} nav={setSc}/>}{sc==='plan'&&prof&&<StudyPlan p={prof} nav={setSc}/>}{sc==='notes'&&prof&&<Notes p={prof}/>}{sc==='progress'&&prof&&<Progress p={prof} stats={stats}/>}{sc==='profile'&&prof&&<ProfileScr p={prof} onUp={onProfUp} out={studentLogout} stats={stats}/>}</main></div></>
  }

  // PARENT PORTAL — link code only
  if(portal==='parent'){
    if(parentStep==='code')return<><CSS/><ParentCodeLogin onLogin={onParentLogin} onBack={goLanding}/></>
    if(parentStep==='dash'&&guardian)return<><CSS/><ParentDash guardian={guardian} onLogout={parentLogout}/></>
    return<><CSS/><ParentCodeLogin onLogin={onParentLogin} onBack={goLanding}/></>
  }

  return<><CSS/><Landing onRole={selectRole}/></>
}
function CSS(){return<style>{`
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}body{font-family:'Nunito',sans-serif;background:#FAFAF8;color:#1C1917;-webkit-font-smoothing:antialiased;overflow-x:hidden}::selection{background:#E8590C;color:#fff}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#E7E5E4;border-radius:3px}
@keyframes alfFadeIn{from{opacity:0}to{opacity:1}}@keyframes alfSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes alfPulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes alfBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes alfPulseBorder{0%,100%{border-color:#EF444450}50%{border-color:#EF4444}}
.a-landing{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#0C0A09 0%,#1C1917 50%,#292524 100%);position:relative;overflow:hidden}
.a-landing-bg{position:absolute;top:-40%;right:-20%;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,#E8590C06 0%,transparent 70%);pointer-events:none}.a-landing-bg2{position:absolute;bottom:-30%;left:-15%;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,#8B5CF606 0%,transparent 70%);pointer-events:none}
.a-landing-content{position:relative;z-index:1;text-align:center;padding:32px 24px;animation:alfFadeIn .6s;display:flex;flex-direction:column;align-items:center;max-width:440px;width:100%}
.a-role-btn{display:flex;align-items:center;gap:16px;padding:20px 28px;border-radius:18px;border:none;color:#fff;font-family:inherit;cursor:pointer;transition:all .25s;text-align:left;width:100%;min-height:72px;box-shadow:0 4px 24px rgba(0,0,0,.2)}.a-role-btn:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.a-center{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.a-center-dark{min-height:100vh;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;background:linear-gradient(160deg,#0C0A09 0%,#1C1917 50%,#292524 100%);padding:24px;text-align:center}
.a-auth{min-height:100vh;display:flex}.a-auth-l{flex:1;background:linear-gradient(160deg,#0C0A09 0%,#1C1917 50%,#292524 100%);padding:60px 48px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;position:relative;overflow:hidden}.a-auth-l::before{content:'';position:absolute;top:-30%;right:-20%;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,#E8590C06 0%,transparent 70%);pointer-events:none}.a-auth-r{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 48px}
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
.a-bub{padding:14px 18px;border-radius:18px;font-size:15px;line-height:1.6;white-space:pre-wrap;max-width:600px;overflow-x:auto}.a-bub.u{background:linear-gradient(135deg,#1C1917,#292524);color:#fff;border-bottom-right-radius:4px}.a-bub.b{background:#fff;color:#1C1917;border:1px solid #F0EDE8;border-bottom-left-radius:4px}
.a-bub table{border-collapse:collapse;margin:10px 0;font-size:13px;width:100%;white-space:normal}.a-bub th,.a-bub td{border:1px solid #E7E5E4;padding:8px 10px;text-align:left}.a-bub th{background:#FFF7ED;font-weight:700;color:#E8590C;font-size:12px;text-transform:uppercase;letter-spacing:.03em}.a-bub td{background:#FAFAF8}.a-bub tr:hover td{background:#FFF7ED}
.a-bub b,.a-bub strong{font-weight:700;color:#1C1917}.a-bub em{font-style:italic;color:#57534E}
.a-typing{display:flex;gap:5px;padding:10px 14px}.a-typing span{width:8px;height:8px;border-radius:50%;background:#E8590C;animation:alfPulse 1s infinite}.a-typing span:nth-child(2){animation-delay:.2s}.a-typing span:nth-child(3){animation-delay:.4s}
.a-chips{padding:0 24px 12px;display:flex;gap:8px;flex-wrap:wrap}.a-chip{padding:10px 16px;border-radius:20px;background:#F5F4F0;border:1px solid #E7E5E4;font-size:14px;font-weight:600;color:#57534E;cursor:pointer;font-family:inherit;transition:all .15s}.a-chip:hover{background:#E7E5E4;transform:translateY(-1px)}
.a-speak-btn{padding:4px 10px;border-radius:10px;border:1px solid #E7E5E4;background:#fff;font-size:15px;cursor:pointer;line-height:1;transition:all .15s}.a-speak-btn:hover{background:#FFF7ED;border-color:#FDBA74}
.a-chat-bar{padding:14px 24px 24px;display:flex;gap:8px;align-items:flex-end;background:#fff;border-top:1px solid #F0EDE8}.a-chat-inp{flex:1;padding:14px 18px;border-radius:16px;border:1.5px solid #E7E5E4;background:#FAFAF8;font-size:15px;outline:none;font-family:inherit;color:#1C1917;overflow-y:auto;scrollbar-width:thin}.a-chat-inp:focus{border-color:#E8590C;box-shadow:0 0 0 3px rgba(232,89,12,.08)}.a-chat-go{width:48px;height:48px;border-radius:14px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;background:linear-gradient(135deg,#E8590C,#DC2626);color:#fff;font-size:20px;font-weight:900;transition:all .15s}.a-chat-go:hover{transform:scale(1.05)}.a-chat-go:disabled{background:#F5F4F0;color:#A8A29E;transform:none}
.a-notes-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.a-note-card{background:#fff;border:1px solid #F0EDE8;border-radius:16px;padding:16px;transition:all .15s}.a-note-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
.a-note-body{font-size:13px;color:#57534E;line-height:1.6;white-space:pre-wrap}
.a-note-act{background:none;border:none;font-size:14px;cursor:pointer;padding:2px;opacity:.5}.a-note-act:hover{opacity:1}
.a-pr{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;transition:background .15s}.a-pr:hover{background:#FAFAF8}.a-pr-l{font-size:14px;font-weight:600}.a-pr-v{font-size:14px;color:#78766F;flex:1;text-align:right;margin-right:8px}.a-ed{padding:12px 20px 16px;border-top:1px solid #F5F4F0;background:#FAFAF8}.a-ed-inp{width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #E7E5E4;font-size:14px;outline:none;font-family:inherit;color:#1C1917;margin-bottom:8px;min-height:44px}.a-ed-inp:focus{border-color:#E8590C}
@media(max-width:900px){.a-side{display:none!important}.a-main{margin-left:0!important}.a-bot{display:flex!important}.a-page{padding:20px 16px 100px}.a-title{font-size:24px}.a-auth{flex-direction:column}.a-auth-l{padding:40px 24px;min-height:auto;flex:none}.a-auth-l h1{font-size:28px!important}.a-auth-r{padding:24px}.a-chat{height:calc(100vh - 70px)}.a-chat-bar{padding:12px 16px 20px}.a-notes-grid{grid-template-columns:1fr}}
@media(min-width:901px){.a-bot{display:none!important}}
`}</style>}
