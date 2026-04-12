/** Shared types for control room widgets — extracted from page.tsx */

export interface SystemStats {
  totals: Record<string, number>;
  last_24h: Record<string, number>;
  last_7d?: Record<string, number>;
}

export interface ObsData {
  health: { status: string; checked_at: string };
  users: { students: number; teachers: number; parents: number; active_24h: number; active_7d: number };
  activity_24h: { quizzes: number; chats: number; admin_actions: number };
  content: { topics: number; questions: number };
  jobs: { failed: number; pending: number };
  feature_flags: { enabled: number; total: number };
  cache: { size: number; keys: string[] };
}

export interface DeployInfo {
  app_version: string; environment: string; region: string; server_time: string;
  deployment: { id: string; url: string; branch: string; commit_sha: string; commit_message: string; commit_author: string };
  rollback_instructions: string[];
}

export interface BackupRecord {
  id: string; backup_type: string; status: string; provider: string; coverage: string | null;
  size_bytes: number | null; completed_at: string | null; verified_at: string | null; notes: string | null; created_at: string;
}

export interface DeployRecord {
  id: string; app_version: string; commit_sha: string | null; commit_message: string | null;
  commit_author: string | null; branch: string | null; environment: string; status: string; deployed_at: string;
}

export interface AuditEntry {
  id: string; admin_id: string; action: string; entity_type: string; entity_id: string | null;
  details: Record<string, unknown> | null; ip_address: string | null; created_at: string;
}

export interface AnalyticsData {
  engagement: { date: string; signups: number; quizzes: number; chats: number }[];
  revenue: { plan: string; count: number }[];
  retention: { period: string; count: number }[];
  content_stats: { chapters: number; topics: number; questions: number };
  top_students: { id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number }[];
}

export interface FeatureFlag {
  id: string; name: string; enabled: boolean; description: string | null;
}
