'use client'
import { useEffect, useState } from 'react'

export default function SplashScreen() {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 400)
    const t2 = setTimeout(() => setPhase(2), 1000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-forest relative overflow-hidden">
      {/* Decorative circles */}
      <div className="absolute top-[-80px] right-[-80px] w-64 h-64 rounded-full bg-saffron/10" />
      <div className="absolute bottom-[-60px] left-[-60px] w-48 h-48 rounded-full bg-saffron/8" />

      <div className={`text-center transition-all duration-700 ${phase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="text-8xl mb-4 foxy-animate">🦊</div>
        <h1 className="font-display text-5xl font-extrabold text-white tracking-tight">
          Alfanumrik
        </h1>
        <p className={`text-saffron font-bold text-xl mt-2 transition-all duration-500 delay-300 ${phase >= 2 ? 'opacity-100' : 'opacity-0'}`}>
          Your AI Tutor is ready!
        </p>
      </div>

      <div className={`absolute bottom-16 transition-all duration-500 delay-500 ${phase >= 2 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex gap-2">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-saffron rounded-full typing-dot" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
