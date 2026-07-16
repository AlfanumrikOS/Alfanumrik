import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import {
  cleanupLegacyServiceWorker,
  reportLegacyServiceWorkerCleanup,
  type LegacyServiceWorkerCleanupResult,
} from '@alfanumrik/lib/RegisterSW';

function registration(scriptUrl: string) {
  const update = vi.fn(async () => undefined);
  const unregister = vi.fn(async () => true);
  const value = {
    active: { scriptURL: scriptUrl },
    installing: null,
    waiting: null,
    update,
    unregister,
  };
  return { value, update, unregister };
}

function reloadGuard(initialState?: string) {
  const values = new Map<string, string>();
  if (initialState) values.set('alfanumrik-sw-retirement-reloaded-v1', initialState);

  return {
    values,
    storage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  };
}

describe('Phase 0 legacy service-worker client cleanup', () => {
  it('does not rely on update handoff: unregisters owned /sw.js, purges, then reloads once', async () => {
    const operations: string[] = [];
    const owned = registration('https://school.example/sw.js?legacy=v3');
    owned.unregister.mockImplementation(async () => {
      operations.push('unregister');
      return true;
    });
    const unrelated = registration('https://school.example/another-worker.js');
    const otherOrigin = registration('https://other.example/sw.js');
    const register = vi.fn();
    const serviceWorkerContainer = {
      register,
      getRegistrations: vi.fn(async () => [owned.value, unrelated.value, otherOrigin.value]),
    };
    const deleteCache = vi.fn(async (cacheName: string) => {
      operations.push(`delete:${cacheName}`);
      return true;
    });
    const reload = vi.fn(() => {
      operations.push('reload');
    });
    const guard = reloadGuard();

    const result = await cleanupLegacyServiceWorker({
      origin: 'https://school.example',
      reload,
      reloadGuardStorage: guard.storage,
      serviceWorkerContainer,
      cacheStorage: {
        keys: vi.fn(async () => [
          'alfanumrik-static-v3',
          'alfanumrik-api-v3',
          'workbox-unrelated',
          'tenant-shell',
        ]),
        delete: deleteCache,
      },
    });

    expect(register).not.toHaveBeenCalled();
    // Even if update() would resolve without activating/claiming a tombstone,
    // cleanup never calls it and therefore cannot mistake resolution for safety.
    expect(owned.update).not.toHaveBeenCalled();
    expect(owned.unregister).toHaveBeenCalledOnce();
    expect(unrelated.update).not.toHaveBeenCalled();
    expect(unrelated.unregister).not.toHaveBeenCalled();
    expect(otherOrigin.update).not.toHaveBeenCalled();
    expect(otherOrigin.unregister).not.toHaveBeenCalled();
    expect(deleteCache.mock.calls.map(([cacheName]) => cacheName).sort()).toEqual([
      'alfanumrik-api-v3',
      'alfanumrik-static-v3',
    ]);
    expect(reload).toHaveBeenCalledOnce();
    expect(guard.storage.setItem).toHaveBeenCalledWith(
      'alfanumrik-sw-retirement-reloaded-v1',
      'removed',
    );
    expect(operations.indexOf('unregister')).toBeLessThan(
      operations.indexOf('delete:alfanumrik-static-v3'),
    );
    expect(operations.indexOf('delete:alfanumrik-api-v3')).toBeLessThan(
      operations.indexOf('reload'),
    );
    expect(result).toEqual({
      registrationsFound: 1,
      unregisterAttempts: 1,
      registrationsRemoved: 1,
      cachesRemoved: 2,
      reloadsTriggered: 1,
      failures: 0,
    });
  });

  it('purges and reloads once when unregister fails, then the guard prevents a loop', async () => {
    const failedRegistration = registration('https://school.example/sw.js');
    failedRegistration.unregister.mockRejectedValue(new Error('browser rejected unregister'));
    const deleteCache = vi.fn(async (cacheName: string) => {
      if (cacheName === 'alfanumrik-api-v3') throw new Error('cache is locked');
      return true;
    });
    const reload = vi.fn();
    const guard = reloadGuard();
    const environment = {
      origin: 'https://school.example',
      reload,
      reloadGuardStorage: guard.storage,
      serviceWorkerContainer: {
        getRegistrations: vi.fn(async () => [failedRegistration.value]),
      },
      cacheStorage: {
        keys: vi.fn(async () => ['alfanumrik-api-v3', 'alfanumrik-static-v3']),
        delete: deleteCache,
      },
    };

    const firstResult = await cleanupLegacyServiceWorker(environment);
    const secondResult = await cleanupLegacyServiceWorker(environment);

    expect(failedRegistration.update).not.toHaveBeenCalled();
    expect(failedRegistration.unregister).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledTimes(4);
    expect(firstResult).toEqual({
      registrationsFound: 1,
      unregisterAttempts: 1,
      registrationsRemoved: 0,
      cachesRemoved: 1,
      reloadsTriggered: 1,
      failures: 2,
    });
    expect(secondResult.reloadsTriggered).toBe(0);
    expect(secondResult.failures).toBe(2);
  });

  it('allows one final reload when unregister succeeds after a fallback reload', async () => {
    const transientRegistration = registration('https://school.example/sw.js');
    transientRegistration.unregister.mockRejectedValueOnce(new Error('transient unregister error'));
    const reload = vi.fn();
    const guard = reloadGuard();
    const environment = {
      origin: 'https://school.example',
      reload,
      reloadGuardStorage: guard.storage,
      serviceWorkerContainer: {
        getRegistrations: vi.fn(async () => [transientRegistration.value]),
      },
      cacheStorage: {
        keys: vi.fn(async () => ['alfanumrik-api-v3']),
        delete: vi.fn(async () => true),
      },
    };

    const fallbackResult = await cleanupLegacyServiceWorker(environment);
    const removalResult = await cleanupLegacyServiceWorker(environment);
    const boundedResult = await cleanupLegacyServiceWorker(environment);

    expect(transientRegistration.unregister).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(guard.storage.setItem.mock.calls).toEqual([
      ['alfanumrik-sw-retirement-reloaded-v1', 'fallback'],
      ['alfanumrik-sw-retirement-reloaded-v1', 'removed'],
    ]);
    expect(fallbackResult).toEqual({
      registrationsFound: 1,
      unregisterAttempts: 1,
      registrationsRemoved: 0,
      cachesRemoved: 1,
      reloadsTriggered: 1,
      failures: 1,
    });
    expect(removalResult).toEqual({
      registrationsFound: 1,
      unregisterAttempts: 1,
      registrationsRemoved: 1,
      cachesRemoved: 1,
      reloadsTriggered: 1,
      failures: 0,
    });
    expect(boundedResult.reloadsTriggered).toBe(0);
  });

  it('does not reload and clears a stale guard when no owned registration remains', async () => {
    const reload = vi.fn();
    const guard = reloadGuard('removed');

    const result = await cleanupLegacyServiceWorker({
      origin: 'https://school.example',
      reload,
      reloadGuardStorage: guard.storage,
      serviceWorkerContainer: {
        getRegistrations: vi.fn(async () => []),
      },
      cacheStorage: {
        keys: vi.fn(async () => ['unrelated-runtime-cache']),
        delete: vi.fn(async () => true),
      },
    });

    expect(reload).not.toHaveBeenCalled();
    expect(guard.storage.removeItem).toHaveBeenCalledWith(
      'alfanumrik-sw-retirement-reloaded-v1',
    );
    expect(guard.values.has('alfanumrik-sw-retirement-reloaded-v1')).toBe(false);
    expect(result).toEqual({
      registrationsFound: 0,
      unregisterAttempts: 0,
      registrationsRemoved: 0,
      cachesRemoved: 0,
      reloadsTriggered: 0,
      failures: 0,
    });
  });

  it('reloads a controller-only tab once when another tab already removed the registration', async () => {
    const reload = vi.fn();
    const guard = reloadGuard();

    const result = await cleanupLegacyServiceWorker({
      origin: 'https://school.example',
      reload,
      reloadGuardStorage: guard.storage,
      serviceWorkerContainer: {
        controller: { scriptURL: 'https://school.example/sw.js' },
        getRegistrations: vi.fn(async () => []),
      },
      cacheStorage: {
        keys: vi.fn(async () => ['alfanumrik-api-v3']),
        delete: vi.fn(async () => true),
      },
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(result).toEqual({
      registrationsFound: 0,
      unregisterAttempts: 0,
      registrationsRemoved: 0,
      cachesRemoved: 1,
      reloadsTriggered: 1,
      failures: 0,
    });
  });
});

function cleanupResult(
  overrides: Partial<LegacyServiceWorkerCleanupResult> = {},
): LegacyServiceWorkerCleanupResult {
  return {
    registrationsFound: 0,
    unregisterAttempts: 0,
    registrationsRemoved: 0,
    cachesRemoved: 0,
    reloadsTriggered: 0,
    failures: 0,
    ...overrides,
  };
}

// REG-259 — sw_legacy_cleanup fleet-recovery telemetry. The PostHog decay
// curve in docs/runbooks/pwa-stale-service-worker-recovery.md §5-6 is the
// ONLY fleet-wide signal that legacy pre-2026-07-11 devices are healing, so
// the emit-gate, the exact event name, and the counts-only payload (P13) are
// all load-bearing for the escalation criteria.
describe('sw_legacy_cleanup telemetry reporter (REG-259)', () => {
  const SIX_COUNT_KEYS = [
    'cachesRemoved',
    'failures',
    'registrationsFound',
    'registrationsRemoved',
    'reloadsTriggered',
    'unregisterAttempts',
  ];

  it('emits nothing for the all-zero healthy-fleet result (zero event volume for clean clients)', () => {
    const capture = vi.fn();

    reportLegacyServiceWorkerCleanup(cleanupResult(), capture);

    expect(capture).not.toHaveBeenCalled();
  });

  it('does not emit when only non-gate counters are set (gate is found/caches/failures ONLY)', () => {
    const capture = vi.fn();

    // Unreachable in practice (removals imply a found registration), but this
    // pins the emit-gate to EXACTLY registrationsFound | cachesRemoved |
    // failures — a widened gate would flood PostHog from healthy clients.
    reportLegacyServiceWorkerCleanup(
      cleanupResult({ unregisterAttempts: 2, registrationsRemoved: 1, reloadsTriggered: 1 }),
      capture,
    );

    expect(capture).not.toHaveBeenCalled();
  });

  it('emits exactly one sw_legacy_cleanup event with ONLY the six numeric counts when a legacy registration is found (P13)', () => {
    const capture = vi.fn();
    const result = cleanupResult({
      registrationsFound: 2,
      unregisterAttempts: 2,
      registrationsRemoved: 1,
      cachesRemoved: 3,
      reloadsTriggered: 1,
      failures: 1,
    });

    reportLegacyServiceWorkerCleanup(result, capture);

    expect(capture).toHaveBeenCalledTimes(1);
    const [eventName, properties] = capture.mock.calls[0];
    expect(eventName).toBe('sw_legacy_cleanup');
    // P13 pin: EXACTLY the six counts — no user id, email, URL, user agent,
    // or any other enrichment may ever ride on this event.
    expect(Object.keys(properties).sort()).toEqual(SIX_COUNT_KEYS);
    expect(properties).toEqual({
      registrationsFound: 2,
      unregisterAttempts: 2,
      registrationsRemoved: 1,
      cachesRemoved: 3,
      reloadsTriggered: 1,
      failures: 1,
    });
    for (const key of SIX_COUNT_KEYS) {
      expect(typeof properties[key], `${key} must be a number`).toBe('number');
    }
  });

  it('emits when only caches were removed (controller-less residue still counts as a heal)', () => {
    const capture = vi.fn();

    reportLegacyServiceWorkerCleanup(cleanupResult({ cachesRemoved: 1 }), capture);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe('sw_legacy_cleanup');
  });

  it('emits when only failures occurred — the runbook §6 escalation signal must not be silent', () => {
    const capture = vi.fn();

    reportLegacyServiceWorkerCleanup(cleanupResult({ failures: 1 }), capture);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toEqual(cleanupResult({ failures: 1 }));
  });

  it('never throws when the capture fn throws — telemetry cannot break the cleanup/reload flow (P15)', () => {
    const throwingCapture = vi.fn(() => {
      throw new Error('posthog exploded');
    });

    expect(() =>
      reportLegacyServiceWorkerCleanup(
        cleanupResult({ registrationsFound: 1, failures: 1 }),
        throwingCapture,
      ),
    ).not.toThrow();
    expect(throwingCapture).toHaveBeenCalledTimes(1);
  });
});

type ExtendableEventHandler = (event: { waitUntil(promise: Promise<unknown>): void }) => void;

describe('Phase 0 /sw.js retirement tombstone', () => {
  it('executes install/activate cleanup without registering a fetch handler', async () => {
    const source = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
    const handlers = new Map<string, ExtendableEventHandler>();
    const skipWaiting = vi.fn(async () => undefined);
    const claim = vi.fn(async () => undefined);
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);

    vm.runInNewContext(source, {
      Promise,
      caches: {
        keys: vi.fn(async () => [
          'alfanumrik-static-v3',
          'alfanumrik-api-v3',
          'unrelated-runtime-cache',
        ]),
        delete: deleteCache,
      },
      self: {
        addEventListener: (eventName: string, handler: ExtendableEventHandler) => {
          handlers.set(eventName, handler);
        },
        skipWaiting,
        clients: { claim },
        registration: { unregister },
      },
    });

    expect([...handlers.keys()].sort()).toEqual(['activate', 'install']);
    expect(handlers.has('fetch')).toBe(false);

    let installWork: Promise<unknown> | undefined;
    handlers.get('install')?.({
      waitUntil: (promise) => {
        installWork = promise;
      },
    });
    await installWork;
    expect(skipWaiting).toHaveBeenCalledOnce();

    let activationWork: Promise<unknown> | undefined;
    handlers.get('activate')?.({
      waitUntil: (promise) => {
        activationWork = promise;
      },
    });
    await activationWork;

    expect(deleteCache.mock.calls.map(([cacheName]) => cacheName).sort()).toEqual([
      'alfanumrik-api-v3',
      'alfanumrik-static-v3',
    ]);
    expect(claim).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('still claims clients and unregisters when CacheStorage cleanup fails', async () => {
    const source = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
    const handlers = new Map<string, ExtendableEventHandler>();
    const claim = vi.fn(async () => undefined);
    const unregister = vi.fn(async () => true);

    vm.runInNewContext(source, {
      Promise,
      caches: {
        keys: vi.fn(async () => {
          throw new Error('CacheStorage unavailable');
        }),
      },
      self: {
        addEventListener: (eventName: string, handler: ExtendableEventHandler) => {
          handlers.set(eventName, handler);
        },
        skipWaiting: vi.fn(async () => undefined),
        clients: { claim },
        registration: { unregister },
      },
    });

    let activationWork: Promise<unknown> | undefined;
    handlers.get('activate')?.({
      waitUntil: (promise) => {
        activationWork = promise;
      },
    });
    await activationWork;

    expect(claim).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
});
