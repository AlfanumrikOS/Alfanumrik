/**
 * E2E helper for toggling feature flags in the test database.
 *
 * Used by welcome-v2.spec.ts to flip `ff_welcome_v2` on/off without touching
 * the super-admin UI. Mutates the `feature_flags` row directly via the
 * Supabase REST API (PATCH) using the service-role key.
 *
 * Required env vars (in .env or CI secrets):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * If those are missing the helper throws — the spec should be skipped via
 * `test.skip(!hasFlagCreds(), 'requires Supabase credentials')`.
 *
 * The 5-minute in-process flag cache in `src/lib/feature-flags.ts` means the
 * dev server may serve a stale value for up to 5 minutes after a flip. Two
 * mitigations:
 *   1. Spec uses `?v=1` / `?v=2` overrides where possible (no flag dependency).
 *   2. For specs that genuinely need the flag flipped, we hit POST
 *      /api/super-admin/feature-flags/invalidate-cache — but in CI without an
 *      admin secret we fall back to a 6-minute wait (skipped by default).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function hasFlagCreds(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

interface FlagPatch {
  is_enabled?: boolean;
  rollout_percentage?: number;
  target_environments?: string[] | null;
  target_roles?: string[] | null;
}

async function patchFlag(flagName: string, patch: FlagPatch): Promise<void> {
  if (!hasFlagCreds()) {
    throw new Error(
      'Cannot toggle feature flag: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  const url = `${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.${encodeURIComponent(flagName)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY!}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`feature_flags PATCH failed: ${res.status} ${text}`);
  }
}

export async function enableWelcomeV2(): Promise<void> {
  await patchFlag('ff_welcome_v2', {
    is_enabled: true,
    rollout_percentage: 100,
    target_environments: null,
    target_roles: null,
  });
}

export async function disableWelcomeV2(): Promise<void> {
  await patchFlag('ff_welcome_v2', {
    is_enabled: false,
    rollout_percentage: 0,
  });
}
