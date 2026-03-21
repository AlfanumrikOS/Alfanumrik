"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { BottomNav } from "@/components/ui";

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

const LANGS = [{code:"en",label:"EN"},{code:"hi",label:"HI"},{code:"hinglish",label:"Hing"}];
const MODES = [{id:"learn",label:"Learn",em:"📖"},{id:"practice",label:"Practice",em:"✏️"},{id:"quiz",label:"Quiz",em:"⚡"},{id:"doubt",label:"Doubt",em:"❓"},{id:"revision",label:"Revise",em:"🔄"},{id:"notes",label:"Notes",em:"📝"}];

async function sbGet(path:string){try{const r=await fetch(SB_URL+"/rest/v1/"+path,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"}});if(!r.ok)return null;return r.json();}catch{return null;}}
async function foxyCall(p:object){try{const r=await fetch(SB_URL+"/functions/v1/foxy-tutor",{method:"POST",headers:{Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"},body:JSON.stringify(p)});if(!r.ok)return{reply:"Foxy is resting. Try again!"};return r.json();}catch{return{reply:"Connection issue. Retry!"};}}

/* ── Rich text renderer (preserving all existing logic) ── */
function cleanMd(t:string):string{return t.replace(/\*\*([^*]+)\*\*/g,"[KEY: $1]").replace(/__([^_]+)__/g,"[KEY: $1]").replace(/\*([^*]+)\*/g,"$1").replace(/_([^_]+)_/g,"$1").replace(/`([^`]+)`/g,"[FORMULA: $1]").replace(/^#{1,4}\s+/gm,"");}
function renderInline(text:string,c:{color:string;icon:string}){const clean=cleanMd(text);const parts:JSX.Element[]=[];const re=/\[(KEY|ANS|FORMULA|DIAGRAM|TIP|MARKS):\s*([^\]]+)\]/g;let m;let last=0;let ki=0;while((m=re.exec(clean))!==null){if(m.index>last)parts.push(<span key={ki++}>{clean.substring(last,m.index)}</span>);const tag=m[1],val=m[2];if(tag==="KEY")parts.push(<span key={ki++} className="font-bold" style={{color:c.color,borderBottom:"2px solid "+c.color+"40",paddingBottom:1}}>{val}</span>);else if(tag==="ANS")parts.push(<span key={ki++} className="inline-block px-3 py-1 my-1 rounded-lg font-extrabold text-sm" style={{border:"2px solid "+c.color,color:c.color,background:c.color+"08"}}>{val}</span>);else if(tag==="FORMULA")parts.push(<span key={ki++} className="inline-block px-3 py-1.5 my-1 rounded-lg font-semibold text-xs" style={{background:"var(--surface-2)",border:"1px solid var(--border)",fontFamily:"monospace"}}>{val}</span>);else if(tag==="TIP")parts.push(<div key={ki++} className="my-2 px-3 py-2.5 rounded-xl text-xs" style={{background:"#fffbeb",border:"1px solid #f59e0b30",color:"#92400e"}}><span className="font-extrabold">Exam Tip: </span>{val}</div>);else if(tag==="MARKS")parts.push(<span key={ki++} className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold ml-1" style={{background:"#7c3aed15",color:"#7c3aed"}}>({val} marks)</span>);last=m.index+m[0].length;}if(last<clean.length)parts.push(<span key={ki++}>{clean.substring(last)}</span>);return parts.length>0?<>{parts}</>:<span>{clean}</span>;}
function Rich({content,subject}:{content:string;subject:string}){const c=SUBJECTS[subject]||SUBJECTS.science;if(!content)return null;const text=cleanMd(content);const lines=text.split("\n");const el:JSX.Element[]=[];let li:string[]=[];let lk:string|null=null;
function fl(){if(li.length>0){el.push(<div key={"l"+el.length} className="my-3 px-4 py-3 rounded-r-xl" style={{background:c.color+"08",borderLeft:"3px solid "+c.color}}>{li.map((item,i)=><div key={i} className="flex gap-2.5 py-1.5 items-start" style={{borderBottom:i<li.length-1?"1px solid #f0f0f0":"none"}}><span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{background:c.color+"20",color:c.color}}>{lk==="num"?i+1:"\u2022"}</span><span className="leading-relaxed">{renderInline(item,c)}</span></div>)}</div>);li=[];lk=null;}}
lines.forEach((line,idx)=>{const t=line.trim();if(t.startsWith("###")){fl();el.push(<h4 key={idx} className="text-sm font-bold mt-4 mb-2 uppercase tracking-wide" style={{color:c.color}}>{c.icon+" "+t.replace(/^###\s*/,"")}</h4>);}else if(t.startsWith("##")){fl();el.push(<h3 key={idx} className="text-base font-bold mt-4 mb-2 pb-2" style={{borderBottom:"2px solid "+c.color+"30"}}>{t.replace(/^##\s*/,"")}</h3>);}else if(t.startsWith(">")){fl();el.push(<div key={idx} className="my-3 px-4 py-3 rounded-xl text-sm leading-relaxed" style={{background:c.color+"08",border:"1px solid "+c.color+"25"}}>{renderInline(t.replace(/^>\s*/,""),c)}</div>);}else if(/^\d+[.)]\s/.test(t)){if(lk!=="num"){fl();lk="num";}li.push(t.replace(/^\d+[.)]\s*/,""));}else if(/^[-\u2022*]\s/.test(t)){if(lk!=="bul"){fl();lk="bul";}li.push(t.replace(/^[-\u2022*]\s*/,""));}else if(!t){fl();el.push(<div key={idx} className="h-2"/>);}else{fl();el.push(<p key={idx} className="my-1.5 leading-[1.75] text-[var(--text-2)]">{renderInline(t,c)}</p>);}});fl();return <div>{el}</div>;}

/* ── Chat Input (mobile-optimized) ── */
function ChatInput({onSubmit,subject,disabled,onMicTap,isListening}:{onSubmit:(t:string)=>void;subject:string;disabled:boolean;onMicTap?:()=>void;isListening?:boolean}){
  const[text,setText]=useState("");const taRef=useRef<HTMLTextAreaElement>(null);
  const c=SUBJECTS[subject]||SUBJECTS.science;
  const send=()=>{if(!text.trim()||disabled)return;onSubmit(text.trim());setText("");if(taRef.current){taRef.current.style.height="auto";}};
  const handleKey=(e:React.KeyboardEvent)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}};
  const autoGrow=(e:React.ChangeEvent<HTMLTextAreaElement>)=>{setText(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";};
  return(
    <div className="border-t px-3 py-2.5 flex items-end gap-2" style={{background:"var(--surface-1)",borderColor:"var(--border)",paddingBottom:"max(env(safe-area-inset-bottom, 8px), 8px)"}}>
      <textarea ref={taRef} value={text} onChange={autoGrow} onKeyDown={handleKey} placeholder="Ask Foxy anything..." rows={1}
        className="flex-1 text-sm rounded-2xl px-4 py-2.5 resize-none outline-none leading-relaxed"
        style={{background:"var(--surface-2)",border:"1.5px solid var(--border)",fontFamily:"var(--font-body)",maxHeight:120,minHeight:40}}/>
      {onMicTap&&<button onClick={onMicTap} className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all active:scale-90"
        style={{background:isListening?"#EF444420":"var(--surface-2)",border:isListening?"2px solid #EF4444":"1.5px solid var(--border)"}}>
        {isListening?"🔴":"🎤"}
      </button>}
      <button onClick={send} disabled={disabled||!text.trim()}
        className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-bold transition-all active:scale-90 disabled:opacity-40"
        style={{background:text.trim()?`linear-gradient(135deg,${c.color},${c.color}dd)`:"var(--surface-2)",color:text.trim()?"#fff":"var(--text-3)"}}>
        {disabled?"...":"\u2191"}
      </button>
    </div>
  );
}

export default function FoxyPage(){
  const { student: authStudent, isLoggedIn, isLoading: authLoading } = useAuth();
  const routerNav = useRouter();
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
  const[chatSessionId,setChatSessionId]=useState<string|null>(null);
  const[xpGained,setXpGained]=useState(0);
  const[streakDays,setStreakDays]=useState(0);
  const[totalXP,setTotalXP]=useState(0);
  const[studentGrade,setStudentGrade]=useState("9");
  const[showTopics,setShowTopics]=useState(false);
  const[sidebarOpen,setSidebarOpen]=useState(true);
  const[showSubjectDD,setShowSubjectDD]=useState(false);
  const[showChapterDD,setShowChapterDD]=useState(false);
  const[selectedChapters,setSelectedChapters]=useState<string[]>([]);
  const[studentSelectedSubjects,setStudentSelectedSubjects]=useState<string[]>([]);
  const endRef=useRef<HTMLDivElement>(null);
  const[voiceEnabled,setVoiceEnabled]=useState(false);
  const[isSpeaking,setIsSpeaking]=useState(false);
  const[isListening,setIsListening]=useState(false);
  const recognitionRef=useRef<any>(null);

  // ── Voice TTS: Find best Indian voice ──
  // ── Preload voices (they load async in Chrome) ──
  const voicesRef=useRef<SpeechSynthesisVoice[]>([]);
  useEffect(()=>{
    if(typeof window==='undefined'||!window.speechSynthesis)return;
    const loadVoices=()=>{voicesRef.current=window.speechSynthesis.getVoices();};
    loadVoices();
    window.speechSynthesis.onvoiceschanged=loadVoices;
    return()=>{window.speechSynthesis.onvoiceschanged=null;};
  },[]);

  const speakText=useCallback((text:string)=>{
    if(!voiceEnabled||typeof window==='undefined'||!window.speechSynthesis)return;
    window.speechSynthesis.cancel();
    // Clean formatting tokens for natural speech
    let clean=text;
    clean=clean.replace(/\[KEY:\s*([^\]]+)\]/g,'$1');
    clean=clean.replace(/\[ANS:\s*([^\]]+)\]/g,'The answer is $1.');
    clean=clean.replace(/\[FORMULA:\s*([^\]]+)\]/g,'The formula is $1.');
    clean=clean.replace(/\[TIP:\s*([^\]]+)\]/g,'Exam tip: $1.');
    clean=clean.replace(/\[MARKS:\s*([^\]]+)\]/g,'This is a $1 marks question.');
    clean=clean.replace(/\[DIAGRAM:\s*([^\]]+)\]/g,'You should draw a diagram of $1.');
    clean=clean.replace(/<!--[\s\S]*?-->/g,'');
    clean=clean.replace(/\n+/g,'. ').replace(/\s+/g,' ').trim();
    if(!clean)return;

    // Pick best Indian voice from preloaded list
    const voices=voicesRef.current.length>0?voicesRef.current:window.speechSynthesis.getVoices();
    const pickVoice=()=>{
      if(language==='hi'){
        return voices.find(v=>v.lang==='hi-IN')||voices.find(v=>v.lang.startsWith('hi'));
      }
      return voices.find(v=>v.lang==='en-IN')||voices.find(v=>v.name.toLowerCase().includes('india'))||voices.find(v=>v.name.toLowerCase().includes('rishi'))||voices.find(v=>v.lang.startsWith('en')&&v.name.toLowerCase().includes('female'))||voices.find(v=>v.lang.startsWith('en'))||null;
    };
    const voice=pickVoice();

    // Speak as one utterance (more reliable across browsers than splitting)
    const utter=new SpeechSynthesisUtterance(clean);
    if(voice)utter.voice=voice;
    utter.rate=0.9;
    utter.pitch=1.05;
    utter.volume=1;
    utter.lang=language==='hi'?'hi-IN':'en-IN';
    utter.onstart=()=>setIsSpeaking(true);
    utter.onend=()=>setIsSpeaking(false);
    utter.onerror=()=>setIsSpeaking(false);

    // Chrome bug workaround: long utterances stop after ~15s. Chunk if needed.
    if(clean.length>300){
      // Split on sentence boundaries without lookbehind (mobile safe)
      const chunks=clean.match(/[^.!?]+[.!?]+/g)||[clean];
      setIsSpeaking(true);
      chunks.forEach((chunk,i)=>{
        const u=new SpeechSynthesisUtterance(chunk.trim());
        if(voice)u.voice=voice;
        u.rate=0.9;u.pitch=1.05;u.volume=1;
        u.lang=language==='hi'?'hi-IN':'en-IN';
        if(i===chunks.length-1)u.onend=()=>setIsSpeaking(false);
        u.onerror=()=>setIsSpeaking(false);
        window.speechSynthesis.speak(u);
      });
    } else {
      window.speechSynthesis.speak(utter);
    }
  },[voiceEnabled,language]);

  const stopSpeaking=useCallback(()=>{
    if(typeof window!=='undefined'&&window.speechSynthesis){window.speechSynthesis.cancel();setIsSpeaking(false);}
  },[]);



  useEffect(()=>{if(!authLoading&&!isLoggedIn)routerNav.replace("/");},[authLoading,isLoggedIn,routerNav]);

  useEffect(()=>{(async()=>{
    if(!authStudent)return;
    setStudent(authStudent);setTotalXP(authStudent.xp_total||0);setStreakDays(authStudent.streak_days||0);
    const grade=(authStudent.grade||"9").replace("Grade ","");setStudentGrade(grade);
    setLanguage(authStudent.preferred_language||"en");
    const subj=typeof window!=="undefined"?(localStorage.getItem("alfanumrik_subject")||authStudent.preferred_subject||"science"):(authStudent.preferred_subject||"science");
    setActiveSubject(subj);
    setStudentSelectedSubjects((authStudent.selected_subjects || [authStudent.preferred_subject].filter(Boolean)) as string[]);
  })();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[authStudent]);

  useEffect(()=>{(async()=>{
    const d=await sbGet("curriculum_topics?grade=eq."+encodeURIComponent("Grade "+studentGrade)+"&parent_topic_id=is.null&is_active=eq.true&order=chapter_number,display_order&limit=50");
    if(d)setTopics(d);
    if(student?.id){const m=await sbGet("topic_mastery?student_id=eq."+student.id+"&subject=eq."+activeSubject+"&order=updated_at.desc");if(m)setMasteryData(m);}
  })();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeSubject,studentGrade,student]);

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const sendMessage=useCallback(async(text:string)=>{
    if(!text.trim())return;
    setMessages(p=>[...p,{id:Date.now(),role:"student",content:text,timestamp:new Date().toISOString()}]);
    setLoading(true);setFoxyState("thinking");setShowTopics(false);
    try{
      const chapContext=selectedChapters.length>0?topics.filter(t=>selectedChapters.includes(t.id)).map(t=>"Ch "+t.chapter_number+": "+t.title).join(", "):null;
      const resp=await foxyCall({message:text,student_id:student?.id||"",student_name:student?.name||"Student",grade:studentGrade,subject:activeSubject,language,mode:sessionMode,topic_id:activeTopic?.id||null,topic_title:activeTopic?.title||null,session_id:chatSessionId,selected_chapters:chapContext});
      const reply=resp.reply||resp.response||resp.message||"Let me think...";const xp=resp.xp_earned||0;
      setMessages(p=>[...p,{id:Date.now()+1,role:"tutor",content:reply,timestamp:new Date().toISOString(),xp}]);
      if(voiceEnabled)setTimeout(()=>speakText(reply),300);
      if(xp>0)setXpGained(p=>p+xp);if(resp.session_id)setChatSessionId(resp.session_id);
      setFoxyState("happy");setTimeout(()=>setFoxyState("idle"),2000);
    }catch{setMessages(p=>[...p,{id:Date.now()+1,role:"tutor",content:"Oops! Please resend.",timestamp:new Date().toISOString()}]);setFoxyState("idle");}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[student,studentGrade,activeSubject,language,sessionMode,activeTopic,chatSessionId]);

  // ── Speech-to-Text: Mic input for conversational mode ──
  const startListening=useCallback(()=>{
    if(typeof window==='undefined')return;
    const SpeechRecognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
    if(!SpeechRecognition){alert('Speech recognition not supported in this browser. Try Chrome.');return;}
    const recognition=new SpeechRecognition();
    recognition.continuous=false;
    recognition.interimResults=false;
    recognition.lang=language==='hi'?'hi-IN':'en-IN';
    recognition.onstart=()=>setIsListening(true);
    recognition.onresult=(event:any)=>{const transcript=event.results[0][0].transcript;if(transcript.trim())sendMessage(transcript.trim());};
    recognition.onerror=()=>setIsListening(false);
    recognition.onend=()=>setIsListening(false);
    recognitionRef.current=recognition;
    recognition.start();
  },[language,sendMessage]);

  const stopListening=useCallback(()=>{
    if(recognitionRef.current){recognitionRef.current.stop();setIsListening(false);}
  },[]);

  const cfg=SUBJECTS[activeSubject]||SUBJECTS.science;
  const FOXY:Record<string,string>={idle:"\uD83E\uDD8A",thinking:"\uD83E\uDD14",happy:"\uD83D\uDE04"};

  if(authLoading||!student) return(
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-center"><div className="text-5xl animate-float mb-3">{FOXY.idle}</div><p className="text-sm text-[var(--text-3)]">Loading Foxy...</p></div>
    </div>
  );

  return(
    <div className="min-h-dvh flex flex-col pb-nav" style={{background:"var(--surface-2)"}}>
      {/* ── HEADER: Foxy avatar + info + lang (mobile-optimized) ── */}
      <header className="sticky top-0 z-30 px-3 py-2.5 flex items-center gap-3" style={{background:"linear-gradient(135deg,#1a1a2e,#0f3460)",color:"#fff"}}>
        <button onClick={()=>routerNav.push("/dashboard")} className="text-white/60 text-sm">&larr;</button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{background:"linear-gradient(135deg,#E8590C,#F59E0B)",animation:foxyState==="thinking"?"pulse 1s infinite":"none"}}>
          {FOXY[foxyState]||FOXY.idle}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">Foxy <span className="text-[10px] font-semibold opacity-60">AI Tutor</span></div>
          <div className="text-[10px] opacity-50 flex gap-2"><span>{totalXP+xpGained} XP</span><span>{streakDays}d streak</span><span>Gr {studentGrade}</span></div>
        </div>
        <div className="flex items-center gap-1.5">
          {LANGS.map(l=><button key={l.code} onClick={()=>setLanguage(l.code)} className="text-[10px] font-bold px-2 py-1 rounded-lg transition-all" style={{background:language===l.code?"rgba(255,255,255,0.2)":"transparent",color:language===l.code?"#fff":"rgba(255,255,255,0.4)"}}>{l.label}</button>)}
          {/* Voice toggle */}
          <button onClick={()=>{if(voiceEnabled){stopSpeaking();setVoiceEnabled(false);}else{setVoiceEnabled(true);}}} className="ml-1 px-2 py-1 rounded-lg text-sm transition-all" style={{background:voiceEnabled?"rgba(245,166,35,0.3)":"rgba(255,255,255,0.1)"}} title={voiceEnabled?"Voice ON - Foxy will speak":"Enable Foxy voice"}>
            {voiceEnabled?(isSpeaking?"🔊":"🔈"):"🔇"}
          </button>
        </div>
      </header>

      {/* ── SUBJECT & CHAPTER DROPDOWNS + MODE SELECTOR ── */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-2" style={{background:"var(--surface-1)",borderBottom:"1px solid var(--border)"}}>
        {/* Subject Dropdown */}
        <div className="relative">
          <button onClick={()=>{setShowSubjectDD(!showSubjectDD);setShowChapterDD(false);}} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{background:cfg.color+"10",border:`1.5px solid ${cfg.color}30`,color:cfg.color}}>
            <span className="text-sm">{cfg.icon}</span>
            <span>{cfg.name}</span>
            <span className="text-[10px] ml-0.5 opacity-60">{showSubjectDD?'\u25B2':'\u25BC'}</span>
          </button>
          {showSubjectDD&&(
            <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-2xl overflow-hidden shadow-lg" style={{background:"var(--surface-1)",border:"1px solid var(--border)"}}>
              <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] px-3">My Subjects</div>
              {(studentSelectedSubjects.length>0?studentSelectedSubjects:Object.keys(SUBJECTS)).map(key=>{
                const sub=SUBJECTS[key]; if(!sub) return null;
                return(
                  <button key={key} onClick={()=>{setActiveSubject(key);setActiveTopic(null);setSelectedChapters([]);setShowSubjectDD(false);}} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all" style={{background:activeSubject===key?`${sub.color}08`:"transparent",borderLeft:activeSubject===key?`3px solid ${sub.color}`:"3px solid transparent"}}>
                    <span className="text-base">{sub.icon}</span>
                    <span className="text-sm font-semibold" style={{color:activeSubject===key?sub.color:"var(--text-1)"}}>{sub.name}</span>
                    {activeSubject===key&&<span className="ml-auto text-xs" style={{color:sub.color}}>\u2713</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Chapter Dropdown (multi-select) */}
        <div className="relative">
          <button onClick={()=>{setShowChapterDD(!showChapterDD);setShowSubjectDD(false);}} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{background:"var(--surface-2)",border:"1.5px solid var(--border)",color:"var(--text-2)"}}>
            <span className="text-sm">📖</span>
            <span>{selectedChapters.length>0?`${selectedChapters.length} Chapter${selectedChapters.length>1?'s':''}`:`All ${topics.length} Chapters`}</span>
            <span className="text-[10px] ml-0.5 opacity-60">{showChapterDD?'\u25B2':'\u25BC'}</span>
          </button>
          {showChapterDD&&(
            <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-[50vh] rounded-2xl overflow-hidden shadow-lg flex flex-col" style={{background:"var(--surface-1)",border:"1px solid var(--border)"}}>
              <div className="p-2 px-3 flex items-center justify-between" style={{borderBottom:"1px solid var(--border)"}}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">{cfg.icon} {cfg.name} Chapters</span>
                <button onClick={()=>{setSelectedChapters([]);}} className="text-[10px] font-semibold" style={{color:"var(--orange)"}}>Clear All</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {topics.map(topic=>{
                  const sel=selectedChapters.includes(topic.id);
                  const mastery=masteryData.find((m:any)=>m.topic_tag===topic.title||m.chapter_number===topic.chapter_number);
                  const lvl=mastery?.mastery_level||"not_started";
                  const lc:Record<string,string>={not_started:"#9ca3af",beginner:"#F59E0B",developing:"#3B82F6",proficient:"#8B5CF6",mastered:"#10B981"};
                  return(
                    <button key={topic.id} onClick={()=>setSelectedChapters(prev=>sel?prev.filter(x=>x!==topic.id):[...prev,topic.id])} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all" style={{background:sel?`${cfg.color}06`:"transparent",borderBottom:"1px solid var(--border)"}}>
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px]" style={{background:sel?cfg.color:"var(--surface-2)",color:sel?"#fff":"var(--text-3)",border:sel?"none":"1.5px solid var(--border)"}}>{sel?'\u2713':''}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate" style={{color:"var(--text-1)"}}>Ch {topic.chapter_number}: {topic.title}</div>
                      </div>
                      <span className="text-[9px] font-bold capitalize px-1.5 py-0.5 rounded" style={{background:(lc[lvl]||"#9ca3af")+"15",color:lc[lvl]||"#9ca3af"}}>{(lvl).replace("_"," ")}</span>
                    </button>
                  );
                })}
              </div>
              {selectedChapters.length>0&&(
                <div className="p-2 px-3" style={{borderTop:"1px solid var(--border)"}}>
                  <button onClick={()=>{
                    const ch=topics.find(t=>selectedChapters.includes(t.id));
                    if(ch){setActiveTopic(ch);sendMessage("Teach me about: "+ch.title+" (Chapter "+ch.chapter_number+")");setShowChapterDD(false);}
                  }} className="w-full py-2 rounded-xl text-xs font-bold text-white" style={{background:cfg.color}}>
                    Start with Selected Chapter{selectedChapters.length>1?'s':''}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mode pills */}
        <div className="flex gap-1 ml-auto overflow-x-auto" style={{scrollbarWidth:"none"}}>
          {MODES.map(m=><button key={m.id} onClick={()=>setSessionMode(m.id)} className="shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all" style={{background:sessionMode===m.id?cfg.color+"15":"transparent",color:sessionMode===m.id?cfg.color:"var(--text-3)"}}>{m.em}</button>)}
        </div>
      </div>

      {/* Close dropdowns when clicking outside */}
      {(showSubjectDD||showChapterDD)&&<div className="fixed inset-0 z-40" onClick={()=>{setShowSubjectDD(false);setShowChapterDD(false);}}/>}

      {/* ── MAIN CHAT AREA ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop collapsible sidebar */}
        <div className="hidden lg:flex shrink-0 relative" style={{width:sidebarOpen?280:0,transition:"width 0.3s ease"}}>
          <div className="flex flex-col overflow-hidden border-r" style={{background:"var(--surface-1)",borderColor:"var(--border)",width:280,position:"absolute",top:0,bottom:0,left:0,transform:sidebarOpen?"translateX(0)":"translateX(-100%)",transition:"transform 0.3s ease"}}>
            <div className="p-3 text-xs font-bold flex items-center justify-between" style={{color:cfg.color,borderBottom:"1px solid var(--border)"}}>
              <span>{cfg.icon} {cfg.name} - Gr {studentGrade} ({topics.length})</span>
              <button onClick={()=>setSidebarOpen(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all hover:opacity-70" style={{background:"var(--surface-2)",color:"var(--text-3)"}} title="Collapse sidebar">&laquo;</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {topics.map(topic=>{
                const mastery=masteryData.find((m:any)=>m.topic_tag===topic.title||m.chapter_number===topic.chapter_number);
                const pct=mastery?.mastery_percent||0;
                const lvl=mastery?.mastery_level||"not_started";
                const lc:Record<string,string>={not_started:"#9ca3af",beginner:"#F59E0B",developing:"#3B82F6",proficient:"#8B5CF6",mastered:"#10B981"};
                return(
                  <button key={topic.id} onClick={()=>{setActiveTopic(topic);sendMessage("Teach me about: "+topic.title+" (Chapter "+topic.chapter_number+")");}} className="w-full text-left p-3 rounded-xl transition-all active:scale-[0.98]" style={{border:`1px solid ${(lc[lvl]||"#9ca3af")}25`,background:"var(--surface-1)"}}>
                    <div className="text-xs font-bold truncate" style={{color:"var(--text-1)"}}>Ch {topic.chapter_number}: {topic.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-16 h-1.5 rounded-full" style={{background:"var(--surface-2)"}}><div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:lc[lvl]||"#9ca3af"}}/></div>
                      <span className="text-[10px] font-bold capitalize" style={{color:lc[lvl]||"#9ca3af"}}>{(lvl).replace("_"," ")}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar expand button (visible when collapsed, desktop only) */}
        {!sidebarOpen&&<button onClick={()=>setSidebarOpen(true)} className="hidden lg:flex shrink-0 w-8 items-center justify-center border-r cursor-pointer transition-all hover:bg-[var(--surface-2)]" style={{background:"var(--surface-1)",borderColor:"var(--border)"}} title="Show chapters">
          <span className="text-[10px]" style={{color:"var(--text-3)"}}>&raquo;</span>
        </button>}

        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4">
            {/* Empty state */}
            {messages.length===0&&(
              <div className="text-center py-12 md:py-20 animate-slide-up">
                <div className="text-6xl md:text-7xl mb-4 animate-float">{FOXY.idle}</div>
                <h2 className="text-xl md:text-2xl font-extrabold mb-2" style={{fontFamily:"var(--font-display)",background:`linear-gradient(135deg,#E8590C,${cfg.color})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Hi! I am Foxy</h2>
                <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto mb-6 leading-relaxed">Your AI tutor. Pick a topic, type below, or tap 🎤 to talk!</p>
                {/* Quick prompts */}
                <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                  {["What should I study today?","Quick quiz","Explain last topic","Formula sheet","Weak areas"].map((text,i)=>(
                    <button key={i} onClick={()=>sendMessage(text)} className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95" style={{background:"var(--surface-1)",border:"1px solid var(--border)",color:"var(--text-2)"}}>{text}</button>
                  ))}
                </div>
                {/* Mobile: Topics button */}
                <button onClick={()=>setShowChapterDD(true)} className="mt-6 px-5 py-2.5 rounded-xl text-sm font-bold" style={{background:cfg.color+"10",color:cfg.color,border:`1.5px solid ${cfg.color}30`}}>
                  {cfg.icon} Browse {topics.length} Chapters
                </button>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg:any)=>(
              <div key={msg.id} className={`flex mb-4 gap-2.5 items-start ${msg.role==="student"?"justify-end":"justify-start"}`} style={{animation:"fadeInUp 0.3s ease"}}>
                {msg.role==="tutor"&&<div className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-base shrink-0" style={{background:"linear-gradient(135deg,#E8590C,#F59E0B)"}}>{FOXY.idle}</div>}
                <div className="relative" style={{maxWidth:"min(85%, 520px)"}}>
                  <div className={`px-4 py-3 text-sm leading-relaxed ${msg.role==="student"?"rounded-2xl rounded-br-sm":"rounded-2xl rounded-bl-sm"}`}
                    style={{background:msg.role==="student"?`linear-gradient(135deg,${cfg.color},${cfg.color}dd)`:"var(--surface-1)",color:msg.role==="student"?"#fff":"var(--text-1)",border:msg.role==="tutor"?"1px solid var(--border)":"none",boxShadow:msg.role==="student"?`0 2px 12px ${cfg.color}20`:"0 1px 6px rgba(0,0,0,0.04)"}}>
                    {msg.role==="tutor"?<Rich content={msg.content} subject={activeSubject}/>:<div className="whitespace-pre-wrap">{msg.content}</div>}
                    <div className="text-[10px] opacity-40 mt-1.5 text-right">{new Date(msg.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                  </div>
                  {msg.xp>0&&<div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-lg text-[10px] font-extrabold text-white" style={{background:"linear-gradient(135deg,#F59E0B,#EF4444)"}}>+{msg.xp} XP</div>}
                </div>
                {msg.role==="student"&&<div className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-bold shrink-0" style={{background:`linear-gradient(135deg,${cfg.color},${cfg.color}bb)`}}>{student?.name?student.name[0].toUpperCase():"S"}</div>}
              </div>
            ))}

            {/* Thinking indicator */}
            {loading&&(
              <div className="flex gap-2.5 items-center mb-4">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{background:"linear-gradient(135deg,#E8590C,#F59E0B)",animation:"pulse 1s infinite"}}>{FOXY.thinking}</div>
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5" style={{background:"var(--surface-1)",border:"1px solid var(--border)"}}>
                  {[0,1,2].map(i=><div key={i} className="w-2 h-2 rounded-full" style={{background:cfg.color,animation:`pulse 1s infinite ${i*0.2}s`,opacity:0.5}}/>)}
                  <span className="text-xs text-[var(--text-3)] ml-1.5">Foxy is thinking...</span>
                </div>
              </div>
            )}
            <div ref={endRef}/>
          </div>

          {/* Chat input */}
          <ChatInput onSubmit={sendMessage} subject={activeSubject} disabled={loading} onMicTap={isListening?stopListening:startListening} isListening={isListening}/>
        </div>
      </div>

      {/* ── MOBILE TOPICS BOTTOM SHEET ── */}
      {showTopics&&(
        <>
          <div className="fixed inset-0 z-40 lg:hidden" style={{background:"rgba(0,0,0,0.3)"}} onClick={()=>setShowTopics(false)}/>
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl max-h-[75vh] flex flex-col lg:hidden" style={{background:"var(--surface-1)",boxShadow:"0 -8px 40px rgba(0,0,0,0.1)"}}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{background:"var(--border)"}}/></div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <span className="text-sm font-bold" style={{color:cfg.color}}>{cfg.icon} {cfg.name} - Grade {studentGrade}</span>
              <button onClick={()=>setShowTopics(false)} className="text-xs text-[var(--text-3)] font-semibold">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
              {topics.map(topic=>{
                const mastery=masteryData.find((m:any)=>m.topic_tag===topic.title||m.chapter_number===topic.chapter_number);
                const pct=mastery?.mastery_percent||0;
                const lvl=mastery?.mastery_level||"not_started";
                const lc:Record<string,string>={not_started:"#9ca3af",beginner:"#F59E0B",developing:"#3B82F6",proficient:"#8B5CF6",mastered:"#10B981"};
                return(
                  <button key={topic.id} onClick={()=>{setActiveTopic(topic);setShowTopics(false);sendMessage("Teach me about: "+topic.title+" (Chapter "+topic.chapter_number+")");}} className="w-full text-left p-3.5 rounded-xl flex items-center gap-3 active:scale-[0.98] transition-all" style={{background:"var(--surface-2)",border:`1px solid ${(lc[lvl]||"#9ca3af")}20`}}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{background:(lc[lvl]||"#9ca3af")+"15"}}>{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{color:"var(--text-1)"}}>Ch {topic.chapter_number}: {topic.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full" style={{background:"var(--border)"}}><div className="h-full rounded-full" style={{width:`${pct}%`,background:lc[lvl]||"#9ca3af"}}/></div>
                        <span className="text-[10px] font-bold capitalize shrink-0" style={{color:lc[lvl]||"#9ca3af"}}>{pct}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Stop speaking floating button */}
      {isSpeaking&&<button onClick={stopSpeaking} className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all" style={{background:"#EF4444",color:"#fff",fontSize:18,boxShadow:"0 4px 20px rgba(239,68,68,0.4)"}}>
        <span style={{fontSize:20}}>&#x25A0;</span>
      </button>}

      <BottomNav/>

      {/* Animations */}
      <style dangerouslySetInnerHTML={{__html:"@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}"}}/>
    </div>
  );
}
