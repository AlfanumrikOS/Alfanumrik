// supabase/functions/_shared/mol/__tests__/classifier.test.ts

import { describe, it, expect } from 'vitest'
import { classify } from '../classifier.ts'

describe('classify', () => {
  it('honors explicit task_type if present', () => {
    expect(classify({
      task_type: 'reasoning',
      input: { question: 'anything' },
      student_context: { student_id: 's', grade: '10', language: 'en' },
    })).toBe('reasoning')
  })

  it('classifies "explain" as explanation', () => {
    expect(classify({
      input: { question: 'Explain photosynthesis in simple terms.' },
      student_context: { student_id: 's', grade: '6', language: 'en' },
    })).toBe('explanation')
  })

  it('classifies "why ... how" multipart as doubt_solving', () => {
    expect(classify({
      input: { question: 'Why does ice float on water and how do I calculate buoyancy?' },
      student_context: { student_id: 's', grade: '11', language: 'en' },
    })).toBe('doubt_solving')
  })

  it('classifies step-by-step request', () => {
    expect(classify({
      input: { question: 'Solve step by step: integrate x sin(x) dx' },
      student_context: { student_id: 's', grade: '12', language: 'en' },
    })).toBe('step_by_step')
  })

  it('classifies quiz request when surface=quiz', () => {
    expect(classify({
      input: { instruction: 'Generate 10 MCQs on cellular respiration' },
      student_context: { student_id: 's', grade: '11', language: 'en' },
      config: { surface: 'quiz' },
    })).toBe('quiz_generation')
  })

  it('classifies vision input', () => {
    expect(classify({
      input: { question: 'Solve this problem', image_url: 'https://x/img.png' },
      student_context: { student_id: 's', grade: '9', language: 'en' },
    })).toBe('ocr_extraction')
  })

  it('classifies "grade my answer" as evaluation', () => {
    expect(classify({
      input: { question: 'Grade my answer: photosynthesis is when plants eat sunlight.' },
      student_context: { student_id: 's', grade: '7', language: 'en' },
    })).toBe('evaluation')
  })

  it('falls back to explanation for short student question', () => {
    expect(classify({
      input: { question: 'What is photosynthesis?' },
      student_context: { student_id: 's', grade: '6', language: 'en' },
    })).toBe('explanation')
  })
})
