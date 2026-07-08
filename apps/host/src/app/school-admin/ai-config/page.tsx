'use client';

/**
 * /school-admin/ai-config — AI personality / tone / pedagogy / language.
 *
 * Lets a tenant admin (with `school.manage_settings`) configure the
 * subset of `tenant_configs` keys that drive Foxy / AI Tutor behaviour:
 *
 *   - ai.personality       (warm_mentor | rigorous_coach | formal_examiner | playful_buddy)
 *   - ai.tone              (formal | neutral | casual)
 *   - ai.pedagogy          (socratic | direct_instruction | worked_example)
 *   - ai.default_language  (en | hi)
 *
 * Backed by GET / PUT /api/school-admin/tenant-config, which is the
 * platform-wide tenant_configs endpoint. Other admin pages (locale,
 * theme, communication) can consume the same endpoint without a new
 * route — they just render different `AI_KEYS`-style subsets.
 *
 * UX:
 *   - A single Save button writes all changed entries in one PUT. No
 *     auto-save on each select to avoid mid-edit half-writes.
 *   - "Default" / "Custom" badge per row, mirroring /school-admin/modules.
 *   - Preview-mode banner when `ff_tenant_config_v2` is OFF in this env.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import { Card, Button, Skeleton } from '@alfanumrik/ui/ui';

// ─── Bilingual helper ─────────────────────────────────────────────────
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

// ─── Types (mirror the endpoint response) ─────────────────────────────
interface ConfigEntry {
  key: string;
  value: unknown;
  isOverride: boolean;
  defaultValue: unknown;
  options: string[] | null;
}

interface TenantConfigResponse {
  tenant_type: 'school' | 'coaching' | 'corporate' | 'government';
  flag_enabled: boolean;
  entries: ConfigEntry[];
}

// Keys this page renders. Other pages (locale, theme, communication)
// will declare their own subset and reuse the same API.
const AI_KEYS: ReadonlyArray<string> = [
  'ai.personality',
  'ai.tone',
  'ai.pedagogy',
  'ai.default_language',
];

// Bilingual labels per key + per option.
const FIELD_LABELS: Record<string, { en: string; hi: string; help_en: string; help_hi: string }> = {
  'ai.personality': {
    en: 'AI Personality',
    hi: 'AI व्यक्तित्व',
    help_en: 'How Foxy frames replies — warm mentor by default; rigorous coach for exam-prep; formal for government deployments; playful for younger learners.',
    help_hi: 'फॉक्सी जवाब कैसे देता है — डिफ़ॉल्ट रूप से सौम्य मार्गदर्शक; परीक्षा-तैयारी के लिए कठोर कोच; सरकारी तैनाती के लिए औपचारिक; छोटे शिक्षार्थियों के लिए चंचल।',
  },
  'ai.tone': {
    en: 'AI Tone',
    hi: 'AI टोन',
    help_en: 'Surface-level register of replies — formal, neutral, or casual.',
    help_hi: 'जवाबों का सतही रजिस्टर — औपचारिक, तटस्थ, या आकस्मिक।',
  },
  'ai.pedagogy': {
    en: 'Teaching Style',
    hi: 'शिक्षण शैली',
    help_en: 'How concepts are introduced — Socratic question-led, direct instruction, or worked-example-first.',
    help_hi: 'अवधारणाएँ कैसे प्रस्तुत होती हैं — सुकराती प्रश्न-आधारित, सीधी निर्देश, या उदाहरण-पहले।',
  },
  'ai.default_language': {
    en: 'Default Language',
    hi: 'डिफ़ॉल्ट भाषा',
    help_en: 'Language Foxy starts in. Students can switch at any time.',
    help_hi: 'जिस भाषा में फॉक्सी शुरू होता है। छात्र कभी भी बदल सकते हैं।',
  },
};

const OPTION_LABELS: Record<string, { en: string; hi: string }> = {
  warm_mentor:        { en: 'Warm mentor',         hi: 'सौम्य मार्गदर्शक' },
  rigorous_coach:     { en: 'Rigorous coach',      hi: 'कठोर कोच' },
  formal_examiner:    { en: 'Formal examiner',     hi: 'औपचारिक परीक्षक' },
  playful_buddy:      { en: 'Playful buddy',       hi: 'चंचल साथी' },
  formal:             { en: 'Formal',              hi: 'औपचारिक' },
  neutral:            { en: 'Neutral',             hi: 'तटस्थ' },
  casual:             { en: 'Casual',              hi: 'आकस्मिक' },
  socratic:           { en: 'Socratic',            hi: 'सुकराती' },
  direct_instruction: { en: 'Direct instruction',  hi: 'सीधे निर्देश' },
  worked_example:     { en: 'Worked example',      hi: 'हल किए गए उदाहरण' },
  en:                 { en: 'English',             hi: 'अंग्रेज़ी' },
  hi:                 { en: 'Hindi',               hi: 'हिन्दी' },
};

function optionLabel(opt: string, isHi: boolean): string {
  const m = OPTION_LABELS[opt];
  return m ? (isHi ? m.hi : m.en) : opt;
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function AiConfigPage() {
  const { isHi } = useAuth() as { isHi?: boolean };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [data, setData] = useState<TenantConfigResponse | null>(null);
  // Local edits — keyed by config key. Cleared after a successful save.
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/school-admin/tenant-config');
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(body.data as TenantConfigResponse);
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter to only AI keys (this page's responsibility).
  const aiEntries = useMemo<ConfigEntry[]>(() => {
    if (!data) return [];
    return data.entries.filter(e => AI_KEYS.includes(e.key));
  }, [data]);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  const onChange = (key: string, value: unknown) => {
    setDraft(prev => {
      const next = { ...prev };
      // If the new value matches the canonical current value, clear the
      // draft entry — keeps "dirty" state truthful.
      const current = aiEntries.find(e => e.key === key)?.value;
      if (current === value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const onSave = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const entries = dirtyKeys.map(key => ({ key, value: draft[key] }));
      const res = await authedFetch('/api/school-admin/tenant-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
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
        <h1 className="text-2xl font-semibold">{t(!!isHi, 'AI Configuration', 'AI कॉन्फ़िगरेशन')}</h1>
        <p className="text-sm text-[color:var(--text-2)] mt-1">
          {t(
            !!isHi,
            'Tune how Foxy talks to your students.',
            'सेट करें कि फॉक्सी आपके छात्रों से कैसे बात करे।',
          )}
        </p>
      </header>

      {error && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--red)]">
          <p className="text-sm text-[color:var(--red)]">{error}</p>
        </Card>
      )}

      {savedAt && !error && dirtyKeys.length === 0 && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--green)]">
          <p className="text-sm text-[color:var(--green)]">
            {t(!!isHi, `Saved at ${savedAt}`, `${savedAt} पर सहेजा गया`)}
          </p>
        </Card>
      )}

      {data && !data.flag_enabled && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--gold)]">
          <p className="text-sm">
            <strong>{t(!!isHi, 'Preview mode', 'पूर्वावलोकन मोड')}:</strong>{' '}
            {t(
              !!isHi,
              'Saved values are stored but the AI runtime currently uses platform defaults until the rollout completes.',
              'सहेजे गए मान संग्रहीत हैं लेकिन रोलआउट पूरा होने तक AI रनटाइम वर्तमान में प्लेटफ़ॉर्म डिफ़ॉल्ट का उपयोग करता है।',
            )}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {aiEntries.map(entry => {
          const labels = FIELD_LABELS[entry.key];
          const currentValue = draft[entry.key] !== undefined ? draft[entry.key] : entry.value;
          const isDirty = entry.key in draft;
          return (
            <Card key={entry.key} className="p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold">
                      {labels ? (isHi ? labels.hi : labels.en) : entry.key}
                    </h3>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                        entry.isOverride
                          ? 'bg-[color:var(--purple)]/10 text-[color:var(--purple)]'
                          : 'bg-[color:var(--text-3)]/10 text-[color:var(--text-3)]'
                      }`}
                    >
                      {entry.isOverride
                        ? t(!!isHi, 'Custom', 'कस्टम')
                        : t(!!isHi, 'Default', 'डिफ़ॉल्ट')}
                    </span>
                    {isDirty && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-[color:var(--gold)]/15 text-[color:var(--gold)]">
                        {t(!!isHi, 'Unsaved', 'सहेजा नहीं गया')}
                      </span>
                    )}
                  </div>
                  {labels && (
                    <p className="text-xs text-[color:var(--text-3)] mt-1">{isHi ? labels.help_hi : labels.help_en}</p>
                  )}
                </div>
              </div>

              {entry.options ? (
                <select
                  value={String(currentValue ?? '')}
                  onChange={e => onChange(entry.key, e.target.value)}
                  disabled={saving}
                  className="w-full px-3 py-2 rounded border border-[color:var(--border-mid)] bg-[color:var(--surface-1)] text-sm"
                >
                  {entry.options.map(opt => (
                    <option key={opt} value={opt}>
                      {optionLabel(opt, !!isHi)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-[color:var(--text-3)] italic">
                  {t(!!isHi, 'Unsupported field type — contact support.', 'असमर्थित फ़ील्ड — सहायता से संपर्क करें।')}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button variant="ghost" onClick={load} disabled={saving || dirtyKeys.length === 0}>
          {t(!!isHi, 'Discard changes', 'परिवर्तन हटाएँ')}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving || dirtyKeys.length === 0}>
          {saving
            ? t(!!isHi, 'Saving…', 'सहेज रहे हैं…')
            : t(!!isHi, `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`, `${dirtyKeys.length} परिवर्तन सहेजें`)}
        </Button>
      </div>
    </div>
  );
}
