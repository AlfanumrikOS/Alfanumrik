// supabase/functions/_shared/mol/__tests__/prompt-builder.test.ts

import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSimplifyPrompt } from '../prompt-builder.ts'

const baseCtx = { student_id: 's', grade: '6', language: 'en' as const, subject: 'science' }

describe('buildSystemPrompt', () => {
  it('produces junior-tier voice for grade 6', () => {
    const sys = buildSystemPrompt('explanation', baseCtx, null)
    expect(sys).toMatch(/simple/i)
    expect(sys).toMatch(/Grade 6/i)
    expect(sys).toMatch(/Foxy/)
    expect(sys).toMatch(/Never reveal/i)
  })

  it('produces senior-tier voice for grade 12 with exam_goal=jee', () => {
    const sys = buildSystemPrompt('reasoning', {
      ...baseCtx, grade: '12', exam_goal: 'jee',
    }, null)
    expect(sys).toMatch(/JEE/i)
    expect(sys).toMatch(/rigorous/i)
  })

  it('embeds RAG context with attribution clause', () => {
    const sys = buildSystemPrompt('explanation', baseCtx, 'Photosynthesis is the process...')
    expect(sys).toMatch(/Photosynthesis is the process/)
    expect(sys).toMatch(/Answer only using the provided NCERT context/i)
  })

  it('outputs Hindi instruction when language=hi', () => {
    const sys = buildSystemPrompt('explanation', { ...baseCtx, language: 'hi' }, null)
    expect(sys).toMatch(/Hindi \(Devanagari/i)
  })
})

describe('buildSimplifyPrompt', () => {
  it('contains explicit simplification instruction', () => {
    const sys = buildSimplifyPrompt(baseCtx, 'long technical answer')
    expect(sys).toMatch(/simplif/i)
    expect(sys).toMatch(/Grade 6/i)
    expect(sys).toMatch(/long technical answer/)
  })
})
