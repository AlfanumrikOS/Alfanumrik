// supabase/functions/alfabot-answer/shared.ts
//
// Shared types + helpers used by both the streaming and non-streaming
// branches of the Edge Function (index.ts + stream-response.ts).
//
// Kept thin: validators, hard-refusal detection, structured logger. No
// upstream calls, no DB calls.

import {
  ALFABOT_HARD_REFUSAL_PATTERNS,
  ALFABOT_REFUSALS,
  type AlfaBotAudience,
  type AlfaBotLang,
} from './prompt.ts';

export const VALID_AUDIENCES: ReadonlyArray<AlfaBotAudience> = [
  'parent',
  'student',
  'teacher',
  'school',
];
export const VALID_LANGS: ReadonlyArray<AlfaBotLang> = ['en', 'hi'];

export interface AlfabotRequest {
  message: string;
  audience: AlfaBotAudience;
  lang: AlfaBotLang;
  sessionId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  anonId: string;
}

export interface DoneEnvelope {
  latency_ms: number;
  tokens_used: number;
  model: string;
  degradedMode: boolean;
  abstainReason?: string;
  sourcesUsed: string[];
}

// ─── Body validation ───────────────────────────────────────────────────────

export function validateBody(
  raw: unknown,
):
  | { ok: true; value: AlfabotRequest }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_body' };
  const b = raw as Record<string, unknown>;

  if (typeof b.message !== 'string' || b.message.length === 0 || b.message.length > 1000) {
    return { ok: false, error: 'invalid_message' };
  }
  if (typeof b.audience !== 'string' || !VALID_AUDIENCES.includes(b.audience as AlfaBotAudience)) {
    return { ok: false, error: 'invalid_audience' };
  }
  if (typeof b.lang !== 'string' || !VALID_LANGS.includes(b.lang as AlfaBotLang)) {
    return { ok: false, error: 'invalid_lang' };
  }
  if (typeof b.sessionId !== 'string' || b.sessionId.length === 0) {
    return { ok: false, error: 'invalid_session_id' };
  }
  if (typeof b.anonId !== 'string' || b.anonId.length === 0) {
    return { ok: false, error: 'invalid_anon_id' };
  }
  if (!Array.isArray(b.history)) {
    return { ok: false, error: 'invalid_history' };
  }
  const history = b.history.slice(-6);
  for (const turn of history) {
    if (
      !turn ||
      typeof turn !== 'object' ||
      ((turn as { role: unknown }).role !== 'user' && (turn as { role: unknown }).role !== 'assistant') ||
      typeof (turn as { content: unknown }).content !== 'string'
    ) {
      return { ok: false, error: 'invalid_history_turn' };
    }
  }

  return {
    ok: true,
    value: {
      message: b.message,
      audience: b.audience as AlfaBotAudience,
      lang: b.lang as AlfaBotLang,
      sessionId: b.sessionId,
      anonId: b.anonId,
      history: history as Array<{ role: 'user' | 'assistant'; content: string }>,
    },
  };
}

// ─── Greeting detection ───────────────────────────────────────────────────

const GREETING_RE = /^(hi|hello|hey|hii+|hola|namaste|namaskar|नमस्ते|नमस्कार|हाय|हैलो)\s*[.!?]*$/i;

const GREETING_REPLIES: Record<AlfaBotAudience, Record<AlfaBotLang, string>> = {
  parent: {
    en: "Hi! I'm AlfaBot, your guide to Alfanumrik. I help parents find the right learning plan for their child. To give you the best answer — which grade is your child in, and which subject do they find toughest?",
    hi: "नमस्ते! मैं AlfaBot हूँ। मैं अभिभावकों को उनके बच्चे के लिए सही learning plan खोजने में मदद करता हूँ। सबसे सटीक जवाब देने के लिए — आपका बच्चा किस कक्षा में है, और कौन-सा विषय सबसे कठिन लगता है?",
  },
  student: {
    en: "Hey! I'm AlfaBot. I can tell you about Foxy — your study buddy who knows your NCERT syllabus inside out. What grade are you in and which subject bugs you the most?",
    hi: "हाय! मैं AlfaBot हूँ। मैं Foxy के बारे में बता सकता हूँ — तुम्हारा study buddy जो NCERT पूरा जानता है। तुम किस class में हो और कौन-सा subject सबसे मुश्किल लगता है?",
  },
  teacher: {
    en: "Hello! I'm AlfaBot. I help teachers discover how Alfanumrik saves grading time and reveals exactly where students are stuck. How many students do you teach, and which subjects?",
    hi: "नमस्ते! मैं AlfaBot हूँ। मैं शिक्षकों को बताता हूँ कि Alfanumrik कैसे grading का समय बचाता है और दिखाता है कि छात्र कहाँ अटके हैं। आप कितने छात्रों को पढ़ाते हैं, और कौन-से विषय?",
  },
  school: {
    en: "Hello! I'm AlfaBot. I help schools explore our NEP-aligned platform. To give you relevant details — how many students does your school serve, and which grades?",
    hi: "नमस्ते! मैं AlfaBot हूँ। मैं स्कूलों को हमारा NEP-aligned platform दिखाता हूँ। सही जानकारी देने के लिए — आपके स्कूल में कितने छात्र हैं, और कौन-सी कक्षाएँ?",
  },
};

/**
 * Detect simple greetings ("hi", "hello", "namaste", etc.) and return an
 * audience-aware warm welcome. Returns null for non-greetings. This short-
 * circuits before the RAG + OpenAI pipeline to give instant, reliable
 * responses for the most common first message.
 */
export function detectGreeting(
  message: string,
  audience: AlfaBotAudience,
  lang: AlfaBotLang,
): { reply: string; reason: string } | null {
  if (GREETING_RE.test(message.trim())) {
    return {
      reply: GREETING_REPLIES[audience][lang],
      reason: 'greeting',
    };
  }
  return null;
}

// ─── Hard refusals ─────────────────────────────────────────────────────────

export function detectHardRefusal(
  message: string,
  lang: AlfaBotLang,
): { reply: string; reason: string } | null {
  for (const { id, pattern } of ALFABOT_HARD_REFUSAL_PATTERNS) {
    if (pattern.test(message)) {
      return {
        reply: ALFABOT_REFUSALS[id][lang],
        reason: `hard_refusal_${id}`,
      };
    }
  }
  return null;
}

// ─── Structured logger (P13: no message content) ────────────────────────────

export function logTurn(req: AlfabotRequest, done: DoneEnvelope): void {
  console.log(
    JSON.stringify({
      event: 'alfabot_turn',
      anonId: req.anonId,
      sessionId: req.sessionId,
      audience: req.audience,
      lang: req.lang,
      latencyMs: done.latency_ms,
      tokensUsed: done.tokens_used,
      model: done.model,
      degradedMode: done.degradedMode,
      abstainReason: done.abstainReason,
      sourcesUsed: done.sourcesUsed,
    }),
  );
}
