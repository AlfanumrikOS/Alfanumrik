export type BulkQuestionGenActionName = 'generate_bulk_questions'

export interface BulkQuestionGenActionInput {
  grade: string
  subject: string
  chapter: string
  chapter_id?: string
  count?: number
  difficulty?: number
  bloom_level?: string
}

export interface BulkQuestionGenActionOutput {
  generated: number
  inserted: number
  rejected?: number
  oracle_enabled?: boolean
  oracle_rejected?: number
  questions: unknown[]
  warning?: string
}

export interface BulkQuestionGenActionContract {
  readonly name: BulkQuestionGenActionName
  readonly auditLabel: `bulk_question_gen.${BulkQuestionGenActionName}`
  readonly metricLabel: `bulk_question_gen.${BulkQuestionGenActionName}`
  readonly requiresAdminAuth: true
  readonly requiresTenantAdminBinding: true
}

export const bulkQuestionGenAction: BulkQuestionGenActionContract = {
  name: 'generate_bulk_questions',
  auditLabel: 'bulk_question_gen.generate_bulk_questions',
  metricLabel: 'bulk_question_gen.generate_bulk_questions',
  requiresAdminAuth: true,
  requiresTenantAdminBinding: true,
}
