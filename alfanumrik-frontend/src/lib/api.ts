const SB_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://dxipobqngyfpqbbznojz.supabase.co'

const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type StudentProfile = {
  id?: string
  name?: string
  grade?: string
  subject?: string
  language?: string
  board?: string
  studentId?: string
}

type LessonRequest = {
  subject: 'math' | 'science'
  topic: string
  grade: string
  board?: string
  language?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  studentProfile?: Record<string, any>
}

type QuizRequest = {
  subject: string
  grade: string
  topic?: string
  count?: number
  difficulty?: 'easy' | 'medium' | 'hard'
}

type DiagramRequest = {
  subject: 'math' | 'science'
  topic: string
  prompt: string
  grade: string
  language?: string
}

type CheckAnswerRequest = {
  subject: 'math' | 'science'
  topic: string
  question: string
  studentAnswer: string
  expectedAnswer?: string
  grade: string
  language?: string
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function apiFetch(
  path: string,
  options: RequestInit = {},
  token?: string,
  useRest = false
) {
  const url = useRest
    ? `${SB_URL}/rest/v1/${path}`
    : `${SB_URL}/functions/v1/${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  const data = await safeJson(res)

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed: ${res.status}`)
  }

  return data
}

export const api = {
  async chat(token: string, messages: ChatMessage[] | string | any, profile?: StudentProfile) {
    try {
      let formattedMessages: ChatMessage[] = []

      if (typeof messages === 'string') {
        formattedMessages = [{ role: 'user', content: messages }]
      } else if (Array.isArray(messages)) {
        formattedMessages = messages.map((m) => ({
          role: m?.role || 'user',
          content: typeof m?.content === 'string' ? m.content : String(m?.content ?? ''),
        }))
      } else {
        formattedMessages = [{ role: 'user', content: String(messages ?? '') }]
      }

      const data = await apiFetch(
        'foxy-tutor',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: formattedMessages,
            student_name: profile?.name || 'Student',
            grade: profile?.grade || 'Grade 6',
            subject: profile?.subject || 'Mathematics',
            language: profile?.language || 'en',
            board: profile?.board || 'CBSE',
          }),
        },
        token
      )

      const text =
        data?.text ||
        data?.message ||
        data?.reply ||
        'Sorry, Foxy had a hiccup! Try again.'

      return { text, message: text, raw: data }
    } catch (e) {
      console.error('Chat error:', e)
      const fallback = 'Sorry, Foxy had a hiccup! Try again.'
      return { text: fallback, message: fallback }
    }
  },

  async saveProfile(token: string, profile: StudentProfile) {
    try {
      const data = await apiFetch(
        'students',
        {
          method: 'POST',
          headers: {
            Prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify({
            name: profile.name,
            grade: profile.grade,
            preferred_language: profile.language || 'en',
            onboarding_completed: true,
          }),
        },
        token,
        true
      )

      return {
        profile: {
          ...profile,
          studentId: data?.[0]?.id || profile.studentId,
        },
      }
    } catch (e) {
      console.error('Profile save error:', e)
      return { profile }
    }
  },

  async getProfile(token: string) {
    try {
      const data = await apiFetch(
        'students?select=*&onboarding_completed=eq.true&order=created_at.desc&limit=1',
        {
          method: 'GET',
        },
        token,
        true
      )

      if (data?.[0]) {
        return { profile: data[0] }
      }
    } catch (e) {
      console.error('Get profile error:', e)
    }

    return { profile: null }
  },

  async getProgress(_token: string) {
    return {
      progress: {
        xp: 0,
        streak: 0,
        quizzes: 0,
        mastered: 0,
      },
    }
  },

  async generateQuiz(token: string, subject: string, grade: string, topic?: string) {
    try {
      const data = await apiFetch(
        'quiz-engine',
        {
          method: 'POST',
          body: JSON.stringify({
            subject: subject?.toLowerCase(),
            grade,
            topic,
            count: 5,
          }),
        },
        token
      )

      return data
    } catch (e) {
      console.error('Generate quiz error:', e)
      return { questions: [] }
    }
  },

  async generateAdaptiveQuiz(token: string, input: QuizRequest) {
    try {
      const data = await apiFetch(
        'quiz-engine',
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject?.toLowerCase(),
            grade: input.grade,
            topic: input.topic,
            count: input.count || 5,
            difficulty: input.difficulty || 'medium',
          }),
        },
        token
      )

      return data
    } catch (e) {
      console.error('Adaptive quiz error:', e)
      return { questions: [] }
    }
  },

  async generateLesson(token: string, input: LessonRequest) {
    try {
      const data = await apiFetch(
        'lesson-generator',
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject,
            topic: input.topic,
            grade: input.grade,
            board: input.board || 'CBSE',
            language: input.language || 'en',
            difficulty: input.difficulty || 'medium',
            studentProfile: input.studentProfile || {},
          }),
        },
        token
      )

      return {
        success: true,
        lesson: data?.lesson || data?.data || data,
      }
    } catch (e) {
      console.error('Generate lesson error:', e)
      return {
        success: false,
        lesson: null,
        error: 'Unable to generate lesson right now.',
      }
    }
  },

  async generateDiagramSvg(token: string, input: DiagramRequest) {
    try {
      const data = await apiFetch(
        'diagram-engine',
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject,
            topic: input.topic,
            prompt: input.prompt,
            grade: input.grade,
            language: input.language || 'en',
            format: 'svg',
          }),
        },
        token
      )

      return {
        success: true,
        svg: data?.svg || '',
        spec: data?.spec || null,
        altText: data?.altText || '',
      }
    } catch (e) {
      console.error('Generate diagram SVG error:', e)
      return {
        success: false,
        svg: '',
        spec: null,
        altText: '',
        error: 'Unable to generate diagram right now.',
      }
    }
  },

  async checkAnswer(token: string, input: CheckAnswerRequest) {
    try {
      const data = await apiFetch(
        'answer-checker',
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject,
            topic: input.topic,
            question: input.question,
            studentAnswer: input.studentAnswer,
            expectedAnswer: input.expectedAnswer,
            grade: input.grade,
            language: input.language || 'en',
          }),
        },
        token
      )

      return {
        success: true,
        result: data?.result || data?.data || data,
      }
    } catch (e) {
      console.error('Check answer error:', e)
      return {
        success: false,
        result: null,
        error: 'Unable to check answer right now.',
      }
    }
  },

  async submitQuizResult(_token: string, result: any) {
    return { success: true, result }
  },
}

export function speak(_text: string, _lang?: string) {}

export function stopSpeaking() {}
