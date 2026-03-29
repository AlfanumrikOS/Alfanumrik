'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type LearnerMemory, type VoiceSessionState, type SessionMode,
  createSessionState, routeNextAction, buildVoiceSystemPrompt,
  getSessionOpener, detectSentiment, generateSessionSummary,
} from '@/lib/foxy-voice-engine';

/**
 * useFoxyVoice — React hook for real-time voice sessions with Foxy.
 *
 * Architecture:
 *   Browser Mic → Web Speech API (STT) → Orchestration Engine → Claude API → Web Speech API (TTS)
 *
 * Phase 1 (MVP): Browser-native STT + TTS (zero external dependencies)
 * Phase 2: Deepgram STT + ElevenLabs TTS (higher quality)
 * Phase 3: WebSocket streaming for sub-500ms latency
 */

export type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface UseFoxyVoiceOptions {
  studentId: string;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  language: 'en' | 'hi' | 'hinglish';
  mode: SessionMode;
}

interface UseFoxyVoiceReturn {
  status: VoiceStatus;
  isSessionActive: boolean;
  currentTranscript: string;
  foxyText: string;
  sessionState: VoiceSessionState | null;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  toggleMute: () => void;
  isMuted: boolean;
  error: string | null;
}

// Check browser support
function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function isTTSSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window;
}

