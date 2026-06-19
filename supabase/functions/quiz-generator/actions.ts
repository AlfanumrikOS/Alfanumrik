export type QuizGeneratorActionName = 'generate' | 'next_question'

export interface QuizGeneratorActionInput {
  action?: QuizGeneratorActionName
  student_id?: string
  subject?: string
  grade?: string
  count?: number
}

export interface QuizGeneratorActionOutput {
  questions?: unknown[]
  meta?: Record<string, unknown>
  error?: string
}

export interface QuizGeneratorActionContract {
  readonly name: QuizGeneratorActionName
  readonly auditLabel: `quiz_generator.${QuizGeneratorActionName}`
  readonly metricLabel: `quiz_generator.${QuizGeneratorActionName}`
  readonly requiresAuthenticatedStudent: true
  readonly requiresTenantStudentBinding: true
}

export const quizGeneratorActions: Record<QuizGeneratorActionName, QuizGeneratorActionContract> = {
  generate: {
    name: 'generate',
    auditLabel: 'quiz_generator.generate',
    metricLabel: 'quiz_generator.generate',
    requiresAuthenticatedStudent: true,
    requiresTenantStudentBinding: true,
  },
  next_question: {
    name: 'next_question',
    auditLabel: 'quiz_generator.next_question',
    metricLabel: 'quiz_generator.next_question',
    requiresAuthenticatedStudent: true,
    requiresTenantStudentBinding: true,
  },
}
