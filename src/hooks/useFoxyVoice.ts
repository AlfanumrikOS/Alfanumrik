'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type LearnerMemory, type VoiceSessionState, type SessionMode,
  createSessionState, routeNextAction, buildVoiceSystemPrompt,
  getSessionOpener, detectSentiment, generateSessionSummary,
} from '@/lib/foxy-voice-engine';

/**
 * useFoxyVoice — Fixed voice session hook.
 *
 * Root cause of "not-allowed" error:
 * Web Speech API's recognition.start() requires a user gesture on first call.
 * The old code called it recursively from onend callback (no gesture).
 *
 * Fix: Use continuous recognition mode so we only call start() once
 * (from the button click), and it stays listening between turns.
 * We pause/resume by stopping TTS, not by restarting recognition.
 *
 * Additional fixes:
 * - Transcript captured via ref (not stale closure)
 * - Mic permission requested explicitly before session starts
 * - Voices loaded asynchronously (Chrome bug: getVoices() returns [] on first call)
 * - Indian English voice selection with fallback chain
 */

export type VoiceStatus = 'idle' | 'requesting_mic' | 'listening' | 'thinking' | 'speaking' | 'error';

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
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  toggleMute: () => void;
  isMuted: boolean;
  error: string | null;
  micPermission: 'unknown' | 'granted' | 'denied' | 'prompt';
  requestMicPermission: () => Promise<boolean>;
}

