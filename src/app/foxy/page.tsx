"use client";
import { useState, useEffect, useRef, useCallback } from "react";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dxipobqngyfpqbbznojz.supabase.co";
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE1ODQ1MDcsImV4cCI6MjA1NzE2MDUwN30.CZJH4VPQa6MHmYkXXxnEFPkfGhJnBPqMlG3MwjUe3tE";

const SUBJECTS: Record<string, {name:string;icon:string;color:string;symbols:string[];tools:string[]}> = {
  math:{name:"Mathematics",icon:"\u2211",color:"#3B82F6",symbols:["\u222B","\u2202","\u221A","\u03C0","\u221E","\u2248","\u2260","\u2264","\u2265","\u0394","\u03B8","\u03B1","\u03B2","\u2208","\u2205","\u222A","\u2229","\u00B1","\u00F7","\u00D7","\u00B2","\u00B3","\u2081","\u2082"],tools:["Calculator","Graph Plotter","Formula Sheet","Geometry Kit"]},
  science:{name:"Science",icon:"\u269B",color:"#10B981",symbols:["\u2697","\u26A1","\u2103","\u03A9","\u03BC","\u03BB","\u212B","\u2192","\u21CC","\u2191","\u2193","\u0394","\u221D","mol","pH","atm","Pa","Hz","eV","nm","kg","N","J","W"],tools:["Periodic Table","Unit Converter","Lab Simulator","Diagram Tool"]},
  english:{name:"English",icon:"Aa",color:"#8B5CF6",symbols:["\u2014","\u2013","\u2026","\u00A9","\u00AE","\u2122","\u00B6","\u00A7","\u2020","\u2021","\u2022","\u00B7","\u00AB","\u00BB","\u00B9","\u00B2","\u00B3"],tools:["Dictionary","Grammar Check","Essay Outline","Reading Log"]},
  hindi:{name:"Hindi",icon:"\u0905",color:"#F59E0B",symbols:["\u0964","\u0965","\u0901","\u0902","\u0903","\u093D","\u094D","\u0950","\u20B9"],tools:["Shabdkosh","Vyakaran","Nibandh","Kavita"]},
  physics:{name:"Physics",icon:"\u26A1",color:"#EF4444",symbols:["F","m","a","v","t","s","\u03C9","\u03C4","\u03C1","\u03C3","\u03B5","\u03BC","\u03BB","\u03BD","\u0394","\u2192","\u22A5","\u2225","\u221D","\u210F","eV"],tools:["Formula Reference","Vector Visualizer","Circuit Builder","Motion Graphs"]},
  chemistry:{name:"Chemistry",icon:"\u2697",color:"#06B6D4",symbols:["\u2192","\u21CC","\u2191","\u2193","\u0394","\u00B0","\u207A","\u207B","\u00B7","\u2261","mol","aq","(s)","(l)","(g)","pH"],tools:["Periodic Table","Equation Balancer","Molarity Calc","VSEPR Shapes"]},
  biology:{name:"Biology",icon:"\u2695",color:"#22C55E",symbols:["\u2642","\u2640","\u00D7","\u2192","\u21D2","ATP","DNA","RNA","mRNA","CO2","O2","H2O"],tools:["Cell Diagram","Taxonomy Tree","Body Systems","Genetics Calc"]}
};

const LANGS = [{code:"en",label:"English"},{code:"hi",label:"Hindi"},{code:"hinglish",label:"Hinglish"},{code:"ta",label:"Tamil"},{code:"te",label:"Telugu"},{code:"bn",label:"Bangla"}];
const MODES = [{id:"learn",label:"Learn",color:"#3B82F6"},{id:"practice",label:"Practice",color:"#10B981"},{id:"quiz",label:"Quiz",color:"#F59E0B"},{id:"doubt",label:"Doubt",color:"#8B5CF6"},{id:"revision",label:"Revise",color:"#EF4444"},{id:"notes",label:"Notes",color:"#06B6D4"}];

