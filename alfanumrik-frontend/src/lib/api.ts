const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dxipobqngyfpqbbznojz.supabase.co'
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const api = {
  // Chat with Foxy AI tutor
  async chat(token: string, messages: any[], profile: any) {
    try {
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
    } catch (e) {
      console.error('Chat error:', e)
      return { text: 'Sorry, Foxy had a hiccup! Try again.' }
    }
  },

  // Save student profile during onboarding
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

  // Get student progress
  async getProgress(token: string) {
    return { progress: { xp: 0, streak: 0, quizzes: 0, mastered: 0 } }
  },

  // Generate quiz from Supabase edge function
  async generateQuiz(token: string, subject: string, grade: string) {
    try {
      const res = await fetch(`${SB_URL}/functions/v1/quiz-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SB_KEY,
        },
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

// Text-to-speech stubs (voice features planned for future)
export function speak(_text: string, _lang?: string) {
  // Voice TTS disabled — future feature
}

export function stopSpeaking() {
  // Voice TTS disabled — future feature
}
