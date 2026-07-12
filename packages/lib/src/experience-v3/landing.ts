import { resolveRouteCapability } from './capabilities';
import type { RoleManifest } from './types';

export type ExperienceV3LandingDecision =
  | { kind: 'legacy' }
  | { kind: 'redirect'; href: string }
  | { kind: 'denied' };

/**
 * Resolve a legacy role-home alias into its canonical V3 home.
 *
 * A globally enabled flag is not sufficient: both the legacy alias and the
 * canonical home must survive the caller's permission/capability filtering.
 * Unmapped legacy routes remain legacy so existing deep links are preserved.
 */
export function resolveExperienceV3Landing({
  enabled,
  manifest,
  legacyPath,
}: {
  enabled: boolean;
  manifest: RoleManifest | null;
  legacyPath: string;
}): ExperienceV3LandingDecision {
  if (!enabled) return { kind: 'legacy' };
  if (!manifest) return { kind: 'denied' };

  const legacyRoute = resolveRouteCapability(manifest, legacyPath);
  if (!legacyRoute) return { kind: 'legacy' };
  if (!legacyRoute.allowed) return { kind: 'denied' };

  const canonicalHome = resolveRouteCapability(manifest, manifest.homeHref);
  if (!canonicalHome?.allowed) return { kind: 'denied' };

  return { kind: 'redirect', href: manifest.homeHref };
}
