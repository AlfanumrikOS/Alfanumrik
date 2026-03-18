import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ fontFamily: 'Nunito, sans-serif' }}>
      {/* Left Brand Panel */}
      <div
        className="hidden lg:flex lg:w-[45%] items-center justify-center p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #f97316 0%, #7c3aed 100%)' }}
      >
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
        <div className="absolute -bottom-32 -right-20 w-96 h-96 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />

        <div className="relative z-10 max-w-md text-white">
          <div className="flex items-center gap-3 mb-8">
            <span className="text-5xl">🦊</span>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight">Alfanumrik</h1>
              <p style={{ color: 'rgba(255,237,213,0.9)' }} className="text-sm font-medium mt-0.5">Learning OS</p>
            </div>
          </div>
          <p className="text-xl font-bold mb-3" style={{ color: 'rgba(255,255,255,0.95)' }}>
            Meet Foxy — your AI tutor
          </p>
          <p style={{ color: 'rgba(255,255,255,0.75)' }} className="text-base leading-relaxed mb-10">
            Adaptive, multilingual tutoring that celebrates every small win. Built for Indian students from Balvatika through Grade 12.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: '🧠', label: 'IQ + EQ', desc: 'Balanced growth' },
              { icon: '🌐', label: '5+ भाषा', desc: 'Multilingual' },
              { icon: '🎯', label: 'Adaptive', desc: 'Your pace' },
            ].map((f) => (
              <div key={f.label} className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="text-2xl mb-1">{f.icon}</div>
                <div className="font-bold text-sm text-white">{f.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-white">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <span className="text-3xl">🦊</span>
            <Link to="/" className="text-2xl font-extrabold"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Alfanumrik
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