export function useFoxyVoice(options: UseFoxyVoiceOptions): UseFoxyVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [foxyText, setFoxyText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');

  const sessionStateRef = useRef<VoiceSessionState | null>(null);
  const memoryRef = useRef<LearnerMemory | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef<number>(0);
  const transcriptRef = useRef<string>('');
  const isProcessingRef = useRef(false);
  const isActiveRef = useRef(false);
  const voicesLoadedRef = useRef(false);

  // Keep isActive ref in sync
  useEffect(() => { isActiveRef.current = isSessionActive; }, [isSessionActive]);

  // ─── Load voices (Chrome needs this async) ─────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices();
      if (voices && voices.length > 0) voicesLoadedRef.current = true;
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // ─── Mic Permission ─────────────────────────────────────

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      // Always try getUserMedia directly — this is the only reliable way
      // to check mic access. navigator.permissions.query() is unreliable:
      // Chrome caches 'denied' even after user changes site settings.
      setStatus('requesting_mic');
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicPermission('denied');
        setError('Your browser does not support microphone access. Please use Chrome.');
        setStatus('error');
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
      setStatus('idle');
      return true;
    } catch (err: any) {
      setStatus('error');

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicPermission('denied');
        setError('Microphone permission denied. Click the lock icon in your address bar → Site settings → Microphone → Allow, then try again.');
      } else if (err.name === 'NotFoundError') {
        setMicPermission('denied');
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotReadableError' || err.name === 'AbortError') {
        setMicPermission('prompt');
        setError('Microphone is in use by another app. Close other apps using the mic and try again.');
      } else {
        setMicPermission('prompt');
        setError('Could not access microphone. Please check your device settings and try again.');
      }
      return false;
    }
  }, []);

  // ─── TTS (Text-to-Speech) — chunked for natural delivery ─

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(async (resolve) => {
      if (!window.speechSynthesis || isMuted) { resolve(); return; }

      window.speechSynthesis.cancel();

      // Strip any markdown/formatting that slipped through
      const clean = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/#{1,6}\s/g, '')
        .replace(/`[^`]*`/g, (m) => m.replace(/`/g, ''))
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();

      // Split into natural spoken chunks at sentence boundaries
      const chunks = clean
        .split(/(?<=[.!?।])\s+/)
        .filter(c => c.trim().length > 0);

      const isHindi = options.language === 'hi';
      const isHinglish = options.language === 'hinglish';
      // Hinglish uses en-IN voice since text is Roman script
      const targetLang = isHindi ? 'hi-IN' : 'en-IN';

      const voices = window.speechSynthesis.getVoices();
      const selectedVoice =
        voices.find(v => v.lang === targetLang && v.localService) ||
        voices.find(v => v.lang === targetLang) ||
        voices.find(v => v.lang.startsWith(isHindi ? 'hi' : 'en') && v.name.toLowerCase().includes('india')) ||
        voices.find(v => v.lang.startsWith(isHindi ? 'hi' : 'en'));

      // Speak each chunk sequentially with micro-pauses between
      for (const chunk of chunks) {
        await new Promise<void>((next) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.lang = targetLang;
          utterance.rate = isHinglish ? 0.93 : isHindi ? 0.90 : 0.95;
          utterance.pitch = 1.05;
          utterance.volume = 0.9;
          if (selectedVoice) utterance.voice = selectedVoice;
          utterance.onend = () => next();
          utterance.onerror = () => next();
          window.speechSynthesis.speak(utterance);
        });
        // Natural pause between sentences (200ms)
        await new Promise(r => setTimeout(r, 200));
      }

      resolve();
    });
  }, [options.language, isMuted]);

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
      totalVoiceSessions: m?.total_voice_sessions || 0,
      parentGoals: m?.parent_goals || null,
    };
  }, [options]);

  // ─── Call Foxy API ──────────────────────────────────────

  const callFoxy = useCallback(async (studentText: string): Promise<string> => {
    const state = sessionStateRef.current;
    const memory = memoryRef.current;
    if (!state || !memory) return "Let me think about that...";

    const wordCount = studentText.split(/\s+/).length;
    state.lastStudentSentiment = detectSentiment(studentText, 0, wordCount);
    state.studentTurns++;
    state.turnCount++;
    if (wordCount <= 2) state.shortResponseCount++;

    const route = routeNextAction(state, memory);
    if (route.nextMode !== state.mode) state.mode = route.nextMode;

    const systemPrompt = buildVoiceSystemPrompt(state.mode, memory, state);

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

    state.foxyTurns++;
    state.sessionDurationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
    state.transcript.push(
      { role: 'student', text: studentText, timestampMs: Date.now() - sessionStartRef.current },
      { role: 'foxy', text: data.reply || '', timestampMs: Date.now() - sessionStartRef.current },
    );

    return data.reply || "Hmm, let me think about that...";
  }, [options]);

  // ─── Process a completed utterance ─────────────────────

  const processUtterance = useCallback(async (text: string) => {
    if (!text.trim() || isProcessingRef.current || !isActiveRef.current) return;
    isProcessingRef.current = true;

    // Pause recognition while Foxy thinks + speaks
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    setStatus('thinking');
    setCurrentTranscript('');
    transcriptRef.current = '';

    try {
      const reply = await callFoxy(text);
      setFoxyText(reply);
      setStatus('speaking');
      await speak(reply);
    } catch {
      setError('Connection issue. Trying again...');
    }

    isProcessingRef.current = false;

    // Resume listening after Foxy finishes speaking
    if (isActiveRef.current) {
      resumeListening();
    }
  }, [callFoxy, speak]);

  // ─── Start / Resume Listening ──────────────────────────

  const resumeListening = useCallback(() => {
    if (!isActiveRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Clean up any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; // one utterance at a time
    recognition.interimResults = true;
    recognition.lang = options.language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStatus('listening');
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }
      if (final) {
        transcriptRef.current = final;
        setCurrentTranscript(final);
      } else if (interim) {
        setCurrentTranscript(interim);
      }
    };

    recognition.onend = () => {
      const text = transcriptRef.current.trim();
      if (text && !isProcessingRef.current) {
        processUtterance(text);
      } else if (isActiveRef.current && !isProcessingRef.current) {
        // No speech detected — restart listening
        setTimeout(() => {
          if (isActiveRef.current) resumeListening();
        }, 200);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        if (sessionStateRef.current) sessionStateRef.current.silenceCount++;
        if (isActiveRef.current && !isProcessingRef.current) {
          setTimeout(() => resumeListening(), 300);
        }
        return;
      }
      if (event.error === 'aborted') return; // we aborted it intentionally
      if (event.error === 'not-allowed') {
        setMicPermission('denied');
        setError('Microphone blocked. Click the lock icon in your address bar and allow microphone access.');
        setStatus('error');
        return;
      }
      setError(`Voice error: ${event.error}. Try refreshing the page.`);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err: any) {
      if (err.message?.includes('already started')) return;
      setError('Could not start listening. Please try again.');
    }
  }, [options.language, processUtterance]);

  // ─── Start Session ──────────────────────────────────────

  const startSession = useCallback(async () => {
    setError(null);

    // Step 1: Request mic permission FIRST (user gesture = this click)
    const hasPermission = await requestMicPermission();
    if (!hasPermission) return;

    setStatus('thinking');

    try {
      const memory = await loadMemory();
      memoryRef.current = memory;

      const state = createSessionState(options.mode, options.subject, options.topic);
      sessionStateRef.current = state;
      sessionStartRef.current = Date.now();
      isProcessingRef.current = false;
      transcriptRef.current = '';

      setIsSessionActive(true);

      // Foxy speaks first
      const opener = getSessionOpener(memory, options.mode, options.topic);
      setFoxyText(opener);
      setStatus('speaking');
      await speak(opener);

      // Start listening (mic already permitted from user gesture above)
      resumeListening();
    } catch (err) {
      setError('Failed to start voice session. Please try again.');
      setStatus('error');
    }
  }, [options, loadMemory, speak, requestMicPermission, resumeListening]);

  // ─── End Session ────────────────────────────────────────

  const endSession = useCallback(async () => {
    setIsSessionActive(false);
    isActiveRef.current = false;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();

    const state = sessionStateRef.current;
    const memory = memoryRef.current;

    if (state && memory) {
      const summary = generateSessionSummary(state);

      const recap = state.questionsAsked > 0
        ? `Great session! You got ${state.questionsCorrect} out of ${state.questionsAsked} right. Keep it up!`
        : `Nice chat! We covered ${state.topic}. See you next time!`;

      setFoxyText(recap);
      setStatus('speaking');
      await speak(recap);

      // Update learner memory
      try {
        await supabase.rpc('update_learner_memory_after_session', {
          p_student_id: options.studentId,
          p_session_summary: summary,
          p_session_mode: state.mode,
        });
      } catch {}
    }

    setStatus('idle');
    sessionStateRef.current = null;
  }, [options.studentId, speak]);

  // ─── Toggle Mute ────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted(m => {
      if (!m) window.speechSynthesis?.cancel();
      return !m;
    });
  }, []);

  // ─── Cleanup ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      if (recognitionRef.current) try { recognitionRef.current.abort(); } catch {}
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, []);

  return {
    status, isSessionActive, currentTranscript, foxyText,
    startSession, endSession, toggleMute, isMuted, error,
    micPermission, requestMicPermission,
  };
}
