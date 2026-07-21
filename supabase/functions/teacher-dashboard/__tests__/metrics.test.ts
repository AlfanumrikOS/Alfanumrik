import {
  assertEquals,
} from 'https://deno.land/std@0.210.0/assert/mod.ts'

import {
  averageFractionsAsPercent,
  averagePercentages,
  averageScopedMasteryByStudent,
  finiteMetricOrNull,
  resolveClassCurriculumScope,
  resolveStudentMastery,
  shapeCohortBktMasteryMap,
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

// ─── T8: shared cohort BKT mastery — cross-surface regression fixture ───
// This fixture cohort (student-1..3, p_know 0.9 / 0.5 / 0.1 → 90% / 50% /
// 10%, cohort average 50%) is the SAME fixture used in
// apps/host/src/__tests__/api/super-admin/analytics-v2-b2b-bkt-mastery.test.ts
// for the super-admin B2B route, and mirrors the exact SQL in
// calculate_cohort_bkt_mastery / get_cohort_bkt_mastery_by_student
// (migration 20260720190000_shared_cohort_bkt_mastery_rpc.sql):
//   avg_mastery_pct = round(AVG(p_know) * 100)
// Both tests assert the SAME cohort produces the SAME 50% average, proving
// teacher Reports and super-admin B2B analytics trace back to one formula.
const COHORT_BKT_FIXTURE_ROWS = [
  { student_id: 'student-1', avg_mastery_pct: 90 },
  { student_id: 'student-2', avg_mastery_pct: 50 },
  { student_id: 'student-3', avg_mastery_pct: 10 },
]
export const COHORT_BKT_FIXTURE_AVERAGE = 50

Deno.test('shared cohort BKT mastery: shapes RPC rows into a per-student map, omitting unscored students', () => {
  const map = shapeCohortBktMasteryMap(COHORT_BKT_FIXTURE_ROWS)
  assertEquals(map.get('student-1'), 90)
  assertEquals(map.get('student-2'), 50)
  assertEquals(map.get('student-3'), 10)
  assertEquals(map.has('student-4'), false) // no concept_mastery rows — absent, not 0

  const cohortAverage = Math.round(
    Array.from(map.values()).reduce((sum, v) => sum + v, 0) / map.size,
  )
  assertEquals(cohortAverage, COHORT_BKT_FIXTURE_AVERAGE)
})

Deno.test('shared cohort BKT mastery: empty/null RPC responses shape to an empty map', () => {
  assertEquals(shapeCohortBktMasteryMap(null).size, 0)
  assertEquals(shapeCohortBktMasteryMap(undefined).size, 0)
  assertEquals(shapeCohortBktMasteryMap([]).size, 0)
  // Malformed rows (missing/non-numeric percent) are dropped, not defaulted to 0.
  assertEquals(
    shapeCohortBktMasteryMap([{ student_id: 'x', avg_mastery_pct: null }]).size,
    0,
  )
})

Deno.test('shared cohort BKT mastery: real BKT value wins over the accuracy proxy', () => {
  // Student HAS a BKT signal — use it, ignore accuracy entirely.
  assertEquals(resolveStudentMastery(90, 20), 90)
  // Student has zero BKT mastery (a real, observed 0 — not "no data") — still wins.
  assertEquals(resolveStudentMastery(0, 75), 0)
})

Deno.test('shared cohort BKT mastery: falls back to accuracy only when there is no BKT signal', () => {
  assertEquals(resolveStudentMastery(null, 42), 42)
  assertEquals(resolveStudentMastery(undefined, 42), 42)
  assertEquals(resolveStudentMastery(Number.NaN, 42), 42)
})
