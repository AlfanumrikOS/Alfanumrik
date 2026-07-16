'use client';

import { useEffect } from 'react';

import { posthogCapture } from './posthog-client';

const ALFANUMRIK_CACHE_PREFIX = 'alfanumrik-';
const CLEANUP_TELEMETRY_EVENT = 'sw_legacy_cleanup';
const RETIRED_WORKER_PATH = '/sw.js';
const RETIREMENT_RELOAD_GUARD = 'alfanumrik-sw-retirement-reloaded-v1';
const RELOAD_STATE_FALLBACK = 'fallback';
const RELOAD_STATE_REMOVED = 'removed';

type WorkerReference = Pick<ServiceWorker, 'scriptURL'>;

export interface LegacyWorkerRegistration {
  active: WorkerReference | null;
  installing: WorkerReference | null;
  waiting: WorkerReference | null;
  unregister(): Promise<boolean>;
}

export interface LegacyWorkerContainer {
  controller?: WorkerReference | null;
  getRegistrations(): Promise<readonly LegacyWorkerRegistration[]>;
}

export interface LegacyCacheStorage {
  keys(): Promise<readonly string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export interface LegacyReloadGuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LegacyServiceWorkerCleanupEnvironment {
  serviceWorkerContainer?: LegacyWorkerContainer | null;
  cacheStorage?: LegacyCacheStorage | null;
  origin?: string;
  reload?: (() => void) | null;
  reloadGuardStorage?: LegacyReloadGuardStorage | null;
}

export interface LegacyServiceWorkerCleanupResult {
  registrationsFound: number;
  unregisterAttempts: number;
  registrationsRemoved: number;
  cachesRemoved: number;
  reloadsTriggered: number;
  failures: number;
}

function defaultServiceWorkerContainer(): LegacyWorkerContainer | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker;
}

