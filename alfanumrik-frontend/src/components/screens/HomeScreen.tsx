'use client'
import { useState, useEffect } from 'react'
import { type Screen, type Prof, type Stats, api, snd, SM, COLORS } from '@/lib/alfanumrik'

// Moment type icons and colors
const MOMENT_MAP: Record<string, { icon: string; bg: string; border: string }> = {
  concept_mastered: { icon: '⭐', bg: '#FFF7ED', border: '#E8590C' },
  layer_unlocked: { icon: '🔓', bg: '#EFF6FF', border: '#3B82F6' },
  misconception_fixed: { icon: '🔧', bg: '#F0FDF4', border: '#22C55E' },
  streak_milestone: { icon: '🔥', bg: '#FFFBEB', border: '#F59E0B' },
  comeback: { icon: '🚀', bg: '#FAF5FF', border: '#8B5CF6' },
  first_correct: { icon: '🌱', bg: '#ECFDF5', border: '#06B6D4' },
  exam_ready: { icon: '🎓', bg: '#FDF2F8', border: '#EC4899' },
  speed_improvement: { icon: '⚡', bg: '#FEF9C3', border: '#EAB308' },
  loop_completed: { icon: '✅', bg: '#F0FDF4', border: '#22C55E' },
}

export default function Home({ p, nav, stats, history }: {
  p: Prof; nav: (s: Screen) => void; stats: Stats; history: any
}) {
  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const [moments, setMoments] = useState<any[]>([])
  const [dashboard, setDashboard] = useState<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).alfanumrikInstallPrompt) setInstallPrompt(true)
  }, [])

  // Load student experience dashboard
  useEffect(() => {
    if (!p.studentId) return
    const load = async () => {
      const d = await api('student-experience', {
        action: 'dashboard', student_id: p.studentId,
        subject: SM[p.subject] || 'math', grade: p.grade
      })
      setDashboard(d)
      setMoments(d.celebrations || [])
      setLoaded(true)
    }
    load()
  }, [p.studentId, p.subject, p.grade])

  const doInstall = async () => {
    const pr = (window as any).alfanumrikInstallPrompt
    if (pr) { pr.prompt(); const { outcome } = await pr.userChoice; if (outcome === 'accepted') setInstallPrompt(false) }
  }

  const prog = dashboard?.progress || {}
  const streak = dashboard?.streak || {}
  const nextActions = dashboard?.next_actions || []
  const acc = stats.asked > 0 ? Math.round((stats.correct / stats.asked) * 100) : 0

  return (
    <div style={{ padding: '24px 28px 120px', maxWidth: 900, animation: 'alfnFadeIn 0.4s ease' }}>

      {/* ── GREETING HERO ── */}
      <div style={{
        background: 'linear-gradient(135deg, #E8590C, #EC4899)',
        borderRadius: 24, padding: '28px 24px', color: '#fff', marginBottom: 20,
        position: 'relative', overflow: 'hidden'
      }}>
        {/* Decorative circles */}
        <div style={{
          position: 'absolute', top: -30, right: -30, width: 120, height: 120,
          borderRadius: '50%', background: 'rgba(255,255,255,0.1)'
        }} />
        <div style={{
          position: 'absolute', bottom: -20, right: 40, width: 80, height: 80,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)'
        }} />

        <p style={{ fontSize: 14, opacity: 0.8, fontWeight: 500 }}>{greeting}</p>
        <h1 style={{
          fontSize: 28, fontWeight: 900, margin: '4px 0 16px', letterSpacing: '-0.02em'
        }}>
          {p.name} 🦊
        </h1>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { v: String(stats.xp), l: 'XP', icon: '⚡' },
            { v: String(streak.days || stats.streak || 0), l: 'Streak', icon: '🔥' },
            { v: `${acc}%`, l: 'Accuracy', icon: '🎯' },
            { v: String(prog.avg_mastery || 0) + '%', l: 'Mastery', icon: '📊' },
          ].map(s => (
            <div key={s.l} style={{
              background: 'rgba(255,255,255,0.15)', borderRadius: 14,
              padding: '10px 16px', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <div>
                <p style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{s.v}</p>
                <p style={{ fontSize: 10, opacity: 0.7, fontWeight: 600 }}>{s.l}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PWA INSTALL ── */}
      {installPrompt && (
        <button onClick={doInstall} style={{
          width: '100%', padding: '16px 20px', borderRadius: 16,
          border: '2px dashed #E8590C', background: '#FFF7ED', color: '#E8590C',
          fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          animation: 'alfnBounce 2s infinite'
        }}>
          📲 Install Alfanumrik App
        </button>
      )}

      {/* ── CELEBRATION MOMENTS ── */}
      {moments.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{
            fontSize: 12, fontWeight: 800, color: '#A8A29E',
            letterSpacing: '0.08em', marginBottom: 10
          }}>
            ✨ YOUR MOMENTS
          </h3>
          <div style={{
            display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8,
            scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch'
          }}>
            {moments.map((m: any, i: number) => {
              const look = MOMENT_MAP[m.moment_type] || { icon: '✨', bg: '#F5F4F0', border: '#E7E5E4' }
              return (
                <div key={m.id || i} style={{
                  minWidth: 260, maxWidth: 300, padding: '16px 18px', borderRadius: 18,
                  border: `2px solid ${look.border}20`, background: look.bg,
                  scrollSnapAlign: 'start', flexShrink: 0,
                  animation: `alfnSlideUp 0.4s ease ${i * 0.1}s both`
                }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{look.icon}</div>
                  <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, color: '#1C1917' }}>
                    {m.title}
                  </p>
                  <p style={{ fontSize: 12, color: '#57534E', lineHeight: 1.5 }}>
                    {m.description}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 900, color: '#E8590C', marginTop: 8 }}>
                    +{m.xp_awarded} XP
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── QUICK ACTION CARDS — BIG MOBILE BUTTONS ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12, marginBottom: 20
      }}>
        {[
          { icon: '🦊', label: 'Chat with Foxy', desc: 'Ask anything', sc: 'foxy' as Screen, bg: 'linear-gradient(135deg, #FFF7ED, #FEF3C7)', border: '#E8590C' },
          { icon: '🎯', label: 'Take a Quiz', desc: `${stats.sessions} completed`, sc: 'quiz' as Screen, bg: 'linear-gradient(135deg, #FAF5FF, #EDE9FE)', border: '#8B5CF6' },
          { icon: '🌟', label: 'Skill Tree', desc: `${prog.total_concepts || 0} concepts`, sc: 'skills' as Screen, bg: 'linear-gradient(135deg, #ECFDF5, #D1FAE5)', border: '#22C55E' },
          { icon: '📝', label: 'My Notes', desc: `${history?.notes?.length || 0} notes`, sc: 'notes' as Screen, bg: 'linear-gradient(135deg, #FFFBEB, #FEF9C3)', border: '#F59E0B' },
        ].map((card, i) => (
          <button key={card.sc} onClick={() => { snd('click'); nav(card.sc) }} style={{
            padding: '20px 16px', borderRadius: 20, border: `2px solid ${card.border}25`,
            background: card.bg, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            // BIG touch target for mobile
            minHeight: 120,
            transition: 'all 0.2s ease',
            animation: `alfnSlideUp 0.4s ease ${0.1 + i * 0.08}s both`
          }}
            onMouseEnter={e => { (e.target as any).style.transform = 'translateY(-3px) scale(1.02)' }}
            onMouseLeave={e => { (e.target as any).style.transform = 'none' }}
          >
            <span style={{ fontSize: 32, display: 'block', marginBottom: 10 }}>{card.icon}</span>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#1C1917', marginBottom: 2 }}>
              {card.label}
            </p>
            <p style={{ fontSize: 12, color: '#78716C', fontWeight: 500 }}>{card.desc}</p>
          </button>
        ))}
      </div>

      {/* ── NEXT ACTIONS ── */}
      {nextActions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{
            fontSize: 12, fontWeight: 800, color: '#A8A29E',
            letterSpacing: '0.08em', marginBottom: 10
          }}>
            → WHAT TO DO NOW
          </h3>
          {nextActions.slice(0, 4).map((a: any, i: number) => {
            const colorMap: Record<string, string> = { urgent: '#EF4444', high: '#E8590C', medium: '#3B82F6' }
            const iconMap: Record<string, string> = {
              fix_misconception: '🔧', assessment_due: '📋', level_up: '⬆️'
            }
            return (
              <button key={i} onClick={() => { snd('click'); nav('skills') }} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 18px', borderRadius: 16, background: '#fff',
                border: `1px solid ${colorMap[a.priority] || '#E7E5E4'}20`,
                marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                // Big mobile button
                minHeight: 64,
                transition: 'all 0.15s ease',
                animation: `alfnSlideUp 0.4s ease ${0.3 + i * 0.08}s both`
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: `${colorMap[a.priority] || '#3B82F6'}12`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0
                }}>
                  {iconMap[a.type] || '📖'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1C1917' }}>{a.label}</p>
                  <p style={{ fontSize: 12, color: '#78716C', marginTop: 2 }}>{a.reason}</p>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 900, letterSpacing: '0.06em',
                  padding: '4px 10px', borderRadius: 8,
                  background: `${colorMap[a.priority] || '#3B82F6'}12`,
                  color: colorMap[a.priority] || '#3B82F6'
                }}>
                  {a.priority?.toUpperCase()}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── RECENT QUIZZES ── */}
      {history?.quizzes?.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid #F0EDE8', borderRadius: 20,
          padding: '20px', marginBottom: 20
        }}>
          <h3 style={{
            fontSize: 12, fontWeight: 800, color: '#A8A29E',
            letterSpacing: '0.08em', marginBottom: 14
          }}>
            RECENT QUIZZES
          </h3>
          {history.quizzes.slice(0, 4).map((q: any) => (
            <div key={q.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid #F5F4F0'
            }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600 }}>{q.subject} · {q.grade}</p>
                <p style={{ fontSize: 11, color: '#A8A29E' }}>
                  {new Date(q.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <div style={{
                fontSize: 15, fontWeight: 900, padding: '4px 12px', borderRadius: 10,
                background: q.score_percent >= 70 ? '#F0FDF4' : q.score_percent >= 40 ? '#FFFBEB' : '#FEF2F2',
                color: q.score_percent >= 70 ? '#16A34A' : q.score_percent >= 40 ? '#D97706' : '#DC2626'
              }}>
                {q.score_percent}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── GROWTH MESSAGE ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1C1917, #292524)', borderRadius: 20,
        padding: '24px', color: '#D6D3D1', lineHeight: 1.7, fontSize: 14
      }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: '#E8590C', letterSpacing: '0.08em', marginBottom: 10 }}>
          🧠 YOU ARE GETTING BETTER AT THINKING
        </p>
        <p>
          {streak.message || 'Start a learning streak by practicing daily.'}
        </p>
        {(prog.struggling || 0) > 0 && (
          <p style={{ marginTop: 12 }}>
            You have <strong style={{ color: '#E8590C' }}>{prog.struggling} concept{prog.struggling > 1 ? 's' : ''}</strong> to
            strengthen. Every one you fix is permanent growth.
          </p>
        )}
        {(prog.mastered || 0) > 0 && (
          <p style={{ marginTop: 8 }}>
            <strong style={{ color: '#22C55E' }}>{prog.mastered} mastered.</strong> These are yours forever.
          </p>
        )}
      </div>
    </div>
  )
}
