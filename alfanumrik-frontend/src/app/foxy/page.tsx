'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { foxyChat } from '@/lib/supabase';
import type { FoxyMessage, SessionMode } from '@/lib/types';
import { ArrowLeft, Send, Globe, BookOpen, Brain, Gamepad2, RefreshCw } from 'lucide-react';

const MODES: {id:SessionMode;label:string;hi:string;icon:React.ElementType;color:string}[] = [
  {id:'learn',label:'Learn',hi:'सीखो',icon:BookOpen,color:'#FF6B35'},
  {id:'practice',label:'Practice',hi:'अभ्यास',icon:Brain,color:'#00B4D8'},
  {id:'quiz',label:'Quiz Me',hi:'क्विज़',icon:Gamepad2,color:'#2DC653'},
  {id:'review',label:'Review',hi:'दोहराओ',icon:RefreshCw,color:'#9B4DAE'},
];

const PROMPTS_EN = ["Explain Newton's Laws with examples 🍎","Help me solve quadratic equations 📐","Teach me photosynthesis 🌱","What is Ohm's Law? ⚡","Quiz me on fractions 🎯"];
const PROMPTS_HI = ["न्यूटन के नियम उदाहरण से समझाओ 🍎","द्विघात समीकरण सिखाओ 📐","प्रकाश संश्लेषण बताओ 🌱","ओम का नियम क्या है? ⚡","भिन्नों पर क्विज़ करो 🎯"];

export default function FoxyPage() {
  const { student, isHi, setLang, isLoggedIn } = useStudent();
  const router = useRouter();
  const [messages, setMessages] = useState<FoxyMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<SessionMode>('learn');
  const [sessionId] = useState<string|undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages]);

  useEffect(() => {
    if(messages.length===0 && student) {
      setMessages([{id:crypto.randomUUID(),role:'foxy',content:isHi?`🦊 नमस्ते ${student.name}! मैं फॉक्सी हूँ — तुम्हारी पढ़ाई की साथी!\n\nआज क्या सीखना है? नीचे कोई विषय चुनो, या कुछ भी पूछो! 😊`:`🦊 Hey ${student.name}! I'm Foxy — your learning buddy!\n\nWhat shall we explore today? Pick a topic below, or ask me anything! 😊`,timestamp:new Date().toISOString()}]);
    }
  }, [student, isHi, messages.length]);

  const send = useCallback(async (text: string) => {
    if(!text.trim()||loading||!student) return;
    const userMsg: FoxyMessage = {id:crypto.randomUUID(),role:'user',content:text.trim(),timestamp:new Date().toISOString()};
    setMessages(p=>[...p,userMsg]);
    setInput('');
    setLoading(true);
    setMessages(p=>[...p,{id:'typing',role:'foxy',content:'',timestamp:new Date().toISOString(),isTyping:true}]);

    const history = messages.filter(m=>!m.isTyping).map(m=>({role:m.role,content:m.content}));
    history.push({role:'user',content:text.trim()});

    const response = await foxyChat(history, student.name, student.grade, isHi?'hi':'en', mode, sessionId);

    setLoading(false);
    setMessages(p=>p.filter(m=>m.id!=='typing').concat({id:crypto.randomUUID(),role:'foxy',content:response,timestamp:new Date().toISOString()}));
  },[loading,student,messages,mode,isHi,sessionId]);

  if(!isLoggedIn){router.push('/');return null;}
  const prompts = isHi?PROMPTS_HI:PROMPTS_EN;

  return(
    <div className="h-screen flex flex-col">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
              <span className="text-2xl">🦊</span>
              <div><div className="font-bold text-sm">Foxy</div><div className="text-[10px] text-white/25">{isHi?'तुम्हारा AI ट्यूटर':'Your AI Tutor'}</div></div>
            </div>
            <button onClick={()=>setLang(isHi?'en':'hi')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10"><Globe className="w-3.5 h-3.5" />{isHi?'EN':'हिं'}</button>
          </div>
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {MODES.map(m=>(
              <button key={m.id} onClick={()=>setMode(m.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all" style={{background:mode===m.id?`${m.color}20`:'transparent',border:`1px solid ${mode===m.id?m.color:'rgba(255,255,255,0.1)'}`,color:mode===m.id?m.color:'rgba(255,255,255,0.4)'}}>
                <m.icon className="w-3.5 h-3.5" />{isHi?m.hi:m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map(msg=>(
          <div key={msg.id} className={`flex ${msg.role==='user'?'justify-end':'justify-start'} animate-slide-up`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role==='user'?'rounded-br-md':'rounded-bl-md'}`} style={{background:msg.role==='user'?'linear-gradient(135deg,#FF6B35,#FFB800)':'rgba(30,27,46,0.7)',border:msg.role==='foxy'?'1px solid rgba(123,45,142,0.2)':'none'}}>
              {msg.isTyping
                ? <div className="flex gap-1.5 py-2 px-1">{[0,1,2].map(i=><div key={i} className="w-2 h-2 rounded-full typing-dot" style={{background:'#9B4DAE'}} />)}</div>
                : <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>}
            </div>
          </div>
        ))}
        {messages.filter(m=>m.role==='user').length===0 && (
          <div className="space-y-2 mt-4">
            <div className="text-xs text-white/20 text-center mb-2">{isHi?'💡 इनमें से कुछ पूछो:':'💡 Try asking:'}</div>
            {prompts.map((p,i)=><button key={i} onClick={()=>send(p)} className="w-full text-left px-4 py-3 rounded-xl text-sm card-interactive" style={{background:'rgba(30,27,46,0.5)',border:'1px solid rgba(255,255,255,0.08)'}}>{p}</button>)}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 glass border-t border-white/5 p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <input type="text" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send(input)} placeholder={isHi?'फॉक्सी से कुछ पूछो...':'Ask Foxy anything...'} className="flex-1 px-4 py-3 rounded-xl bg-surface-800/50 border border-white/10 text-white placeholder-white/20 focus:border-brand-orange focus:outline-none focus:ring-2 focus:ring-brand-orange/20 transition-all text-sm" disabled={loading} />
          <button onClick={()=>send(input)} disabled={!input.trim()||loading} className="w-11 h-11 rounded-xl flex items-center justify-center transition-all disabled:opacity-30" style={{background:input.trim()?'linear-gradient(135deg,#FF6B35,#FFB800)':'rgba(255,255,255,0.05)'}}><Send className="w-5 h-5 text-white" /></button>
        </div>
      </div>
    </div>
  );
}
