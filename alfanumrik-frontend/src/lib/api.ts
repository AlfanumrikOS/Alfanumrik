const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const api = {
  async chat(token: string, messages: any, profile: any) {
    try {
      let formattedMessages = messages
      if (typeof messages === 'string') {
        formattedMessages = [{ role: 'user', content: messages }]
      } else if (!Array.isArray(messages)) {
        formattedMessages = [{ role: 'user', content: String(messages) }]
      }

      const res = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: formattedMessages,
          student_name: profile?.name || 'Student',
          grade: profile?.grade || 'Grade 6',
          subject: profile?.subject || 'Mathematics',
          language: profile?.language || 'en',
        }),
      })
      const data = await res.json()
      const text = data.text || 'Sorry, Foxy had a hiccup! Try again.'
      return { text, message: text }
    } catch (e) {
      console.error('Chat error:', e)
      const fallback = 'Sorry, Foxy had a hiccup! Try again.'
      return { text: fallback, message: fallback }
    }
  },

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
    return { profile }
  },

  async getProfile(token: string) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/students?onboarding_completed=eq.true&limit=1`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` },
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

  async getProgress(token: string) {
    return { progress: { xp: 0, streak: 0, quizzes: 0, mastered: 0 } }
  },

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

  async submitQuizResult(token: string, result: any) {
    return { success: true }
  },
}

export function speak(_text: string, _lang?: string) {}
export function stopSpeaking() {}
