'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { api, speak, stopSpeaking } from '@/lib/api'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const STARTERS = [
  "Explain photosynthesis simply 🌿",
  "Help me understand fractions 🔢",
  "What causes earthquakes? 🌍",
  "Tell me about the Mughal Empire 🏯",
  "How does electricity work? ⚡",
  "Quiz me on my subject! 🧠",
]

export default function FoxyScreen({
  profile,
  token,
  initTopic,
}: {
  profile: any
  token: string
  initTopic?: string
}) {
  const welcomeMsg = `Hey ${profile?.name || 'there'}! I'm Foxy, your AI tutor! 🦊✨\n\nI'm here to help you with **${profile?.subject || 'all your subjects'}**. What would you like to learn today?`

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: welcomeMsg }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [isListening, setIsListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const initFired = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send initTopic once (from Syllabus "Ask Foxy" button)
  useEffect(() => {
    if (initTopic && !initFired.current) {
      initFired.current = true
      setTimeout(() => sendMessage(initTopic), 600)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initTopic])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg = text.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    let streamedText = ''

    try {
      await api.chatStream(
        token,
        userMsg,
        sessionId,
        (chunk) => {
          streamedText += chunk
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: streamedText, streaming: true }
            return updated
          })
        },
        (sid) => {
          if (sid) setSessionId(sid)
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: streamedText, streaming: false }
            return updated
          })
          if (ttsEnabled && streamedText) {
            speak(streamedText, profile?.language === 'Hindi' ? 'hi-IN' : 'en-IN')
          }
          setLoading(false)
        }
      )
    } catch {
      // Fallback: non-streaming
      try {
        const res = await api.chat(token, userMsg, sessionId)
        if (res.sessionId) setSessionId(res.sessionId)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: res.message, streaming: false }
          return updated
        })
        if (ttsEnabled && res.message) {
          speak(res.message, profile?.language === 'Hindi' ? 'hi-IN' : 'en-IN')
        }
      } catch {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: "Sorry, I had trouble connecting. Please try again! 🦊",
            streaming: false,
          }
          return updated
        })
      }
      setLoading(false)
    }
  }, [token, sessionId, loading, ttsEnabled, profile?.language])

  const startNewChat = () => {
    if (ttsEnabled) stopSpeaking()
    setMessages([{
      role: 'assistant',
      content: `Starting fresh! 🦊 What shall we explore today, ${profile?.name || 'friend'}?`,
    }])
    setSessionId(undefined)
  }

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice input not supported in this browser'); return }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return }

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = profile?.language === 'Hindi' ? 'hi-IN' : 'en-IN'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult  = (e: any) => { setInput(e.results[0][0].transcript); setIsListening(false) }
    rec.onerror   = () => setIsListening(false)
    rec.onend     = () => setIsListening(false)
    rec.start()
    setIsListening(true)
  }

  const toggleTts = () => {
    if (ttsEnabled) stopSpeaking()
    setTtsEnabled(v => !v)
  }

  return (
    <div className="screen">
      {/* Header */}
      <div className="bg-forest px-5 pt-12 pb-4 flex items-center gap-3 flex-shrink-0">
        <div className="relative">
          <div className="w-12 h-12 bg-saffron rounded-2xl flex items-center justify-center text-2xl">🦊</div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-forest" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-xl font-extrabold text-white">Foxy — MIGA Tutor</h1>
          <p className="text-cream/60 text-xs">{profile?.grade} · {profile?.subject}</p>
        </div>
        <button
          onClick={toggleTts}
          title="Toggle voice output"
          className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all ${
            ttsEnabled ? 'bg-saffron text-white' : 'bg-white/10 text-cream/50'
          }`}
        >🔊</button>
        <button
          onClick={startNewChat}
          title="New chat"
          className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-cream/50 text-base"
        >✚</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Starter chips — only on fresh chat */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {STARTERS.map(s => (
              <button key={s} onClick={() => sendMessage(s)}
                className="bg-white border border-saffron/20 text-forest text-xs font-medium px-3 py-1.5 rounded-full active:scale-95 transition-all shadow-sm">
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 bg-saffron rounded-xl flex items-center justify-center text-sm mr-2 flex-shrink-0 mt-1">
                🦊
              </div>
            )}
            <div className={`relative max-w-[78%] px-4 py-3 rounded-2xl shadow-sm ${
              msg.role === 'user'
                ? 'bg-saffron text-white rounded-tr-sm'
                : 'bg-white text-forest rounded-tl-sm'
            }`}>
              {msg.streaming && msg.content === '' ? (
                <div className="flex gap-1 py-1">
                  {[0, 1, 2].map(j => (
                    <div key={j} className="w-2 h-2 bg-saffron rounded-full typing-dot"
                      style={{ animationDelay: `${j * 0.2}s` }} />
                  ))}
                </div>
              ) : (
                <div className={`text-sm leading-relaxed ${msg.role === 'user' ? 'text-white' : 'text-forest'}`}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown components={{
                      strong: ({ children }) => <strong className="font-bold text-saffron">{children}</strong>,
                      p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul:     ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2">{children}</ul>,
                      li:     ({ children }) => <li className="text-forest/80">{children}</li>,
                      code:   ({ children }) => <code className="bg-saffron/10 text-saffron px-1 rounded text-xs">{children}</code>,
                    }}>
                      {msg.content}
                    </ReactMarkdown>
                  ) : msg.content}
                  {msg.streaming && msg.content && (
                    <span className="inline-block w-1 h-4 bg-saffron/60 ml-0.5 animate-pulse-soft rounded-full" />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="bg-white border-t border-black/5 px-4 py-3 safe-bottom flex-shrink-0">
        <div className="flex items-center gap-2 bg-cream rounded-2xl px-4 py-2 border border-black/8">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            placeholder="Ask Foxy anything..."
            className="flex-1 bg-transparent text-forest text-sm outline-none font-medium placeholder:text-forest/30"
            disabled={loading}
          />
          <button onClick={startVoice}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-forest/8 text-forest/50'
            }`}>
            🎤
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="w-9 h-9 bg-saffron rounded-xl flex items-center justify-center text-white disabled:opacity-40 transition-all active:scale-90">
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
