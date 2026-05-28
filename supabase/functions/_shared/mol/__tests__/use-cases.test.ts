// supabase/functions/_shared/mol/__tests__/use-cases.test.ts

import { describe, it, expect } from 'vitest'
import { selectProviderChain } from '../router.ts'
import { determineUseCase } from '../use-cases.ts'
import type { StudentContext } from '../types.ts'

describe('determineUseCase', () => {
  const baseContext: StudentContext = {
    student_id: 'student-123',
    grade: '11',
    language: 'en',
    subject: 'science',
    exam_goal: 'cbse',
  }

  it('detects hard IIT math use case', () => {
    const context = { ...baseContext, subject: 'math', exam_goal: 'jee' }
    const uc = determineUseCase('step_by_step', context, 'Solve this IIT JEE equation')
    expect(uc).toBe('hard_iit_math')
  })

  it('detects physics derivations use case', () => {
    const context = { ...baseContext, subject: 'physics' }
    const uc = determineUseCase('reasoning', context, 'Derive the equations of motion')
    expect(uc).toBe('physics_derivations')
  })

  it('detects numerical problem solving use case', () => {
    const context = { ...baseContext, subject: 'chemistry' }
    const uc = determineUseCase('step_by_step', context, 'Calculate the mole fraction of the solution')
    expect(uc).toBe('numerical_problem_solving')
  })

  it('detects fast practice solving use case', () => {
    const context = { ...baseContext, learning_speed: 'fast' as const }
    const uc = determineUseCase('quiz_generation', context, 'Generate a quick quiz')
    expect(uc).toBe('fast_practice_solving')
  })

  it('detects creating question banks use case', () => {
    const context = { ...baseContext, student_id: 'anon-coaching', task_type: 'quiz_generation' }
    const uc = determineUseCase('quiz_generation', context, 'Create a test')
    expect(uc).toBe('creating_question_banks')
  })

  it('detects deep theory explanation use case', () => {
    const context = { ...baseContext, learning_speed: 'slow' as const }
    const uc = determineUseCase('explanation', context, 'Explain the concepts')
    expect(uc).toBe('deep_theory_explanation')
  })

  it('detects student tutoring use case', () => {
    const context = { ...baseContext, learning_speed: 'moderate' as const }
    const uc = determineUseCase('explanation', context, 'Tutoring topic')
    expect(uc).toBe('student_tutoring')
  })

  it('detects generating hints use case', () => {
    const uc = determineUseCase('concept_explanation', baseContext, 'Give me a hint for this question')
    expect(uc).toBe('generating_hints')
  })

  it('detects long PDF/book analysis use case', () => {
    const uc = determineUseCase('ocr_extraction', baseContext, 'Analyze this book scan')
    expect(uc).toBe('long_pdf_analysis')
  })

  it('detects doubt solving for students use case', () => {
    const uc = determineUseCase('doubt_solving', baseContext, 'Why is this wrong?')
    expect(uc).toBe('doubt_solving_students')
  })

  it('detects content generation for coaching use case', () => {
    const context = { ...baseContext, student_id: 'anon-coaching' }
    const uc = determineUseCase('explanation', context, 'Generate coaching content')
    expect(uc).toBe('content_generation_coaching')
  })
})

describe('selectProviderChain with custom use cases', () => {
  it('routes Hard IIT Math to o3-mini as primary, with o1 and gpt-4o fallbacks', () => {
    const context: StudentContext = {
      student_id: 'student-123',
      grade: '12',
      language: 'en',
      subject: 'math',
      exam_goal: 'jee',
    }
    const chain = selectProviderChain('step_by_step', {
      hybrid_enabled: false,
      openai_default: false,
      weights: {},
      student_context: context,
      query: 'JEE Advanced math question',
      use_cases_routing_enabled: true,
    })

    expect(chain.passes.length).toBe(1)
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'openai', model: 'o3-mini' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'openai', model: 'o1' })
    expect(chain.passes[0].chain[2]).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it('routes Deep Theory Explanation to OpenAI GPT-4o as primary, Claude Opus and Claude Sonnet as fallbacks', () => {
    const context: StudentContext = {
      student_id: 'student-123',
      grade: '10',
      language: 'en',
      subject: 'science',
      learning_speed: 'slow',
    }
    const chain = selectProviderChain('explanation', {
      hybrid_enabled: false,
      openai_default: false,
      weights: {},
      student_context: context,
      query: 'Detailed theory of photosynthesis',
      use_cases_routing_enabled: true,
    })

    expect(chain.passes.length).toBe(1)
    expect(chain.passes[0].chain[0]).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(chain.passes[0].chain[1]).toEqual({ provider: 'anthropic', model: 'claude-3-opus-20240229' })
    expect(chain.passes[0].chain[2]).toEqual({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' })
  })
})
