import { createClient } from '@supabase/supabase-js'

// ── Supabase ──
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
export const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjcxMzgsImV4cCI6MjA4ODQ0MzEzOH0.l-6_9kOkH1mXCGvNM0WzC8naEACGMCFaneEA7XxIhKc'
export const sb = createClient(SB_URL, SB_KEY)
export const EF = `${SB_URL}/functions/v1`
export const SITE = typeof window !== 'undefined' ? window.location.origin : 'https://alfanumrik-eight.vercel.app'

// ── API helper ──
export async function api(fn: string, body: any) {
  try {
    const r = await fetch(`${EF}/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return await r.json()
  } catch { return { error: 'API failed' } }
}

// ── Types ──
export type Screen = 'loading' | 'auth' | 'confirm' | 'reset' | 'onboard' | 'home' | 'foxy' | 'quiz' | 'notes' | 'progress' | 'skills' | 'profile'

export type Prof = {
  name: string
  grade: string
  subject: string
  language: string
  studentId?: string
}

export type Stats = {
  xp: number
  streak: number
  sessions: number
  correct: number
  asked: number
  minutes: number
}

export type Note = {
  id: string; title: string; content: string; note_type: string; color: string
  chapter_number?: number; chapter_title?: string; is_pinned: boolean
  is_starred: boolean; word_count: number; updated_at: string
}

// ── Constants ──
export const GRADES = ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12']

export const SUBJ = [
  { id: 'Mathematics', icon: '∑', c: '#E8590C', emoji: '🔢' },
  { id: 'Science', icon: '⚛', c: '#0EA5E9', emoji: '🔬' },
  { id: 'English', icon: 'Aa', c: '#8B5CF6', emoji: '📚' },
  { id: 'Hindi', icon: 'अ', c: '#F59E0B', emoji: '📖' },
  { id: 'Social Studies', icon: '🌍', c: '#10B981', emoji: '🗺' },
  { id: 'Physics', icon: '⚡', c: '#3B82F6', emoji: '⚡' },
  { id: 'Chemistry', icon: '🧪', c: '#EF4444', emoji: '🧪' },
  { id: 'Biology', icon: '🧬', c: '#22C55E', emoji: '🧬' },
  { id: 'Computer Science', icon: '💻', c: '#14B8A6', emoji: '💻' },
  { id: 'Accountancy', icon: '📊', c: '#8B5CF6', emoji: '📊' },
  { id: 'Economics', icon: '📈', c: '#F59E0B', emoji: '📈' }
]

export const LANGS = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'hi', label: 'Hindi', flag: '🇮🇳' },
  { code: 'ta', label: 'Tamil', flag: '🏛' },
  { code: 'te', label: 'Telugu', flag: '🏛' },
  { code: 'bn', label: 'Bengali', flag: '🏛' },
  { code: 'mr', label: 'Marathi', flag: '🏛' }
]

export const SM: Record<string, string> = {
  Mathematics: 'math', Science: 'science', English: 'english',
  Hindi: 'hindi', 'Social Studies': 'social_studies',
  Physics: 'physics', Chemistry: 'chemistry', Biology: 'biology',
  'Computer Science': 'computer_science'
}

// ── Sound Engine (Socratic + holistic) ──
let audioCtx: AudioContext | null = null
function getCtx() {
  if (!audioCtx && typeof window !== 'undefined') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return audioCtx
}

export function snd(type: string) {
  const ac = getCtx()
  if (!ac) return
  try { ac.resume() } catch {}

  const o = ac.createOscillator()
  const g = ac.createGain()
  o.connect(g)
  g.connect(ac.destination)
  const t = ac.currentTime

  switch (type) {
    case 'click': // soft tap
      o.type = 'sine'
      o.frequency.setValueAtTime(800, t)
      g.gain.setValueAtTime(0.06, t)
      g.gain.linearRampToValueAtTime(0, t + 0.04)
      break
    case 'nav': // page transition whoosh
      o.type = 'sine'
      o.frequency.setValueAtTime(400, t)
      o.frequency.linearRampToValueAtTime(600, t + 0.06)
      g.gain.setValueAtTime(0.04, t)
      g.gain.linearRampToValueAtTime(0, t + 0.08)
      break
    case 'send': // message sent — ascending chirp
      o.type = 'sine'
      o.frequency.setValueAtTime(523, t)
      o.frequency.linearRampToValueAtTime(1047, t + 0.1)
      g.gain.setValueAtTime(0.08, t)
      g.gain.linearRampToValueAtTime(0, t + 0.12)
      break
    case 'recv': // foxy responds — warm descending
      o.type = 'triangle'
      o.frequency.setValueAtTime(880, t)
      o.frequency.linearRampToValueAtTime(523, t + 0.2)
      g.gain.setValueAtTime(0.06, t)
      g.gain.linearRampToValueAtTime(0, t + 0.25)
      break
    case 'think': // Socratic thinking prompt — gentle rising question
      o.type = 'sine'
      o.frequency.setValueAtTime(392, t)          // G4
      o.frequency.setValueAtTime(440, t + 0.15)   // A4
      o.frequency.setValueAtTime(523, t + 0.3)    // C5 (rises like a question)
      g.gain.setValueAtTime(0.05, t)
      g.gain.linearRampToValueAtTime(0.07, t + 0.2)
      g.gain.linearRampToValueAtTime(0, t + 0.4)
      break
    case 'eureka': // student gets insight — bright major chord arpeggio
      o.type = 'sine'
      o.frequency.setValueAtTime(523, t)           // C5
      o.frequency.setValueAtTime(659, t + 0.08)    // E5
      o.frequency.setValueAtTime(784, t + 0.16)    // G5
      o.frequency.setValueAtTime(1047, t + 0.24)   // C6
      g.gain.setValueAtTime(0.1, t)
      g.gain.linearRampToValueAtTime(0, t + 0.4)
      break
    case 'correct': // answer correct — two-note chime
      o.type = 'sine'
      o.frequency.setValueAtTime(659, t)            // E5
      o.frequency.setValueAtTime(880, t + 0.1)      // A5
      g.gain.setValueAtTime(0.12, t)
      g.gain.linearRampToValueAtTime(0, t + 0.2)
      break
    case 'wrong': // wrong answer — gentle low hum (not punishing)
      o.type = 'triangle'
      o.frequency.setValueAtTime(220, t)
      g.gain.setValueAtTime(0.06, t)
      g.gain.linearRampToValueAtTime(0, t + 0.15)
      break
    case 'badge': // achievement — triumphant fanfare
      o.type = 'sine'
      o.frequency.setValueAtTime(523, t)
      o.frequency.setValueAtTime(659, t + 0.1)
      o.frequency.setValueAtTime(784, t + 0.2)
      o.frequency.setValueAtTime(1047, t + 0.3)
      g.gain.setValueAtTime(0.12, t)
      g.gain.linearRampToValueAtTime(0, t + 0.5)
      break
    case 'streak': // streak milestone — warm ascending with vibrato
      o.type = 'sine'
      o.frequency.setValueAtTime(440, t)
      o.frequency.setValueAtTime(554, t + 0.12)
      o.frequency.setValueAtTime(659, t + 0.24)
      g.gain.setValueAtTime(0.08, t)
      g.gain.linearRampToValueAtTime(0, t + 0.4)
      break
    case 'unlock': // layer unlock — magical ascending sparkle
      o.type = 'sine'
      o.frequency.setValueAtTime(698, t)            // F5
      o.frequency.setValueAtTime(880, t + 0.08)     // A5
      o.frequency.setValueAtTime(1047, t + 0.16)    // C6
      o.frequency.setValueAtTime(1319, t + 0.24)    // E6
      g.gain.setValueAtTime(0.1, t)
      g.gain.setValueAtTime(0.12, t + 0.16)
      g.gain.linearRampToValueAtTime(0, t + 0.5)
      break
    case 'ok': // confirmation — clean two-note
      o.type = 'sine'
      o.frequency.setValueAtTime(523, t)
      o.frequency.setValueAtTime(784, t + 0.12)
      g.gain.setValueAtTime(0.08, t)
      g.gain.linearRampToValueAtTime(0, t + 0.2)
      break
    default:
      o.frequency.setValueAtTime(600, t)
      g.gain.setValueAtTime(0.05, t)
      g.gain.linearRampToValueAtTime(0, t + 0.05)
  }

  o.start(t)
  o.stop(t + 0.6)
}

// ── DB Helpers ──
export async function ensureStudent(uid: string, p: Prof): Promise<string | null> {
  try {
    const { data: ex } = await sb.from('students').select('id').eq('auth_user_id', uid).maybeSingle()
    if (ex) {
      await sb.from('students').update({
        name: p.name, grade: p.grade, preferred_language: p.language, onboarding_completed: true
      }).eq('id', ex.id)
      return ex.id
    }
    const { data: cr } = await sb.from('students').insert({
      auth_user_id: uid, name: p.name, grade: p.grade,
      preferred_language: p.language, onboarding_completed: true
    }).select('id').single()
    return cr?.id || null
  } catch (e) { console.error(e); return null }
}

export async function getStats(sid: string): Promise<Stats> {
  const z: Stats = { xp: 0, streak: 0, sessions: 0, correct: 0, asked: 0, minutes: 0 }
  if (!sid) return z
  try {
    const { data } = await sb.from('student_overall_stats')
      .select('total_xp,streak_days,total_sessions,total_questions_asked,total_questions_answered_correctly,total_time_minutes')
      .eq('student_id', sid).maybeSingle()
    if (!data) return z
    return {
      xp: data.total_xp || 0, streak: data.streak_days || 0,
      sessions: data.total_sessions || 0, correct: data.total_questions_answered_correctly || 0,
      asked: data.total_questions_asked || 0, minutes: data.total_time_minutes || 0
    }
  } catch { return z }
}

export async function getTopicMastery(sid: string, sub: string) {
  try {
    const { data } = await sb.from('topic_mastery')
      .select('topic_tag,mastery_percent,mastery_level,total_attempts,correct_attempts')
      .eq('student_id', sid).eq('subject', sub)
      .order('mastery_percent', { ascending: false }).limit(20)
    return data || []
  } catch { return [] }
}

// ── Color palette for playful Indian theme ──
export const COLORS = {
  // Primary
  saffron: '#E8590C',
  saffronLight: '#FFF7ED',
  saffronDark: '#C2410C',
  // Secondary
  lotus: '#EC4899',
  sky: '#0EA5E9',
  leaf: '#22C55E',
  turmeric: '#F59E0B',
  indigo: '#6366F1',
  // Neutrals
  ink: '#1C1917',
  stone: '#57534E',
  sand: '#A8A29E',
  cream: '#FAFAF8',
  pearl: '#F5F4F0',
  // States
  correct: '#22C55E',
  wrong: '#EF4444',
  warning: '#F59E0B'
}
