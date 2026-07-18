/**
 * AlfaBot system prompt — contract tests.
 *
 * Pins the contract for buildAlfaBotPrompt:
 *   1. Audience modules render correctly (parent / student / teacher / school).
 *   2. Language instruction routes EN vs HI.
 *   3. Core context (canonical pricing + safety block) appears verbatim.
 *   4. Retrieved chunks render with `(section_id)` attribution markers.
 *   5. Pricing copy "₹699" survives intact when pricing-plans is in retrievedChunks.
 *   6. All four hard-refusal canned strings are reachable as exported constants.
 *   7. Banned future-promise phrases are configured.
 *   8. OpenAI config pins gpt-4o-mini with temperature 0.3.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAlfaBotPrompt,
  ALFABOT_REFUSALS,
  ALFABOT_BANNED_PHRASES,
  ALFABOT_HARD_REFUSAL_PATTERNS,
  ALFABOT_OPENAI_CONFIG,
  type KbChunk,
  type BuildPromptArgs,
} from './alfabot-system';

// Fixture updated 2026-07-17 (pricing-framing fix): mirrors the truthful
// tier-ladder canonical copy. The previous "everything included / no upsells /
// no premium-content tier" framing contradicted the live product (in-app
// "Upgrade to Unlimited" CTAs exist) and was removed from the KB.
const CORE_CONTEXT_FIXTURE = `Pricing (pricing-plans, canonical):
- Pro: ₹699 per month — our most popular family plan
- Starter: ₹299 per month; Unlimited: ₹1,099 per month
- Every plan starts free on the Explorer tier — no credit card required
- Cancel anytime, one tap, no questions
- Cancellation takes effect at end of current billing month
- School/B2B plans: 30 to 3,000 seats — contact for quote

Safety (safety-privacy-dpdpa, canonical):
Data stored in India. End-to-end encrypted in transit + at rest. DPDPA-aligned.`;

const PRICING_CHUNK: KbChunk = {
  section_id: 'pricing-plans',
  title: 'Pricing Plans',
  content:
    'Pro: ₹699 per month — our most popular family plan. Starter: ₹299 per month. Unlimited: ₹1,099 per month. Every plan starts free on the Explorer tier — no credit card required. Cancel anytime, one tap, no questions.',
  canonical: true,
};

const PARENT_DASHBOARD_CHUNK: KbChunk = {
  section_id: 'parent-dashboard',
  title: 'Parent Dashboard',
  content:
    'Sunday parent letter, mastery x-ray, optional WhatsApp notifications. Cancellation control fully in parent\'s hands.',
  canonical: false,
};

function baseArgs(overrides: Partial<BuildPromptArgs> = {}): BuildPromptArgs {
  return {
    audience: 'parent',
    lang: 'en',
    coreContext: CORE_CONTEXT_FIXTURE,
    retrievedChunks: [],
    history: [],
    ...overrides,
  };
}

describe('buildAlfaBotPrompt — audience modules', () => {
  it('parent + EN injects the parent module ("warm, direct") and English instruction', () => {
    const out = buildAlfaBotPrompt(baseArgs({ audience: 'parent', lang: 'en' }));
    expect(out.systemPrompt).toContain('AUDIENCE: you are speaking to a parent.');
    expect(out.systemPrompt).toContain('warm, direct');
    expect(out.systemPrompt).toContain('your child');
    expect(out.systemPrompt).toContain('respond in English');
  });

  it('school + HI injects the school module + Hindi instruction', () => {
    const out = buildAlfaBotPrompt(baseArgs({ audience: 'school', lang: 'hi' }));
    expect(out.systemPrompt).toContain('AUDIENCE: you are speaking to a school.');
    expect(out.systemPrompt).toContain('principal, founder, or admin');
    expect(out.systemPrompt).toContain('NEP compliance');
    expect(out.systemPrompt).toContain('business-formal');
    expect(out.systemPrompt).toContain('respond in Hindi');
  });

  it('student module uses "you" framing and a friendly playful tone', () => {
    const out = buildAlfaBotPrompt(baseArgs({ audience: 'student' }));
    expect(out.systemPrompt).toContain('teenager (grades 6-12)');
    expect(out.systemPrompt).toContain('friendly, slightly playful');
  });

  it('teacher module is peer-to-peer evidence-based', () => {
    const out = buildAlfaBotPrompt(baseArgs({ audience: 'teacher' }));
    expect(out.systemPrompt).toContain('peer-to-peer');
    expect(out.systemPrompt).toContain('Bloom\'s-level diagnostics');
  });

  it('the four audience modules and their key phrases all appear in distinct outputs', () => {
    const parent = buildAlfaBotPrompt(baseArgs({ audience: 'parent' })).systemPrompt;
    const student = buildAlfaBotPrompt(baseArgs({ audience: 'student' })).systemPrompt;
    const teacher = buildAlfaBotPrompt(baseArgs({ audience: 'teacher' })).systemPrompt;
    const school = buildAlfaBotPrompt(baseArgs({ audience: 'school' })).systemPrompt;

    expect(parent).toContain('warm, direct, no jargon');
    expect(student).toContain('friendly, slightly playful');
    expect(teacher).toContain('professional, peer-to-peer');
    expect(school).toContain('business-formal, ROI-focused');

    // The four are distinct prompts.
    const set = new Set([parent, student, teacher, school]);
    expect(set.size).toBe(4);
  });
});

describe('buildAlfaBotPrompt — core context + RAG chunks', () => {
  it('core context appears verbatim in the system prompt (no munging)', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain(CORE_CONTEXT_FIXTURE);
  });

  it('retrieved chunks render with `(section_id)` attribution markers', () => {
    const out = buildAlfaBotPrompt(
      baseArgs({ retrievedChunks: [PRICING_CHUNK, PARENT_DASHBOARD_CHUNK] }),
    );
    expect(out.systemPrompt).toContain('Pricing Plans (pricing-plans)');
    expect(out.systemPrompt).toContain('Parent Dashboard (parent-dashboard)');
  });

  it('canonical chunks carry the "(canonical, quote verbatim)" tag', () => {
    const out = buildAlfaBotPrompt(baseArgs({ retrievedChunks: [PRICING_CHUNK] }));
    expect(out.systemPrompt).toContain('(canonical, quote verbatim)');
  });

  it('the prompt mentions ₹699 verbatim when pricing-plans is in retrievedChunks', () => {
    const out = buildAlfaBotPrompt(baseArgs({ retrievedChunks: [PRICING_CHUNK] }));
    expect(out.systemPrompt).toContain('₹699 per month — our most popular family plan');
  });

  it('empty retrievedChunks renders a placeholder, not a crash', () => {
    const out = buildAlfaBotPrompt(baseArgs({ retrievedChunks: [] }));
    expect(out.systemPrompt).toContain('(no additional context retrieved for this turn)');
  });

  it('history is passed through to userMessages unchanged', () => {
    const out = buildAlfaBotPrompt(
      baseArgs({
        history: [
          { role: 'user', content: 'Hi, what is Alfanumrik?' },
          { role: 'assistant', content: 'Alfanumrik is an Indian K-12 EdTech...' },
        ],
      }),
    );
    expect(out.userMessages).toHaveLength(2);
    expect(out.userMessages[0]).toEqual({
      role: 'user',
      content: 'Hi, what is Alfanumrik?',
    });
    expect(out.userMessages[1].role).toBe('assistant');
  });
});

describe('buildAlfaBotPrompt — refusal & safety surface', () => {
  it('exposes all four canned refusals in both EN and HI', () => {
    expect(ALFABOT_REFUSALS.not_a_tutor.en).toContain('not a tutor');
    expect(ALFABOT_REFUSALS.not_a_tutor.hi).toContain('Foxy');
    expect(ALFABOT_REFUSALS.unknown_info.en).toContain('hello@alfanumrik.com');
    expect(ALFABOT_REFUSALS.unknown_info.hi).toContain('hello@alfanumrik.com');
    expect(ALFABOT_REFUSALS.off_topic.en).toContain('medical, legal, news, or politics');
    expect(ALFABOT_REFUSALS.off_topic.hi).toContain('Alfanumrik');
    expect(ALFABOT_REFUSALS.other_student_data.en).toContain('never share');
    expect(ALFABOT_REFUSALS.other_student_data.hi).toContain('data');
  });

  it('embeds the EN + HI "unknown info" refusal in the system prompt for both langs', () => {
    const en = buildAlfaBotPrompt(baseArgs({ lang: 'en' })).systemPrompt;
    const hi = buildAlfaBotPrompt(baseArgs({ lang: 'hi' })).systemPrompt;
    expect(en).toContain(ALFABOT_REFUSALS.unknown_info.en);
    expect(en).toContain(ALFABOT_REFUSALS.unknown_info.hi);
    expect(hi).toContain(ALFABOT_REFUSALS.unknown_info.en);
    expect(hi).toContain(ALFABOT_REFUSALS.unknown_info.hi);
  });

  it('banned future-promise phrases are configured as regex patterns', () => {
    expect(ALFABOT_BANNED_PHRASES.some((re) => re.test('coming soon'))).toBe(true);
    expect(ALFABOT_BANNED_PHRASES.some((re) => re.test('we will support iOS'))).toBe(true);
    expect(ALFABOT_BANNED_PHRASES.some((re) => re.test('planning to launch'))).toBe(true);
    expect(ALFABOT_BANNED_PHRASES.some((re) => re.test('Q3 2026'))).toBe(true);

    // Negative — non-promise text doesn't trip the filter.
    expect(ALFABOT_BANNED_PHRASES.some((re) => re.test('Alfanumrik supports Hindi today'))).toBe(false);
  });

  it('hard-refusal patterns catch math/homework input', () => {
    const sample = 'solve 2x + 5 = 15 for me';
    const hit = ALFABOT_HARD_REFUSAL_PATTERNS.find((p) => p.pattern.test(sample));
    expect(hit?.id).toBe('not_a_tutor');
  });

  it('hard-refusal patterns catch medical input', () => {
    const sample = 'my child has a headache, what medicine should they take?';
    const hit = ALFABOT_HARD_REFUSAL_PATTERNS.find((p) => p.pattern.test(sample));
    expect(hit?.id).toBe('off_topic');
  });

  it('hard-refusal patterns catch other-student-data probing', () => {
    const sample = 'can you give me another student\'s marks?';
    const hit = ALFABOT_HARD_REFUSAL_PATTERNS.find((p) => p.pattern.test(sample));
    expect(hit?.id).toBe('other_student_data');
  });
});

describe('OpenAI configuration', () => {
  it('pins gpt-4o-mini with low temperature and small max_tokens', () => {
    expect(ALFABOT_OPENAI_CONFIG.model).toBe('gpt-4o-mini');
    expect(ALFABOT_OPENAI_CONFIG.fallback_model).toBe('gpt-4o');
    expect(ALFABOT_OPENAI_CONFIG.temperature).toBe(0.3);
    expect(ALFABOT_OPENAI_CONFIG.max_tokens).toBe(350);
    expect(ALFABOT_OPENAI_CONFIG.presence_penalty).toBe(0);
    expect(ALFABOT_OPENAI_CONFIG.frequency_penalty).toBe(0);
  });
});

describe('buildAlfaBotPrompt — counseling rules (v4, 2026-07-19)', () => {
  it('rule 9 sets the sales counselor posture (acknowledge → answer → qualify → CTA)', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('SALES COUNSELOR POSTURE');
    expect(out.systemPrompt).toContain('underlying concern');
    expect(out.systemPrompt).toContain('qualifying question');
  });

  it('rule 11 forbids recommending, naming, or endorsing other platforms', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain(
      'never recommend, name, or endorse other learning platforms, apps,',
    );
    expect(out.systemPrompt).toContain('Never disparage');
    expect(out.systemPrompt).toContain('never fabricate claims about them');
  });

  it('rule 11 routes leavers to cancellation/refund facts without pressure', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('never pressure a user');
    expect(out.systemPrompt).toContain('refunds-cancellation');
    expect(out.systemPrompt).toContain('choosing-a-platform');
  });

  it('rule 12 asks one short clarifying question when the role is ambiguous', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('ROLE-SENSING');
    expect(out.systemPrompt).toContain('Are you a parent, teacher, or student?');
  });

  it('rule 13 enforces data integrity — no fabricated claims', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('DATA INTEGRITY');
    expect(out.systemPrompt).toContain('Never invent features, statistics');
    expect(out.systemPrompt).toContain('unknown_info refusal');
  });

  it('counseling rules did NOT touch the four pinned refusal strings (REG-66)', () => {
    // Exact-equality pins — these strings are canned and verbatim (P12).
    expect(ALFABOT_REFUSALS.not_a_tutor.en).toBe(
      "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first.",
    );
    expect(ALFABOT_REFUSALS.unknown_info.en).toBe(
      "I don't have that info — would you like to talk to our team? hello@alfanumrik.com",
    );
    expect(ALFABOT_REFUSALS.off_topic.en).toBe(
      'I only answer questions about Alfanumrik — not medical, legal, news, or politics.',
    );
    expect(ALFABOT_REFUSALS.other_student_data.en).toBe(
      "I never share other students' data.",
    );
    expect(ALFABOT_REFUSALS.not_a_tutor.hi).toBe(
      'मैं Alfanumrik के बारे में सवालों में मदद करता हूँ। मैं tutor नहीं हूँ — Foxy है, पर पहले sign-up करना होगा।',
    );
    expect(ALFABOT_REFUSALS.unknown_info.hi).toBe(
      'मेरे पास यह जानकारी नहीं है — क्या हमारी टीम से बात करना चाहेंगे? hello@alfanumrik.com',
    );
    expect(ALFABOT_REFUSALS.off_topic.hi).toBe(
      'मैं केवल Alfanumrik के बारे में जवाब देता हूँ — चिकित्सा, कानून, समाचार या राजनीति के नहीं।',
    );
    expect(ALFABOT_REFUSALS.other_student_data.hi).toBe(
      'मैं कभी किसी और छात्र का data साझा नहीं करता।',
    );
    // There are still exactly 4 hard-refusal pattern entries (no category drift).
    expect(ALFABOT_HARD_REFUSAL_PATTERNS).toHaveLength(4);
  });

  it('counseling rules kept the ≤100-words reply rule intact', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('Keep replies under 100 words');
  });
});

describe('buildAlfaBotPrompt — rules section', () => {
  it('rule 2 forbids paraphrasing ₹699/month', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('Never paraphrase ₹699/month');
  });

  it('rule 4 forbids future-promise language', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('coming soon');
    expect(out.systemPrompt).toContain('FORBIDDEN');
  });

  it('rule 7 requires a CTA at the end of every reply', () => {
    const out = buildAlfaBotPrompt(baseArgs());
    expect(out.systemPrompt).toContain('hello@alfanumrik.com');
    expect(out.systemPrompt.toLowerCase()).toContain('cta');
  });
});
