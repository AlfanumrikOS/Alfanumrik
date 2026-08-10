/**
 * Database typing seam.
 *
 * LAYERING: infrastructure-only. Application and domain code MUST NOT import
 * from here — they depend on ports, not on the DB schema.
 *
 * This file is intentionally THIN. The generated schema lives in exactly one
 * place (`apps/host/src/types/database.types.ts`, produced by
 * `npm run supabase:gen-types`); this module only re-exports it plus a typed
 * client alias so adapters have one canonical import for both. Do not copy or
 * hand-maintain schema shapes here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type { Database } from '@/types/database.types';

import type { Database } from '@/types/database.types';

/** A Supabase client bound to the generated `Database` schema. */
export type TypedSupabaseClient = SupabaseClient<Database>;
