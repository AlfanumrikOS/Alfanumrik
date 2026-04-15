// supabase/functions/_shared/subjects-validate.ts
//
// Shared subject validator for Supabase Edge Functions.
//
// Delegates to the canonical `get_available_subjects(p_student_id UUID)` RPC
// that combines grade-map + plan gating in the database layer. Callers pass
// an already-constructed Supabase client (service role or caller JWT); this
// helper has no side effects and does NOT create its own client.
//
// Returns:
//   { ok: true }                                    — subject is enrolled + unlocked
//   { ok: false, reason: 'grade' }                  — subject not available for grade
//   { ok: false, reason: 'plan' }                   — grade allows it, plan does not
//
// Throws on RPC errors (callers should catch and fail closed).
//
// See: docs/superpowers/specs/2026-04-15-subject-governance-design.md §6.2

// deno-lint-ignore no-explicit-any
export async function validateSubjectRpc(supabase: any, studentId: string, subject: string) {
  const { data, error } = await supabase.rpc('get_available_subjects', { p_student_id: studentId })
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  const row = (data ?? []).find((r: any) => r.code === subject)
  if (!row) return { ok: false as const, reason: 'grade' as const }
  if (row.is_locked) return { ok: false as const, reason: 'plan' as const }
  return { ok: true as const }
}
