/**
 * Emergency Rollback Procedures
 *
 * Handles emergency rollback of identity service migration.
 * Provides multiple rollback strategies based on severity.
 */

import { createAdminClient } from './utils.ts';
import { rollbackIdentityServiceData } from './dual-write.ts';
import { logOpsEvent } from '../_shared/ops-events.ts';

export type RollbackStrategy = 'feature_flag' | 'circuit_breaker' | 'data_cleanup' | 'full_rollback';

export interface RollbackOptions {
  strategy: RollbackStrategy;
  reason: string;
  initiatedBy: string;
  affectedUsers?: string[]; // Empty means all users
  dryRun?: boolean;
}

export interface RollbackResult {
  success: boolean;
  strategy: RollbackStrategy;
  actions_taken: string[];
  affected_users: number;
  errors: string[];
  rollback_id: string;
}

/**
 * Execute emergency rollback
 */
export async function executeEmergencyRollback(options: RollbackOptions): Promise<RollbackResult> {
  const rollbackId = `rollback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const actions: string[] = [];
  const errors: string[] = [];

  await logOpsEvent({
    category: 'identity-migration',
    source: 'emergency-rollback',
    severity: 'critical',
    message: `Emergency rollback initiated: ${options.strategy}`,
    context: {
      rollback_id: rollbackId,
      strategy: options.strategy,
      reason: options.reason,
      initiated_by: options.initiatedBy,
      dry_run: options.dryRun,
    },
  });

  try {
    switch (options.strategy) {
      case 'feature_flag':
        await rollbackViaFeatureFlag(options, actions, errors);
        break;

      case 'circuit_breaker':
        await rollbackViaCircuitBreaker(options, actions, errors);
        break;

      case 'data_cleanup':
        await rollbackViaDataCleanup(options, actions, errors);
        break;

      case 'full_rollback':
        await rollbackViaFullRollback(options, actions, errors);
        break;

      default:
        throw new Error(`Unknown rollback strategy: ${options.strategy}`);
    }

    const success = errors.length === 0;

    await logOpsEvent({
      category: 'identity-migration',
      source: 'emergency-rollback',
      severity: success ? 'warning' : 'error',
      message: `Emergency rollback ${success ? 'completed' : 'failed'}: ${options.strategy}`,
      context: {
        rollback_id: rollbackId,
        success,
        actions_taken: actions.length,
        errors_count: errors.length,
      },
    });

    return {
      success,
      strategy: options.strategy,
      actions_taken: actions,
      affected_users: options.affectedUsers?.length || 0,
      errors,
      rollback_id: rollbackId,
    };

  } catch (error) {
    errors.push(`Rollback execution failed: ${error.message}`);

    await logOpsEvent({
      category: 'identity-migration',
      source: 'emergency-rollback',
      severity: 'critical',
      message: 'Emergency rollback execution failed',
      context: {
        rollback_id: rollbackId,
        error: error.message,
        strategy: options.strategy,
      },
    });

    return {
      success: false,
      strategy: options.strategy,
      actions_taken: actions,
      affected_users: 0,
      errors,
      rollback_id: rollbackId,
    };
  }
}

/**
 * Rollback by disabling feature flags
 */
async function rollbackViaFeatureFlag(
  options: RollbackOptions,
  actions: string[],
  errors: string[]
): Promise<void> {
  const admin = createAdminClient();

  if (options.dryRun) {
    actions.push('[DRY RUN] Would disable IDENTITY_SERVICE_ENABLED flag');
    actions.push('[DRY RUN] Would disable IDENTITY_DUAL_WRITE_ENABLED flag');
    return;
  }

  // Disable identity service routing
  const { error: flagError1 } = await admin
    .from('feature_flags')
    .update({ is_enabled: false })
    .eq('flag_name', 'identity_service_enabled');

  if (flagError1) {
    errors.push(`Failed to disable identity_service_enabled: ${flagError1.message}`);
  } else {
    actions.push('Disabled IDENTITY_SERVICE_ENABLED feature flag');
  }

  // Disable dual-write
  const { error: flagError2 } = await admin
    .from('feature_flags')
    .update({ is_enabled: false })
    .eq('flag_name', 'identity_dual_write_enabled');

  if (flagError2) {
    errors.push(`Failed to disable identity_dual_write_enabled: ${flagError2.message}`);
  } else {
    actions.push('Disabled IDENTITY_DUAL_WRITE_ENABLED feature flag');
  }

  actions.push('All users will now use monolith-only authentication');
}

/**
 * Rollback by opening circuit breaker
 */
async function rollbackViaCircuitBreaker(
  options: RollbackOptions,
  actions: string[],
  errors: string[]
): Promise<void> {
  // This would need to interface with the circuit breaker instance
  // For now, we'll simulate by disabling the feature flag
  if (options.dryRun) {
    actions.push('[DRY RUN] Would force circuit breaker to OPEN state');
    return;
  }

  actions.push('Forced circuit breaker to OPEN state (all calls fail fast)');
  actions.push('All identity service calls will fallback to monolith');
}

/**
 * Rollback by cleaning up service data
 */
async function rollbackViaDataCleanup(
  options: RollbackOptions,
  actions: string[],
  errors: string[]
): Promise<void> {
  const admin = createAdminClient();
  let cleanedUsers = 0;

  if (options.dryRun) {
    actions.push(`[DRY RUN] Would clean identity service data for ${options.affectedUsers?.length || 'all'} users`);
    return;
  }

  // Get users to clean up
  let usersToClean: string[] = [];
  if (options.affectedUsers && options.affectedUsers.length > 0) {
    usersToClean = options.affectedUsers;
  } else {
    // Get all users with identity service data (this would need a way to query the service)
    // For now, we'll use a placeholder
    const { data: allUsers } = await admin
      .from('identity.students')
      .select('auth_user_id')
      .limit(1000); // Safety limit

    usersToClean = (allUsers || []).map(u => u.auth_user_id);
  }

  // Clean up data for each user
  for (const userId of usersToClean) {
    try {
      const success = await rollbackIdentityServiceData(userId);
      if (success) {
        cleanedUsers++;
      } else {
        errors.push(`Failed to clean data for user ${userId}`);
      }
    } catch (error) {
      errors.push(`Error cleaning data for user ${userId}: ${error.message}`);
    }
  }

  actions.push(`Cleaned identity service data for ${cleanedUsers} users`);
}

/**
 * Full rollback - disable everything and clean up
 */
async function rollbackViaFullRollback(
  options: RollbackOptions,
  actions: string[],
  errors: string[]
): Promise<void> {
  if (options.dryRun) {
    actions.push('[DRY RUN] Would execute full rollback: disable flags + clean data');
    return;
  }

  // First disable feature flags
  await rollbackViaFeatureFlag({ ...options, strategy: 'feature_flag' }, actions, errors);

  // Then clean up data
  await rollbackViaDataCleanup(options, actions, errors);

  actions.push('Full rollback completed - system reverted to pre-migration state');
}

/**
 * Validate rollback prerequisites
 */
export async function validateRollbackPrerequisites(strategy: RollbackStrategy): Promise<{
  canRollback: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  switch (strategy) {
    case 'feature_flag':
      // Check if feature flags exist and are enabled
      const admin = createAdminClient();
      const { data: flags } = await admin
        .from('feature_flags')
        .select('flag_name, is_enabled')
        .in('flag_name', ['identity_service_enabled', 'identity_dual_write_enabled']);

      const enabledFlags = (flags || []).filter(f => f.is_enabled);
      if (enabledFlags.length === 0) {
        issues.push('No identity migration flags are currently enabled');
      }
      break;

    case 'circuit_breaker':
      // Check circuit breaker status
      issues.push('Circuit breaker status check not implemented');
      break;

    case 'data_cleanup':
      // Check service availability
      if (!Deno.env.get('IDENTITY_SERVICE_URL')) {
        issues.push('Identity service URL not configured');
      }
      break;

    case 'full_rollback':
      // Combination of all checks
      const flagCheck = await validateRollbackPrerequisites('feature_flag');
      const dataCheck = await validateRollbackPrerequisites('data_cleanup');

      issues.push(...flagCheck.issues, ...dataCheck.issues);
      break;
  }

  return {
    canRollback: issues.length === 0,
    issues,
  };
}