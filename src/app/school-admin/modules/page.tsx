'use client';

/**
 * /school-admin/modules — Module enablement management.
 *
 * Lets a tenant admin (with `school.manage_modules`) toggle which platform
 * modules are exposed to their students/teachers.
 *
 * Backed by GET / PUT /api/school-admin/modules.
 *
 * UX notes:
 *   - Each module shows: bilingual name, description, and a toggle switch.
 *   - Origin badge:
 *       "Default" when the resolved value comes from the registry default
 *                  for this tenant_type (no DB override row).
 *       "Custom"  when a tenant_modules row exists.
 *   - When the platform-level flag `ff_tenant_module_registry_v1` is OFF
 *     in this environment, the API surfaces every module as enabled and
 *     we render an info banner explaining that toggles save but won't take
 *     effect until the flag rolls out.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { authedFetch } from '@/lib/school-admin/authed-fetch';
import { Card, Button, Skeleton } from '@/components/ui';

// ─── Bilingual helper ─────────────────────────────────────────────────
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

// ─── Types (mirror the GET response in route.ts) ──────────────────────
interface ModuleView {
  key: string;
  displayName: string;
  displayNameHi: string | null;
  description: string;
  routePrefix: string | null;
  isEnabled: boolean;
  isOverride: boolean;
  config: Record<string, unknown> | null;
}

interface ModulesResponse {
  tenant_type: 'school' | 'coaching' | 'corporate' | 'government';
  flag_enabled: boolean;
  modules: ModuleView[];
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function ModulesPage() {
  const { isHi } = useAuth() as { isHi?: boolean };
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ModulesResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/school-admin/modules');
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(body.data as ModulesResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = async (m: ModuleView) => {
    if (savingKey) return; // prevent double-submit while another row is saving
    setSavingKey(m.key);
    setError(null);
    try {
      const res = await authedFetch('/api/school-admin/modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey: m.key, isEnabled: !m.isEnabled }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      // Refresh the whole view so the "Default/Custom" badge is canonical.
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="app-container py-6">
        <Skeleton variant="title" height={28} width="40%" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} variant="rect" height={84} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t(!!isHi, 'Modules', 'मॉड्यूल')}</h1>
        <p className="text-sm text-[color:var(--text-2)] mt-1">
          {t(
            !!isHi,
            'Enable or disable platform features for this school.',
            'इस स्कूल के लिए प्लेटफ़ॉर्म सुविधाएँ सक्षम या अक्षम करें।',
          )}
        </p>
      </header>

      {error && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--red)]">
          <p className="text-sm text-[color:var(--red)]">{error}</p>
        </Card>
      )}

      {data && !data.flag_enabled && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--gold)]">
          <p className="text-sm">
            <strong>{t(!!isHi, 'Preview mode', 'पूर्वावलोकन मोड')}:</strong>{' '}
            {t(
              !!isHi,
              'Toggles save your preferences but the registry rollout is not active in this environment yet, so every module is currently treated as enabled. Your saved choices will take effect when the rollout completes.',
              'टॉगल आपकी प्राथमिकताएँ सहेजते हैं लेकिन रजिस्ट्री रोलआउट अभी इस वातावरण में सक्रिय नहीं है, इसलिए वर्तमान में हर मॉड्यूल सक्षम माना जाता है। रोलआउट पूरा होने पर आपकी सहेजी गई पसंद प्रभावी होगी।',
            )}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {data?.modules.map(m => (
          <Card key={m.key} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold">
                    {isHi && m.displayNameHi ? m.displayNameHi : m.displayName}
                  </h3>
                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                      m.isOverride
                        ? 'bg-[color:var(--purple)]/10 text-[color:var(--purple)]'
                        : 'bg-[color:var(--text-3)]/10 text-[color:var(--text-3)]'
                    }`}
                  >
                    {m.isOverride
                      ? t(!!isHi, 'Custom', 'कस्टम')
                      : t(!!isHi, 'Default', 'डिफ़ॉल्ट')}
                  </span>
                  {m.routePrefix && (
                    <span className="text-xs text-[color:var(--text-3)] font-mono">{m.routePrefix}</span>
                  )}
                </div>
                <p className="text-sm text-[color:var(--text-2)] mt-1">{m.description}</p>
              </div>

              <Button
                variant={m.isEnabled ? 'primary' : 'ghost'}
                onClick={() => onToggle(m)}
                disabled={savingKey === m.key}
                aria-pressed={m.isEnabled}
                aria-label={`Toggle ${m.displayName}`}
              >
                {savingKey === m.key
                  ? t(!!isHi, 'Saving…', 'सहेज रहे हैं…')
                  : m.isEnabled
                    ? t(!!isHi, 'Enabled', 'सक्षम')
                    : t(!!isHi, 'Disabled', 'अक्षम')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
