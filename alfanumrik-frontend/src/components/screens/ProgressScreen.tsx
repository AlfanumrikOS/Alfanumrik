'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export default function ProgressScreen({ token }: { token: string }) {
  const [progress, setProgress] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getProgress(token)
      .then(d => { setProgress(d.progress); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="screen items-center justify-center">
      <div className="text-5xl foxy-animate">📊</div>
      <p className="text-saffron font-bold mt-3">Loading stats...</p>
    </div>
  )

  const avg     = progress?.avgScore     || 0
  const streak  = progress?.streakDays   || 0
  const total   = progress?.totalQuizzes || 0
  const sessions = progress?.sessionCount || 0

  const { levelLabel, levelColor } =
    avg >= 90 ? { levelLabel: 'Expert 🌟',        levelColor: '#FF6B00' } :
    avg >= 75 ? { levelLabel: 'Advanced 🔥',       levelColor: '#E8522A' } :
    avg >= 60 ? { levelLabel: 'Intermediate 📚',   levelColor: '#3B82F6' } :
    avg >= 40 ? { levelLabel: 'Learner 🌱',         levelColor: '#22C55E' } :
               { levelLabel: 'Beginner 🐣',         levelColor: '#94A3B8' }

  return (
    <div className="screen overflow-y-auto pb-6">
      <div className="bg-forest px-6 pt-12 pb-6 rounded-b-[2.5rem]">
        <h1 className="font-display text-3xl font-extrabold text-white">My Progress 📊</h1>
        <p className="text-cream/60 mt-1">Track your learning journey</p>
      </div>

      <div className="px-5 mt-5 space-y-4">
        {/* Level card — inline gradient to avoid Tailwind purge on dynamic values */}
        <div className="card text-white overflow-hidden"
          style={{ background: `linear-gradient(135deg, #FF6B00 0%, ${levelColor} 100%)` }}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">
              🎓
            </div>
            <div>
              <p className="text-white/70 text-sm font-medium">Current Level</p>
              <p className="font-display text-2xl font-extrabold">{levelLabel}</p>
              <p className="text-white/70 text-xs mt-0.5">Average score: {avg}%</p>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon="🔥" label="Day Streak"     value={streak}    unit="days"  bg="#FFF7ED" border="#FED7AA" />
          <StatCard icon="📝" label="Quizzes Done"   value={total}     unit="total" bg="#EFF6FF" border="#BFDBFE" />
          <StatCard icon="💬" label="Tutor Sessions" value={sessions}  unit="chats" bg="#FAF5FF" border="#E9D5FF" />
          <StatCard icon="🎯" label="Avg Score"      value={`${avg}%`} unit="accuracy" bg="#F0FDF4" border="#BBF7D0" />
        </div>

        {/* Progress bars */}
        <div className="card">
          <p className="font-bold text-forest mb-3">Score Progress</p>
          <div className="space-y-3">
            {[
              { label: 'Quiz Average',    val: avg },
              { label: 'Completion Rate', val: Math.min(total * 10, 100) },
              { label: 'Streak Score',    val: Math.min(streak * 15, 100) },
            ].map(({ label, val }) => (
              <div key={label}>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-forest/70 font-medium">{label}</span>
                  <span className="text-sm font-bold text-saffron">{val}%</span>
                </div>
                <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full bg-saffron rounded-full progress-fill" style={{ width: `${val}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent quizzes */}
        {progress?.recentQuizzes?.length > 0 && (
          <div className="card">
            <p className="font-bold text-forest mb-3">Recent Quizzes</p>
            <div className="space-y-2">
              {progress.recentQuizzes.map((q: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
                  <div>
                    <p className="text-sm font-bold text-forest">{q.topic || 'Quiz'}</p>
                    <p className="text-xs text-forest/50">
                      {new Date(q.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <div className={`badge-pill text-sm font-extrabold ${
                    q.percentage >= 80 ? 'bg-green-100 text-green-700' :
                    q.percentage >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {q.percentage}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, unit, bg, border }: {
  icon: string; label: string; value: any; unit: string; bg: string; border: string
}) {
  return (
    <div className="rounded-3xl p-4 border" style={{ backgroundColor: bg, borderColor: border }}>
      <div className="text-2xl mb-2">{icon}</div>
      <p className="font-extrabold text-2xl text-forest">{value}</p>
      <p className="text-xs text-forest/50 font-medium">{label}</p>
      <p className="text-xs text-forest/30">{unit}</p>
    </div>
  )
}
