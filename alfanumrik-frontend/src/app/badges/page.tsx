'use client';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { BADGES } from '@/data/curriculum';
import { ArrowLeft, Lock } from 'lucide-react';

const CATS = [{id:'streak',label:'🔥 Streaks',hi:'🔥 स्ट्रीक',color:'#FF6B35'},{id:'mastery',label:'⭐ Mastery',hi:'⭐ महारत',color:'#FFB800'},{id:'speed',label:'⚡ Speed',hi:'⚡ गति',color:'#00B4D8'},{id:'exploration',label:'🗺️ Exploration',hi:'🗺️ खोज',color:'#2DC653'}];

export default function BadgesPage() {
  const { isHi, isLoggedIn } = useStudent();
  const router = useRouter();
  if(!isLoggedIn){router.push('/');return null;}

  return(
    <div className="min-h-screen pb-8">
      <div className="sticky top-0 z-50 glass border-b border-white/5"><div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3"><button onClick={()=>router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button><div><div className="font-bold">{isHi?'🏆 बैज और उपलब्धियाँ':'🏆 Badges & Achievements'}</div><div className="text-xs text-white/25">0/{BADGES.length} {isHi?'अनलॉक':'unlocked'}</div></div></div></div>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-8">
        {CATS.map(cat=>{
          const catBadges = BADGES.filter(b=>b.category===cat.id);
          if(!catBadges.length) return null;
          return(<div key={cat.id} className="animate-slide-up"><h3 className="text-sm font-bold mb-3" style={{color:cat.color}}>{isHi?cat.hi:cat.label}</h3><div className="grid grid-cols-3 gap-3">{catBadges.map(b=>(
            <div key={b.id} className="glass rounded-xl p-4 text-center card-interactive relative opacity-40">
              <div className="absolute top-2 right-2"><Lock className="w-3 h-3 text-white/15" /></div>
              <div className="text-4xl mb-2">{b.icon}</div>
              <div className="text-xs font-bold truncate">{isHi&&b.nameHi?b.nameHi:b.name}</div>
              <div className="text-[10px] text-white/25 mt-1 line-clamp-2">{isHi&&b.descriptionHi?b.descriptionHi:b.description}</div>
              <div className="text-[10px] font-bold mt-2" style={{color:'#FFB800'}}>+{b.xpReward} XP</div>
            </div>
          ))}</div></div>);
        })}
      </div>
    </div>
  );
}
