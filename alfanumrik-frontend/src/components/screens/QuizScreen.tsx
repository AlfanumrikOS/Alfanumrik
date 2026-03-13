'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

interface Question {
  id: number
  question: string
  options: string[]
  correct: number
  explanation: string
}

type QuizState = 'setup' | 'loading' | 'active' | 'result'

const TOPICS: Record<string, string[]> = {
  Mathematics:       ['Fractions', 'Algebra basics', 'Geometry shapes', 'Percentages', 'Triangles', 'Statistics'],
  Science:           ['Photosynthesis', 'Solar system', 'Human body', 'States of matter', 'Food chains'],
  English:           ['Parts of speech', 'Tenses', 'Synonyms', 'Active & Passive voice', 'Comprehension'],
  Hindi:             ['संज्ञा', 'सर्वनाम', 'क्रिया', 'विशेषण', 'मुहावरे'],
  Physics:           ['Laws of motion', 'Electricity', 'Light & Optics', 'Sound waves', 'Thermodynamics'],
  Chemistry:         ['Atomic structure', 'Periodic table', 'Chemical reactions', 'Acids & Bases', 'Metals'],
  Biology:           ['Cell structure', 'Photosynthesis', 'Human anatomy', 'Genetics', 'Ecosystems'],
  History:           ['Mughal Empire', 'Indian Independence', 'World War II', 'Ancient civilisations'],
  Geography:         ['Rivers of India', 'Climate zones', 'World capitals', 'Natural resources'],
  'Social Studies':  ['Indian Constitution', 'Local government', 'Agriculture', 'Trade & Economy'],
  Economics:         ['Supply & demand', 'GDP', 'Inflation', 'Banking system', 'Budget'],
  'Computer Science':['Variables', 'Loops', 'Functions', 'Sorting algorithms', 'Databases'],
}

