/**
 * Identity Service Types
 * TypeScript type definitions for the identity Edge Function
 */

export interface IdentityResolution {
  student_id: string | null;
  role: 'student' | 'teacher' | 'parent' | 'admin' | 'super_admin';
  grade: string | null;
  plan: string | null;
  school_id: string | null;
  features: Record<string, boolean>;
}

export interface UserProfile {
  id: string;
  auth_user_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  // Role-specific fields
  grade?: string;
  subscription_plan?: string;
  school_id?: string;
  institution_id?: string;
  account_status?: string;
}

export interface SessionInfo {
  id: string;
  session_token_hash: string;
  device_label: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  is_active: boolean;
}

export interface PermissionInfo {
  roles: Array<{
    name: string;
    display_name: string;
    display_name_hi?: string;
    hierarchy_level: number;
  }>;
  permissions: string[];
}

export interface OnboardingStatus {
  intended_role: string;
  step: string;
  profile_id: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_step: string | null;
  retry_count: number;
  metadata: Record<string, unknown>;
}

export interface IdentityRequest {
  method: string;
  url: URL;
  headers: Headers;
  json?: unknown;
}

export interface IdentityResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  requestId: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  prefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}