/**
 * Data Migration Framework for Microservices
 *
 * Provides utilities to migrate data from public schema to domain-specific schemas.
 * Used in Phase 3: Data Migration Framework.
 */

import { supabaseAdmin } from './supabase-admin';
import { logger } from './logger';

export interface MigrationPlan {
  table: string;
  sourceSchema: string;
  targetSchema: string;
  whereClause?: string;
  batchSize?: number;
}

export interface MigrationResult {
  table: string;
  migrated: number;
  errors: number;
  duration: number;
}

/**
 * Migrate a table from source schema to target schema
 */
export async function migrateTable(plan: MigrationPlan): Promise<MigrationResult> {
  const start = Date.now();
  let migrated = 0;
  let errors = 0;
  const batchSize = plan.batchSize || 1000;

  try {
    // Get total count
    const { count } = await supabaseAdmin
      .from(`${plan.sourceSchema}.${plan.table}`)
      .select('*', { count: 'exact', head: true });

    if (!count) {
      return { table: plan.table, migrated: 0, errors: 0, duration: Date.now() - start };
    }

    // Migrate in batches
    for (let offset = 0; offset < count; offset += batchSize) {
      const { data, error } = await supabaseAdmin
        .from(`${plan.sourceSchema}.${plan.table}`)
        .select('*')
        .range(offset, offset + batchSize - 1);

      if (error) {
        logger.error(`Migration error for ${plan.table}`, { error: error.message, offset });
        errors += batchSize;
        continue;
      }

      if (data && data.length > 0) {
        const { error: insertError } = await supabaseAdmin
          .from(`${plan.targetSchema}.${plan.table}`)
          .insert(data);

        if (insertError) {
          logger.error(`Insert error for ${plan.table}`, { error: insertError.message, offset });
          errors += data.length;
        } else {
          migrated += data.length;
        }
      }
    }

    logger.info(`Migration completed for ${plan.table}`, { migrated, errors, total: count });
  } catch (err) {
    logger.error(`Migration failed for ${plan.table}`, { error: err });
    errors++;
  }

  return { table: plan.table, migrated, errors, duration: Date.now() - start };
}

/**
 * Validate migration by comparing row counts
 */
export async function validateMigration(plan: MigrationPlan): Promise<boolean> {
  try {
    const { count: sourceCount } = await supabaseAdmin
      .from(`${plan.sourceSchema}.${plan.table}`)
      .select('*', { count: 'exact', head: true });

    const { count: targetCount } = await supabaseAdmin
      .from(`${plan.targetSchema}.${plan.table}`)
      .select('*', { count: 'exact', head: true });

    const match = sourceCount === targetCount;
    logger.info(`Validation for ${plan.table}`, { source: sourceCount, target: targetCount, match });

    return match;
  } catch (err) {
    logger.error(`Validation failed for ${plan.table}`, { error: err });
    return false;
  }
}

/**
 * Rollback migration by truncating target table
 */
export async function rollbackMigration(plan: MigrationPlan): Promise<void> {
  try {
    await supabaseAdmin.from(`${plan.targetSchema}.${plan.table}`).delete().neq('id', ''); // Truncate
    logger.info(`Rollback completed for ${plan.table}`);
  } catch (err) {
    logger.error(`Rollback failed for ${plan.table}`, { error: err });
  }
}