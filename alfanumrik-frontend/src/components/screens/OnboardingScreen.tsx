'use client'
import { useState } from 'react'

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const grades = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const subjects = ['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology','History','Geography','Economics','Computer Science']
const languages = [
  { label: 'English', code: 'en' },
  { label: 'Hindi', code: 'hi' },
  { label: 'Tamil', code: 'ta' },
  { label: 'Telugu', code: 'te' },
  { label: 'Bengali', code: 'bn' },
  { label: 'Marathi', code: 'mr' },
  { label: 'Kannada', code: 'kn' },
  { label: 'Malayalam', code: 'ml' },
  { label: 'Gujarati', code: 'gu' },
  { label: 'Punjabi', code: 'pa' },
]

export default function OnboardingScreen({ token, onComplete }: { token: string; onComplete: (p: any) => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [language, setLanguage] = useState('en')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const steps = [
    { title: "What's your name?", subtitle: "Let Foxy get to know you! 🦊" },
    { title: "Which grade are you in?", subtitle: "I'll teach at just the right level" },
    { title: "What subject first?", subtitle: "Pick your focus area" },
    { title: "Preferred language?", subtitle: "Learn in your language" },
  ]

  const canNext = [!!name.trim(), !!grade, !!subject, true][step]

  const handleFinish = async () => {
    setLoading(true)
    setError('')
    
    const profile = { name: name.trim(), grade, subject, language }
    
    try {
      // Try saving via Supabase REST directly
      const res = await fetch(`${SB}/rest/v1/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SK,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          auth_user_id: undefined, // Will be set by RLS/trigger
          name: name.trim(),
          grade,
          preferred_language: language,
          onboarding_completed: true,
        }),
      })
      
      if (res.ok) {
        const data = await res.json()
        onComplete({ ...profile, studentId: data?.[0]?.id })
        return
      }

      // If direct insert fails (maybe student already exists), try update
      const updateRes = await fetch(`${SB}/rest/v1/students?auth_user_id=eq.${encodeURIComponent('current')}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SK,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          grade,
          preferred_language: language,
          onboarding_completed: true,
        }),
      })
    } catch (e) {
      console.error('Profile save error:', e)
    }
    
    // Always proceed — don't block the student
    onComplete(profile)
    setLoading(false)
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

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-2xl p-3 mb-4 text-center">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {step === 0 && (
          <input
            className="input-field text-lg text-center"
            type="text"
            placeholder="Enter your name..."
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(1)}
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
                  grade === g ? 'bg-saffron text-white scale-105 shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
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
                  subject === s ? 'bg-saffron text-white scale-[1.02] shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
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
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`py-3 px-3 rounded-2xl font-bold text-sm transition-all ${
                  language === l.code ? 'bg-saffron text-white scale-[1.02] shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {l.label}
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
