const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// In production, use Supabase Edge Functions. In dev, use local Express server.
const API_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : `${SB_URL}/functions/v1`

async function request(path: string, token: string, options: any = {}) {
  const headers: any = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(API_BASE.includes('supabase') ? { 'apikey': SB_KEY } : {}),
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'POST',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(err.message || err.error || 'Request failed')
  }

  return res.json()
}

export const api = {
  // Chat with Foxy
  async chat(token: string, messages: any[], profile: any) {
    // Use the foxy-tutor edge function
    const res = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        student_name: profile?.name || 'Student',
        grade: profile?.grade || 'Grade 6',
        subject: profile?.subject || 'Mathematics',
        language: profile?.language || 'en',
      }),
    })
    const data = await res.json()
    return { text: data.text || 'Sorry, Foxy had a hiccup! Try again.' }
  },

  // Save student profile
  async saveProfile(token: string, profile: any) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          name: profile.name,
          grade: profile.grade,
          preferred_language: profile.language || 'en',
          onboarding_completed: true,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        return { profile: { ...profile, studentId: data?.[0]?.id } }
      }
    } catch (e) {
      console.error('Profile save error:', e)
    }
    // Always return profile even if save fails
    return { profile }
  },

  // Get student profile
  async getProfile(token: string) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/students?onboarding_completed=eq.true&limit=1`, {
        headers: {
          'apikey': SB_KEY,
          'Authorization': `Bearer ${token}`,
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.[0]) return { profile: data[0] }
      }
    } catch (e) {
      console.error('Get profile error:', e)
    }
    return { profile: null }
  },

  // Get progress
  async getProgress(token: string) {
    return { xp: 0, streak: 0, quizzes: 0, mastered: 0 }
  },

  // Generate quiz
  async generateQuiz(token: string, subject: string, grade: string) {
    try {
      const res = await fetch(`${SB_URL}/functions/v1/quiz-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SB_KEY },
        body: JSON.stringify({ subject: subject?.toLowerCase(), grade, count: 5 }),
      })
      return res.json()
    } catch {
      return { questions: [] }
    }
  },

  // Submit quiz result
  async submitQuizResult(token: string, result: any) {
    return { success: true }
  },
}
