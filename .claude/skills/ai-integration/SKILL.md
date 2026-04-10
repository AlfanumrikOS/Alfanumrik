---
name: ai-integration
description: Claude API usage patterns, RAG pipeline rules, prompt template conventions, and AI safety checklist for Alfanumrik Edge Functions.
user-invocable: false
---

# Skill: AI Integration

Patterns for the AI-powered features. Reference when modifying foxy-tutor, ncert-solver, quiz-generator, or cme-engine.

**Owning agent**: ai-engineer. Assessment reviews correctness.

## AI Edge Functions
| Function | Model | Purpose | Daily Limit |
|---|---|---|---|
| `foxy-tutor` | Claude Haiku | Conversational tutoring (6 modes) | Per plan: 5/30/unlimited |
| `ncert-solver` | Claude Haiku | Step-by-step NCERT solutions | Shared with foxy |
| `quiz-generator` | None (algorithmic) | Adaptive question selection | No limit |
| `cme-engine` | None (algorithmic) | BKT/IRT mastery computation | No limit |

## Claude API Usage Pattern
```typescript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": Deno.env.get("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,    // Foxy persona + CBSE scope + safety rails + RAG context
    messages: conversationHistory,
    stream: true,            // Always stream for tutoring
  }),
});
```

## RAG Pipeline
```
Input: student question + grade + subject + topic
  ↓
1. Extract keywords / topic from question
2. Query rag_content_chunks:
   - Filter: grade = student grade, subject = student subject
   - Match: keyword similarity or embedding similarity
   - Limit: top 3-5 chunks
  ↓
3. Build system prompt:
   "You are Foxy, a friendly CBSE tutor for Class {grade} {subject}.
    Use ONLY the following reference material:
    ---
    {chunk_1}
    {chunk_2}
    {chunk_3}
    ---
    If the answer is not in the reference material, say so."
  ↓
4. Send to Claude with conversation history
  ↓
5. Post-process response:
   - Verify no hallucinated facts (if detectable)
   - Add NCERT chapter references
   - Ensure age-appropriate language
  ↓
6. Stream to student
```

## Prompt Template Conventions
1. **System prompt** defines: persona (Foxy), scope (CBSE grade+subject), safety rails, RAG context
2. **Temperature**: 0.3 for factual (solving, explaining), 0.7 for motivational (encouragement)
3. **Max tokens**: varies by mode — quiz answers: 256, explanations: 1024, notes: 2048
4. **Language**: respond in the language the student uses (English, Hindi, or Hinglish)
5. **Safety rails in system prompt**:
   - "You are a tutor for Class {grade}. Stay within CBSE {subject} curriculum."
   - "Do not discuss topics outside academics."
   - "If unsure, say 'I'm not sure about this — check with your teacher.'"
   - "Keep explanations age-appropriate."

## Circuit Breaker Rules
```
Failure tracking:
- Count Claude API failures in a 60-second window
- If ≥ 3 failures in 60 seconds → OPEN circuit

When circuit is OPEN:
- Return cached response or fallback message
- Fallback: "Foxy is taking a short break. Try again in a minute!"
- Log circuit open event

Recovery:
- After 30 seconds, allow ONE probe request → HALF-OPEN
- If probe succeeds → CLOSE circuit
- If probe fails → keep OPEN, reset 30s timer
```

## AI Safety Checklist (product invariant P12)
- [ ] All responses age-appropriate for grades 6-12
- [ ] No unfiltered LLM output — always post-process
- [ ] Responses stay within CBSE curriculum scope
- [ ] Daily usage limits enforced per subscription plan
- [ ] Circuit breaker implemented for Claude API failures
- [ ] No PII sent to Claude API (anonymize: session ID only, no name/email)
- [ ] AI interactions logged for quality audit (session_id, topic, mode, quality_score — no PII)

## Foxy Tutor Modes
| Mode | Behavior | Temperature |
|---|---|---|
| Learn | Explain topic step-by-step | 0.3 |
| Practice | Guide through practice problems | 0.3 |
| Quiz | Generate and evaluate quiz questions | 0.3 |
| Doubt | Answer specific doubts with references | 0.3 |
| Revise | Create revision summaries | 0.5 |
| Notes | Generate structured notes | 0.3 |

## CME Engine Algorithms
| Algorithm | Purpose | Implementation |
|---|---|---|
| BKT (Bayesian Knowledge Tracing) | Estimate P(mastery) per concept | `p_mastery = p_mastery * (1 - p_slip) / p_correct` if correct |
| IRT (Item Response Theory) | Estimate student ability | 2-parameter logistic model |
| SM-2 (Spaced Repetition) | Schedule review intervals | Modified SuperMemo algorithm |
| Error Classification | Categorize mistakes | Careless (fast+wrong), conceptual (slow+wrong), procedural |
| Retention Decay | Model forgetting curve | Exponential decay with practice boosts |

## Key Files
| File | Owner | Purpose |
|---|---|---|
| `supabase/functions/foxy-tutor/index.ts` | ai-engineer | Main tutor function |
| `supabase/functions/ncert-solver/index.ts` | ai-engineer | Problem solver |
| `supabase/functions/quiz-generator/index.ts` | ai-engineer | Question selection |
| `supabase/functions/cme-engine/index.ts` | ai-engineer | Mastery computation |
| `supabase/functions/_shared/` | ai-engineer | Shared utilities |
| `src/lib/cognitive-engine.ts` | assessment (rules) | Client-side cognitive algorithms |
| `src/lib/feedback-engine.ts` | assessment (rules) | Feedback generation rules |
