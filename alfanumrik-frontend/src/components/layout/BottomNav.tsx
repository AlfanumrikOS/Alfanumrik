'use client'
import type { Screen } from '@/app/page'

const tabs = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'quiz', icon: '📝', label: 'Quiz' },
  { id: 'foxy', icon: '🦊', label: 'Foxy', fab: true },
  { id: 'progress', icon: '📊', label: 'Progress' },
  { id: 'badges', icon: '🏆', label: 'Badges' },
] as const

export default function BottomNav({ active, onChange }: {
  active: Screen
  onChange: (s: Screen) => void
}) {
  return (
    <nav className="bg-white border-t border-black/8 safe-bottom px-2 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="flex items-end justify-around h-16">
        {tabs.map(tab => {
          const isActive = active === tab.id
          if ('fab' in tab && tab.fab) {
            return (
              <button
                key={tab.id}
                onClick={() => onChange(tab.id as Screen)}
                className="relative -mt-5 flex flex-col items-center"
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-saffron scale-110 shadow-saffron/40'
                    : 'bg-forest shadow-forest/20'
                }`}>
                  {tab.icon}
                </div>
                <span className={`text-[10px] mt-1 font-bold ${isActive ? 'text-saffron' : 'text-gray-400'}`}>
                  {tab.label}
                </span>
              </button>
            )
          }
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id as Screen)}
              className="nav-tab"
            >
              <span className={`text-2xl transition-transform duration-200 ${isActive ? 'scale-110' : 'scale-100'}`}>
                {tab.icon}
              </span>
              <span className={`text-[10px] font-bold transition-colors ${isActive ? 'text-saffron' : 'text-gray-400'}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 w-6 h-0.5 bg-saffron rounded-full" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
