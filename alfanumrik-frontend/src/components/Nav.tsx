'use client'
import { type Screen, type Prof, snd } from '@/lib/alfanumrik'

const TABS: { sc: Screen; label: string; icon: string; activeColor: string }[] = [
  { sc: 'home', label: 'Home', icon: '🏠', activeColor: '#E8590C' },
  { sc: 'foxy', label: 'Foxy', icon: '🦊', activeColor: '#E8590C' },
  { sc: 'quiz', label: 'Quiz', icon: '🎯', activeColor: '#8B5CF6' },
  { sc: 'skills', label: 'Skills', icon: '🌟', activeColor: '#0EA5E9' },
  { sc: 'notes', label: 'Notes', icon: '📝', activeColor: '#F59E0B' },
  { sc: 'profile', label: 'Me', icon: '👤', activeColor: '#EC4899' },
]

export default function Nav({ active, nav, p }: { active: Screen; nav: (s: Screen) => void; p: Prof }) {
  return (
    <>
      {/* DESKTOP SIDE NAV */}
      <nav style={{
        width: 220, background: '#fff', borderRight: '1px solid #F0EDE8',
        display: 'flex', flexDirection: 'column', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 50
      }} className="alfn-side">
        {/* Brand */}
        <div style={{
          padding: '24px 20px', display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid #F0EDE8'
        }}>
          <span style={{ fontSize: 28 }}>🦊</span>
          <div>
            <span style={{ fontSize: 17, fontWeight: 900, color: '#E8590C' }}>Alfanumrik</span>
            <p style={{ fontSize: 10, color: '#A8A29E', fontWeight: 600, marginTop: 1 }}>
              {p.grade} · {p.subject}
            </p>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map(t => {
            const isActive = active === t.sc
            return (
              <button key={t.sc} onClick={() => { snd('nav'); nav(t.sc) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', borderRadius: 14, border: 'none',
                  background: isActive ? `${t.activeColor}10` : 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  color: isActive ? t.activeColor : '#78716C', width: '100%', textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}>
                <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{t.icon}</span>
                <span>{t.label}</span>
                {isActive && (
                  <div style={{
                    marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
                    background: t.activeColor
                  }} />
                )}
              </button>
            )
          })}
        </div>

        {/* User card */}
        <div style={{
          padding: '16px', borderTop: '1px solid #F0EDE8',
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: 'linear-gradient(135deg, #E8590C, #EC4899)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, flexShrink: 0
          }}>
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</p>
            <p style={{ fontSize: 11, color: '#A8A29E' }}>{p.grade}</p>
          </div>
        </div>
      </nav>

      {/* MOBILE BOTTOM NAV — bigger touch targets */}
      <nav style={{
        display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
        borderTop: '1px solid #F0EDE8',
        padding: '8px 4px calc(env(safe-area-inset-bottom, 8px) + 4px)',
        zIndex: 50, justifyContent: 'space-around'
      }} className="alfn-bot">
        {TABS.map(t => {
          const isActive = active === t.sc
          return (
            <button key={t.sc} onClick={() => { snd('nav'); nav(t.sc) }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                // BIGGER touch targets for mobile — min 48x48 per Google guidelines
                padding: '8px 12px', minWidth: 52, minHeight: 48,
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                borderRadius: 12, transition: 'all 0.2s ease',
                ...(isActive ? { background: `${t.activeColor}10` } : {})
              }}>
              <span style={{
                fontSize: 22,  // Bigger icons for mobile
                filter: isActive ? 'none' : 'grayscale(0.6) opacity(0.5)',
                transition: 'all 0.2s ease',
                transform: isActive ? 'scale(1.15)' : 'scale(1)'
              }}>
                {t.icon}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: isActive ? t.activeColor : '#A8A29E',
                transition: 'color 0.2s ease'
              }}>
                {t.label}
              </span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
