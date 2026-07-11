import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { cleanupLegacyServiceWorker } from '@alfanumrik/lib/RegisterSW';

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
