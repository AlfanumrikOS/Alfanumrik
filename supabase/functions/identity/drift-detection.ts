/**
 * Data Drift Detection
 *
 * Monitors data consistency between monolith and identity service.
 * Detects and alerts on data drift during migration.
 */

import { createAdminClient } from '../utils.ts';
import { logOpsEvent } from '../../_shared/ops-events.ts';

export interface DriftDetectionConfig {
  enabled: boolean;
  sampleSize: number;        // Number of users to check per run
  checkInterval: number;     // Ms between checks
  alertThreshold: number;    // Violation rate threshold for alerts
}

export interface DriftReport {
  timestamp: string;
  total_checked: number;
  violations_found: number;
  violation_rate: number;
  violations: DriftViolation[];
  recommendations: string[];
}

export interface DriftViolation {
  user_id: string;
  field: string;
  monolith_value: any;
  service_value: any;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Run drift detection on a sample of users
 */
export async function detectDataDrift(config: DriftDetectionConfig): Promise<DriftReport> {
  if (!config.enabled) {
    return {
      timestamp: new Date().toISOString(),
      total_checked: 0,
      violations_found: 0,
      violation_rate: 0,
      violations: [],
      recommendations: ['Drift detection is disabled'],
    };
  }

  const admin = createAdminClient();

  // Get a random sample of users with profiles
  const { data: sampleUsers, error } = await admin
    .rpc('get_random_user_sample', { sample_size: config.sampleSize });

  if (error || !sampleUsers) {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'drift-detection',
      severity: 'error',
      message: 'Failed to get user sample for drift detection',
      context: { error: error?.message },
    });

    return {
      timestamp: new Date().toISOString(),
      total_checked: 0,
      violations_found: 0,
      violation_rate: 0,
      violations: [],
      recommendations: ['Failed to retrieve user sample'],
    };
  }

  const violations: DriftViolation[] = [];
  let checked = 0;

  for (const user of sampleUsers) {
    try {
      const userViolations = await checkUserDrift(user.auth_user_id);
      violations.push(...userViolations);
      checked++;
    } catch (error) {
      await logOpsEvent({
        category: 'identity-migration',
        source: 'drift-detection',
        severity: 'warning',
        message: 'Failed to check user drift',
        context: { user_id: user.auth_user_id, error: error.message },
      });
    }
  }

  const violationRate = checked > 0 ? (violations.length / checked) * 100 : 0;

  const report: DriftReport = {
    timestamp: new Date().toISOString(),
    total_checked: checked,
    violations_found: violations.length,
    violation_rate: violationRate,
    violations,
    recommendations: generateRecommendations(violationRate, violations),
  };

  // Alert if violation rate exceeds threshold
  if (violationRate > config.alertThreshold) {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'drift-detection',
      severity: 'critical',
      message: 'Data drift violation rate exceeds threshold',
      context: {
        violation_rate: violationRate,
        threshold: config.alertThreshold,
        total_checked: checked,
        violations_found: violations.length,
      },
    });
  }

  return report;
}

/**
 * Check data drift for a specific user
 */
async function checkUserDrift(authUserId: string): Promise<DriftViolation[]> {
  const admin = createAdminClient();
  const violations: DriftViolation[] = [];

  // Get monolith data
  const monolithData = await getMonolithUserData(authUserId);

  // Get service data
  const serviceData = await getServiceUserData(authUserId);

  if (!monolithData && !serviceData) {
    return violations; // No data in either system
  }

  if (!monolithData || !serviceData) {
    // Data exists in one but not the other - this is a violation
    violations.push({
      user_id: authUserId,
      field: 'existence',
      monolith_value: monolithData ? 'exists' : 'missing',
      service_value: serviceData ? 'exists' : 'missing',
      severity: 'high',
    });
    return violations;
  }

  // Compare key fields
  const fieldsToCheck = [
    { field: 'name', severity: 'high' as const },
    { field: 'email', severity: 'medium' as const },
    { field: 'grade', severity: 'high' as const },
    { field: 'subscription_plan', severity: 'medium' as const },
    { field: 'account_status', severity: 'high' as const },
  ];

  for (const { field, severity } of fieldsToCheck) {
    const monolithValue = monolithData[field];
    const serviceValue = serviceData[field];

    if (monolithValue !== serviceValue) {
      violations.push({
        user_id: authUserId,
        field,
        monolith_value: monolithValue,
        service_value: serviceValue,
        severity,
      });
    }
  }

  return violations;
}

/**
 * Get user data from monolith
 */
async function getMonolithUserData(authUserId: string): Promise<any | null> {
  const admin = createAdminClient();

  // Try student table first
  let { data } = await admin
    .from('identity.students')
    .select('name, email, grade, subscription_plan, account_status')
    .eq('auth_user_id', authUserId)
    .single();

  if (data) return data;

  // Try teacher table
  ({ data } = await admin
    .from('identity.teachers')
    .select('name, email')
    .eq('auth_user_id', authUserId)
    .single());

  if (data) return data;

  // Try guardian table
  ({ data } = await admin
    .from('identity.guardians')
    .select('name, email')
    .eq('auth_user_id', authUserId)
    .single());

  return data || null;
}

/**
 * Get user data from identity service
 */
async function getServiceUserData(authUserId: string): Promise<any | null> {
  const serviceUrl = Deno.env.get('IDENTITY_SERVICE_URL');
  if (!serviceUrl) return null;

  try {
    const response = await fetch(`${serviceUrl}/profile/${authUserId}`, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('IDENTITY_SERVICE_TOKEN')}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.profile || null;
    }
  } catch (error) {
    // Service unavailable
  }

  return null;
}

/**
 * Generate recommendations based on drift analysis
 */
function generateRecommendations(violationRate: number, violations: DriftViolation[]): string[] {
  const recommendations: string[] = [];

  if (violationRate > 10) {
    recommendations.push('CRITICAL: High violation rate detected. Consider pausing migration.');
  } else if (violationRate > 5) {
    recommendations.push('WARNING: Moderate violation rate. Investigate root causes.');
  }

  const highSeverityViolations = violations.filter(v => v.severity === 'high');
  if (highSeverityViolations.length > 0) {
    recommendations.push(`${highSeverityViolations.length} high-severity violations found. Manual review required.`);
  }

  const existenceViolations = violations.filter(v => v.field === 'existence');
  if (existenceViolations.length > 0) {
    recommendations.push('Data existence mismatches detected. Check dual-write implementation.');
  }

  if (recommendations.length === 0) {
    recommendations.push('No issues detected. Migration proceeding normally.');
  }

  return recommendations;
}

/**
 * Emergency drift mitigation
 */
export async function mitigateDataDrift(violations: DriftViolation[]): Promise<void> {
  const admin = createAdminClient();

  for (const violation of violations) {
    if (violation.severity === 'high') {
      // For high-severity violations, log for manual intervention
      await logOpsEvent({
        category: 'identity-migration',
        source: 'drift-mitigation',
        severity: 'critical',
        message: 'High-severity data drift requires manual intervention',
        context: violation,
      });
    }
  }
}