async function sbGet(path:string){try{const r=await fetch(SB_URL+"/rest/v1/"+path,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"}});if(!r.ok)return null;return r.json();}catch{return null;}}
async function foxyCall(p:object){try{const r=await fetch(SB_URL+"/functions/v1/foxy-tutor",{method:"POST",headers:{Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"},body:JSON.stringify(p)});if(!r.ok)return{reply:"Foxy is resting. Try again!"};return r.json();}catch{return{reply:"Connection issue. Retry!"};}}

function Rich({content,subject}:{content:string;subject:string}){const c=SUBJECTS[subject]||SUBJECTS.science;if(!content)return null;const lines=content.split("\n");const el:JSX.Element[]=[];let li:string[]=[];let lk:string|null=null;
function fl(){if(li.length>0){el.push(<div key={"l"+el.length} style={{margin:"12px 0",padding:"12px 16px",background:c.color+"08",borderLeft:"3px solid "+c.color,borderRadius:"0 12px 12px 0"}}>{li.map((item,i)=><div key={i} style={{display:"flex",gap:10,padding:"6px 0",alignItems:"flex-start",borderBottom:i<li.length-1?"1px solid #f0f0f0":"none"}}><span style={{minWidth:24,height:24,borderRadius:"50%",background:c.color+"20",color:c.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{lk==="num"?i+1:"\u2022"}</span><span style={{lineHeight:1.6}}>{item}</span></div>)}</div>);li=[];lk=null;}}
lines.forEach((line,idx)=>{const t=line.trim();if(t.startsWith("###")){fl();el.push(<h4 key={idx} style={{fontSize:14,fontWeight:700,color:c.color,margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:1}}>{c.icon+" "+t.replace(/^###\s*/,"")}</h4>);}else if(t.startsWith("##")){fl();el.push(<h3 key={idx} style={{fontSize:16,fontWeight:700,color:"#1a1a2e",margin:"18px 0 10px",paddingBottom:8,borderBottom:"2px solid "+c.color+"30"}}>{t.replace(/^##\s*/,"")}</h3>);}else if(t.startsWith(">")){fl();el.push(<div key={idx} style={{margin:"12px 0",padding:"14px 16px",background:c.color+"08",border:"1px solid "+c.color+"25",borderRadius:12,fontSize:14,lineHeight:1.7}}>{t.replace(/^>\s*/,"")}</div>);}else if(/^\d+[.)]\s/.test(t)){if(lk!=="num"){fl();lk="num";}li.push(t.replace(/^\d+[.)]\s*/,""));}else if(/^[-\u2022*]\s/.test(t)){if(lk!=="bul"){fl();lk="bul";}li.push(t.replace(/^[-\u2022*]\s*/,""));}else if(!t){fl();el.push(<div key={idx} style={{height:8}}/>);}else{fl();el.push(<p key={idx} style={{margin:"6px 0",lineHeight:1.75,color:"#374151"}}>{t}</p>);}});fl();return <div>{el}</div>;}

function Input({onSubmit,subject}:{onSubmit:(t:string)=>void;subject:string}){
  const[points,setPoints]=useState([""]);const[mode,setMode]=useState("free");const c=SUBJECTS[subject]||SUBJECTS.science;const[showSym,setShowSym]=useState(false);const[showTools,setShowTools]=useState(false);const taRef=useRef<HTMLTextAreaElement>(null);const[aPt,setAPt]=useState(0);
  function ins(s:string){if(mode==="points"){const u=[...points];u[aPt]=(u[aPt]||"")+s;setPoints(u);}else if(taRef.current){const ta=taRef.current;const st=ta.selectionStart;ta.value=ta.value.substring(0,st)+s+ta.value.substring(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=st+s.length;ta.focus();}}
  function go(){if(mode==="points"){const f=points.filter(p=>p.trim());if(!f.length)return;onSubmit(f.map((p,i)=>(i+1)+". "+p).join("\n"));setPoints([""]);}else{const v=taRef.current?.value?.trim();if(!v)return;onSubmit(v);if(taRef.current)taRef.current.value="";}}
  function kd(e:React.KeyboardEvent){if(e.key==="Enter"&&!e.shiftKey&&mode==="free"){e.preventDefault();go();}if(e.key==="Enter"&&mode==="points"){e.preventDefault();setPoints([...points,""]);}}
  return(<div style={{padding:"16px 20px",background:"#fff",borderTop:"1px solid #e5e7eb"}}>
    <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:11,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>Answer:</span>
      {[{id:"free",l:"Free Text"},{id:"points",l:"Point-wise"}].map(m=><button key={m.id} onClick={()=>setMode(m.id)} style={{padding:"4px 12px",borderRadius:20,border:mode===m.id?"2px solid "+c.color:"1px solid #e5e7eb",background:mode===m.id?c.color+"10":"#fff",color:mode===m.id?c.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{m.l}</button>)}
      <button onClick={()=>setShowSym(!showSym)} style={{marginLeft:"auto",padding:"4px 12px",borderRadius:20,border:showSym?"2px solid "+c.color:"1px solid #e5e7eb",background:showSym?c.color+"10":"#fff",color:showSym?c.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{c.icon} Symbols</button>
      <button onClick={()=>setShowTools(!showTools)} style={{padding:"4px 12px",borderRadius:20,border:showTools?"2px solid "+c.color:"1px solid #e5e7eb",background:showTools?c.color+"10":"#fff",color:showTools?c.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>Tools</button>
    </div>
    {showSym&&<div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"10px 12px",background:c.color+"05",borderRadius:12,marginBottom:10,border:"1px solid "+c.color+"20",maxHeight:120,overflowY:"auto"}}>{c.symbols.map((s,i)=><button key={i} onClick={()=>ins(s)} style={{width:36,height:36,borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace"}}>{s}</button>)}</div>}
    {showTools&&<div style={{display:"flex",gap:8,padding:"10px 0",marginBottom:10,flexWrap:"wrap"}}>{c.tools.map((t,i)=><button key={i} onClick={()=>onSubmit("/tool "+t)} style={{padding:"8px 16px",borderRadius:12,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,color:"#374151"}}>{t}</button>)}</div>}
    {mode==="points"?<div style={{marginBottom:10}}>{points.map((pt,idx)=><div key={idx} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}><span style={{minWidth:28,height:28,borderRadius:"50%",background:pt.trim()?c.color+"20":"#f3f4f6",color:pt.trim()?c.color:"#9ca3af",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{idx+1}</span><input value={pt} onChange={e=>{const u=[...points];u[idx]=e.target.value;setPoints(u);}} onFocus={()=>setAPt(idx)} onKeyDown={kd} placeholder={"Point "+(idx+1)+"..."} style={{flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid #e5e7eb",fontSize:14,outline:"none",fontFamily:"Nunito,sans-serif"}}/>{points.length>1&&<button onClick={()=>setPoints(points.filter((_,i)=>i!==idx))} style={{width:28,height:28,borderRadius:"50%",border:"1px solid #fecaca",background:"#fef2f2",color:"#ef4444",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>x</button>}</div>)}<button onClick={()=>setPoints([...points,""])} style={{padding:"6px 14px",borderRadius:8,border:"1px dashed "+c.color+"40",background:"transparent",color:c.color,fontSize:12,fontWeight:600,cursor:"pointer"}}>+ Add Point</button></div>:<textarea ref={taRef} onKeyDown={kd} placeholder="Type your answer or ask Foxy..." rows={2} style={{width:"100%",padding:"12px 16px",borderRadius:12,border:"1px solid #e5e7eb",fontSize:14,outline:"none",resize:"vertical",fontFamily:"Nunito,sans-serif",lineHeight:1.6,marginBottom:10,boxSizing:"border-box"}}/>}
    <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={go} style={{padding:"10px 24px",borderRadius:12,border:"none",background:"linear-gradient(135deg,"+c.color+","+c.color+"dd)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 12px "+c.color+"30"}}>Send to Foxy</button></div>
  </div>);
}

function Ring({value,size=60,color,label}:{value:number;size?:number;color:string;label?:string}){const r=(size-8)/2;const ci=2*Math.PI*r;const o=ci-(value/100)*ci;return<div style={{textAlign:"center"}}><svg width={size} height={size} style={{transform:"rotate(-90deg)"}}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={4}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4} strokeDasharray={ci} strokeDashoffset={o} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s ease"}}/></svg><div style={{marginTop:-size/2-8,fontSize:size>50?14:11,fontWeight:800,color,height:size,display:"flex",alignItems:"center",justifyContent:"center"}}>{Math.round(value)}%</div>{label&&<div style={{fontSize:10,color:"#9ca3af",marginTop:2,fontWeight:600}}>{label}</div>}</div>;}

function TopicCard({topic,onClick,mastery,subject}:{topic:any;onClick:()=>void;mastery:any;subject:string}){const c=SUBJECTS[subject]||SUBJECTS.science;const pct=mastery?.mastery_percent||0;const lvl=mastery?.mastery_level||"not_started";const lc:Record<string,string>={not_started:"#9ca3af",beginner:"#F59E0B",developing:"#3B82F6",proficient:"#8B5CF6",mastered:"#10B981"};return<button onClick={onClick} style={{padding:"14px 16px",borderRadius:16,border:"1px solid "+(lc[lvl]||"#9ca3af")+"25",background:"#fff",cursor:"pointer",textAlign:"left",width:"100%",display:"flex",alignItems:"center",gap:14,transition:"all 0.3s",boxShadow:"0 2px 8px rgba(0,0,0,0.04)",fontFamily:"Nunito,sans-serif"}}><Ring value={pct} size={48} color={lc[lvl]||"#9ca3af"}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:"#1a1a2e",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Ch {topic.chapter_number}: {topic.title}</div><div style={{fontSize:11,color:"#6b7280",marginTop:2,display:"flex",alignItems:"center",gap:6}}><span style={{padding:"1px 8px",borderRadius:10,background:(lc[lvl]||"#9ca3af")+"15",color:lc[lvl]||"#9ca3af",fontSize:10,fontWeight:700,textTransform:"capitalize"}}>{(lvl as string).replace("_"," ")}</span>{topic.estimated_minutes&&<span style={{fontSize:10,color:"#9ca3af"}}>{topic.estimated_minutes}m</span>}</div></div></button>;}

export default function FoxyPage(){
  const[student,setStudent]=useState<any>(null);
  const[activeSubject,setActiveSubject]=useState("science");
  const[topics,setTopics]=useState<any[]>([]);
  const[masteryData,setMasteryData]=useState<any[]>([]);
  const[messages,setMessages]=useState<any[]>([]);
  const[loading,setLoading]=useState(false);
  const[sessionMode,setSessionMode]=useState("learn");
  const[language,setLanguage]=useState("en");
  const[activeTopic,setActiveTopic]=useState<any>(null);
  const[foxyState,setFoxyState]=useState("idle");
  const[sidePanel,setSidePanel]=useState("topics");
  const[chatSessionId,setChatSessionId]=useState<string|null>(null);
  const[xpGained,setXpGained]=useState(0);
  const[streakDays,setStreakDays]=useState(0);
  const[totalXP,setTotalXP]=useState(0);
  const[dailyActivity,setDailyActivity]=useState<any>(null);
  const[recentNotes,setRecentNotes]=useState<any[]>([]);
  const[studentGrade,setStudentGrade]=useState("9");
  const endRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{(async()=>{
    const grade=typeof window!=="undefined"?(localStorage.getItem("alfanumrik_grade")||"9"):"9";
    const lang=typeof window!=="undefined"?(localStorage.getItem("alfanumrik_language")||"en"):"en";
    setStudentGrade(grade);setLanguage(lang);
    const stu=await sbGet("students?limit=1&order=created_at.desc");
    if(stu&&stu[0]){setStudent(stu[0]);setTotalXP(stu[0].xp_total||0);setStreakDays(stu[0].streak_days||0);setStudentGrade((stu[0].grade||"Grade 9").replace("Grade ",""));const td=new Date().toISOString().split("T")[0];const act=await sbGet("daily_activity?student_id=eq."+stu[0].id+"&activity_date=eq."+td+"&limit=1");if(act&&act[0])setDailyActivity(act[0]);const notes=await sbGet("student_notes?student_id=eq."+stu[0].id+"&order=created_at.desc&limit=5");if(notes)setRecentNotes(notes);}
    else{setStudent({id:"demo",name:"Demo Student",grade:"Grade "+grade});}
  })();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{(async()=>{
    const d=await sbGet("curriculum_topics?grade=eq."+encodeURIComponent("Grade "+studentGrade)+"&parent_topic_id=is.null&is_active=eq.true&order=chapter_number,display_order&limit=50");
    if(d)setTopics(d);
    if(student?.id&&student.id!=="demo"){const m=await sbGet("topic_mastery?student_id=eq."+student.id+"&subject=eq."+activeSubject+"&order=updated_at.desc");if(m)setMasteryData(m);}
  })();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeSubject,studentGrade,student]);

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const sendMessage=useCallback(async(text:string)=>{
    if(!text.trim())return;
    setMessages(p=>[...p,{id:Date.now(),role:"student",content:text,timestamp:new Date().toISOString()}]);
    setLoading(true);setFoxyState("thinking");
    try{
      const resp=await foxyCall({message:text,student_id:student?.id||"demo",student_name:student?.name||"Student",grade:studentGrade,subject:activeSubject,language,mode:sessionMode,topic_id:activeTopic?.id||null,topic_title:activeTopic?.title||null,session_id:chatSessionId});
      const reply=resp.reply||resp.response||resp.message||"Let me think...";const xp=resp.xp_earned||0;
      setMessages(p=>[...p,{id:Date.now()+1,role:"tutor",content:reply,timestamp:new Date().toISOString(),xp}]);
      if(xp>0)setXpGained(p=>p+xp);if(resp.session_id)setChatSessionId(resp.session_id);
      setFoxyState("happy");setTimeout(()=>setFoxyState("idle"),2000);
    }catch{setMessages(p=>[...p,{id:Date.now()+1,role:"tutor",content:"Oops! Please resend.",timestamp:new Date().toISOString()}]);setFoxyState("idle");}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[student,studentGrade,activeSubject,language,sessionMode,activeTopic,chatSessionId]);

  const cfg=SUBJECTS[activeSubject]||SUBJECTS.science;
  const FOXY:Record<string,string>={idle:"\uD83E\uDD8A",thinking:"\uD83E\uDD14",happy:"\uD83D\uDE04"};

  return(
    <div style={{fontFamily:"Nunito,Segoe UI,sans-serif",height:"100vh",display:"flex",flexDirection:"column",background:"#f8fafc",color:"#1a1a2e"}}>
      <style dangerouslySetInnerHTML={{__html:"@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}*{box-sizing:border-box;scrollbar-width:thin}"}}/>

      <div style={{padding:"10px 20px",background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)",color:"#fff",display:"flex",alignItems:"center",gap:16,boxShadow:"0 4px 20px rgba(0,0,0,0.3)",zIndex:10}}>
        <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#E8590C,#F59E0B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,animation:foxyState==="thinking"?"pulse 1s infinite":"none",boxShadow:"0 0 20px rgba(232,89,12,0.4)"}}>{FOXY[foxyState]||FOXY.idle}</div>
        <div style={{flex:1}}><div style={{fontSize:16,fontWeight:800}}>Foxy <span style={{fontSize:11,fontWeight:600,opacity:0.7}}>Your Intelligent Guide</span></div><div style={{fontSize:11,opacity:0.6,display:"flex",gap:12,marginTop:2}}><span>{student?.name||"Student"}</span><span>Grade {studentGrade}</span><span>{streakDays}d streak</span><span>{totalXP+xpGained} XP</span></div></div>
        <select value={language} onChange={e=>setLanguage(e.target.value)} style={{padding:"6px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",outline:"none"}}>{LANGS.map(l=><option key={l.code} value={l.code} style={{color:"#000"}}>{l.label}</option>)}</select>
      </div>

      <div style={{padding:"8px 20px",background:"#fff",borderBottom:"1px solid #e5e7eb",display:"flex",gap:8,alignItems:"center",overflowX:"auto"}}>
        {Object.entries(SUBJECTS).map(([key,sub])=><button key={key} onClick={()=>{setActiveSubject(key);setActiveTopic(null);}} style={{padding:"6px 14px",borderRadius:20,border:activeSubject===key?"2px solid "+sub.color:"1px solid #e5e7eb",background:activeSubject===key?sub.color+"10":"transparent",color:activeSubject===key?sub.color:"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",flexShrink:0}}><span style={{fontSize:14}}>{sub.icon}</span>{sub.name}</button>)}
        <div style={{flex:1}}/>
        {MODES.map(m=><button key={m.id} onClick={()=>setSessionMode(m.id)} style={{padding:"5px 10px",borderRadius:16,border:sessionMode===m.id?"2px solid "+m.color:"1px solid transparent",background:sessionMode===m.id?m.color+"10":"transparent",color:sessionMode===m.id?m.color:"#9ca3af",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{m.label}</button>)}
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <div style={{width:300,borderRight:"1px solid #e5e7eb",background:"#fff",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #e5e7eb"}}>{["topics","stats","notes"].map(tab=><button key={tab} onClick={()=>setSidePanel(tab)} style={{flex:1,padding:"10px 0",border:"none",borderBottom:sidePanel===tab?"3px solid "+cfg.color:"3px solid transparent",background:sidePanel===tab?cfg.color+"05":"transparent",color:sidePanel===tab?cfg.color:"#9ca3af",fontSize:12,fontWeight:700,cursor:"pointer",textTransform:"capitalize"}}>{tab}</button>)}</div>
          <div style={{flex:1,overflowY:"auto",padding:12}}>
            {sidePanel==="topics"&&<div style={{display:"flex",flexDirection:"column",gap:8}}><div style={{padding:"10px 14px",background:cfg.color+"10",borderRadius:12,fontSize:12,color:cfg.color,fontWeight:700}}>{cfg.icon} {cfg.name} - Grade {studentGrade} ({topics.length})</div>{topics.map(topic=>{const mastery=masteryData.find((m:any)=>m.topic_tag===topic.title||m.chapter_number===topic.chapter_number);return<TopicCard key={topic.id} topic={topic} mastery={mastery} subject={activeSubject} onClick={()=>{setActiveTopic(topic);sendMessage("Teach me about: "+topic.title+" (Chapter "+topic.chapter_number+")");}}/>;})}</div>}
            {sidePanel==="stats"&&<div style={{display:"flex",flexDirection:"column",gap:16}}><div style={{padding:20,background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:16,color:"#fff",display:"flex",justifyContent:"space-around",textAlign:"center"}}><div><div style={{fontSize:28,fontWeight:900,color:"#F59E0B"}}>{totalXP+xpGained}</div><div style={{fontSize:10,opacity:0.7}}>Total XP</div></div><div><div style={{fontSize:28,fontWeight:900,color:"#EF4444"}}>{streakDays}</div><div style={{fontSize:10,opacity:0.7}}>Streak</div></div></div><div style={{padding:"14px 16px",background:"#f9fafb",borderRadius:12,border:"1px solid #e5e7eb"}}><div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Today</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{[{l:"Sessions",v:dailyActivity?.sessions_count||0},{l:"Questions",v:dailyActivity?.questions_asked||0},{l:"Correct",v:dailyActivity?.questions_correct||0},{l:"XP",v:(dailyActivity?.xp_earned||0)+xpGained}].map((s,i)=><div key={i} style={{padding:10,background:"#fff",borderRadius:10,textAlign:"center",border:"1px solid #f3f4f6"}}><div style={{fontSize:18,fontWeight:800}}>{s.v}</div><div style={{fontSize:10,color:"#9ca3af"}}>{s.l}</div></div>)}</div></div></div>}
            {sidePanel==="notes"&&<div style={{display:"flex",flexDirection:"column",gap:8}}><button onClick={()=>sendMessage("/notes create")} style={{padding:12,borderRadius:12,border:"2px dashed "+cfg.color+"40",background:"transparent",color:cfg.color,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Ask Foxy for notes</button>{recentNotes.map((n:any,i:number)=><div key={i} style={{padding:"12px 14px",borderRadius:12,border:"1px solid #e5e7eb",background:"#fff",borderLeft:"4px solid "+(n.color||"#E8590C")}}><div style={{fontSize:13,fontWeight:700}}>{n.title}</div><div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{n.content?.substring(0,120)}...</div></div>)}{recentNotes.length===0&&<div style={{padding:20,textAlign:"center",color:"#9ca3af",fontSize:13}}>No notes yet</div>}</div>}
          </div>
        </div>

        <div style={{flex:1,display:"flex",flexDirection:"column",background:"linear-gradient(180deg,#f8fafc,#f1f5f9)"}}>
          <div style={{flex:1,overflowY:"auto",padding:20}}>
            {messages.length===0&&<div style={{textAlign:"center",padding:"60px 40px",animation:"fadeInUp 0.5s ease"}}><div style={{fontSize:80,marginBottom:16,animation:"float 3s ease-in-out infinite"}}>{FOXY.idle}</div><h2 style={{fontSize:24,fontWeight:900,background:"linear-gradient(135deg,#E8590C,"+cfg.color+")",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:8}}>Hi! I am Foxy</h2><p style={{color:"#6b7280",fontSize:14,lineHeight:1.8,maxWidth:500,margin:"0 auto"}}>Your Intelligent Guide. Pick any chapter from the left, or type below!</p><div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginTop:24}}>{["What should I study today?","Start a quick quiz","Show my weak areas","Create smart notes","Give me formula sheet"].map((text,i)=><button key={i} onClick={()=>sendMessage(text)} style={{padding:"10px 18px",borderRadius:14,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,color:"#374151",boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>{text}</button>)}</div></div>}
            {messages.map((msg:any)=><div key={msg.id} style={{display:"flex",justifyContent:msg.role==="student"?"flex-end":"flex-start",marginBottom:16,animation:"fadeInUp 0.3s ease",gap:10,alignItems:"flex-start"}}>{msg.role==="tutor"&&<div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#E8590C,#F59E0B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{FOXY.idle}</div>}<div style={{maxWidth:"75%",padding:"14px 18px",borderRadius:msg.role==="student"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:msg.role==="student"?"linear-gradient(135deg,"+cfg.color+","+cfg.color+"dd)":"#fff",color:msg.role==="student"?"#fff":"#1a1a2e",fontSize:14,lineHeight:1.7,boxShadow:msg.role==="student"?"0 4px 12px "+cfg.color+"25":"0 2px 12px rgba(0,0,0,0.06)",border:msg.role==="tutor"?"1px solid #f3f4f6":"none",position:"relative"}}>{msg.role==="tutor"?<Rich content={msg.content} subject={activeSubject}/>:<div style={{whiteSpace:"pre-wrap"}}>{msg.content}</div>}{msg.xp>0&&<div style={{position:"absolute",top:-8,right:-8,background:"linear-gradient(135deg,#F59E0B,#EF4444)",color:"#fff",padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:800}}>+{msg.xp} XP</div>}<div style={{fontSize:10,opacity:0.5,marginTop:6,textAlign:"right"}}>{new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></div>{msg.role==="student"&&<div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,"+cfg.color+","+cfg.color+"bb)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",fontWeight:800,flexShrink:0}}>{student?.name?student.name[0].toUpperCase():"S"}</div>}</div>)}
            {loading&&<div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16}}><div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#E8590C,#F59E0B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,animation:"pulse 1s infinite"}}>{FOXY.thinking}</div><div style={{padding:"12px 20px",borderRadius:"18px 18px 18px 4px",background:"#fff",border:"1px solid #f3f4f6",display:"flex",gap:6}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:cfg.color,animation:"pulse 1s infinite "+(i*0.2)+"s",opacity:0.6}}/>)}<span style={{fontSize:12,color:"#9ca3af",marginLeft:6}}>Foxy is thinking...</span></div></div>}
            <div ref={endRef}/>
          </div>
          <Input onSubmit={sendMessage} subject={activeSubject}/>
        </div>
      </div>
    </div>
  );
}
