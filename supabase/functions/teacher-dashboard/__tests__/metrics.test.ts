import {
  assertEquals,
} from 'https://deno.land/std@0.210.0/assert/mod.ts'

import {
  averageFractionsAsPercent,
  averagePercentages,
  averageScopedMasteryByStudent,
  finiteMetricOrNull,
  resolveClassCurriculumScope,
} from '../metrics.ts'

Deno.test('teacher metric provenance: missing values stay unavailable', () => {
  assertEquals(finiteMetricOrNull(null), null)
  assertEquals(finiteMetricOrNull(undefined), null)
  assertEquals(finiteMetricOrNull(''), null)
  assertEquals(finiteMetricOrNull(Number.NaN), null)

  // Zero is an observed value and must not be conflated with no signal.
  assertEquals(finiteMetricOrNull(0), 0)
})

Deno.test('teacher metric provenance: mastery averages only canonical samples', () => {
  assertEquals(averageFractionsAsPercent([]), null)
  assertEquals(averageFractionsAsPercent([null, undefined]), null)
  assertEquals(averageFractionsAsPercent([0.8, null, 0.6]), 70)
  assertEquals(averageFractionsAsPercent([0]), 0)
})

Deno.test('teacher metric provenance: class averages preserve an empty signal', () => {
  assertEquals(averagePercentages([null, undefined]), null)
  assertEquals(averagePercentages([80, null, 60]), 70)
})

Deno.test('teacher metric provenance: class curriculum scope keeps grade and teacher subjects', () => {
  assertEquals(
    resolveClassCurriculumScope('class-1', 'Grade 7', 'science', 'math', ['math', 'science']),
    { grade: '7', subjectCode: 'math' },
  )
  assertEquals(
    resolveClassCurriculumScope('class-1', '7', 'science', 'history', ['math', 'science']),
    { grade: '7', subjectCode: null },
  )
  assertEquals(
    resolveClassCurriculumScope('class-1', '7', 'science', 'history', []),
    { grade: '7', subjectCode: null },
  )
  assertEquals(
    resolveClassCurriculumScope('grade-8', null, null, undefined, ['science']),
    { grade: '8', subjectCode: 'science' },
  )
})

Deno.test('teacher metric provenance: out-of-scope topics never enter class mastery', () => {
  const averages = averageScopedMasteryByStudent(
    ['student-1', 'student-2'],
    ['topic-in-scope'],
    [
      { student_id: 'student-1', topic_id: 'topic-in-scope', p_know: 0.6 },
      { student_id: 'student-1', topic_id: 'other-subject-topic', p_know: 1 },
      { student_id: 'student-2', topic_id: 'other-subject-topic', p_know: 0.9 },
    ],
  )
  assertEquals(averages.get('student-1'), 60)
  assertEquals(averages.get('student-2'), null)
})
