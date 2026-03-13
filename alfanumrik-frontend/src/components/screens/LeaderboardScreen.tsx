'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

export default function LeaderboardScreen({ token, profile, onBack }: {
  token: string
  profile: any
  onBack: () => void
}) {
  const [tab, setTab] = useState<'weekly'|'alltime'>('weekly')
  const [data, setData] = useState<any[]>([])
  const [myRank, setMyRank] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getLeaderboard(token, tab).then(d => {
      setData(d.leaderboard || [])
      setMyRank(d.myRank || null)
      setLoading(false)
    }).catch(() => {
      // Fallback mock while API is being built
      setData(MOCK_LEADERS)
      setMyRank({ rank: 12, name: profile?.name, score: 340, quizzes: 8 })
      setLoading(false)
    })
  }, [tab, token])

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="screen overflow-y-auto pb-8">
      <div className="bg-forest px-5 pt-12 pb-5">
        <button onClick={onBack} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white text-lg mb-4">←</button>
        <h1 className="font-display text-3xl font-extrabold text-white">Leaderboard 🏆</h1>
        <p className="text-cream/60 mt-1">Top learners this week</p>
      </div>

      <div className="px-5 mt-5">
        {/* Tab toggle */}
        <div className="flex bg-white rounded-2xl p-1 mb-5 shadow-sm border border-black/5">
          {(['weekly', 'alltime'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setLoading(true) }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${tab === t ? 'bg-saffron text-white' : 'text-forest/50'}`}>
              {t === 'weekly' ? '📅 This Week' : '🏆 All Time'}
            </button>
          ))}
        </div>

        {/* My rank */}
        {myRank && (
          <div className="card border-2 border-saffron/30 mb-4 bg-saffron/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-saffron rounded-2xl flex items-center justify-center font-extrabold text-white">
                #{myRank.rank}
              </div>
              <div className="flex-1">
                <p className="font-bold text-forest">You — {myRank.name}</p>
                <p className="text-xs text-forest/50">{myRank.quizzes} quizzes · {myRank.score} pts</p>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard list */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-2xl shimmer" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((user, i) => (
              <div key={user.userId || i}
                className={`card flex items-center gap-3 ${i < 3 ? 'border border-saffron/20' : ''}`}>
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-extrabold text-lg flex-shrink-0 ${
                  i === 0 ? 'bg-amber-100' : i === 1 ? 'bg-gray-100' : i === 2 ? 'bg-orange-100' : 'bg-black/5'
                }`}>
                  {i < 3 ? medals[i] : <span className="text-sm text-forest/50">#{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-forest truncate">{user.name}</p>
                  <p className="text-xs text-forest/40">{user.grade} · {user.quizzes} quizzes</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-extrabold text-saffron">{user.score}</p>
                  <p className="text-[10px] text-forest/30">points</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const MOCK_LEADERS = [
  { name: 'Arjun S.', grade: 'Grade 10', score: 1240, quizzes: 31 },
  { name: 'Priya M.', grade: 'Grade 9',  score: 1180, quizzes: 28 },
  { name: 'Rohan K.', grade: 'Grade 10', score: 1090, quizzes: 26 },
  { name: 'Ananya R.', grade: 'Grade 8', score: 940,  quizzes: 22 },
  { name: 'Vikram P.', grade: 'Grade 11', score: 880, quizzes: 20 },
  { name: 'Sneha T.', grade: 'Grade 9',  score: 810,  quizzes: 18 },
  { name: 'Karan B.', grade: 'Grade 10', score: 750,  quizzes: 17 },
  { name: 'Meera J.', grade: 'Grade 7',  score: 690,  quizzes: 15 },
  { name: 'Aditya L.', grade: 'Grade 11', score: 620, quizzes: 14 },
  { name: 'Riya N.', grade: 'Grade 8',   score: 570,  quizzes: 12 },
]
