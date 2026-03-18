'use client'
import { useState, useEffect } from 'react'
import { type Prof, api, snd, SM } from '@/lib/alfanumrik'

const STATE_LOOK: Record<string, { icon: string; color: string; bg: string; glow: string }> = {
  mastered:   { icon: '⭐', color: '#E8590C', bg: '#FFF7ED', glow: '0 0 16px rgba(232,89,12,0.25)' },
  proficient: { icon: '✅', color: '#22C55E', bg: '#F0FDF4', glow: '0 0 12px rgba(34,197,94,0.2)' },
  developing: { icon: '📖', color: '#0EA5E9', bg: '#F0F9FF', glow: 'none' },
  struggling: { icon: '🔶', color: '#F59E0B', bg: '#FFFBEB', glow: 'none' },
  error:      { icon: '⚠️', color: '#EF4444', bg: '#FEF2F2', glow: '0 0 16px rgba(239,68,68,0.2)' },
  locked:     { icon: '🔒', color: '#D4D0C8', bg: '#F5F4F0', glow: 'none' },
}

export default function SkillTree({ p }: { p: Prof }) {
  const [tree, setTree] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<any>(null)

  useEffect(() => {
    if (!p.studentId) return
    const load = async () => {
      const d = await api('student-experience', {
        action: 'skill_tree', student_id: p.studentId,
        subject: SM[p.subject] || 'math', grade: p.grade
      })
      setTree((d.tree || []).filter((n: any) => n.type !== 'chapter'))
      setSummary(d.summary || {})
      setLoading(false)
    }
    load()
  }, [p.studentId, p.subject, p.grade])

  if (loading) return (
    <div style={{
      padding: '80px 20px', textAlign: 'center',
      animation: 'alfnPulse 1.5s infinite'
    }}>
      <span style={{ fontSize: 48 }}>🌟</span>
      <p style={{ color: '#A8A29E', marginTop: 12, fontSize: 14 }}>Loading your skill map...</p>
    </div>
  )

  const total = Math.max(1, (summary.mastered || 0) + (summary.proficient || 0) +
    (summary.developing || 0) + (summary.struggling || 0) + (summary.error || 0))

  return (
    <div style={{ padding: '24px 28px 120px', maxWidth: 900, animation: 'alfnFadeIn 0.4s ease' }}>

      {/* ── HEADER ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#1C1917' }}>
          🌟 Skill Tree
        </h1>
        <p style={{ fontSize: 13, color: '#78716C', marginTop: 4 }}>
          {p.subject} · {p.grade} · {tree.length} concepts
        </p>
      </div>

      {/* ── DISTRIBUTION BAR ── */}
      <div style={{
        background: '#fff', borderRadius: 20, padding: '20px',
        border: '1px solid #F0EDE8', marginBottom: 20
      }}>
        {/* Bar */}
        <div style={{
          display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden',
          background: '#F0EDE8', marginBottom: 12
        }}>
          {[
            { count: summary.mastered || 0, color: '#E8590C' },
            { count: summary.proficient || 0, color: '#22C55E' },
            { count: summary.developing || 0, color: '#0EA5E9' },
            { count: summary.struggling || 0, color: '#F59E0B' },
            { count: summary.error || 0, color: '#EF4444' },
          ].map((seg, i) => (
            <div key={i} style={{
              width: `${(seg.count / total * 100)}%`, background: seg.color,
              transition: 'width 0.6s ease'
            }} />
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {[
            { l: 'Mastered', c: '#E8590C', n: summary.mastered || 0 },
            { l: 'Proficient', c: '#22C55E', n: summary.proficient || 0 },
            { l: 'Developing', c: '#0EA5E9', n: summary.developing || 0 },
            { l: 'Struggling', c: '#F59E0B', n: summary.struggling || 0 },
            { l: 'Errors', c: '#EF4444', n: summary.error || 0 },
            { l: 'Locked', c: '#D4D0C8', n: summary.locked || 0 },
          ].map(item => (
            <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.c }} />
              <span style={{ fontSize: 12, color: '#78716C', fontWeight: 600 }}>
                {item.n} {item.l}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── CONCEPT GRID ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
        gap: 10
      }}>
        {tree.map((c: any, i: number) => {
          const look = STATE_LOOK[c.visual_state] || STATE_LOOK.locked
          const isError = c.visual_state === 'error'
          const isLocked = c.visual_state === 'locked'

          return (
            <button key={c.code} onClick={() => {
              snd(isLocked ? 'click' : 'think')
              setSelectedNode(selectedNode?.code === c.code ? null : c)
            }} style={{
              padding: '18px 16px', borderRadius: 20,
              border: `2px solid ${look.color}30`,
              background: look.bg, cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left', position: 'relative', overflow: 'hidden',
              opacity: isLocked ? 0.4 : 1,
              boxShadow: look.glow,
              transition: 'all 0.25s ease',
              animation: isError
                ? 'alfnPulseBorder 2.5s infinite'
                : `alfnSlideUp 0.4s ease ${Math.min(i * 0.03, 0.6)}s both`,
              // Big touch target
              minHeight: 130,
            }}>
              {/* Streak badge */}
              {c.streak >= 3 && (
                <span style={{
                  position: 'absolute', top: 10, right: 12,
                  fontSize: 11, fontWeight: 900, color: '#F59E0B'
                }}>
                  🔥{c.streak}
                </span>
              )}

              {/* Progress bar at bottom */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
                background: `${look.color}15`
              }}>
                <div style={{
                  height: '100%', width: `${c.mastery}%`, background: look.color,
                  borderRadius: '0 2px 2px 0', transition: 'width 0.5s ease'
                }} />
              </div>

              {/* Icon + Title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{look.icon}</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, lineHeight: 1.3,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any
                }}>
                  {c.title || c.code.split('.').pop()?.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Mastery % */}
              <p style={{ fontSize: 28, fontWeight: 900, color: look.color, lineHeight: 1 }}>
                {c.mastery}%
              </p>
              <p style={{ fontSize: 11, color: '#78716C', fontWeight: 600, marginTop: 3 }}>
                {c.status_text}
              </p>

              {/* 3-layer dots */}
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                <div style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: c.l1 >= 70 ? '#E8590C' : c.l1 > 0 ? '#E8590C30' : '#E7E5E4'
                }} />
                <div style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: c.l2 >= 85 ? '#3B82F6' : c.l2_unlocked ? '#3B82F630' : '#E7E5E4'
                }} />
                <div style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: c.l3 >= 95 ? '#8B5CF6' : c.l3_unlocked ? '#8B5CF630' : '#E7E5E4'
                }} />
              </div>

              {/* Exam path label */}
              {c.exam_type && c.exam_type !== 'all' && (
                <p style={{
                  fontSize: 9, fontWeight: 700, color: '#A8A29E', marginTop: 6,
                  textTransform: 'uppercase', letterSpacing: '0.06em'
                }}>
                  {c.exam_type} path
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* ── DETAIL PANEL (when a node is selected) ── */}
      {selectedNode && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderRadius: '24px 24px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
          padding: '24px', zIndex: 100, maxHeight: '50vh', overflowY: 'auto',
          animation: 'alfnSlideUp 0.3s ease'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {selectedNode.title || selectedNode.code}
              </h3>
              <p style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>
                {selectedNode.status_text}
              </p>
            </div>
            <button onClick={() => setSelectedNode(null)} style={{
              width: 36, height: 36, borderRadius: 12, border: 'none',
              background: '#F5F4F0', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit'
            }}>✕</button>
          </div>

          {/* Layer progress */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'L1 CBSE', mastery: selectedNode.l1, color: '#E8590C', threshold: 70 },
              { label: 'L2 Apply', mastery: selectedNode.l2, color: '#3B82F6', threshold: 85, locked: !selectedNode.l2_unlocked },
              { label: 'L3 Advanced', mastery: selectedNode.l3, color: '#8B5CF6', threshold: 95, locked: !selectedNode.l3_unlocked },
            ].map(layer => (
              <div key={layer.label} style={{
                flex: 1, padding: '14px', borderRadius: 14,
                background: layer.locked ? '#F5F4F0' : `${layer.color}08`,
                border: `1px solid ${layer.locked ? '#E7E5E4' : layer.color}20`,
                opacity: layer.locked ? 0.5 : 1
              }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: layer.color, marginBottom: 4 }}>
                  {layer.label}
                </p>
                <p style={{ fontSize: 22, fontWeight: 900, color: layer.color }}>
                  {layer.mastery}%
                </p>
                <div style={{ height: 4, borderRadius: 2, background: `${layer.color}20`, marginTop: 6 }}>
                  <div style={{
                    height: '100%', borderRadius: 2, background: layer.color,
                    width: `${layer.mastery}%`, transition: 'width 0.5s ease'
                  }} />
                </div>
                <p style={{ fontSize: 10, color: '#A8A29E', marginTop: 4 }}>
                  {layer.locked ? '🔒 Locked' : layer.mastery >= layer.threshold ? '✅ Complete' : `Need ${layer.threshold}%`}
                </p>
              </div>
            ))}
          </div>

          {/* Action button */}
          <button onClick={() => {
            snd('ok')
            // TODO: navigate to the learning loop for this concept
          }} style={{
            width: '100%', padding: '16px', borderRadius: 16, border: 'none',
            background: selectedNode.visual_state === 'error'
              ? 'linear-gradient(135deg, #EF4444, #DC2626)'
              : 'linear-gradient(135deg, #E8590C, #EC4899)',
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            // Big mobile button
            minHeight: 56
          }}>
            {selectedNode.visual_state === 'error'
              ? '🔧 Fix Misconception'
              : selectedNode.visual_state === 'locked'
              ? '🔒 Complete Prerequisites First'
              : selectedNode.l2_unlocked && selectedNode.l2 < 85
              ? '📝 Practice Application Problems'
              : '📖 Continue Learning'}
          </button>
        </div>
      )}

      {/* Overlay when detail panel is open */}
      {selectedNode && (
        <div onClick={() => setSelectedNode(null)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.3)', zIndex: 99
        }} />
      )}
    </div>
  )
}
