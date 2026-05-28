// supabase/functions/_shared/mol/use-cases.ts

import type { TaskType, StudentContext } from './types.ts'

export interface ProviderTarget {
  provider: 'openai' | 'anthropic'
  model: string
}

export interface UseCaseConfig {
  name: string
  primary: ProviderTarget
  fallbacks: ProviderTarget[]
}

export const USE_CASES: Record<string, UseCaseConfig> = {
  hard_iit_math: {
    name: 'Hard IIT Math',
    primary: { provider: 'openai', model: 'o3-mini' },
    fallbacks: [
      { provider: 'openai', model: 'o1' },
      { provider: 'openai', model: 'gpt-4o' },
    ],
  },
  physics_derivations: {
    name: 'Physics Derivations',
    primary: { provider: 'openai', model: 'o3-mini' },
    fallbacks: [
      { provider: 'openai', model: 'o1' },
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    ],
  },
  numerical_problem_solving: {
    name: 'Numerical Problem Solving',
    primary: { provider: 'openai', model: 'o3-mini' },
    fallbacks: [
      { provider: 'openai', model: 'o1' },
      { provider: 'openai', model: 'gpt-4o' },
    ],
  },
  fast_practice_solving: {
    name: 'Fast Practice Solving',
    primary: { provider: 'openai', model: 'gpt-4o-mini' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    ],
  },
  doubt_solving_students: {
    name: 'Doubt Solving for Students',
    primary: { provider: 'openai', model: 'gpt-4o' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      { provider: 'openai', model: 'gpt-4o-mini' },
    ],
  },
  content_generation_coaching: {
    name: 'Content Generation for Coaching',
    primary: { provider: 'openai', model: 'o1' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o' },
    ],
  },
  deep_theory_explanation: {
    name: 'Deep Theory Explanation',
    primary: { provider: 'openai', model: 'gpt-4o' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-opus-20240229' },
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    ],
  },
  student_tutoring: {
    name: 'Student Tutoring',
    primary: { provider: 'openai', model: 'gpt-4o' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    ],
  },
  creating_question_banks: {
    name: 'Creating Question Banks',
    primary: { provider: 'openai', model: 'gpt-4o' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-opus-20240229' },
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    ],
  },
  generating_hints: {
    name: 'Generating Hints',
    primary: { provider: 'openai', model: 'gpt-4o-mini' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    ],
  },
  long_pdf_analysis: {
    name: 'Long PDF/Book Analysis',
    primary: { provider: 'openai', model: 'gpt-4o' },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-3-opus-20240229' },
    ],
  },
}

/**
 * Maps task details and student context to a specific use case string.
 * Returns null if no specific custom use case is matched.
 */
export function determineUseCase(
  task: TaskType,
  context?: StudentContext,
  query?: string,
): string | null {
  if (!context) return null

  const subject = (context.subject || '').toLowerCase().trim()
  const examGoal = (context.exam_goal || '').toLowerCase().trim()
  const qText = (query || '').toLowerCase().trim()
  const speed = context.learning_speed
  const grade = parseInt(context.grade || '0', 10)

  // 1. Hard IIT Math
  if (
    (subject === 'math' || subject === 'mathematics') &&
    examGoal === 'jee' &&
    (task === 'step_by_step' || task === 'reasoning' || task === 'explanation')
  ) {
    return 'hard_iit_math'
  }

  // 2. Physics derivations
  if (
    subject === 'physics' &&
    (task === 'reasoning' || task === 'step_by_step') &&
    (qText.includes('derive') || qText.includes('derivation') || qText.includes('prove') || grade >= 11)
  ) {
    return 'physics_derivations'
  }

  // 3. Numerical problem solving
  const isSciMath = ['physics', 'chemistry', 'math', 'mathematics'].includes(subject)
  const isNumericalQuery =
    qText.includes('solve') ||
    qText.includes('calculate') ||
    qText.includes('value') ||
    qText.includes('find the') ||
    /\b\d+\b/.test(qText)
  if (task === 'step_by_step' && isSciMath && isNumericalQuery) {
    return 'numerical_problem_solving'
  }

  // 4. Fast practice solving
  if (task === 'quiz_generation' && speed === 'fast') {
    return 'fast_practice_solving'
  }

  // 5. Creating question banks
  if (task === 'quiz_generation') {
    // If there's no student_id, or student_id matches anon/coaching pattern
    const isCoaching = !context?.student_id || context.student_id.startsWith('anon')
    if (isCoaching) {
      return 'creating_question_banks'
    }
  }

  // 6. Generating hints
  if (task === 'concept_explanation' && qText.includes('hint')) {
    return 'generating_hints'
  }

  // 7. Deep theory explanation
  if (
    (task === 'concept_explanation' || task === 'explanation') &&
    (speed === 'slow' || qText.includes('detailed') || qText.includes('deeply') || qText.includes('theory'))
  ) {
    return 'deep_theory_explanation'
  }

  // 8. Student tutoring
  if (task === 'explanation' && context?.student_id && !context.student_id.startsWith('anon')) {
    return 'student_tutoring'
  }

  // 9. Long PDF/book analysis
  if (task === 'ocr_extraction' || qText.includes('pdf') || qText.includes('book')) {
    return 'long_pdf_analysis'
  }

  // 10. Doubt solving for students
  if (task === 'doubt_solving') {
    return 'doubt_solving_students'
  }

  // 11. Content generation for coaching
  const isCoachingContext = !context?.student_id || context.student_id.startsWith('anon')
  if (isCoachingContext && (task === 'explanation' || task === 'concept_explanation' || task === 'step_by_step')) {
    return 'content_generation_coaching'
  }

  return null
}
