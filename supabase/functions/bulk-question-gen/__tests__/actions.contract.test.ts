import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts'
import { bulkQuestionGenAction } from '../actions.ts'

Deno.test('bulk-question-gen action preserves HTTP contract labels and admin auth requirements', () => {
  assertEquals(bulkQuestionGenAction.name, 'generate_bulk_questions')
  assertEquals(bulkQuestionGenAction.requiresAdminAuth, true)
  assertEquals(bulkQuestionGenAction.requiresTenantAdminBinding, true)
  assertEquals(bulkQuestionGenAction.auditLabel, 'bulk_question_gen.generate_bulk_questions')
  assertEquals(bulkQuestionGenAction.metricLabel, 'bulk_question_gen.generate_bulk_questions')
})
