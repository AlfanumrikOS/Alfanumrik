'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   useVoice — Unified voice hook for Foxy Learning Companion

   TTS: ElevenLabs (via /api/tts) with Web Speech API fallback
   STT: Web Speech API (browser-native, zero latency)
   Audio: Visualizer via AnalyserNode for waveform
   ═══════════════════════════════════════════════════════════════ */

interface UseVoiceOptions {
  language: string;
  onTranscript: (text: string) => void;
  enabled: boolean;
}

interface UseVoiceReturn {
  // TTS
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  isLoadingAudio: boolean;
  // STT
  startListening: () => void;
  stopListening: () => void;
  isListening: boolean;
  interimTranscript: string;
  // Audio analysis
  analyserNode: AnalyserNode | null;
  // Status
  ttsAvailable: boolean;
  sttAvailable: boolean;
}

// Audio context singleton
let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function useVoice({ language, onTranscript, enabled }: UseVoiceOptions): UseVoiceReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [sttAvailable, setSttAvailable] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Check capabilities on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // STT check
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSttAvailable(!!SR);
    // TTS check — ping the API route
    setTtsAvailable(true); // Optimistic; falls back to Web Speech API if /api/tts fails
  }, []);

  // ─── TTS: ElevenLabs with Web Speech API fallback ───
  const speak = useCallback(async (text: string) => {
    if (!enabled || !text.trim()) return;

    // Stop any current speech
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();

    setIsLoadingAudio(true);

    try {
      // Try ElevenLabs first
      abortRef.current = new AbortController();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
        signal: abortRef.current.signal,
      });

      if (res.ok && res.body) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const audio = audioRef.current;
        audio.src = url;

        // Set up analyser for waveform visualization
        const ctx = getAudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        // Only create source node once per audio element
        if (!sourceNodeRef.current) {
          sourceNodeRef.current = ctx.createMediaElementSource(audio);
        }
        sourceNodeRef.current.connect(analyser);
        analyser.connect(ctx.destination);
        setAnalyserNode(analyser);

        setIsLoadingAudio(false);
        setIsSpeaking(true);

        audio.onended = () => {
          setIsSpeaking(false);
          setAnalyserNode(null);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          setIsLoadingAudio(false);
          setAnalyserNode(null);
          URL.revokeObjectURL(url);
        };

        await audio.play();
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setIsLoadingAudio(false);
        return;
      }
      // Fall through to Web Speech API
    }

    // Fallback: Web Speech API
    setIsLoadingAudio(false);
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const clean = text
      .replace(/\[KEY:\s*([^\]]+)\]/g, '$1')
      .replace(/\[ANS:\s*([^\]]+)\]/g, 'The answer is $1.')
      .replace(/\[FORMULA:\s*([^\]]+)\]/g, '$1')
      .replace(/\[TIP:\s*([^\]]+)\]/g, 'Exam tip: $1.')
      .replace(/\[MARKS:\s*([^\]]+)\]/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return;

    const voices = window.speechSynthesis.getVoices();
    const voice = language === 'hi'
      ? (voices.find(v => v.lang === 'hi-IN') || voices.find(v => v.lang.startsWith('hi')))
      : (voices.find(v => v.lang === 'en-IN') || voices.find(v => v.name.toLowerCase().includes('india')) || voices.find(v => v.lang.startsWith('en')));

    // Chunk long text
    const chunks = clean.length > 300 ? (clean.match(/[^.!?]+[.!?]+/g) || [clean]) : [clean];

    setIsSpeaking(true);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      if (voice) u.voice = voice;
      u.rate = 0.9;
      u.pitch = 1.05;
      u.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
      if (i === chunks.length - 1) {
        u.onend = () => setIsSpeaking(false);
      }
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
    });
  }, [enabled, language]);

  const stopSpeaking = useCallback(() => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setIsLoadingAudio(false);
    setAnalyserNode(null);
  }, []);

  // ─── STT: Web Speech API ───
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    // Stop TTS while listening
    stopSpeaking();

    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = language === 'hi' ? 'hi-IN' : language === 'hinglish' ? 'hi-IN' : 'en-IN';
    r.maxAlternatives = 1;

    r.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };

    r.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) setInterimTranscript(interim);
      if (final.trim()) {
        setInterimTranscript('');
        onTranscript(final.trim());
      }
    };

    r.onerror = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    r.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = r;
    r.start();
  }, [language, onTranscript, stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      setInterimTranscript('');
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, []);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    isLoadingAudio,
    startListening,
    stopListening,
    isListening,
    interimTranscript,
    analyserNode,
    ttsAvailable,
    sttAvailable,
  };
}
