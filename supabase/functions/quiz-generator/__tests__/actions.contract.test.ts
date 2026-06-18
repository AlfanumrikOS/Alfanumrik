import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts'
import { quizGeneratorActions } from '../actions.ts'

Deno.test('quiz-generator actions preserve public action names and labels', () => {
  assertEquals(Object.keys(quizGeneratorActions), ['generate', 'next_question'])
  for (const [name, action] of Object.entries(quizGeneratorActions)) {
    assertEquals(action.name, name)
    assertEquals(action.requiresAuthenticatedStudent, true)
    assertEquals(action.requiresTenantStudentBinding, true)
    assertEquals(action.auditLabel, `quiz_generator.${name}`)
    assertEquals(action.metricLabel, `quiz_generator.${name}`)
  }
})
