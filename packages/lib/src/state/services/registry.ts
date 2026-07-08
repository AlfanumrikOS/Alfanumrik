/**
 * src/lib/state/services/registry.ts — the typed service registry.
 *
 * Maps service.name → service instance so the Orchestrator can find a
 * service by name (used by event-driven dispatches and by tests). The
 * registry is the canonical roster of "what services Alfanumrik runs";
 * the rule engine, the bus, and the mesh all read from this one map.
 *
 * Adding a service:
 *   1. Implement it under src/lib/state/services/<name>-service.ts
 *   2. Append it to STANDARD_SERVICES below
 *   3. The orchestrator picks it up automatically — no other plumbing.
 *
 * Why a Map instead of a hard-coded import in orchestrator.ts:
 *   - Test harnesses can construct a minimal orchestrator with a subset
 *     of services (e.g. just quiz-completion) without dragging the
 *     whole roster in.
 *   - Lets services declare which events they `subscribesTo`; the
 *     orchestrator scans the registry on event arrival.
 */

import type { Service } from './service';
import { quizCompletionService } from './quiz-completion-service';

/**
 * Frozen roster of services the production orchestrator dispatches.
 * Test harnesses can build their own subsets.
 */
export const STANDARD_SERVICES: ReadonlyMap<string, Service<unknown, unknown>> =
  buildRegistry([
    quizCompletionService as unknown as Service<unknown, unknown>,
  ]);

function buildRegistry(
  services: Service<unknown, unknown>[],
): ReadonlyMap<string, Service<unknown, unknown>> {
  const m = new Map<string, Service<unknown, unknown>>();
  for (const s of services) {
    if (m.has(s.name)) {
      throw new Error(
        `services/registry: duplicate service name "${s.name}". ` +
          `Each service must have a unique name across STANDARD_SERVICES.`,
      );
    }
    m.set(s.name, s);
  }
  return m;
}

/**
 * Builds a sub-registry containing only the named services. Throws if
 * any name is unknown — tests should fail loudly when they reference
 * a removed service.
 */
export function pickServices(
  names: ReadonlyArray<string>,
): ReadonlyMap<string, Service<unknown, unknown>> {
  const m = new Map<string, Service<unknown, unknown>>();
  for (const name of names) {
    const s = STANDARD_SERVICES.get(name);
    if (!s) {
      throw new Error(
        `services/registry: unknown service "${name}". ` +
          `Known: ${Array.from(STANDARD_SERVICES.keys()).join(', ')}`,
      );
    }
    m.set(name, s);
  }
  return m;
}
