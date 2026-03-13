'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import AuthScreen from '@/components/screens/AuthScreen'
import OnboardingScreen from '@/components/screens/OnboardingScreen'
import HomeScreen from '@/components/screens/HomeScreen'
import FoxyScreen from '@/components/screens/FoxyScreen'
import QuizScreen from '@/components/screens/QuizScreen'
import ProgressScreen from '@/components/screens/ProgressScreen'
import BadgesScreen from '@/components/screens/BadgesScreen'
import BottomNav from '@/components/layout/BottomNav'
import SplashScreen from '@/components/screens/SplashScreen'

export type Screen = 'home' | 'foxy' | 'quiz' | 'progress' | 'badges'

export default function App() {
  const { user, session, loading } = useAuth()
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [activeScreen, setActiveScreen] = useState<Screen>('home')
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2200)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!user || !session) { setHasProfile(null); return }
    api.getProfile(session.access_token)
      .then(data => { setProfile(data.profile); setHasProfile(true) })
      .catch(() => setHasProfile(false))
  }, [user, session])

  if (showSplash) return <SplashScreen />
  if (loading) return <LoadingState />
  if (!user) return <AuthScreen />
  if (hasProfile === null) return <LoadingState />
  if (!hasProfile) return (
    <OnboardingScreen
      token={session!.access_token}
      onComplete={(p) => { setProfile(p); setHasProfile(true) }}
    />
  )

  const screens: Record<Screen, JSX.Element> = {
    home: <HomeScreen profile={profile} token={session!.access_token} onNavigate={setActiveScreen} />,
    foxy: <FoxyScreen profile={profile} token={session!.access_token} />,
    quiz: <QuizScreen profile={profile} token={session!.access_token} />,
    progress: <ProgressScreen token={session!.access_token} />,
    badges: <BadgesScreen token={session!.access_token} />,
  }

  return (
    <div className="flex flex-col min-h-dvh bg-cream">
      <div className="flex-1 overflow-hidden">
        {screens[activeScreen]}
      </div>
      <BottomNav active={activeScreen} onChange={setActiveScreen} />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-cream">
      <div className="text-center">
        <div className="text-6xl mb-4 foxy-animate">🦊</div>
        <p className="text-saffron font-bold text-lg">Loading...</p>
      </div>
    </div>
  )
}
