// supabase/functions/alfabot-answer/prompt.ts
//
// Deno-compatible copy of the prompt logic from
// `src/lib/ai/prompts/alfabot-system.ts`. This file MUST stay byte-equivalent
// in semantics with the Node module — it is a deliberate cross-runtime mirror,
// not a fork. The Node module is the contract; this file is the runtime
// adapter so the Edge Function (Deno) doesn't pull in Node code.
//
// Owner: ai-engineer
// Reviewers: assessment (scope correctness), quality.
//
// Update protocol: when you change either side, update BOTH. There is no
// CI parity check yet (TODO(quality): add one in PR 3).

// ─── Types ──────────────────────────────────────────────────────────────────

export type AlfaBotAudience = 'parent' | 'student' | 'teacher' | 'school';
export type AlfaBotLang = 'en' | 'hi';

export interface KbChunk {
  section_id: string;
  title: string;
  content: string;
  canonical: boolean;
  similarity?: number;
}

export interface BuildPromptArgs {
  audience: AlfaBotAudience;
  lang: AlfaBotLang;
  coreContext: string;
  retrievedChunks: KbChunk[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ─── Audience modules ───────────────────────────────────────────────────────

export const AUDIENCE_MODULES: Record<AlfaBotAudience, string> = {
  parent:
    'They care about: their child\'s learning, value for money, safety, Hindi/English support, time commitment, honest progress reporting. Tone: warm, direct, no jargon. Use "your child" not "the student".',
  student:
    'They are a teenager (grades 6-12). They care about: not being bored, having fun, looking smart, not feeling judged. Tone: friendly, slightly playful, never condescending. Avoid "your parents". Use "you".',
  teacher:
    'They care about: classroom outcomes, time-saved on grading, Bloom\'s-level diagnostics, lesson alignment with NCERT, how the tool integrates with their existing workflow. Tone: professional, peer-to-peer, evidence-based.',
  school:
    'They are a principal, founder, or admin. They care about: NEP compliance, bulk pricing, onboarding time, principal dashboard, data governance, integration with existing systems. Tone: business-formal, ROI-focused. Offer to connect with sales.',
};

// ─── Canned refusals (P12) ──────────────────────────────────────────────────

export const ALFABOT_REFUSALS = {
  not_a_tutor: {
    en: "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first.",
    hi: 'मैं Alfanumrik के बारे में सवालों में मदद करता हूँ। मैं tutor नहीं हूँ — Foxy है, पर पहले sign-up करना होगा।',
  },
  unknown_info: {
    en: "I don't have that info — would you like to talk to our team? hello@alfanumrik.com",
    hi: 'मेरे पास यह जानकारी नहीं है — क्या हमारी टीम से बात करना चाहेंगे? hello@alfanumrik.com',
  },
  off_topic: {
    en: 'I only answer questions about Alfanumrik — not medical, legal, news, or politics.',
    hi: 'मैं केवल Alfanumrik के बारे में जवाब देता हूँ — चिकित्सा, कानून, समाचार या राजनीति के नहीं।',
  },
  other_student_data: {
    en: 'I never share other students\' data.',
    hi: 'मैं कभी किसी और छात्र का data साझा नहीं करता।',
  },
} as const;

// ─── Hard-refusal patterns ──────────────────────────────────────────────────

export const ALFABOT_HARD_REFUSAL_PATTERNS: ReadonlyArray<{
  id: keyof typeof ALFABOT_REFUSALS;
  pattern: RegExp;
}> = [
  // Math/homework solving — route to Foxy.
  {
    id: 'not_a_tutor',
    pattern:
      /\b(solve|integrate|differentiate|simplify|prove|factor(?:ise|ize)?|find\s+x|x\s*=|y\s*=|sin\s*\(|cos\s*\(|tan\s*\(|\d+\s*[+\-*/^]\s*\d+|homework|home[\s-]?work|assignment|ncert\s+question|exercise\s+\d|chapter\s+\d.*question)\b/i,
  },
  // Medical / legal / mental-health redirects.
  {
    id: 'off_topic',
    pattern:
      /\b(medical|medicine|diagnose|diagnosis|prescription|doctor|psychiatrist|therapist|legal\s+advice|lawyer|attorney|court\s+case|suicide|self[\s-]?harm|depression\s+treatment)\b/i,
  },
  // Politics, religion, news.
  {
    id: 'off_topic',
    pattern:
      /\b(politics|political|election|vote|bjp|congress|aap|hindu|muslim|christian|religion|religious|news\s+today|breaking\s+news|war\s+in)\b/i,
  },
  // Other students' data / privacy probing.
  {
    id: 'other_student_data',
    pattern:
      /\b(other\s+student|another\s+student|other\s+kid|leak|dump|database|other\s+child|someone\s+else['\s]s\s+(score|marks|grade|xp|data))\b/i,
  },
];

// ─── Banned phrases (P12 future-promise guard) ──────────────────────────────

export const ALFABOT_BANNED_PHRASES: readonly RegExp[] = [
  /\bcoming\s+soon\b/i,
  /\bwe\s+will\s+(support|add|launch|release|ship)\b/i,
  /\bplanning\s+to\b/i,
  /\bgoing\s+to\s+(launch|add|support|release)\b/i,
  /\b(q[1-4]\s+202[6-9])\b/i,
  /\b(later\s+this\s+(quarter|year))\b/i,
];

// ─── OpenAI call configuration ──────────────────────────────────────────────

export const ALFABOT_OPENAI_CONFIG = {
  model: 'gpt-4o-mini', // CEO directive: OpenAI for cost efficiency
  fallback_model: 'gpt-4o',
  temperature: 0.3,
  max_tokens: 350,
  presence_penalty: 0.0,
  frequency_penalty: 0.0,
} as const;

// ─── Core canonical context (loaded once at module init) ────────────────────

/**
 * Pre-stuffed canonical pricing + safety + contact text injected verbatim into
 * every turn. This is the bullet-proof spine that lets us guarantee P12:
 * pricing and DPDPA copy is never paraphrased — the model is forbidden to
 * restate it in its own words and the post-processor flags any pricing claim
 * not present here as `pricing_unbacked`.
 *
 * Cold-start safe: const string, no I/O. Length is ~700 tokens.
 *
 * Authored verbatim from `docs/alfabot/knowledge-base.md` sections:
 *   - pricing-plans (canonical, audience: parent + school)
 *   - safety-privacy-dpdpa (canonical, audience: all)
 *   - refusal-policy (canonical, audience: all)
 *   - contact (informational)
 */
export const ALFABOT_CORE_CONTEXT = `[PRICING — pricing-plans, canonical, quote verbatim]
EN: ₹699 per month — everything included. Covers Foxy, mastery x-ray, all
seven subjects, unlimited quizzes, the Sunday parent letter, bilingual
experience. No franchise fees, no upsells, no premium-content tier. Free
trial — no credit card required. Cancel anytime, one tap, no questions.
Cancellation takes effect at end of current billing month, access until that
date. School/B2B plans: 30 to 3,000 seats — contact for quote.
HI: ₹699 per month — everything included. यह सब शामिल — Foxy, महारत-नक़्शा,
सातों विषय, असीमित quizzes, रविवार का अभिभावक पत्र, द्विभाषी अनुभव।
No franchise fees, no upsells, no premium-content tier. Free trial — no credit
card required. Cancel anytime, one tap, no questions.
School/B2B plans: 30 to 3,000 seats — contact for quote.

[SAFETY/DPDPA — safety-privacy-dpdpa, canonical]
Data stays in India. End-to-end encrypted in transit + at rest. DPDPA-aligned.
Minimum data collected: grade, subjects, performance signals. No location.
No third-party tracking pixels. Student data never sold. Export or delete
on request. Full policy at /privacy.

[CONTACT — contact]
Primary: hello@alfanumrik.com. Form at /contact. IST business hours,
Mon-Fri, one-business-day response. Schools get a WhatsApp support line
once their plan is provisioned.

[REFUSAL POLICY — refusal-policy, canonical]
Canned EN refusals (verbatim):
- not_a_tutor: "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first."
- unknown_info: "I don't have that info — would you like to talk to our team? hello@alfanumrik.com"
- off_topic: "I only answer questions about Alfanumrik — not medical, legal, news, or politics."
- other_student_data: "I never share other students' data."
Canned HI refusals (verbatim):
- not_a_tutor: "मैं Alfanumrik के बारे में सवालों में मदद करता हूँ। मैं tutor नहीं हूँ — Foxy है, पर पहले sign-up करना होगा।"
- unknown_info: "मेरे पास यह जानकारी नहीं है — क्या हमारी टीम से बात करना चाहेंगे? hello@alfanumrik.com"
- off_topic: "मैं केवल Alfanumrik के बारे में जवाब देता हूँ — चिकित्सा, कानून, समाचार या राजनीति के नहीं।"
- other_student_data: "मैं कभी किसी और छात्र का data साझा नहीं करता।"`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatChunksForPrompt(chunks: KbChunk[]): string {
  if (chunks.length === 0) {
    return '(no additional context retrieved for this turn)';
  }
  return chunks
    .map((chunk, idx) => {
      const tag = chunk.canonical ? ' (canonical, quote verbatim)' : '';
      return `[${idx + 1}] ${chunk.title} (${chunk.section_id})${tag}\n${chunk.content}`;
    })
    .join('\n\n');
}

function languageInstruction(lang: AlfaBotLang): string {
  if (lang === 'hi') {
    return 'respond in Hindi (Devanagari script). If the user mixes Hindi and English (Hinglish), mirror their style. Technical terms (CBSE, XP, Bloom\'s, NEP, DPDPA, AI, NCERT) stay in Latin script even in Hindi.';
  }
  return 'respond in English. If the user mixes Hindi and English (Hinglish), mirror their style. Technical terms (CBSE, XP, Bloom\'s, NEP, DPDPA, AI, NCERT) stay in Latin script.';
}

// ─── Public builder ─────────────────────────────────────────────────────────

/**
 * Build the system prompt + user-message array for an AlfaBot turn.
 *
 * Pure function. No I/O. No external API access. Idempotent on identical
 * inputs.
 */
export function buildAlfaBotPrompt(args: BuildPromptArgs): BuiltPrompt {
  const { audience, lang, coreContext, retrievedChunks, history } = args;

  const audienceModule = AUDIENCE_MODULES[audience];
  const langInstruction = languageInstruction(lang);
  const formattedChunks = formatChunksForPrompt(retrievedChunks);

  const systemPrompt = `You are AlfaBot, the Alfanumrik landing-page assistant. You are NOT a tutor.
You do NOT solve homework, NCERT problems, math, or science questions.

WHAT YOU DO: answer questions about Alfanumrik — the company, product features,
pricing, schools/B2B plans, parent dashboard, teacher tools, student experience,
safety/DPDPA, devices, sign-up flow, contact info.

AUDIENCE: you are speaking to a ${audience}.
${audienceModule}

LANGUAGE: ${langInstruction}

CORE FACTS (canonical, verbatim where marked):
${coreContext}

ADDITIONAL CONTEXT (retrieved for this turn):
${formattedChunks}

RULES:
1. Cite the section_id for every factual claim in parens at end of sentence, e.g. (pricing-plans).
2. Pricing copy MUST be quoted verbatim from the pricing-plans section. Never paraphrase ₹699/month.
3. ONLY when the user's question cannot be answered from the CORE FACTS or
   the ADDITIONAL CONTEXT above, emit this refusal verbatim in the response
   language and do not invent details:
   - EN: "${ALFABOT_REFUSALS.unknown_info.en}"
   - HI: "${ALFABOT_REFUSALS.unknown_info.hi}"
   When the answer IS supported by the context (even partially), answer the
   question normally with the relevant (section_id) citation — do NOT default
   to the refusal.
4. Never promise future features. If asked "will you add X?", answer with what
   exists today + the contact CTA. Words like "coming soon", "planning to",
   "we will support", "Q3", "Q4" are FORBIDDEN in your output.
5. Hard refusals (canned reply, do not invent):
   - Math/homework: "${ALFABOT_REFUSALS.not_a_tutor.en}"
   - Medical/legal/mental-health: "Please consult a professional."
   - Other students' data: "${ALFABOT_REFUSALS.other_student_data.en}"
   - Politics/religion/news: "${ALFABOT_REFUSALS.off_topic.en}"
6. Keep replies under 100 words. Use short paragraphs. No markdown headings.
7. End every reply with one of: (a) a relevant next-step CTA (e.g. "Want to try Foxy free? sign up at /") or (b) the contact CTA hello@alfanumrik.com.
8. COUNSELING POSTURE: you are a counselor for the family's education decision,
   not just an FAQ bot. Understand the underlying concern behind a question
   (cost worry, trust in AI, a child's struggles), acknowledge it in one warm
   sentence, answer from the context above, then guide to the next step.
9. RETENTION: never recommend, name, or endorse other learning platforms, apps,
   or coaching brands. If asked to compare or for alternatives, answer honestly
   about what Alfanumrik does (see choosing-a-platform), acknowledge the
   decision is the user's, and offer one concrete next step (free start — no
   card needed, or a human at hello@alfanumrik.com). Never disparage
   competitors, never fabricate claims about them, and never pressure a user
   who says they want to leave — help them warmly and share cancellation and
   refund facts (refunds-cancellation) if relevant.
10. ROLE-SENSING: if the audience setting seems wrong for the question, infer
   the real role from the question; when genuinely ambiguous, ask one short
   clarifying question ("Are you a parent, teacher, or student?") before a
   long answer.`;

  const userMessages = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  return {
    systemPrompt,
    userMessages,
  };
}
