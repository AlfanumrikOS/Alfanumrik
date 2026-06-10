#!/usr/bin/env node
/**
 * Local Development Flag Sync
 * 
 * Purpose: Quickly enable production-ready flags on local Supabase instance
 * 
 * Usage:
 *   npx tsx scripts/sync-production-flags.ts                    # Apply all flags
 *   npx tsx scripts/sync-production-flags.ts --check            # Show current status
 *   npx tsx scripts/sync-production-flags.ts --reset            # Disable all and restore defaults
 *   npx tsx scripts/sync-production-flags.ts --verbose          # Detailed output
 * 
 * Requirements:
 *   - SUPABASE_SERVICE_ROLE_KEY environment variable set
 *   - Local Supabase running (docker compose up) OR remote staging/prod DB
 *   - feature_flags table exists in your Supabase instance
 */

import { createClient } from '@supabase/supabase-js';

interface FlagConfig {
  name: string;
  enabled: boolean;
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FLAG CONFIGURATION (mirrors the migration 20260615100000_enable_production_flags_local_dev.sql)
// ═══════════════════════════════════════════════════════════════════════════

const PRODUCTION_FLAGS: FlagConfig[] = [
  // Landing Page & Marketing
  { name: 'ff_welcome_v2', enabled: true, description: 'Modern landing page (mobile-first redesign)' },

  // Pedagogy v2 — Daily Rhythm & Curiosity Dive
  { name: 'ff_pedagogy_v2_daily_rhythm', enabled: true, description: 'Adaptive Today home + SRS queue' },
  { name: 'ff_pedagogy_v2_weekly_dive', enabled: true, description: 'Weekly Curiosity Dive' },
  { name: 'ff_pedagogy_v2_monthly_synthesis', enabled: true, description: 'Monthly Synthesis + WhatsApp share' },
  { name: 'ff_productive_failure_v1', enabled: true, description: 'ZPD problem BEFORE tutorial' },
  { name: 'ff_distractor_micro_explainer_v1', enabled: true, description: 'Wrong-answer remediation' },

  // Editorial Atlas Redesign
  { name: 'ff_editorial_atlas_v1', enabled: true, description: 'Master Atlas redesign switch' },
  { name: 'ff_editorial_atlas_student', enabled: true, description: 'Student dashboard canary' },
  { name: 'ff_editorial_atlas_parent', enabled: true, description: 'Parent portal canary' },
  { name: 'ff_editorial_atlas_teacher', enabled: true, description: 'Teacher dashboard canary' },
  { name: 'ff_editorial_atlas_school', enabled: true, description: 'School-admin canary' },

  // Consumer Minimalism (Phase 1)
  { name: 'ff_today_home_v1', enabled: true, description: 'Adaptive Today home + 4-tab nav' },
  { name: 'ff_parent_encourage_v1', enabled: true, description: 'Parent→child cheer button' },

  // Goal-Adaptive Learning
  { name: 'ff_goal_profiles', enabled: true, description: 'Super-admin Goal Profile preview' },
  { name: 'ff_goal_aware_foxy', enabled: true, description: 'Persona system prompts + scorecards' },
  { name: 'ff_goal_aware_selection', enabled: true, description: 'Adaptive quiz generation' },

  // Study Menu
  { name: 'ff_study_menu_v2', enabled: true, description: 'Sidebar consolidation' },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getEnvUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function validateEnv(): boolean {
  const url = getEnvUrl();
  const key = getServiceRoleKey();

  if (!url || !key) {
    console.error('❌ Error: Missing Supabase credentials');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', url ? '✓ set' : '✗ missing');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', key ? '✓ set' : '✗ missing');
    console.error('\nSet these in your .env.local file.');
    return false;
  }

  return true;
}

function formatFlag(flag: FlagConfig, isEnabled?: boolean): string {
  const status = isEnabled !== undefined ? (isEnabled ? '✓' : '✗') : '–';
  return `  [${status}] ${flag.name.padEnd(35)} ${flag.description}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function checkStatus(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n📊 Current Feature Flag Status\n');

  const flagNames = PRODUCTION_FLAGS.map((f) => f.name);
  const { data, error } = await supabase
    .from('feature_flags')
    .select('flag_name, is_enabled')
    .in('flag_name', flagNames);

  if (error) {
    console.error('❌ Query failed:', error.message);
    return;
  }

  const statusMap = new Map(data?.map((d) => [d.flag_name, d.is_enabled]) || []);

  let enabledCount = 0;
  let disabledCount = 0;
  let missingCount = 0;

  for (const flag of PRODUCTION_FLAGS) {
    if (statusMap.has(flag.name)) {
      const isEnabled = statusMap.get(flag.name);
      console.log(formatFlag(flag, isEnabled));
      isEnabled ? enabledCount++ : disabledCount++;
    } else {
      console.log(formatFlag(flag, false) + ' (missing)');
      missingCount++;
    }
  }

  console.log(`\n📈 Summary:`);
  console.log(`   Enabled:  ${enabledCount}`);
  console.log(`   Disabled: ${disabledCount}`);
  console.log(`   Missing:  ${missingCount}`);
  console.log(
    `\n💡 To enable: npx tsx scripts/sync-production-flags.ts --apply\n`
  );
}

async function applyFlags(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n🚀 Enabling Production-Ready Flags\n');

  for (const flag of PRODUCTION_FLAGS) {
    const { error } = await supabase.from('feature_flags').upsert(
      {
        flag_name: flag.name,
        is_enabled: flag.enabled,
        target_environments: ['development', 'staging'],
        rollout_percentage: 100,
      },
      { onConflict: 'flag_name' }
    );

    if (error) {
      console.error(`❌ ${flag.name}: ${error.message}`);
    } else {
      console.log(formatFlag(flag, true));
    }
  }

  console.log(`\n✅ Applied ${PRODUCTION_FLAGS.length} flags\n`);
  console.log('🎯 You can now test production features locally:');
  console.log('   - http://localhost:3000/welcome                (Modern landing page)');
  console.log('   - http://localhost:3000/dashboard              (Atlas redesigned)');
  console.log('   - http://localhost:3000/foxy?mode=practice     (Goal-aware Foxy)');
  console.log('   - http://localhost:3000/dive                   (Weekly Curiosity Dive)');
  console.log('   - http://localhost:3000/synthesis              (Monthly Synthesis)');
  console.log('   - http://localhost:3000/today                  (Adaptive Today home)\n');
}

async function resetFlags(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n🔄 Resetting to Default (OFF) State\n');

  for (const flag of PRODUCTION_FLAGS) {
    const { error } = await supabase
      .from('feature_flags')
      .update({ is_enabled: false })
      .eq('flag_name', flag.name);

    if (error) {
      console.error(`❌ ${flag.name}: ${error.message}`);
    } else {
      console.log(formatFlag(flag, false));
    }
  }

  console.log(`\n✅ Reset ${PRODUCTION_FLAGS.length} flags to OFF\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isReset = args.includes('--reset');
  const isApply = args.includes('--apply') || (!isCheck && !isReset);
  const isVerbose = args.includes('--verbose');

  // Validate environment
  if (!validateEnv()) {
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(getEnvUrl(), getServiceRoleKey());

  try {
    if (isCheck) {
      await checkStatus(supabase);
    } else if (isReset) {
      const confirm = process.argv.includes('--force');
      if (!confirm) {
        console.warn('⚠️  This will disable all production flags.');
        console.warn('    Run with --force to confirm: npx tsx scripts/sync-production-flags.ts --reset --force');
        process.exit(0);
      }
      await resetFlags(supabase);
    } else if (isApply) {
      await applyFlags(supabase);
    }
  } catch (err) {
    console.error('❌ Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
