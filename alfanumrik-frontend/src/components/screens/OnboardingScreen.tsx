'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

const grades = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const subjects = ['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology','History','Geography','Economics','Computer Science']
const languages = ['English','Hindi','Tamil','Telugu','Bengali','Marathi','Kannada','Malayalam','Gujarati','Punjabi']

export default function OnboardingScreen({ token, onComplete }: { token: string; onComplete: (p: any) => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [language, setLanguage] = useState('English')
  const [loading, setLoading] = useState(false)

  const steps = [
    { title: "What's your name?", subtitle: "Let Foxy get to know you! 🦊" },
    { title: "Which grade are you in?", subtitle: "I'll teach at just the right level" },
    { title: "What subject first?", subtitle: "Pick your focus area" },
    { title: "Preferred language?", subtitle: "Learn in your language" },
  ]

  const canNext = [!!name.trim(), !!grade, !!subject, !!language][step]

  const handleFinish = async () => {
    setLoading(true)
    try {
      const { profile } = await api.saveProfile(token, { name, grade, subject, language })
      onComplete(profile)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-forest safe-top">
      {/* Progress */}
      <div className="px-6 pt-6">
        <div className="flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/20">
              <div className={`h-full bg-saffron rounded-full progress-fill ${i <= step ? 'w-full' : 'w-0'}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 py-8">
        <div className="text-6xl mb-6 foxy-animate text-center">🦊</div>
        <h2 className="font-display text-3xl font-extrabold text-white text-center">{steps[step].title}</h2>
        <p className="text-cream/60 text-center mt-2 mb-8 font-medium">{steps[step].subtitle}</p>

        {step === 0 && (
          <input
            className="input-field text-lg text-center"
            type="text"
            placeholder="Enter your name..."
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        )}

        {step === 1 && (
          <div className="grid grid-cols-3 gap-2">
            {grades.map(g => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`py-3 px-2 rounded-2xl font-bold text-sm transition-all ${
                  grade === g ? 'bg-saffron text-white scale-105 shadow-lg' : 'bg-white/10 text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
            {subjects.map(s => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className={`py-3 px-3 rounded-2xl font-bold text-sm transition-all text-left ${
                  subject === s ? 'bg-saffron text-white scale-[1.02] shadow-lg' : 'bg-white/10 text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-2 gap-2">
            {languages.map(l => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`py-3 px-3 rounded-2xl font-bold text-sm transition-all ${
                  language === l ? 'bg-saffron text-white scale-[1.02] shadow-lg' : 'bg-white/10 text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 pb-10 safe-bottom flex gap-3">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">
            ← Back
          </button>
        )}
        <button
          onClick={step < 3 ? () => setStep(s => s + 1) : handleFinish}
          disabled={!canNext || loading}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {loading ? '⏳ Setting up...' : step < 3 ? 'Next →' : "🎉 Let's Go!"}
        </button>
      </div>
    </div>
  )
}
