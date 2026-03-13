'use client'
import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async () => {
    setError(''); setSuccess(''); setLoading(true)
    try {
      if (tab === 'signup') {
        await signUp(email, password)
        setSuccess('Account created! Check your email to verify, then sign in.')
        setTab('login')
      } else {
        await signIn(email, password)
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-forest safe-top">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-8 pb-4">
        <div className="text-8xl foxy-animate mb-4">🦊</div>
        <h1 className="font-display text-4xl font-extrabold text-white text-center">
          Alfanumrik
        </h1>
        <p className="text-cream/70 text-center mt-2 font-medium">
          Your personal AI tutor
        </p>
      </div>

      {/* Card */}
      <div className="bg-cream rounded-t-[2.5rem] p-6 safe-bottom">
        {/* Tabs */}
        <div className="flex bg-white rounded-2xl p-1 mb-6 shadow-sm">
          {(['login', 'signup'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); setSuccess('') }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${
                tab === t ? 'bg-saffron text-white shadow-sm' : 'text-gray-500'
              }`}
            >
              {t === 'login' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === 'signup' && (
            <div>
              <label className="text-xs font-bold text-forest/60 uppercase tracking-wider mb-1 block">Name</label>
              <input
                className="input-field"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-forest/60 uppercase tracking-wider mb-1 block">Email</label>
            <input
              className="input-field"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-forest/60 uppercase tracking-wider mb-1 block">Password</label>
            <input
              className="input-field"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm font-medium">
            {success}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !email || !password}
          className="btn-primary w-full mt-5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Please wait...
            </>
          ) : tab === 'login' ? '🚀 Sign In' : '🎉 Create Account'}
        </button>

        <p className="text-center text-xs text-forest/40 mt-4">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  )
}
