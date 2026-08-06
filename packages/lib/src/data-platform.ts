/**
 * Data platform governance utilities.
 * P1 remediation (audit 2026-08-06): Data classification, quality checks,
 * backup verification, and retention enforcement.
 */

import { supabaseAdmin } from './supabase-admin';
import { logger } from './logger';

// ── Data Classification ─────────────────────────────────────

export interface DataClassificationRow {
  table_name: string;
  column_name: string;
  sensitivity_tier: string;
  pii_category: string | null;
  purpose_scope: string | null;
  retention_class: string | null;
  is_encrypted: boolean;
  requires_consent: boolean;
  requires_deletion_propagation: boolean;
}

export async function getUnclassifiedTables(): Promise<{ table_name: string; column_count: number }[]> {
  const { data, error } = await supabaseAdmin.rpc('get_unclassified_tables');
  if (error) {
    logger.error('Failed to get unclassified tables', { error: error.message });
    throw error;
  }
  return (data ?? []) as { table_name: string; column_count: number }[];
}

export async function getSensitiveFields(): Promise<DataClassificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('data_classification')
    .select('*')
    .in('sensitivity_tier', ['child_record', 'sensitive', 'financial', 'credential']);
  if (error) throw error;
  return data as DataClassificationRow[];
}

// ── Data Quality ────────────────────────────────────────────

export interface DataQualityCheckResult {
  check_name: string;
  result: 'pass' | 'fail' | 'warn';
  detail: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
}

export async function runDataQualityChecks(): Promise<DataQualityCheckResult[]> {
  const { data, error } = await supabaseAdmin.rpc('run_data_quality_checks');
  if (error) {
    logger.error('Data quality checks failed', { error: error.message });
    throw error;
  }
  return (data ?? []) as DataQualityCheckResult[];
}

export async function getRecentQualityFailures(): Promise<DataQualityCheckResult[]> {
  const { data, error } = await supabaseAdmin
    .from('data_quality_check_results')
    .select('*')
    .in('result', ['fail', 'warn'])
    .is('resolved_at', null)
    .order('checked_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data as unknown as DataQualityCheckResult[];
}

// ── Backup Verification ─────────────────────────────────────

export interface BackupHealthSummary {
  checked_at: string;
  backup_status: string | null;
  last_healthy: string | null;
  backups_7d: number;
  last_drill: string | null;
  drill_cadence: string;
}

export async function runBackupHealthCheck(): Promise<BackupHealthSummary> {
  const { data, error } = await supabaseAdmin.rpc('run_daily_backup_health_check');
  if (error) {
    logger.error('Backup health check failed', { error: error.message });
    throw error;
  }
  return data as unknown as BackupHealthSummary;
}

export async function getBackupHealthView(): Promise<BackupHealthSummary> {
  const { data, error } = await supabaseAdmin
    .from('v_backup_health_summary')
    .select('*')
    .single();
  if (error) throw error;
  return data as unknown as BackupHealthSummary;
}

// ── Vacuous Policy Detection ────────────────────────────────

export async function detectVacuousOwnPolicies(): Promise<{
  table_name: string;
  policy_name: string;
  policy_cmd: string;
  policy_using: string;
  policy_check: string;
}[]> {
  const { data, error } = await supabaseAdmin.rpc('detect_vacuous_own_policies');
  if (error) throw error;
  return (data ?? []) as {
    table_name: string;
    policy_name: string;
    policy_cmd: string;
    policy_using: string;
    policy_check: string;
  }[];
}
