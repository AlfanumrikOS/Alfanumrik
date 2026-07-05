'use client';

/**
 * /super-admin/readiness-rubric — Phase 4 of Exam-Ready 360°.
 *
 * Lets super-admin tune the rubric thresholds and composite-score weights
 * that drive the per-chapter exam-readiness signal. Changes take effect
 * immediately (next RPC call reads the updated row), with no migration or
 * deploy required.
 *
 * Schema invariants enforced server-side via CHECK constraints — this UI
 * shows constraint errors verbatim from the API rather than re-validating
 * client-side, so server is the single source of truth.
 */

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';

const S: Record<string, React.CSSProperties> = {
  card: {
    padding: 16,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-1)',
  },
  primaryBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--text-1)',
    color: 'var(--surface-1)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface-1)',
    color: 'var(--text-1)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
};

interface RubricConfig {
  ready_mastered_ratio: number;
  ready_quiz_avg: number;
  ready_spaced_reviews: number;
  almost_mastered_ratio: number;
  almost_quiz_avg: number;
  almost_spaced_reviews: number;
  building_mastered_ratio: number;
  building_quiz_count: number;
  weight_mastery: number;
  weight_recent_quiz: number;
  weight_spaced_reviews: number;
  updated_at?: string;
  updated_by?: string | null;
}

interface RubricResponse {
  config: RubricConfig;
  defaults: RubricConfig;
}

interface FieldDef {
  key: keyof RubricConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const TIER_FIELDS: { tier: 'Ready' | 'Almost' | 'Building'; color: string; fields: FieldDef[] }[] = [
  {
    tier: 'Ready',
    color: 'var(--success)',
    fields: [
      { key: 'ready_mastered_ratio', label: 'Mastered ratio ≥', hint: '0.5–1.0 (e.g. 0.85 = 85%)', min: 0.5, max: 1.0, step: 0.01 },
      { key: 'ready_quiz_avg', label: 'Recent quiz avg ≥', hint: '50–100 (%)', min: 50, max: 100, step: 1 },
      { key: 'ready_spaced_reviews', label: 'Spaced reviews ≥', hint: '0–20 (count)', min: 0, max: 20, step: 1 },
    ],
  },
  {
    tier: 'Almost',
    color: 'var(--info)',
    fields: [
      { key: 'almost_mastered_ratio', label: 'Mastered ratio ≥', hint: '0.3–1.0', min: 0.3, max: 1.0, step: 0.01 },
      { key: 'almost_quiz_avg', label: 'Recent quiz avg ≥', hint: '30–100 (%)', min: 30, max: 100, step: 1 },
      { key: 'almost_spaced_reviews', label: 'Spaced reviews ≥', hint: '0–20', min: 0, max: 20, step: 1 },
    ],
  },
  {
    tier: 'Building',
    color: 'var(--warning)',
    fields: [
      { key: 'building_mastered_ratio', label: 'Mastered ratio ≥', hint: '0.1–1.0', min: 0.1, max: 1.0, step: 0.01 },
      { key: 'building_quiz_count', label: 'Recent quiz count ≥', hint: '0–20', min: 0, max: 20, step: 1 },
    ],
  },
];

const WEIGHT_FIELDS: FieldDef[] = [
  { key: 'weight_mastery', label: 'Mastery weight', hint: '0–1, must sum to 1.0', min: 0, max: 1, step: 0.05 },
  { key: 'weight_recent_quiz', label: 'Recent quiz weight', hint: '0–1, must sum to 1.0', min: 0, max: 1, step: 0.05 },
  { key: 'weight_spaced_reviews', label: 'Spaced reviews weight', hint: '0–1, must sum to 1.0', min: 0, max: 1, step: 0.05 },
];

function ReadinessRubricContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<RubricResponse | null>(null);
  const [draft, setDraft] = useState<Partial<RubricConfig>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch('/api/super-admin/readiness-rubric');
    if (res.ok) {
      const body = (await res.json()) as { success: boolean; data: RubricResponse };
      if (body.success) {
        setData(body.data);
        setDraft({});
      }
    } else {
      setError('Failed to load rubric config');
    }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleChange = (key: keyof RubricConfig, value: string) => {
    const num = Number.parseFloat(value);
    setDraft((prev) => ({ ...prev, [key]: Number.isFinite(num) ? num : 0 }));
  };