export default function QuizScreen({ profile, token }: { profile: any; token: string }) {
  const [state, setState] = useState<QuizState>('setup')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [questions, setQuestions] = useState<Question[]>([])
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [userAnswers, setUserAnswers] = useState<number[]>([])   // one entry per question answered
  const [showExpl, setShowExpl] = useState(false)

  const topics = TOPICS[profile?.subject] || ['Key concepts', 'Definitions', 'Fundamentals']

  const diffCfg = {
    easy:   { pill: 'bg-green-100 text-green-700', label: '😊 Easy' },
    medium: { pill: 'bg-amber-100 text-amber-700', label: '🧠 Medium' },
    hard:   { pill: 'bg-red-100 text-red-700',     label: '🔥 Hard' },
  }

  const startQuiz = async () => {
    if (!topic.trim()) return
    setState('loading')
    try {
      const data = await api.generateQuiz(token, topic, difficulty, 5)
      setQuestions(data.questions)
      setCurrent(0)
      setSelected(null)
      setUserAnswers([])
      setState('active')
    } catch {
      setState('setup')
      alert('Failed to generate quiz. Check your connection and try again!')
    }
  }

  const handleAnswer = (idx: number) => {
    if (selected !== null) return
    setSelected(idx)
    setShowExpl(true)
  }

  const nextQuestion = async () => {
    const newAnswers = [...userAnswers, selected!]

    if (current + 1 >= questions.length) {
      // All questions answered — calculate correct count from full array
      const finalScore = newAnswers.filter((ans, i) => ans === questions[i].correct).length
      try {
        await api.saveQuizResult(token, {
          topic,
          subject: profile?.subject,
          grade:   profile?.grade,
          score:   finalScore,
          total:   questions.length,
          answers: newAnswers.map((ans, i) => ({
            question: i,
            selected: ans,
            correct:  ans === questions[i].correct,
          })),
        })
      } catch { /* non-blocking */ }
      setUserAnswers(newAnswers)
      setState('result')
    } else {
      setUserAnswers(newAnswers)
      setCurrent(c => c + 1)
      setSelected(null)
      setShowExpl(false)
    }
  }

  // ── Setup ─────────────────────────────────────────────────────
  if (state === 'setup') return (
    <div className="screen overflow-y-auto pb-6">
      <div className="bg-forest px-6 pt-12 pb-6 rounded-b-[2.5rem]">
        <h1 className="font-display text-3xl font-extrabold text-white">Quiz Time! 📝</h1>
        <p className="text-cream/60 mt-1">Test your {profile?.subject} knowledge</p>
      </div>
      <div className="px-5 mt-5 space-y-5">
        <div className="card space-y-4">
          <div>
            <label className="text-xs font-bold text-forest/50 uppercase tracking-wider mb-2 block">Topic</label>
            <input className="input-field" placeholder="e.g. Photosynthesis, Fractions..."
              value={topic} onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startQuiz()} />
          </div>
          <div>
            <label className="text-xs font-bold text-forest/50 uppercase tracking-wider mb-2 block">Quick topics</label>
            <div className="flex flex-wrap gap-2">
              {topics.map(t => (
                <button key={t} onClick={() => setTopic(t)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${
                    topic === t ? 'bg-saffron text-white border-saffron' : 'bg-white border-black/10 text-forest/70'
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-forest/50 uppercase tracking-wider mb-2 block">Difficulty</label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as const).map(d => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                    difficulty === d ? 'bg-saffron text-white' : diffCfg[d].pill
                  }`}>{diffCfg[d].label}</button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={startQuiz} disabled={!topic.trim()} className="btn-primary w-full disabled:opacity-50">
          🧠 Generate Quiz
        </button>
      </div>
    </div>
  )

  // ── Loading ────────────────────────────────────────────────────
  if (state === 'loading') return (
    <div className="screen items-center justify-center">
      <div className="text-6xl foxy-animate mb-4">🦊</div>
      <p className="font-bold text-forest text-xl">Foxy is crafting your quiz...</p>
      <div className="flex gap-2 mt-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2.5 h-2.5 bg-saffron rounded-full typing-dot"
            style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  )

  // ── Active ─────────────────────────────────────────────────────
  if (state === 'active') {
    const q = questions[current]
    const letters = ['A', 'B', 'C', 'D']
    const progress = (current / questions.length) * 100
    const currentScore = userAnswers.filter((ans, i) => ans === questions[i].correct).length

    return (
      <div className="screen">
        <div className="bg-forest px-6 pt-12 pb-5 flex-shrink-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-cream/60 text-sm font-medium">Q {current + 1} of {questions.length}</span>
            <span className={`badge-pill text-xs ${diffCfg[difficulty].pill}`}>{difficulty}</span>
            <span className="text-saffron font-bold text-sm">🏆 {currentScore}/{questions.length}</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-saffron rounded-full progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="card mb-4">
            <p className="text-forest font-bold text-base leading-relaxed">{q.question}</p>
          </div>
          <div className="space-y-2.5">
            {q.options.map((opt, i) => {
              let cls = 'bg-white border-2 border-black/10 text-forest'
              if (selected !== null) {
                if (i === q.correct)           cls = 'bg-green-50 border-2 border-green-400 text-green-800'
                else if (i === selected)       cls = 'bg-red-50 border-2 border-red-400 text-red-700'
                else                           cls = 'bg-white border-2 border-black/5 text-forest/40'
              }
              return (
                <button key={i} onClick={() => handleAnswer(i)} disabled={selected !== null}
                  className={`w-full text-left px-4 py-3.5 rounded-2xl font-medium transition-all active:scale-[0.98] flex items-center gap-3 ${cls}`}>
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                    selected !== null && i === q.correct ? 'bg-green-400 text-white' :
                    selected !== null && i === selected  ? 'bg-red-400 text-white'   : 'bg-black/8'
                  }`}>
                    {selected !== null && i === q.correct ? '✓' :
                     selected !== null && i === selected  ? '✗' : letters[i]}
                  </span>
                  <span className="text-sm">{opt}</span>
                </button>
              )
            })}
          </div>

          {showExpl && (
            <div className={`mt-4 rounded-2xl p-4 animate-slide-up border ${
              selected === q.correct ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
            }`}>
              <p className="font-bold text-sm mb-1">
                {selected === q.correct ? '🎉 Correct!' : '💡 Not quite...'}
              </p>
              <p className="text-sm text-forest/70">{q.explanation}</p>
            </div>
          )}
        </div>

        {selected !== null && (
          <div className="px-5 pb-6 safe-bottom animate-slide-up flex-shrink-0">
            <button onClick={nextQuestion} className="btn-primary w-full">
              {current + 1 >= questions.length ? '🎯 See Results' : 'Next Question →'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Results ────────────────────────────────────────────────────
  const finalScore = userAnswers.filter((ans, i) => ans === questions[i].correct).length
  const pct   = Math.round((finalScore / questions.length) * 100)
  const emoji = pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : pct >= 40 ? '📚' : '💪'
  const msg   = pct >= 80 ? 'Outstanding!' : pct >= 60 ? 'Great job!' : pct >= 40 ? 'Keep practicing!' : "Don't give up!"

  return (
    <div className="screen items-center justify-center px-6 text-center">
      <div className="text-7xl mb-4">{emoji}</div>
      <h2 className="font-display text-4xl font-extrabold text-forest">{msg}</h2>
      <p className="text-forest/60 mt-2 font-medium">
        You scored on <span className="font-bold text-forest">{topic}</span>
      </p>
      <div className="w-32 h-32 rounded-full bg-saffron/10 border-4 border-saffron flex items-center justify-center mt-6 mb-8">
        <div>
          <p className="font-display text-4xl font-extrabold text-saffron">{pct}%</p>
          <p className="text-forest/50 text-xs">{finalScore}/{questions.length} correct</p>
        </div>
      </div>
      <div className="flex gap-3 w-full">
        <button onClick={() => { setState('setup'); setTopic('') }} className="btn-secondary flex-1">
          New Quiz
        </button>
        <button onClick={startQuiz} className="btn-primary flex-1">
          Retry ↺
        </button>
      </div>
    </div>
  )
}
