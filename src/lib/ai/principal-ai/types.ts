/**
 * Principal AI Assistant v1 — shared types.
 *
 * Owner: ai-engineer. The route (src/app/api/school-admin/ai-assistant/route.ts)
 * is the ONLY consumer today. Mirrors the jsonb shape produced by the drafted
 * get_principal_ai_context(p_school_id) RPC (migration 20260616010000) — kept as
 * a loose interface because the RPC is DRAFTED-not-applied and the route must
 * degrade gracefully if its shape is absent.
 */

// ─── Context bundle (mirror get_principal_ai_context jsonb) ──────────────────
//
// Every field is optional / nullable: the route NEVER trusts the RPC to be
// applied. A missing table / RPC error collapses to a clean abstain upstream,
// and a partial bundle still renders a useful (if narrower) prompt.

export interface PrincipalAiOverview {
  [key: string]: unknown;
}

export interface PrincipalAiAtRiskClass {
  class_id?: string;
  class_name?: string;
  grade?: string;
  student_count?: number;
  at_risk_count?: number;
  avg_mastery?: number | null;
}

export interface PrincipalAiTeacherEngagement {
  teacher_id?: string;
  teacher_name?: string;
  class_count?: number;
  remediation_assigned_count?: number;
  remediation_resolved_count?: number;
}

export interface PrincipalAiSubjectMastery {
  subject?: string;
  label?: string;
  student_count?: number;
  avg_mastery?: number | null;
  at_risk_count?: number;
}

export interface PrincipalAiSyllabusReadiness {
  grades?: string[];
  ready_count?: number;
  partial_count?: number;
  missing_count?: number;
  total_chapters?: number;
}

export interface PrincipalAiContext {
  school_id?: string;
  overview?: PrincipalAiOverview | null;
  classes_at_risk?: PrincipalAiAtRiskClass[] | null;
  teacher_engagement?: PrincipalAiTeacherEngagement[] | null;
  mastery_by_subject?: PrincipalAiSubjectMastery[] | null;
  syllabus_readiness?: PrincipalAiSyllabusReadiness | null;
  generated_at?: string;
}

// ─── Wire shapes (route ↔ frontend contract) ─────────────────────────────────

export interface PrincipalAiHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Model id stamped on assistant rows (REG-67); null for user rows. */
  model: string | null;
  /** Populated when the assistant declined to answer. */
  abstain_reason: string | null;
  created_at: string;
}

export interface PrincipalAiSessionSummary {
  id: string;
  lang: string;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

/** A single prior turn passed to Claude in native messages[] shape. */
export interface PrincipalAiTurn {
  role: 'user' | 'assistant';
  content: string;
}