export function useFoxyVoice(options: UseFoxyVoiceOptions): UseFoxyVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [foxyText, setFoxyText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionStateRef = useRef<VoiceSessionState | null>(null);
  const memoryRef = useRef<LearnerMemory | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef<number>(0);

  // ─── Load Learner Memory ────────────────────────────────

  const loadMemory = useCallback(async (): Promise<LearnerMemory> => {
    const { data } = await supabase.rpc('get_or_create_learner_memory', {
      p_student_id: options.studentId,
    });

    const m = data as any;
    return {
      name: options.studentName,
      grade: options.grade,
      board: 'CBSE',
      preferredLanguage: m?.preferred_language || options.language,
      explanationStyle: m?.explanation_style || 'step_by_step',
      pacePreference: m?.pace_preference || 'moderate',
      confidenceLevel: m?.confidence_level || 'developing',
      recentWeakConcepts: m?.recent_weak_concepts || [],
      recentStrongConcepts: m?.recent_strong_concepts || [],
      recentMistakes: m?.recent_mistakes || [],
      currentFocusTopic: m?.current_focus_topic || options.topic,
      lastSessionSummary: m?.last_session_summary || null,
      lastSessionMode: m?.last_session_mode || null,
      sessionStreak: m?.session_streak || 0,
      parentGoals: m?.parent_goals || null,
      totalVoiceSessions: m?.total_voice_sessions || 0,
    };
  }, [options]);

  // ─── Text-to-Speech ─────────────────────────────────────

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!isTTSSupported() || isMuted) { resolve(); return; }

      // Stop any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.language === 'hi' ? 'hi-IN' : 'en-IN';
      utterance.rate = 1.0;
      utterance.pitch = 1.05; // slightly warm
      utterance.volume = 0.9;

      // Try to find an Indian English voice
      const voices = window.speechSynthesis.getVoices();
      const indianVoice = voices.find(v =>
        v.lang === (options.language === 'hi' ? 'hi-IN' : 'en-IN')
      );
      if (indianVoice) utterance.voice = indianVoice;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }, [options.language, isMuted]);

  // ─── Call Foxy API ──────────────────────────────────────

  const callFoxy = useCallback(async (studentText: string): Promise<string> => {
    const state = sessionStateRef.current;
    const memory = memoryRef.current;
    if (!state || !memory) return "I'm having trouble connecting. Try again.";

    // Detect sentiment
    const wordCount = studentText.split(/\s+/).length;
    state.lastStudentSentiment = detectSentiment(studentText, 0, wordCount);

    // Update counters
    state.studentTurns++;
    state.turnCount++;
    if (wordCount <= 2) state.shortResponseCount++;

    // Route to correct mode
    const route = routeNextAction(state, memory);
    if (route.nextMode !== state.mode) {
      state.mode = route.nextMode;
    }

    // Build system prompt
    const systemPrompt = buildVoiceSystemPrompt(state.mode, memory, state);

    // Call Foxy edge function
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        message: studentText,
        student_id: options.studentId,
        grade: options.grade,
        subject: options.subject,
        language: options.language,
        mode: state.mode,
        session_id: sessionIdRef.current,
        voice_system_prompt: systemPrompt,
      }),
    });

    const data = await res.json();
    if (data.session_id) sessionIdRef.current = data.session_id;

    // Update state
    state.foxyTurns++;
    state.sessionDurationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);

    // Add to transcript
    state.transcript.push(
      { role: 'student', text: studentText, timestampMs: Date.now() - sessionStartRef.current },
      { role: 'foxy', text: data.reply || '', timestampMs: Date.now() - sessionStartRef.current },
    );

    return data.reply || "Hmm, let me think about that...";
  }, [options]);

  // ─── Start Session ──────────────────────────────────────

  const startSession = useCallback(async () => {
    if (!isSpeechSupported()) {
      setError('Voice input is not supported in this browser. Try Chrome.');
      return;
    }

    setError(null);
    setStatus('thinking');

    try {
      // Load memory
      const memory = await loadMemory();
      memoryRef.current = memory;

      // Create session state
      const state = createSessionState(options.mode, options.subject, options.topic);
      sessionStateRef.current = state;
      sessionStartRef.current = Date.now();

      // Create DB session record
      const { data: sessionRow } = await supabase
        .from('foxy_voice_sessions')
        .insert({
          student_id: options.studentId,
          session_mode: options.mode,
          subject: options.subject,
          topic: options.topic,
          grade: options.grade,
          language: options.language,
          stt_provider: 'browser',
          tts_provider: 'browser',
        })
        .select('id')
        .single();

      if (sessionRow) sessionIdRef.current = sessionRow.id;

      setIsSessionActive(true);

      // Foxy speaks first — session opener
      const opener = getSessionOpener(memory as any, options.mode, options.topic);
      setFoxyText(opener);
      setStatus('speaking');
      await speak(opener);

      // Start listening
      startListening();
    } catch (err) {
      setError('Failed to start voice session. Please try again.');
      setStatus('error');
    }
  }, [options, loadMemory, speak]);

  // ─── Listening Loop ─────────────────────────────────────

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = options.language === 'hi' ? 'hi-IN' : 'en-IN';

    recognition.onstart = () => setStatus('listening');

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setCurrentTranscript(transcript);
    };

    recognition.onend = async () => {
      const transcript = currentTranscript.trim();
      if (!transcript || !isSessionActive) return;

      setStatus('thinking');
      setCurrentTranscript('');

      try {
        const reply = await callFoxy(transcript);
        setFoxyText(reply);
        setStatus('speaking');
        await speak(reply);

        // Continue listening after Foxy finishes speaking
        if (isSessionActive) {
          startListening();
        }
      } catch {
        setError('Connection issue. Trying again...');
        if (isSessionActive) startListening();
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Silence detected
        if (sessionStateRef.current) sessionStateRef.current.silenceCount++;
        if (isSessionActive) startListening();
        return;
      }
      if (event.error !== 'aborted') {
        setError(`Voice error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [options.language, isSessionActive, currentTranscript, callFoxy, speak]);

  // ─── End Session ────────────────────────────────────────

  const endSession = useCallback(async () => {
    setIsSessionActive(false);

    // Stop recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    // Stop speech
    if (typeof window !== 'undefined') {
      window.speechSynthesis.cancel();
    }

    const state = sessionStateRef.current;
    const memory = memoryRef.current;

    if (state && memory) {
      // Generate summary
      const summary = generateSessionSummary(state);
      const engagementScore = calculateEngagementScore(state);

      // Foxy says goodbye
      const recap = state.questionsAsked > 0
        ? `Great session! You got ${state.questionsCorrect} out of ${state.questionsAsked} right. ${engagementScore >= 70 ? 'Really solid work!' : 'Keep practicing!'}`
        : `Nice chat! We covered ${state.topic}. See you next time!`;

      setFoxyText(recap);
      setStatus('speaking');
      await speak(recap);

      // Save to DB
      if (sessionIdRef.current) {
        await supabase.from('foxy_voice_sessions').update({
          ended_at: new Date().toISOString(),
          duration_seconds: Math.round((Date.now() - sessionStartRef.current) / 1000),
          total_turns: state.turnCount,
          student_turns: state.studentTurns,
          foxy_turns: state.foxyTurns,
          questions_asked: state.questionsAsked,
          questions_correct: state.questionsCorrect,
          silences_detected: state.silenceCount,
          engagement_score: engagementScore,
          struggle_moments: state.consecutiveWrong >= 2 ? 1 : 0,
          transcript: state.transcript,
          foxy_summary: summary,
          concepts_covered: state.conceptsCovered,
        }).eq('id', sessionIdRef.current);
      }

      // Update learner memory
      await supabase.rpc('update_learner_memory_after_session', {
        p_student_id: options.studentId,
        p_session_summary: summary,
        p_session_mode: state.mode,
        p_engagement_score: engagementScore,
      });
    }

    setStatus('idle');
    sessionStateRef.current = null;
  }, [options.studentId, speak]);

  // ─── Toggle Mute ────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted(m => !m);
    if (!isMuted && typeof window !== 'undefined') {
      window.speechSynthesis.cancel();
    }
  }, [isMuted]);

  // ─── Cleanup ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (typeof window !== 'undefined') window.speechSynthesis.cancel();
    };
  }, []);

  return {
    status,
    isSessionActive,
    currentTranscript,
    foxyText,
    sessionState: sessionStateRef.current,
    startSession,
    endSession,
    toggleMute,
    isMuted,
    error,
  };
}

function calculateEngagementScore(state: VoiceSessionState): number {
  let score = 50; // baseline

  // Positive signals
  if (state.studentTurns >= 5) score += 10;
  if (state.questionsCorrect > 0) score += Math.min(state.questionsCorrect * 5, 20);
  if (state.consecutiveCorrect >= 3) score += 10;
  if (state.sessionDurationSec >= 300) score += 10; // 5+ minutes

  // Negative signals
  if (state.silenceCount >= 3) score -= 15;
  if (state.shortResponseCount >= 4) score -= 10;
  if (state.consecutiveWrong >= 3) score -= 10;

  return Math.max(0, Math.min(100, score));
}
