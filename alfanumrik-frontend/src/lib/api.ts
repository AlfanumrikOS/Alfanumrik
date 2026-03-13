const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

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

  // Streaming chat
  chatStream: (token: string, message: string, sessionId: string | undefined, onChunk: (t: string) => void, onDone: (sid: string) => void) => {
    return fetch(`${API_URL}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, sessionId }),
    }).then(async (res) => {
      const reader = res.body!.getReader()
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
