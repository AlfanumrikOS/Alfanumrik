'use client'
import { useEffect } from 'react'

const APP = '/app'

export default function LandingPage() {
  useEffect(() => {
    const rv = document.querySelectorAll('.rv')
    const obs = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); obs.unobserve(e.target) }})
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' })
    rv.forEach(el => obs.observe(el))
    const nav = document.getElementById('lnav')
    const onS = () => { if(nav) nav.classList.toggle('scrolled', window.scrollY > 40) }
    window.addEventListener('scroll', onS)
    return () => { window.removeEventListener('scroll', onS); obs.disconnect() }
  }, [])
  return (<><LandingCSS/>
    <nav className="lnav" id="lnav"><a href="/" className="lnav-logo"><span style={{fontSize:28}}>🦊</span><strong>Alfanumrik</strong></a><div className="lnav-links"><a href="#features">Features</a><a href="#how">How It Works</a><a href="#pricing">Pricing</a><a href="#paths">Students &amp; Parents</a><a href={APP} className="lcta">Start Free →</a></div></nav>

    <header className="hero"><div className="hero-in"><div>
      <div className="hero-badge rv"><div className="pulse"/>Founding Member Offer — Limited Spots</div>
      <h1 className="rv d1">Your child deserves a tutor that <span className="grd">never gives up</span> on them.</h1>
      <p className="hero-sub rv d2">Meet <strong>Foxy</strong> — the AI tutor that adapts to your child&apos;s pace, explains in their language, and makes NCERT concepts click. For Grade 6–12, CBSE, ICSE &amp; State Boards.</p>
      <div className="hero-acts rv d3"><a href={APP} className="bp">🦊 Start Learning Free</a><a href="#how" className="bs">See How It Works</a></div>
      <div className="hero-stats rv d4"><div className="hst"><strong>2,142+</strong><span>NCERT MCQs</span></div><div className="hst"><strong>5</strong><span>Subjects</span></div><div className="hst"><strong>24/7</strong><span>AI Tutor</span></div></div>
    </div>
    <div className="hero-vis rv">
      <div className="hphone"><div className="hscreen"><div className="phdr"><div className="phav">🦊</div><div><div className="phn">Foxy AI Tutor</div><div className="phs">Grade 9 · Science</div></div></div>
      <div className="cmsgs"><div className="cmsg user">Foxy, Newton ka second law samjhao!</div><div className="cmsg bot">Bilkul! 🧡 Newton ka 2nd Law kehta hai: F = m × a. Matlab, kisi cheez ko jitna zyada push karo (Force), utni tez chalegi... 🏏</div><div className="cmsg user">Cricket ka example do na</div><div className="cmsg bot">Haan! Jab bowler gend dalta hai — jitni zyada force, gend utni tez. Lekin bhaari gend utni tez nahi jaayegi! ⚡</div></div>
      </div></div>
      <div className="flt xp"><div className="fli" style={{background:'#FEF3C7'}}>🔥</div><div><strong>12-day streak!</strong><br/><span style={{fontSize:11,color:'#A8A29E'}}>Keep going, champ!</span></div></div>
      <div className="flt str"><div className="fli" style={{background:'#DCFCE7'}}>⭐</div><div><strong>+50 XP earned</strong><br/><span style={{fontSize:11,color:'#A8A29E'}}>Mastered: Force &amp; Laws</span></div></div>
      <div className="flt qz"><div className="fli" style={{background:'#EFF6FF'}}>🎯</div><div><strong>Quiz: 9/10</strong><br/><span style={{fontSize:11,color:'#A8A29E'}}>Gravitation Ch.3</span></div></div>
    </div></div></header>

    <div className="bstrip"><div className="bstrip-in">{['CBSE','ICSE','State Boards','NCERT Aligned','Grade 6–12','Hindi & English'].map((b,i)=><span key={b}>{i>0&&<span style={{margin:'0 16px',opacity:.3}}>·</span>}{b}</span>)}</div></div>

    <section className="sec" id="features"><div className="sec-in">
      <div className="slbl rv" style={{background:'#FFF0E6',color:'#E8590C'}}>🦊 WHY ALFANUMRIK</div>
      <h2 className="sttl rv">Not another study app.<br/>A <span style={{color:'#E8590C'}}>thinking partner</span> for your child.</h2>
      <p className="ssub rv">Alfanumrik doesn&apos;t just give answers — Foxy teaches concepts step-by-step, adapts to weak areas, and makes learning genuinely fun.</p>
      <div className="fgrid">{[
        {i:'🦊',bg:'#FFF0E6',t:'Foxy AI Tutor',d:'A patient, multilingual tutor that explains in Hindi, English, or Hinglish — just the way your child understands. Ask unlimited doubts, 24/7.'},
        {i:'🎯',bg:'#F3EEFF',t:'Adaptive Quizzes',d:'MCQs that get smarter with every attempt. Foxy identifies weak topics and generates targeted questions from 2,142+ NCERT-aligned problems.'},
        {i:'📋',bg:'#ECFDF5',t:'AI Study Plans',d:"Personalized daily study schedules that adapt to your child's pace, exam dates, and mastery levels. No more guessing what to study next."},
        {i:'📈',bg:'#EFF6FF',t:'Chapter Mastery',d:'Visual skill trees showing exactly which chapters your child has mastered and which need attention. Track progress topic by topic.'},
        {i:'📝',bg:'#FEF3C7',t:'Smart Notes',d:"AI-generated revision notes tailored to your child's weak areas. Quick-reference summaries before exams, organized by chapter."},
        {i:'👨‍👩‍👧',bg:'#FCE7F3',t:'Parent Dashboard',d:"Weekly reports on your child's progress, streaks, weak areas, and achievements. Stay involved without being intrusive."}
      ].map((f,j)=><article key={f.t} className={`fc rv${j>0?' d'+Math.min(j,4):''}`}><div className="fci" style={{background:f.bg}}>{f.i}</div><h3>{f.t}</h3><p>{f.d}</p></article>)}</div>
    </div></section>

    <section className="sec" id="how" style={{background:'#F5F3EF'}}><div className="sec-in" style={{textAlign:'center'}}>
      <div className="slbl rv" style={{background:'#fff',color:'#7C3AED',margin:'0 auto'}}>🚀 HOW IT WORKS</div>
      <h2 className="sttl rv" style={{margin:'0 auto'}}>From zero to learning hero in <span style={{color:'#7C3AED'}}>4 simple steps</span></h2>
      <div className="stps">{[
        {n:'1',bg:'#FFF0E6',c:'#E8590C',t:'Register Your Child',d:'Quick 2-minute signup. Parents fill in student details, grade, and subjects.'},
        {n:'2',bg:'#F3EEFF',c:'#7C3AED',t:'Foxy Assesses Level',d:'Foxy asks a few questions to understand where your child stands in each topic.'},
        {n:'3',bg:'#ECFDF5',c:'#059669',t:'Personalized Learning',d:'AI creates a custom study plan targeting weak areas first, with daily quizzes.'},
        {n:'4',bg:'#EFF6FF',c:'#2563EB',t:'Watch Them Grow',d:'Track mastery improvements, streaks, and XP. Parents get weekly reports.'}
      ].map((s,j)=><div key={s.n} className={`stp rv${j>0?' d'+j:''}`}><div className="stpn" style={{background:s.bg,color:s.c}}>{s.n}</div><h3>{s.t}</h3><p>{s.d}</p></div>)}</div>
    </div></section>

    <section className="sec" id="paths"><div className="sec-in">
      <div style={{textAlign:'center',marginBottom:8}}><div className="slbl rv" style={{background:'#ECFDF5',color:'#059669',margin:'0 auto'}}>👋 BUILT FOR YOU</div>
      <h2 className="sttl rv" style={{textAlign:'center'}}>Whether you&apos;re studying or supporting a student — <span style={{color:'#059669'}}>we&apos;ve got you.</span></h2></div>
      <div className="pths">
        <div className="pth pstu rv"><span className="pemo">🎓</span><h3>For Students</h3><p>Your new study buddy that actually gets you. Ask doubts in Hindi or English, take quizzes, and level up like a game.</p><ul>{['Chat with Foxy anytime — even at 2 AM before exams','2,142+ MCQs across Science, Maths, English, Hindi, SST','Earn XP, maintain streaks, unlock achievements','Smart notes that focus on YOUR weak topics','Study plans that adapt as you learn'].map(l=><li key={l}>{l}</li>)}</ul><a href={APP} className="ptcta stucta">Start Learning Free →</a></div>
        <div className="pth ppar rv d1"><span className="pemo">👨‍👩‍👧</span><h3>For Parents</h3><p>Finally, a way to support your child&apos;s education without becoming their teacher. Get real insights, not just report cards.</p><ul>{['Weekly progress reports delivered to your dashboard','See exactly which topics need attention','Expert-curated parenting tips for each learning stage','Safe, ad-free learning environment','Track multiple children from one account'].map(l=><li key={l}>{l}</li>)}</ul><a href={APP} className="ptcta parcta">Register Your Child →</a></div>
      </div>
    </div></section>

    <section className="sec" style={{background:'#F5F3EF',textAlign:'center'}}><div className="sec-in">
      <div className="slbl rv" style={{background:'#fff',color:'#E8590C',margin:'0 auto'}}>📚 CURRICULUM</div>
      <h2 className="sttl rv">Every chapter. Every concept. <span style={{color:'#E8590C'}}>NCERT aligned.</span></h2>
      <p className="ssub rv" style={{margin:'0 auto 32px',textAlign:'center'}}>Foxy covers the complete syllabus for Grade 6–12. All content is mapped to NCERT textbooks and aligned with CBSE, ICSE, and major State Board curricula.</p>
      <div className="spls">{['∑ Mathematics','⚗️ Science','🌍 Social Studies','Aa English','अ Hindi','⚛️ Physics','🧪 Chemistry','🧬 Biology','💻 Computer Science','📊 Economics'].map((s,i)=><div key={s} className={`spl rv${i>0?' d'+Math.min(i%5,4):''}`}>{s}</div>)}</div>
    </div></section>

    <section className="sec"><div className="sec-in" style={{textAlign:'center'}}>
      <div className="slbl rv" style={{background:'#F3EEFF',color:'#7C3AED',margin:'0 auto'}}>💬 WHAT THEY SAY</div>
      <h2 className="sttl rv">Parents and students <span style={{color:'#7C3AED'}}>love Foxy.</span></h2>
      <div className="tgrid">{[
        {s:'★★★★★',q:'My son used to hate Science. Now he asks Foxy doubts on his own! The Hindi explanations made all the difference. His test scores went from 45% to 78% in two months.',n:'Sunita Devi',r:'Parent · Son in Class 8, Patna',bg:'linear-gradient(135deg,#E8590C,#EC4899)'},
        {s:'★★★★★',q:"Foxy is like having a personal tutor but way more patient! I can ask the same question 10 times and it explains differently each time. XP and streaks keep me motivated.",n:'Arjun Mehra',r:'Student · Class 9 CBSE, Delhi',bg:'linear-gradient(135deg,#7C3AED,#2563EB)'},
        {s:'★★★★★',q:"The parent dashboard gives me peace of mind. I can see exactly what topics my daughter is struggling with, and the weekly tips help me support her learning.",n:'Rajesh Khanna',r:'Parent · Daughter in Class 10, Mumbai',bg:'linear-gradient(135deg,#059669,#059669)'}
      ].map((t,i)=><div key={t.n} className={`tc rv${i>0?' d'+i:''}`}><div className="tcst">{t.s}</div><p>&ldquo;{t.q}&rdquo;</p><div className="tca"><div className="tcav" style={{background:t.bg}}>{t.n[0]}</div><div><div className="tcn">{t.n}</div><div className="tcr">{t.r}</div></div></div></div>)}</div>
    </div></section>

    <section className="sec" id="pricing" style={{background:'#F5F3EF'}}><div className="sec-in" style={{textAlign:'center'}}>
      <div className="slbl rv" style={{background:'#fff',color:'#E8590C',margin:'0 auto'}}>🔥 FOUNDING MEMBER PRICING</div>
      <h2 className="sttl rv">Lock in launch prices. <span style={{color:'#E8590C'}}>Forever.</span></h2>
      <p className="ssub rv" style={{margin:'0 auto 8px',textAlign:'center'}}>Join during our founding member launch and keep these prices even after they go up.</p>
      <div className="pgrid">{[
        {nm:'Explorer',tg:'Try before you buy',pr:'Free',og:'',lt:'',fts:[{t:'5 Foxy chats/day',o:1},{t:'3 quizzes/day',o:1},{t:'1 subject',o:1},{t:'First 3 chapters',o:0},{t:'No study plan',o:0}],btn:'Start Free',bbg:'#F5F3EF',bc:'#1C1917',bdg:'',dbg:''},
        {nm:'Starter',tg:'For focused learners',pr:'₹149',og:'₹499',lt:'🚀 70% OFF — Founding Member',fts:[{t:'20 Foxy chats/day',o:1},{t:'10 quizzes/day',o:1},{t:'2 subjects',o:1},{t:'All chapters',o:1},{t:'AI study plan',o:1}],btn:'Choose Starter',bbg:'#2563EB',bc:'#fff',bdg:'EARLY BIRD',dbg:'#2563EB'},
        {nm:'Pro',tg:'For serious students',pr:'₹299',og:'₹999',lt:'🔥 70% OFF — 200 spots left!',fts:[{t:'Unlimited Foxy chats',o:1},{t:'Unlimited quizzes',o:1},{t:'All subjects',o:1},{t:'Parent dashboard',o:1},{t:'Voice tutor',o:1}],btn:'🚀 Get Pro Now',bbg:'#E8590C',bc:'#fff',bdg:'MOST POPULAR',dbg:'#E8590C',pop:1},
        {nm:'Unlimited',tg:'Everything. No limits.',pr:'₹499',og:'₹1,999',lt:'👑 75% OFF — 100 spots!',fts:[{t:'Everything in Pro',o:1},{t:'Priority support',o:1},{t:'Download notes',o:1},{t:'Advanced analytics',o:1},{t:'Early features',o:1}],btn:'Go Unlimited',bbg:'#7C3AED',bc:'#fff',bdg:'BEST VALUE',dbg:'#7C3AED'}
      ].map((p,i)=><div key={p.nm} className={`prc rv${i>0?' d'+i:''}${(p as any).pop?' pop':''}`}>{p.bdg&&<div className="prbdg" style={{background:p.dbg}}>{p.bdg}</div>}<h3>{p.nm}</h3><p className="prtg">{p.tg}</p><div className="pramt">{p.og&&<span className="prog">{p.og}</span>}{p.pr}{p.pr!=='Free'&&<span className="prper">/mo</span>}</div>{p.lt&&<div className="prlt">{p.lt}</div>}<ul className="prfts">{p.fts.map(f=><li key={f.t}><span className={f.o?'prck':'prxx'}>{f.o?'✓':'○'}</span>{f.t}</li>)}</ul><a href={APP} className="prbtn" style={{background:p.bbg,color:p.bc}}>{p.btn}</a></div>)}</div>
    </div></section>

    <section className="sec ltrust"><div className="sec-in">
      <div className="slbl rv" style={{background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.6)',margin:'0 auto'}}>🛡️ SECURITY &amp; TRUST</div>
      <h2 className="sttl rv" style={{color:'#fff'}}>Your child&apos;s data is in the safest hands.</h2>
      <p className="ssub rv" style={{color:'rgba(255,255,255,.5)',margin:'0 auto 48px'}}>Alfanumrik is built with enterprise-grade security. We&apos;re certified by international standards.</p>
      <div className="cgrid">{[
        {nm:'ISO 27001',sb:'Information Security Management',c:'#2563EB',icon:<svg viewBox="0 0 24 24" width={24} height={24}><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>},
        {nm:'ISO 42001',sb:'AI Management System Certified',c:'#7C3AED',icon:<svg viewBox="0 0 24 24" width={24} height={24}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 6v6l4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>},
        {nm:'PCI DSS',sb:'Payment Security Compliant',c:'#059669',icon:<svg viewBox="0 0 24 24" width={24} height={24}><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M2 10h20" stroke="currentColor" strokeWidth="2"/></svg>}
      ].map(c=><div key={c.nm} className="ccard rv"><div className="cci" style={{background:`${c.c}22`,color:c.c}}>{c.icon}</div><div><h4>{c.nm}</h4><p>{c.sb}</p></div></div>)}</div>
      <div className="tnums rv">{[{v:'100%',l:'NCERT Aligned'},{v:'2,142+',l:'Verified MCQs'},{v:'0',l:'Ads. Ever.'},{v:'24/7',l:'AI Availability'}].map(n=><div key={n.l} className="tnum"><strong>{n.v}</strong><span>{n.l}</span></div>)}</div>
    </div></section>

    <section className="sec lfcta"><div className="sec-in" style={{position:'relative',zIndex:1,textAlign:'center'}}>
      <div style={{fontSize:64,marginBottom:16}}>🦊</div>
      <h2 className="sttl rv">Ready to transform how your child <span style={{color:'#E8590C'}}>learns?</span></h2>
      <p className="ssub rv" style={{margin:'0 auto 32px',textAlign:'center'}}>Join thousands of Indian families who trust Foxy. Start free — no credit card required.</p>
      <div style={{display:'flex',gap:14,justifyContent:'center',flexWrap:'wrap'}} className="rv"><a href={APP} className="bp" style={{padding:'18px 40px',fontSize:17}}>🦊 Start Learning Free</a><a href={APP} className="bs" style={{padding:'18px 40px',fontSize:17}}>Register Your Child →</a></div>
      <p style={{marginTop:24,fontSize:13,color:'#A8A29E'}} className="rv">Free forever on Explorer plan · No credit card needed · Cancel anytime</p>
    </div></section>

    <footer className="lft"><div className="lft-in">
      <div className="lft-br"><strong>🦊 Alfanumrik</strong><p>AI-powered adaptive learning by CusioSense Learning India Pvt. Ltd. Making quality education accessible to every student in India.</p></div>
      <div className="lft-col"><h4>Product</h4><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#how">How It Works</a><a href={APP}>Login</a></div>
      <div className="lft-col"><h4>For Students</h4><a href={APP}>Start Learning</a><a href="#features">AI Tutor</a><a href="#features">Quizzes</a><a href="#features">Study Plans</a></div>
      <div className="lft-col"><h4>For Parents</h4><a href={APP}>Register Child</a><a href="#features">Dashboard</a><a href="#features">Reports</a><a href="mailto:support@alfanumrik.com">Support</a></div>
    </div><div className="lft-bot"><p>© 2026 CusioSense Learning India Private Limited. All rights reserved.</p><div className="lft-certs"><span>🛡️ ISO 27001</span><span>🤖 ISO 42001</span><span>💳 PCI DSS</span></div></div></footer>
  </>)
}

function LandingCSS(){return<style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap');
:root{--or:#E8590C;--pu:#7C3AED;--gr:#059669;--bl:#2563EB;--pk:#EC4899;--brd:#F5F3EF;--fd:'Bricolage Grotesque',sans-serif;--fb:'DM Sans',sans-serif}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}body{font-family:var(--fb)!important;color:#1C1917;background:#FEFCF9;overflow-x:hidden}::selection{background:var(--or);color:#fff}
.lnav{position:fixed;top:0;left:0;right:0;z-index:100;padding:14px 32px;display:flex;align-items:center;justify-content:space-between;backdrop-filter:blur(20px);background:rgba(254,252,249,.85);border-bottom:1px solid transparent;transition:all .3s}.lnav.scrolled{border-bottom:1px solid var(--brd);box-shadow:0 1px 12px rgba(0,0,0,.04)}
.lnav-logo{display:flex;align-items:center;gap:10px;text-decoration:none}.lnav-logo strong{font-family:var(--fd);font-size:22px;font-weight:800;color:var(--or)}
.lnav-links{display:flex;align-items:center;gap:28px}.lnav-links a{text-decoration:none;font-size:14px;font-weight:600;color:#57534E;transition:color .2s}.lnav-links a:hover{color:var(--or)}
.lcta{padding:10px 24px;border-radius:12px;background:var(--or);color:#fff!important;font-weight:700;font-size:14px;text-decoration:none;transition:all .2s}.lcta:hover{background:#D14B08;transform:translateY(-1px);box-shadow:0 4px 20px rgba(232,89,12,.3)}
.hero{min-height:100vh;display:flex;align-items:center;padding:120px 32px 80px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(232,89,12,.06),transparent 70%);pointer-events:none}
.hero::after{content:'';position:absolute;bottom:-150px;left:-100px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.04),transparent 70%);pointer-events:none}
.hero-in{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;position:relative;z-index:1}
.hero-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:100px;background:#FFF0E6;color:var(--or);font-size:13px;font-weight:700;margin-bottom:24px}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--or);animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
.hero h1{font-family:var(--fd);font-size:clamp(36px,5vw,56px);font-weight:800;line-height:1.08;letter-spacing:-.03em;margin-bottom:20px}
.grd{background:linear-gradient(135deg,var(--or),var(--pk));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero-sub{font-size:18px;color:#57534E;line-height:1.65;margin-bottom:36px;max-width:480px}
.hero-acts{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:40px}
.bp{padding:16px 36px;border-radius:14px;background:var(--or);color:#fff;font-weight:700;font-size:16px;border:none;cursor:pointer;font-family:var(--fb);transition:all .25s;display:inline-flex;align-items:center;gap:8px;text-decoration:none}.bp:hover{background:#D14B08;transform:translateY(-2px);box-shadow:0 8px 32px rgba(232,89,12,.25)}
.bs{padding:16px 36px;border-radius:14px;background:transparent;color:#1C1917;font-weight:700;font-size:16px;border:2px solid var(--brd);cursor:pointer;font-family:var(--fb);transition:all .25s;display:inline-flex;align-items:center;gap:8px;text-decoration:none}.bs:hover{border-color:var(--or);color:var(--or);transform:translateY(-2px)}
.hero-stats{display:flex;gap:32px}.hst strong{font-family:var(--fd);font-size:28px;font-weight:800;display:block}.hst span{font-size:12px;color:#A8A29E;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.hero-vis{position:relative;display:flex;justify-content:center;align-items:center}
.hphone{width:320px;height:580px;border-radius:40px;background:#0C0A09;box-shadow:0 40px 80px rgba(0,0,0,.15);padding:16px;overflow:hidden}
.hscreen{width:100%;height:100%;border-radius:28px;background:linear-gradient(160deg,#1C1917,#292524);overflow:hidden;padding:24px 18px;display:flex;flex-direction:column}
.phdr{display:flex;align-items:center;gap:10px;margin-bottom:20px}.phav{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--or),var(--pk));display:flex;align-items:center;justify-content:center;font-size:18px}.phn{font-size:14px;font-weight:700;color:#fff}.phs{font-size:11px;color:rgba(255,255,255,.4)}
.cmsgs{flex:1;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.cmsg{max-width:85%;padding:12px 16px;border-radius:16px;font-size:13px;line-height:1.5;animation:chatIn .5s both}.cmsg.bot{background:rgba(255,255,255,.06);color:rgba(255,255,255,.85);border-bottom-left-radius:4px;align-self:flex-start}.cmsg.user{background:var(--or);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
@keyframes chatIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.cmsg:nth-child(1){animation-delay:.3s}.cmsg:nth-child(2){animation-delay:.8s}.cmsg:nth-child(3){animation-delay:1.4s}.cmsg:nth-child(4){animation-delay:2s}
.flt{position:absolute;padding:12px 18px;border-radius:16px;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.08);display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;animation:floatY 4s ease-in-out infinite}@keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}.flt.xp{top:60px;left:-40px}.flt.str{bottom:120px;right:-30px;animation-delay:1s}.flt.qz{top:200px;right:-50px;animation-delay:2s}.fli{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
.bstrip{padding:20px 0;background:var(--brd)}.bstrip-in{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;max-width:1000px;margin:0 auto;padding:0 32px}.bstrip-in>span{font-size:14px;font-weight:700;color:#A8A29E;letter-spacing:.06em;white-space:nowrap}
.sec{padding:100px 32px}.sec-in{max-width:1100px;margin:0 auto}
.slbl{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:100px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px}
.sttl{font-family:var(--fd);font-size:clamp(28px,4vw,44px);font-weight:800;line-height:1.12;letter-spacing:-.02em;margin-bottom:16px}
.ssub{font-size:17px;color:#57534E;line-height:1.6;max-width:560px}
.fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}
.fc{padding:32px 28px;border-radius:20px;border:1px solid var(--brd);background:#fff;transition:all .3s}.fc:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,.06);border-color:transparent}
.fci{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:18px}.fc h3{font-family:var(--fd);font-size:18px;font-weight:700;margin-bottom:8px}.fc p{font-size:14px;color:#57534E;line-height:1.6}
.stps{display:grid;grid-template-columns:repeat(4,1fr);gap:32px;margin-top:48px}.stp{text-align:center;position:relative}.stp::after{content:'→';position:absolute;right:-20px;top:40px;font-size:24px;color:#A8A29E;font-weight:300}.stp:last-child::after{display:none}
.stpn{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px;font-family:var(--fd);font-weight:800}.stp h3{font-size:16px;font-weight:700;margin-bottom:6px}.stp p{font-size:13px;color:#57534E;line-height:1.5}
.pths{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:48px}
.pth{border-radius:20px;padding:48px 40px;transition:all .3s}.pth:hover{transform:translateY(-4px)}.pemo{font-size:48px;margin-bottom:20px;display:block}.pth h3{font-family:var(--fd);font-size:26px;font-weight:800;margin-bottom:12px}.pth p{font-size:15px;line-height:1.6;margin-bottom:24px;opacity:.8}.pth ul{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:28px}.pth ul li{display:flex;align-items:flex-start;gap:8px;font-size:14px;font-weight:500}
.ptcta{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;transition:all .25s;border:none;cursor:pointer;font-family:var(--fb)}.ptcta:hover{transform:translateY(-2px)}
.pstu{background:linear-gradient(160deg,#FFF4ED,#FFF0E6,#FFFBF5)}.stucta{background:var(--or);color:#fff;box-shadow:0 4px 20px rgba(232,89,12,.2)}
.ppar{background:linear-gradient(160deg,#F3EEFF,#EDE9FE,#FAF5FF)}.parcta{background:var(--pu);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,.2)}
.spls{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:32px}.spl{padding:12px 24px;border-radius:100px;font-weight:700;font-size:14px;border:2px solid var(--brd);background:#fff;display:inline-flex;align-items:center;gap:8px;transition:all .2s}.spl:hover{transform:translateY(-2px);border-color:var(--or);box-shadow:0 4px 16px rgba(0,0,0,.04)}
.tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}
.tc{padding:28px;border-radius:20px;border:1px solid var(--brd);background:#fff;text-align:left}.tcst{color:#F59E0B;font-size:14px;letter-spacing:2px;margin-bottom:12px}.tc p{font-size:14px;color:#57534E;line-height:1.65;margin-bottom:16px;font-style:italic}
.tca{display:flex;align-items:center;gap:10px}.tcav{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff}.tcn{font-size:13px;font-weight:700}.tcr{font-size:11px;color:#A8A29E}
.pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:48px}
.prc{padding:28px 24px;border-radius:20px;border:1px solid var(--brd);background:#fff;text-align:center;position:relative;transition:all .3s}.prc:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,.06)}.prc.pop{border:2px solid var(--or);box-shadow:0 8px 32px rgba(232,89,12,.1)}
.prbdg{position:absolute;top:-12px;left:50%;transform:translateX(-50%);padding:4px 16px;border-radius:100px;font-size:11px;font-weight:800;letter-spacing:.04em;color:#fff}
.prc h3{font-family:var(--fd);font-size:20px;font-weight:800;margin-bottom:4px;margin-top:8px}.prtg{font-size:12px;color:#A8A29E;margin-bottom:16px}
.pramt{font-family:var(--fd);font-size:36px;font-weight:800;margin-bottom:4px}.prper{font-size:14px;font-weight:500;color:#A8A29E}.prog{font-size:14px;color:#A8A29E;text-decoration:line-through;margin-right:6px;font-weight:500}
.prlt{display:inline-block;padding:4px 12px;border-radius:8px;background:#FFF0E6;color:var(--or);font-size:11px;font-weight:700;margin-bottom:16px}
.prfts{list-style:none;text-align:left;display:flex;flex-direction:column;gap:8px;margin:16px 0 24px}.prfts li{font-size:13px;display:flex;align-items:center;gap:8px;color:#57534E}.prck{color:#059669;font-weight:800;font-size:14px}.prxx{color:#A8A29E;font-size:14px}
.prbtn{width:100%;padding:14px;border-radius:12px;font-weight:700;font-size:14px;border:none;cursor:pointer;font-family:var(--fb);transition:all .2s;text-decoration:none;display:block;text-align:center}.prbtn:hover{transform:translateY(-1px)}
.ltrust{background:#0C0A09;color:#fff;text-align:center}
.cgrid{display:flex;justify-content:center;gap:32px;flex-wrap:wrap;margin-bottom:40px}
.ccard{padding:24px 32px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);display:flex;align-items:center;gap:16px;transition:all .2s;text-align:left}.ccard:hover{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.06)}.cci{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center}.ccard h4{font-size:16px;font-weight:800;margin-bottom:2px}.ccard p{font-size:12px;color:rgba(255,255,255,.4)}
.tnums{display:flex;justify-content:center;gap:64px;margin-top:48px;flex-wrap:wrap}.tnum strong{font-family:var(--fd);font-size:36px;font-weight:800;display:block}.tnum span{font-size:13px;color:rgba(255,255,255,.4)}
.lfcta{text-align:center;background:linear-gradient(160deg,#FFF4ED,#FFF0E6,#FFFBF5);position:relative;overflow:hidden}.lfcta::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(232,89,12,.08),transparent 70%)}
.lft{background:#0C0A09;color:rgba(255,255,255,.5);padding:60px 32px 32px}
.lft-in{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:48px}
.lft-br strong{font-family:var(--fd);font-size:20px;color:var(--or);display:block;margin-bottom:8px}.lft-br p{font-size:13px;line-height:1.6;max-width:280px}
.lft-col h4{color:rgba(255,255,255,.8);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px}.lft-col a{display:block;font-size:13px;color:rgba(255,255,255,.4);text-decoration:none;margin-bottom:10px;transition:color .2s}.lft-col a:hover{color:var(--or)}
.lft-bot{max-width:1100px;margin:32px auto 0;padding-top:24px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}.lft-bot p{font-size:12px}
.lft-certs{display:flex;gap:20px}.lft-certs span{font-size:11px;color:rgba(255,255,255,.3)}
.rv{opacity:0;transform:translateY(24px);transition:all .6s cubic-bezier(.4,0,.2,1)}.rv.vis{opacity:1;transform:translateY(0)}.d1{transition-delay:.1s}.d2{transition-delay:.2s}.d3{transition-delay:.3s}.d4{transition-delay:.4s}
@media(max-width:1024px){.hero-in{grid-template-columns:1fr;text-align:center;gap:48px}.hero-sub{margin:0 auto 36px}.hero-acts{justify-content:center}.hero-stats{justify-content:center}.hero-vis{order:-1}.hphone{width:260px;height:480px}.flt{display:none}.fgrid{grid-template-columns:1fr 1fr}.stps{grid-template-columns:1fr 1fr;gap:24px}.stp::after{display:none}.pths{grid-template-columns:1fr}.tgrid{grid-template-columns:1fr 1fr}.pgrid{grid-template-columns:1fr 1fr}.lft-in{grid-template-columns:1fr 1fr}.tnums{gap:32px}}
@media(max-width:640px){.sec{padding:60px 20px}.lnav{padding:12px 20px}.lnav-links a:not(.lcta){display:none}.hero{padding:100px 20px 60px}.fgrid,.tgrid{grid-template-columns:1fr}.pgrid{grid-template-columns:1fr}.stps{grid-template-columns:1fr}.hero-stats{flex-direction:column;gap:16px;align-items:center}.lft-in{grid-template-columns:1fr}.tnums{flex-direction:column;gap:24px}}
`}</style>}