  const merged: RubricConfig | null = data ? { ...data.config, ...draft } : null;

  const dirty = Object.keys(draft).length > 0;

  const weightSum = merged
    ? merged.weight_mastery + merged.weight_recent_quiz + merged.weight_spaced_reviews
    : 0;
  const weightSumOk = Math.abs(weightSum - 1.0) < 0.001;

  const save = async () => {
    if (!dirty || !merged) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await apiFetch('/api/super-admin/readiness-rubric', {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      const body = (await res.json()) as { success: boolean; data: RubricResponse };
      setData(body.data);
      setDraft({});
      setSuccess('Saved. Changes apply to the next readiness query.');
    } else {
      const errBody = await res.json().catch(() => ({}));
      setError((errBody as { detail?: string; error?: string }).detail
        ?? (errBody as { error?: string }).error
        ?? 'Save failed');
    }
    setSaving(false);
  };

  const resetToDefaults = () => {
    if (!data) return;
    setDraft(data.defaults);
  };

  const discardChanges = () => {
    setDraft({});
    setError(null);
    setSuccess(null);
  };

  if (loading && !data) {
    return <p style={{ color: 'var(--text-3)' }}>Loading rubric…</p>;
  }
  if (!merged || !data) {
    return <p style={{ color: 'var(--danger)' }}>{error ?? 'No data'}</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground">Exam-Ready Rubric</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            Tune the thresholds that decide when a student is &quot;ready&quot; vs &quot;almost&quot; vs &quot;building&quot; on a chapter.
            Changes apply immediately (next readiness query reads the new row).
          </p>
          {data.config.updated_at && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              Last updated {new Date(data.config.updated_at).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div style={{ ...S.card, background: 'color-mix(in srgb, var(--danger) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)', marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ ...S.card, background: 'color-mix(in srgb, var(--success) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)', color: 'var(--success)', marginBottom: 16, fontSize: 13 }}>
          {success}
        </div>
      )}

      {/* Tier sections */}
      {TIER_FIELDS.map(({ tier, color, fields }) => (
        <section key={tier} style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color, marginTop: 0, marginBottom: 12 }}>
            {tier} tier
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{f.label}</span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={merged[f.key] as number}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 13,
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.hint}</span>
              </label>
            ))}
          </div>
        </section>
      ))}

      {/* Composite weights */}
      <section style={{ ...S.card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
          Composite score weights
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
          The 0–100 score on the readiness card is{' '}
          <code>w_mastery × mastery_avg + w_quiz × recent_quiz_avg + w_spaced × min(100, spaced_reviews × 10)</code>.
          The three weights must sum to 1.0.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {WEIGHT_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{f.label}</span>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={merged[f.key] as number}
                onChange={(e) => handleChange(f.key, e.target.value)}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  fontSize: 13,
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{f.hint}</span>
            </label>
          ))}
        </div>
        <p
          style={{
            fontSize: 12,
            marginTop: 12,
            color: weightSumOk ? 'var(--success)' : 'var(--danger)',
            fontWeight: 600,
          }}
          data-testid="weight-sum-indicator"
        >
          Sum: {weightSum.toFixed(3)} {weightSumOk ? '✓' : '— must equal 1.0'}
        </p>
      </section>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || !weightSumOk}
          style={{
            ...S.primaryBtn,
            opacity: !dirty || saving || !weightSumOk ? 0.5 : 1,
            cursor: !dirty || saving || !weightSumOk ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={discardChanges}
          disabled={!dirty || saving}
          style={{
            ...S.secondaryBtn,
            opacity: !dirty || saving ? 0.5 : 1,
            cursor: !dirty || saving ? 'not-allowed' : 'pointer',
          }}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={resetToDefaults}
          style={{ ...S.secondaryBtn }}
          title="Stage the original default values for review (you still need to click Save)"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

export default function ReadinessRubricPage() {
  return (
    <AdminShell>
      <ReadinessRubricContent />
    </AdminShell>
  );
}
