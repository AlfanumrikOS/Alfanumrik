'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import type { Screen } from '@/app/page'

const motivations = [
  "Every question you ask makes you smarter! 🌟",
  "Learning a little every day adds up to a lot! 📚",
  "You're doing amazing — keep it up! 🚀",
  "Curiosity is the best superpower! 🔍",
  "Foxy believes in you! 🦊",
]

export default function HomeScreen({ profile, token, onNavigate }: {
  profile: any
  token: string
  onNavigate: (s: Screen) => void
}) {
  const { signOut } = useAuth()
  const [progress, setProgress] = useState<any>(null)
  const [motivation] = useState(() => motivations[Math.floor(Math.random() * motivations.length)])
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    api.getProgress(token).then(d => setProgress(d.progress)).catch(() => {})
  }, [token])

  const quickActions = [
    { icon: '🦊', label: 'Ask Foxy', sub: 'AI tutor chat', screen: 'foxy', color: 'bg-saffron' },
    { icon: '📝', label: 'Take Quiz', sub: 'Test yourself', screen: 'quiz', color: 'bg-forest' },
    { icon: '📊', label: 'My Progress', sub: 'Track growth', screen: 'progress', color: 'bg-foxy' },
    { icon: '🏆', label: 'Badges', sub: 'Achievements', screen: 'badges', color: 'bg-amber-500' },
  ] as const

  return (
    <div className="screen overflow-y-auto pb-4">
      {/* Header */}
      <div className="bg-forest px-6 pt-12 pb-8 rounded-b-[2.5rem] relative overflow-hidden">
        <div className="absolute top-[-40px] right-[-40px] w-32 h-32 bg-saffron/10 rounded-full" />
        <div className="absolute bottom-[-20px] left-[60%] w-24 h-24 bg-white/5 rounded-full" />

        <div className="flex justify-between items-start relative">
          <div>
            <p className="text-cream/60 font-medium text-sm">{greeting} 👋</p>
            <h1 className="font-display text-3xl font-extrabold text-white mt-0.5">
              {profile?.name || 'Student'}!
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="badge-pill bg-saffron/20 text-saffron text-xs">{profile?.grade}</span>
              <span className="badge-pill bg-white/10 text-cream text-xs">{profile?.subject}</span>
            </div>
          </div>
          <div className="text-5xl foxy-animate">🦊</div>
        </div>

        {/* Streak */}
        <div className="bg-white/10 backdrop-blur rounded-2xl px-4 py-3 mt-4 flex items-center gap-3">
          <span className="text-2xl">🔥</span>
          <div>
            <p className="text-white font-bold text-sm">{progress?.streakDays || 0} day streak!</p>
            <p className="text-cream/60 text-xs">Keep learning every day</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-saffron font-extrabold text-xl">{progress?.totalQuizzes || 0}</p>
            <p className="text-cream/50 text-xs">quizzes done</p>
          </div>
        </div>
      </div>

      <div className="px-5 mt-5 space-y-5">
        {/* Motivation card */}
        <div className="card border-l-4 border-saffron flex items-center gap-3">
          <span className="text-2xl">💡</span>
          <p className="text-forest/80 text-sm font-medium italic">{motivation}</p>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="font-display font-bold text-lg text-forest mb-3">Quick Start</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map(action => (
              <button
                key={action.screen}
                onClick={() => onNavigate(action.screen)}
                className="card text-left active:scale-95 transition-transform duration-150 hover:shadow-md"
              >
                <div className={`w-12 h-12 ${action.color} rounded-2xl flex items-center justify-center text-2xl mb-3 shadow-sm`}>
                  {action.icon}
                </div>
                <p className="font-bold text-forest">{action.label}</p>
                <p className="text-forest/50 text-xs mt-0.5">{action.sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        {progress && (
          <div>
            <h2 className="font-display font-bold text-lg text-forest mb-3">Your Stats</h2>
            <div className="card">
              <div className="grid grid-cols-3 divide-x divide-black/5">
                <StatCell label="Avg Score" value={`${progress.avgScore}%`} />
                <StatCell label="Sessions" value={progress.sessionCount} />
                <StatCell label="Quizzes" value={progress.totalQuizzes} />
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() => onNavigate('foxy')}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          🦊 Chat with Foxy Now
        </button>

        {/* Sign out */}
        <button onClick={signOut} className="w-full text-center text-forest/30 text-xs py-2">
          Sign out
        </button>
      </div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex flex-col items-center py-2 px-1">
      <p className="font-extrabold text-2xl text-saffron">{value}</p>
      <p className="text-forest/50 text-xs mt-0.5 text-center">{label}</p>
    </div>
  )
}
