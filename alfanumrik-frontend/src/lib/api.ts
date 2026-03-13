const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export function speak(text: string, lang: string = 'en-IN') {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    speechSynthesis.speak(utterance)
  }
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynthesis.cancel()
  }
}

async function apiCall(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

// Profile
export const api = {
  getProfile: (token: string) => apiCall('/api/profile', {}, token),
  saveProfile: (token: string, data: any) =>
    apiCall('/api/profile', { method: 'POST', body: JSON.stringify(data) }, token),
  getProgress: (token: string) => apiCall('/api/profile/progress', {}, token),

  // Chat
  chat: (token: string, message: string, sessionId?: string) =>
    apiCall('/api/chat', { method: 'POST', body: JSON.stringify({ message, sessionId }) }, token),
  getChatHistory: (token: string, sessionId: string) =>
    apiCall(`/api/chat/history/${sessionId}`, {}, token),
  getSessions: (token: string) => apiCall('/api/chat/sessions', {}, token),

  // Quiz
  generateQuiz: (token: string, topic: string, difficulty = 'medium', count = 5) =>
    apiCall('/api/quiz/generate', { method: 'POST', body: JSON.stringify({ topic, difficulty, count }) }, token),
  saveQuizResult: (token: string, data: any) =>
    apiCall('/api/quiz/result', { method: 'POST', body: JSON.stringify(data) }, token),
  getQuizHistory: (token: string) => apiCall('/api/quiz/history', {}, token),

  // Leaderboard
  getLeaderboard: (token: string, period: string) =>
    apiCall(`/api/admin/leaderboard?period=${period}`, {}, token),

  // Subscription / Payment
  getSubscription: (token: string) => apiCall('/api/payment/subscription', {}, token),
  createPaymentOrder: (token: string, planId: string) =>
    apiCall('/api/payment/order', { method: 'POST', body: JSON.stringify({ planId }) }, token),
  verifyPayment: (token: string, data: any) =>
    apiCall('/api/payment/verify', { method: 'POST', body: JSON.stringify(data) }, token),

  // Streaming chat
  chatStream: (token: string, message: string, sessionId: string | undefined, onChunk: (t: string) => void, onDone: (sid: string) => void) => {
    return fetch(`${API_URL}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, sessionId }),
    }).then(async (res) => {
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sid = sessionId || ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.chunk) onChunk(data.chunk)
            if (data.done) { sid = data.sessionId || sid; onDone(sid) }
          } catch {}
        }
      }
    })
  }
}
