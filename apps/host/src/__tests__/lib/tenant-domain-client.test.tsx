/**
 * TenantConfigProvider + hook tests.
 *
 * Exercises:
 *   - initial loading state, then no_tenant on { isTenantContext: false }
 *   - happy path → ready state with tenant + modules + config
 *   - fetch error → no_tenant fallback (never throws)
 *   - initialState seed skips network
 *   - applyCssVars=true sets CSS custom properties on <html>
 *   - applyCssVars=false leaves <html> alone
 *   - typography vars only emitted when typography fields are non-null
 *   - useIsModuleEnabled, useTenantConfigValue, useTenantType selector hooks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, waitFor, act } from '@testing-library/react';
import {
  TenantConfigProvider,
  useTenantConfig,
  useIsModuleEnabled,
  useTenantConfigValue,
  useTenantType,
  cssVarsFromTenant,
  type TenantConfigState,
} from '@alfanumrik/lib/tenant-domain/client';
import type { TenantConfigResponse } from '@/app/api/tenant/config/route';
import type { ReactNode } from 'react';

const HAPPY_BODY: TenantConfigResponse = {
  isTenantContext: true,
  tenant: {
    id: 'school-1',
    slug: 'dps',
    name: 'Delhi Public School',
    plan: 'family',
    isActive: true,
    tenantType: 'coaching',
    branding: {
      logoUrl: 'https://cdn/logo.png',
      primaryColor: '#123456',
      secondaryColor: '#abcdef',
      tagline: 'Learn boldly',
      faviconUrl: null,
      showPoweredBy: true,
    },
    typography: { fontHeading: 'Inter', fontBody: 'system-ui', borderRadiusPx: 10 },
  },
  modules: {
    lms: true, ai_tutor: true, testing_engine: true, live_classes: true,
    analytics: true, crm: false, assignments: true, attendance: true, communication: true,
  },
  config: {
    'theme.dark_mode_default': false,
    'ai.personality': 'rigorous_coach',
    'ai.tone': 'neutral',
    'ai.pedagogy': 'worked_example',
    'ai.default_language': 'en',
    'locale.timezone': 'Asia/Kolkata',
    'locale.currency': 'INR',
    'locale.number_format': 'en-IN',
    'communication.from_email_name': 'DPS',
  },
};

beforeEach(() => {
  // Reset CSS vars on document.documentElement so each test starts clean.
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function wrapWithProvider(initialState?: TenantConfigState) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <TenantConfigProvider applyCssVars={false} initialState={initialState}>
      {children}
    </TenantConfigProvider>
  );
  Wrapper.displayName = 'TestTenantConfigProviderWrapper';
  return Wrapper;
}

describe('TenantConfigProvider — fetch lifecycle', () => {
  it('starts in loading state, transitions to ready on happy fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(HAPPY_BODY), { status: 200 }),
    );

    const { result } = renderHook(() => useTenantConfig(), {
      wrapper: wrapWithProvider(),
    });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchSpy).toHaveBeenCalledWith('/api/tenant/config', { credentials: 'same-origin' });
    if (result.current.status === 'ready') {
      expect(result.current.tenant.tenantType).toBe('coaching');
      expect(result.current.modules.crm).toBe(false);
      expect(result.current.config['ai.personality']).toBe('rigorous_coach');
    }
  });

  it('falls back to no_tenant on { isTenantContext: false }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ isTenantContext: false }), { status: 200 }),
    );
    const { result } = renderHook(() => useTenantConfig(), {
      wrapper: wrapWithProvider(),
    });
    await waitFor(() => expect(result.current.status).toBe('no_tenant'));
  });

  it('falls back to no_tenant on fetch rejection (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useTenantConfig(), {
      wrapper: wrapWithProvider(),
    });
    await waitFor(() => expect(result.current.status).toBe('no_tenant'));
  });

  it('falls back to no_tenant on non-OK HTTP (e.g. 500)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    const { result } = renderHook(() => useTenantConfig(), {
      wrapper: wrapWithProvider(),
    });
    await waitFor(() => expect(result.current.status).toBe('no_tenant'));
  });
});

describe('TenantConfigProvider — initialState seed', () => {
  it('skips the network when initialState is provided', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ready: TenantConfigState = {
      status: 'ready',
      tenant: HAPPY_BODY.tenant,
      modules: HAPPY_BODY.modules,
      config: HAPPY_BODY.config,
    };
    const { result } = renderHook(() => useTenantConfig(), {
      wrapper: wrapWithProvider(ready),
    });
    expect(result.current.status).toBe('ready');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('TenantConfigProvider — CSS vars', () => {
  it('applyCssVars=true sets brand + typography vars', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(HAPPY_BODY), { status: 200 }),
    );

    render(
      <TenantConfigProvider applyCssVars={true}>
        <div data-testid="child" />
      </TenantConfigProvider>,
    );

    await waitFor(() => {
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--color-brand-primary')).toBe('#123456');
      expect(root.style.getPropertyValue('--color-brand-secondary')).toBe('#abcdef');
      expect(root.style.getPropertyValue('--tenant-font-heading')).toBe('Inter');
      expect(root.style.getPropertyValue('--tenant-font-body')).toBe('system-ui');
      expect(root.style.getPropertyValue('--tenant-radius')).toBe('10px');
    });
  });

  it('applyCssVars=false leaves <html> alone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(HAPPY_BODY), { status: 200 }),
    );
    render(
      <TenantConfigProvider applyCssVars={false}>
        <div />
      </TenantConfigProvider>,
    );
    // Wait a tick for the fetch to settle, then assert no var was set.
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(document.documentElement.style.getPropertyValue('--color-brand-primary')).toBe('');
  });
});

describe('cssVarsFromTenant — pure helper', () => {
  it('omits typography vars when those fields are null', () => {
    const vars = cssVarsFromTenant({
      ...HAPPY_BODY.tenant,
      typography: { fontHeading: null, fontBody: null, borderRadiusPx: null },
    });
    expect(vars['--color-brand-primary']).toBe('#123456');
    expect(vars['--tenant-font-heading']).toBeUndefined();
    expect(vars['--tenant-font-body']).toBeUndefined();
    expect(vars['--tenant-radius']).toBeUndefined();
  });
});

describe('Selector hooks', () => {
  const ready: TenantConfigState = {
    status: 'ready',
    tenant: HAPPY_BODY.tenant,
    modules: HAPPY_BODY.modules,
    config: HAPPY_BODY.config,
  };

  it('useIsModuleEnabled reads from the modules map', () => {
    const { result: enabled } = renderHook(() => useIsModuleEnabled('lms'), {
      wrapper: wrapWithProvider(ready),
    });
    expect(enabled.current).toBe(true);

    const { result: disabled } = renderHook(() => useIsModuleEnabled('crm'), {
      wrapper: wrapWithProvider(ready),
    });
    expect(disabled.current).toBe(false);
  });

  it('useIsModuleEnabled returns true while loading (fail-open)', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useIsModuleEnabled('crm'), {
      wrapper: wrapWithProvider(),
    });
    expect(result.current).toBe(true);
  });

  it('useTenantConfigValue returns the typed value when ready', () => {
    const { result } = renderHook(() => useTenantConfigValue('ai.personality'), {
      wrapper: wrapWithProvider(ready),
    });
    expect(result.current).toBe('rigorous_coach');
  });

  it('useTenantConfigValue returns null while loading', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useTenantConfigValue('ai.personality'), {
      wrapper: wrapWithProvider(),
    });
    expect(result.current).toBeNull();
  });

  it('useTenantType defaults to "school" while loading, returns real type when ready', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const { result: loading } = renderHook(() => useTenantType(), {
      wrapper: wrapWithProvider(),
    });
    expect(loading.current).toBe('school');

    const { result: readyResult } = renderHook(() => useTenantType(), {
      wrapper: wrapWithProvider(ready),
    });
    expect(readyResult.current).toBe('coaching');
  });
});
