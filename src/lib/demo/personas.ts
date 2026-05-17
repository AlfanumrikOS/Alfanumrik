// Phase F.2 (Super-Admin Production-Readiness Plan, 2026-05-17)
// Single source of truth for demo-account persona names. Imported by
// both the super-admin demo route Zod schema and the demo page UI so
// the option-list and the validator can never drift again.

export const DEMO_PERSONAS = ['weak_student', 'average', 'high_performer'] as const;
export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const DEMO_ROLES = [
  'student',
  'teacher',
  'parent',
  'school_admin',
  'super_admin',
] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

// Persona-driven seed values for a student profile. Used by both create and
// reset paths so a freshly-created persona and a reset persona produce the
// same dashboard shape.
export const PERSONA_PROFILES: Record<DemoPersona, { xp_total: number; streak_days: number }> = {
  high_performer: { xp_total: 2500, streak_days: 45 },
  average:        { xp_total: 800,  streak_days: 12 },
  weak_student:   { xp_total: 150,  streak_days: 3 },
};

// The legacy migration shipped with persona='weak'. The CHECK constraint
// in 20260528000001_promote_demo_accounts_v2.sql accepts both while we
// migrate; this normaliser ensures all writes use the new label.
export function normalisePersona(input: string | null | undefined): DemoPersona {
  if (!input) return 'average';
  if (input === 'weak') return 'weak_student';
  if ((DEMO_PERSONAS as readonly string[]).includes(input)) return input as DemoPersona;
  return 'average';
}
