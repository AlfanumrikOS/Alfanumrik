'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const BADGES = [
  { id: 'first_quiz', icon: '🎯', name: 'First Quiz', desc: 'Completed your first quiz', req: (p: any) => p.totalQuizzes >= 1 },
  { id: 'quiz_5', icon: '📚', name: 'Quiz Enthusiast', desc: 'Completed 5 quizzes', req: (p: any) => p.totalQuizzes >= 5 },
  { id: 'quiz_10', icon: '🏆', name: 'Quiz Champion', desc: 'Completed 10 quizzes', req: (p: any) => p.totalQuizzes >= 10 },
  { id: 'quiz_25', icon: '👑', name: 'Quiz Master', desc: 'Completed 25 quizzes', req: (p: any) => p.totalQuizzes >= 25 },
  { id: 'streak_3', icon: '🔥', name: '3-Day Streak', desc: 'Learned 3 days in a row', req: (p: any) => p.streakDays >= 3 },
  { id: 'streak_7', icon: '⚡', name: 'Weekly Warrior', desc: '7-day learning streak', req: (p: any) => p.streakDays >= 7 },
  { id: 'streak_30', icon: '🌟', name: 'Monthly Legend', desc: '30-day streak!', req: (p: any) => p.streakDays >= 30 },
  { id: 'score_80', icon: '🎓', name: 'High Scorer', desc: 'Average score above 80%', req: (p: any) => p.avgScore >= 80 },
  { id: 'score_90', icon: '💎', name: 'Genius', desc: 'Average score above 90%', req: (p: any) => p.avgScore >= 90 },
  { id: 'foxy_chat', icon: '🦊', name: 'Foxy\'s Friend', desc: 'Had 5 Foxy sessions', req: (p: any) => p.sessionCount >= 5 },
  { id: 'first_chat', icon: '💬', name: 'First Chat', desc: 'Asked Foxy a question', req: (p: any) => p.sessionCount >= 1 },
  { id: 'explorer', icon: '🗺️', name: 'Explorer', desc: 'Tried 3 different topics', req: (p: any) => p.totalQuizzes >= 3 },
]

export default function BadgesScreen({ token }: { token: string }) {
  const [progress, setProgress] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getProgress(token).then(d => { setProgress(d.progress); setLoading(false) })
    .catch(() => setLoading(false))
  }, [token])

  const earned = progress ? BADGES.filter(b => b.req(progress)) : []
  const locked = BADGES.filter(b => !earned.find(e => e.id === b.id))

  if (loading) return (
    <div className="screen items-center justify-center">
      <div className="text-5xl foxy-animate">🏆</div>
      <p className="text-saffron font-bold mt-3">Loading badges...</p>
    </div>
  )

  return (
    <div className="screen overflow-y-auto pb-6">
      <div className="bg-forest px-6 pt-12 pb-6 rounded-b-[2.5rem]">
        <h1 className="font-display text-3xl font-extrabold text-white">Badges 🏆</h1>
        <p className="text-cream/60 mt-1">{earned.length} of {BADGES.length} earned</p>
        <div className="bg-white/10 rounded-2xl mt-3 p-3">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-saffron rounded-full progress-fill" style={{ width: `${(earned.length / BADGES.length) * 100}%` }} />
          </div>
          <p className="text-cream/50 text-xs mt-2">{Math.round((earned.length / BADGES.length) * 100)}% complete</p>
        </div>
      </div>

      <div className="px-5 mt-5">
        {earned.length > 0 && (
          <div className="mb-6">
            <h2 className="font-bold text-forest mb-3">✅ Earned ({earned.length})</h2>
            <div className="grid grid-cols-3 gap-3">
              {earned.map(b => (
                <BadgeCard key={b.id} badge={b} earned />
              ))}
            </div>
          </div>
        )}

        {locked.length > 0 && (
          <div>
            <h2 className="font-bold text-forest/50 mb-3">🔒 Locked ({locked.length})</h2>
            <div className="grid grid-cols-3 gap-3">
              {locked.map(b => (
                <BadgeCard key={b.id} badge={b} earned={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BadgeCard({ badge, earned }: { badge: any; earned: boolean }) {
  return (
    <div className={`rounded-3xl p-3 text-center border transition-all ${
      earned ? 'bg-white border-saffron/20 shadow-sm' : 'bg-black/3 border-transparent'
    }`}>
      <div className={`text-3xl mb-1.5 ${!earned ? 'grayscale opacity-40' : ''}`}>
        {earned ? badge.icon : '🔒'}
      </div>
      <p className={`text-xs font-bold leading-tight ${earned ? 'text-forest' : 'text-forest/30'}`}>
        {badge.name}
      </p>
      {earned && (
        <p className="text-[10px] text-saffron mt-0.5 leading-tight">{badge.desc}</p>
      )}
    </div>
  )
}