function defaultCacheStorage(): LegacyCacheStorage | null {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  return window.caches;
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function defaultReloadGuardStorage(): LegacyReloadGuardStorage | null {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function reloadCurrentPage(): void {
  if (typeof window !== 'undefined') window.location.reload();
}

function isRetiredAlfanumrikWorker(
  worker: WorkerReference | null | undefined,
  origin: string,
): boolean {
  if (!worker) return false;

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  try {
    const scriptUrl = new URL(worker.scriptURL, expectedOrigin);
    return scriptUrl.origin === expectedOrigin && scriptUrl.pathname === RETIRED_WORKER_PATH;
  } catch {
    return false;
  }
}

function isRetiredAlfanumrikRegistration(
  registration: LegacyWorkerRegistration,
  origin: string,
): boolean {
  return [registration.active, registration.waiting, registration.installing].some((worker) =>
    isRetiredAlfanumrikWorker(worker, origin),
  );
}

/**
 * Remove only the retired Alfanumrik root worker and the CacheStorage entries
 * it created. This deliberately does not clear unrelated application/browser
 * caches and never registers a replacement worker.
 */
export async function cleanupLegacyServiceWorker(
  environment: LegacyServiceWorkerCleanupEnvironment = {},
): Promise<LegacyServiceWorkerCleanupResult> {
  const serviceWorkerContainer =
    environment.serviceWorkerContainer === undefined
      ? defaultServiceWorkerContainer()
      : environment.serviceWorkerContainer;
  const cacheStorage =
    environment.cacheStorage === undefined ? defaultCacheStorage() : environment.cacheStorage;
  const origin = environment.origin ?? currentOrigin();
  const reload = environment.reload === undefined ? reloadCurrentPage : environment.reload;
  const reloadGuardStorage =
    environment.reloadGuardStorage === undefined
      ? defaultReloadGuardStorage()
      : environment.reloadGuardStorage;
  const result: LegacyServiceWorkerCleanupResult = {
    registrationsFound: 0,
    unregisterAttempts: 0,
    registrationsRemoved: 0,
    cachesRemoved: 0,
    reloadsTriggered: 0,
    failures: 0,
  };
  let ownedControllerFound = false;

  if (serviceWorkerContainer) {
    ownedControllerFound = isRetiredAlfanumrikWorker(serviceWorkerContainer.controller, origin);
    try {
      const registrations = await serviceWorkerContainer.getRegistrations();
      const ownedRegistrations = registrations.filter((registration) =>
        isRetiredAlfanumrikRegistration(registration, origin),
      );
      result.registrationsFound = ownedRegistrations.length;

      await Promise.all(
        ownedRegistrations.map(async (registration) => {
          result.unregisterAttempts += 1;
          try {
            if (await registration.unregister()) result.registrationsRemoved += 1;
          } catch {
            result.failures += 1;
          }
        }),
      );
    } catch {
      result.failures += 1;
    }
  }

  if (cacheStorage) {
    try {
      const cacheNames = await cacheStorage.keys();
      const ownedCacheNames = cacheNames.filter((cacheName) =>
        cacheName.startsWith(ALFANUMRIK_CACHE_PREFIX),
      );

      await Promise.all(
        ownedCacheNames.map(async (cacheName) => {
          try {
            if (await cacheStorage.delete(cacheName)) result.cachesRemoved += 1;
          } catch {
            result.failures += 1;
          }
        }),
      );
    } catch {
      result.failures += 1;
    }
  }

  // When no owned registration remains, clear a stale loop guard and leave the
  // page untouched. This is the normal path after the final retirement reload.
  if (result.registrationsFound === 0 && !ownedControllerFound) {
    if (reloadGuardStorage) {
      try {
        reloadGuardStorage.removeItem(RETIREMENT_RELOAD_GUARD);
      } catch {
        result.failures += 1;
      }
    }
    return result;
  }

  // unregister() does not release the incumbent controller from the current
  // document, so unload it after CacheStorage cleanup. The guard has two
  // bounded states: one fallback reload when unregister cannot be confirmed,
  // then one final reload if a later retry confirms removal. Persistent
  // failures never advance past the fallback state and therefore cannot loop.
  let shouldReload = false;
  if (reload && reloadGuardStorage) {
    try {
      const reloadState = reloadGuardStorage.getItem(RETIREMENT_RELOAD_GUARD);
      if (result.registrationsRemoved > 0 && reloadState !== RELOAD_STATE_REMOVED) {
        reloadGuardStorage.setItem(RETIREMENT_RELOAD_GUARD, RELOAD_STATE_REMOVED);
        shouldReload = true;
      } else if (result.registrationsRemoved === 0 && reloadState === null) {
        reloadGuardStorage.setItem(RETIREMENT_RELOAD_GUARD, RELOAD_STATE_FALLBACK);
        shouldReload = true;
      }
    } catch {
      result.failures += 1;
      // Without a durable loop guard, reload only after confirmed removal.
      shouldReload = result.registrationsRemoved > 0;
    }
  } else if (reload) {
    // Without sessionStorage, reload only after confirmed removal so a browser
    // that repeatedly rejects unregister() cannot loop forever.
    shouldReload = result.registrationsRemoved > 0;
  }

  if (shouldReload && reload) {
    try {
      reload();
      result.reloadsTriggered = 1;
    } catch {
      result.failures += 1;
    }
  }

  return result;
}

/**
 * Fleet self-heal telemetry (PII-free, P13). Emits ONE `sw_legacy_cleanup`
 * PostHog event per cleanup pass, and ONLY when there was something to
 * report — a legacy registration, an owned cache, or a failure. The healthy
 * all-zero path (the overwhelming majority of clients) emits nothing, so
 * clean clients generate zero event volume.
 *
 * The payload is exactly the six numeric counts from
 * `LegacyServiceWorkerCleanupResult`. No user id, no URL, no user agent —
 * PostHog attaches its own context; we do not enrich.
 *
 * Fire-and-forget via the house `posthogCapture()` util (lazy dynamic
 * import of posthog-js, no-ops when PostHog is disabled, swallows errors).
 * Wrapped in try/catch so telemetry can never break the cleanup/reload
 * flow on auth/onboarding pages (P15). `capture` is injectable for tests.
 */
export function reportLegacyServiceWorkerCleanup(
  result: LegacyServiceWorkerCleanupResult,
  capture: (event: string, properties: Record<string, unknown>) => void = posthogCapture,
): void {
  const hasSomethingToReport =
    result.registrationsFound > 0 || result.cachesRemoved > 0 || result.failures > 0;
  if (!hasSomethingToReport) return;

  try {
    capture(CLEANUP_TELEMETRY_EVENT, {
      registrationsFound: result.registrationsFound,
      unregisterAttempts: result.unregisterAttempts,
      registrationsRemoved: result.registrationsRemoved,
      cachesRemoved: result.cachesRemoved,
      reloadsTriggered: result.reloadsTriggered,
      failures: result.failures,
    });
  } catch {
    // Telemetry must never break the containment flow.
  }
}

/**
 * Phase 0 containment mount. Kept in the shared layout so every role and
 * white-label tenant retries best-effort cleanup after hydration.
 */
export default function ServiceWorkerCleanup() {
  useEffect(() => {
    void cleanupLegacyServiceWorker()
      .then((result) => {
        reportLegacyServiceWorkerCleanup(result);
        if (result.failures > 0) {
          console.warn('[sw] Legacy service-worker cleanup was incomplete and will be retried.');
        }
      })
      .catch(() => {
        // cleanupLegacyServiceWorker is defensive and should never reject,
        // but the shared layout (auth/onboarding included) must never be
        // broken by an unhandled rejection here (P15).
      });
  }, []);

  return null;
}
