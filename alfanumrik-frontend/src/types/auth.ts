export type UserRole = 'super_admin' | 'admin' | 'student' | 'parent' | 'unknown';
export type LinkStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface StudentProfile {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  grade: string;
  board: string;
  preferred_language: string;
  invite_code: string;
  link_code: string | null;
  is_active: boolean;
  account_status: string;
  xp_total: number;
  streak_days: number;
  created_at: string;
}

export interface GuardianProfile {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string;
  preferred_language: string;
  onboarding_completed: boolean;
  created_at: string;
}

export interface AdminProfile {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface GuardianStudentLink {
  id: string;
  guardian_id: string;
  student_id: string;
  status: LinkStatus;
  permission_level: string;
  is_verified: boolean;
  initiated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  link_code: string | null;
  created_at: string;
  updated_at: string;
  guardian?: GuardianProfile;
  student?: StudentProfile;
}

export interface AuditLogEntry {
  id: string;
  admin_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  admin_user?: { name: string; email: string } | null;
}
