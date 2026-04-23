/**
 * Identity Dual-Write Manager
 *
 * Handles dual-write operations during identity service migration.
 * Ensures data consistency between monolith and service.
 */

import { createAdminClient } from './utils.ts';
import { identityCircuitBreaker } from './circuit-breaker.ts';
import { logOpsEvent } from '../_shared/ops-events.ts';

export interface DualWriteResult {
  success: boolean;
  monolithResult?: any;
  serviceResult?: any;
  consistencyCheck?: ConsistencyCheckResult;
  errors: string[];
}

export interface ConsistencyCheckResult {
  consistent: boolean;
  differences: string[];
  monolithData: any;
  serviceData: any;
}

/**
 * Dual-write user profile creation/update
 */
export async function dualWriteUserProfile(
  operation: 'create' | 'update',
  userData: {
    auth_user_id: string;
    role: string;
    name: string;
    email?: string;
    grade?: string;
    board?: string;
    school_name?: string;
    subjects_taught?: string[];
    grades_taught?: string[];
    phone?: string;
    link_code?: string;
  }
): Promise<DualWriteResult> {
  const errors: string[] = [];
  let monolithResult: any;
  let serviceResult: any;
  let consistencyResult: ConsistencyCheckResult | undefined;

  // 1. Always write to monolith first (source of truth)
  try {
    monolithResult = await writeToMonolith(operation, userData);
  } catch (error) {
    errors.push(`Monolith write failed: ${error.message}`);
    return { success: false, errors };
  }

  // 2. Attempt to write to identity service (with circuit breaker)
  try {
    serviceResult = await identityCircuitBreaker.execute(
      () => writeToIdentityService(operation, userData),
      () => Promise.resolve(null) // Fallback: do nothing, just log
    );

    if (serviceResult.usedFallback) {
      errors.push('Identity service write skipped due to circuit breaker');
    }
  } catch (error) {
    errors.push(`Identity service write failed: ${error.message}`);
  }

  // 3. If both writes succeeded, perform consistency check
  if (monolithResult && serviceResult && !serviceResult.usedFallback) {
    try {
      consistencyResult = await checkDataConsistency(userData.auth_user_id);
      if (!consistencyResult.consistent) {
        errors.push(`Data inconsistency detected: ${consistencyResult.differences.join(', ')}`);

        // Log critical inconsistency
        await logOpsEvent({
          category: 'identity-migration',
          source: 'dual-write',
          severity: 'error',
          message: 'Data inconsistency detected between monolith and identity service',
          context: {
            user_id: userData.auth_user_id,
            operation,
            differences: consistencyResult.differences,
            monolith_data: consistencyResult.monolithData,
            service_data: consistencyResult.serviceData,
          },
        });
      }
    } catch (error) {
      errors.push(`Consistency check failed: ${error.message}`);
    }
  }

  const success = errors.length === 0 || (monolithResult && errors.every(e => e.includes('Identity service') || e.includes('Consistency')));

  // Log dual-write result
  await logOpsEvent({
    category: 'identity-migration',
    source: 'dual-write',
    severity: success ? 'info' : 'warning',
    message: `Dual-write ${operation} completed`,
    context: {
      user_id: userData.auth_user_id,
      operation,
      success,
      monolith_success: !!monolithResult,
      service_success: !!(serviceResult && !serviceResult.usedFallback),
      consistency_checked: !!consistencyResult,
      consistent: consistencyResult?.consistent,
      errors,
    },
  });

  return {
    success,
    monolithResult,
    serviceResult: serviceResult?.result,
    consistencyCheck: consistencyResult,
    errors,
  };
}

/**
 * Write to monolith database (existing logic)
 */
async function writeToMonolith(
  operation: 'create' | 'update',
  userData: any
): Promise<any> {
  const admin = createAdminClient();

  // This would call the existing bootstrap_user_profile RPC
  const { data, error } = await admin.rpc('bootstrap_user_profile', {
    p_auth_user_id: userData.auth_user_id,
    p_role: userData.role,
    p_name: userData.name,
    p_email: userData.email || '',
    p_grade: userData.grade || null,
    p_board: userData.board || null,
    p_school_name: userData.school_name || null,
    p_subjects_taught: userData.subjects_taught || [],
    p_grades_taught: userData.grades_taught || [],
    p_phone: userData.phone || null,
    p_link_code: userData.link_code || null,
  });

  if (error) {
    throw new Error(`Monolith RPC failed: ${error.message}`);
  }

  return data;
}

/**
 * Write to identity service
 */
async function writeToIdentityService(
  operation: 'create' | 'update',
  userData: any
): Promise<any> {
  const serviceUrl = Deno.env.get('IDENTITY_SERVICE_URL');
  if (!serviceUrl) {
    throw new Error('IDENTITY_SERVICE_URL not configured');
  }

  const endpoint = operation === 'create' ? '/create-profile' : '/update-profile';

  const response = await fetch(`${serviceUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('IDENTITY_SERVICE_TOKEN')}`,
    },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    throw new Error(`Identity service returned ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Check data consistency between monolith and service
 */
async function checkDataConsistency(authUserId: string): Promise<ConsistencyCheckResult> {
  const admin = createAdminClient();
  const serviceUrl = Deno.env.get('IDENTITY_SERVICE_URL');

  // Get data from monolith
  const { data: monolithData, error: monolithError } = await admin
    .from('identity.students')
    .select('id, name, email, grade, subscription_plan, account_status')
    .eq('auth_user_id', authUserId)
    .single();

  if (monolithError && monolithError.code !== 'PGRST116') { // Not found
    throw new Error(`Monolith query failed: ${monolithError.message}`);
  }

  // Get data from service
  let serviceData: any = null;
  if (serviceUrl) {
    try {
      const response = await fetch(`${serviceUrl}/profile/${authUserId}`, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('IDENTITY_SERVICE_TOKEN')}`,
        },
      });

      if (response.ok) {
        serviceData = await response.json();
      }
    } catch (error) {
      // Service unavailable, skip consistency check
    }
  }

  // Compare key fields
  const differences: string[] = [];

  if (!monolithData && !serviceData) {
    return { consistent: true, differences: [], monolithData, serviceData };
  }

  if (!monolithData || !serviceData) {
    differences.push('Data exists in one system but not the other');
  } else {
    // Compare fields
    const fieldsToCheck = ['name', 'email', 'grade', 'subscription_plan'];
    for (const field of fieldsToCheck) {
      if (monolithData[field] !== serviceData[field]) {
        differences.push(`${field}: monolith=${monolithData[field]}, service=${serviceData[field]}`);
      }
    }
  }

  return {
    consistent: differences.length === 0,
    differences,
    monolithData,
    serviceData,
  };
}

/**
 * Emergency rollback: delete from identity service
 */
export async function rollbackIdentityServiceData(authUserId: string): Promise<boolean> {
  try {
    const serviceUrl = Deno.env.get('IDENTITY_SERVICE_URL');
    if (!serviceUrl) return false;

    const response = await fetch(`${serviceUrl}/profile/${authUserId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('IDENTITY_SERVICE_TOKEN')}`,
      },
    });

    await logOpsEvent({
      category: 'identity-migration',
      source: 'dual-write',
      severity: 'warning',
      message: 'Emergency rollback executed',
      context: { user_id: authUserId, success: response.ok },
    });

    return response.ok;
  } catch (error) {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'dual-write',
      severity: 'error',
      message: 'Emergency rollback failed',
      context: { user_id: authUserId, error: error.message },
    });
    return false;
  }
}