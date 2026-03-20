'use client';

export function generateStaticParams() {
  return [
    { subject: 'math' },
    { subject: 'science' },
    { subject: 'english' },
    { subject: 'hindi' },
    { subject: 'social_science' },
  ];
}

import { useParams, useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { getConceptsBySubject, getSubjectLabel, getSubjectLabelHi, getSubjectIcon, getSubjectColor } from '@/data/curriculum';
import { getBloomLabel, getBloomColor } from '@/lib/engine';
import type { Subject, ConceptNode } from '@/lib/types';
import { ArrowLeft, Lock, Circle, ChevronRight, BookOpen, Brain, Gamepad2 } from 'lucide-react';

export default function LearnPage() {
  const params = useParams();
  const subject = params?.subject as string;
  const { student, isHi, isLoggedIn } = useStudent();
  const router = useRouter();
  if(!isLoggedIn||!student||!subject){router.push('/dashboard');return null;}
  const subj = subject as Subject;
  const concepts = getConceptsBySubject(subj);
  const color = getSubjectColor(subj);
  const byGrade = new Map<number, ConceptNode[]>();
  concepts.forEach(c=>{const l=byGrade.get(c.grade)||[];l.push(c);byGrade.set(c.grade,l);});
  const grades = Array.from(byGrade.keys()).sort();

  return(
    <div className="min-h-screen pb-8">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{getSubjectIcon(subj)}</span>
            <div>
              <div className="font-bold">{isHi?getSubjectLabelHi(subj):getSubjectLabel(subj)}</div>
              <div className="text-xs text-white/25">{concepts.length} {isHi?'अवधारणाएँ':'concepts'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Progress */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold">{isHi?'समग्र प्रगति':'Overall Progress'}</span>
            <span className="text-xs" style={{color}}>0/{concepts.length}</span>
          </div>
          <div className="w-full bg-surface-800/50 rounded-full h-3">
            <div className="h-3 rounded-full" style={{width:'0%',background:color}} />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3">
          <button onClick={()=>router.push('/foxy')} className="glass rounded-xl p-3 text-center card-interactive">
            <BookOpen className="w-5 h-5 mx-auto mb-1" style={{color}} />
            <div className="text-xs font-bold">{isHi?'सीखो':'Learn'}</div>
          </button>
          <button onClick={()=>router.push('/quiz')} className="glass rounded-xl p-3 text-center card-interactive">
            <Gamepad2 className="w-5 h-5 mx-auto mb-1" style={{color}} />
            <div className="text-xs font-bold">{isHi?'अभ्यास':'Practice'}</div>
          </button>
          <button onClick={()=>router.push('/quiz')} className="glass rounded-xl p-3 text-center card-interactive">
            <Brain className="w-5 h-5 mx-auto mb-1" style={{color}} />
            <div className="text-xs font-bold">{isHi?'क्विज़':'Quiz'}</div>
          </button>
        </div>

        {/* Concept Map */}
        {grades.map(grade=>(
          <div key={grade} className="animate-slide-up">
            <h3 className="text-sm font-bold text-white/40 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold" style={{background:`${color}20`,color}}>{grade}</span>
              {isHi?`कक्षा ${grade}`:`Class ${grade}`}
            </h3>
            <div className="space-y-2 ml-3 border-l-2 pl-4" style={{borderColor:`${color}20`}}>
              {(byGrade.get(grade)||[]).map(concept=>{
                const isLocked = concept.prerequisites.length > 0;
                return(
                  <button key={concept.id} onClick={()=>!isLocked&&router.push('/foxy')} disabled={isLocked} className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all border" style={{background:'rgba(30,27,46,0.3)',borderColor:'rgba(255,255,255,0.05)',opacity:isLocked?0.4:1}}>
                    <div className="flex-shrink-0">{isLocked?<Lock className="w-5 h-5 text-white/15" />:<Circle className="w-5 h-5 text-white/15" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{isHi&&concept.titleHi?concept.titleHi:concept.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{background:`${getBloomColor(concept.bloomLevel)}15`,color:getBloomColor(concept.bloomLevel)}}>{getBloomLabel(concept.bloomLevel)}</span>
                        <span className="text-[10px] text-white/20">{concept.chapter}</span>
                      </div>
                      {concept.cbseCompetency&&<div className="text-[10px] text-white/15 mt-1 truncate">📋 {concept.cbseCompetency}</div>}
                    </div>
                    {!isLocked&&<ChevronRight className="w-4 h-4 text-white/15 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
