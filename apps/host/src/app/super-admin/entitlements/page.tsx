'use client';

/**
 * /super-admin/entitlements — Per-school deal-driven Entitlements editor.
 *
 * Lets an ops operator configure the deal-specific entitlement overrides for ONE
 * school: turn modules / features on or off, set per-day limits, attach the
 * overrides to a contract, and preview the resolved (effective) value before the
 * runtime enforcement flag (ff_institution_entitlements_v1) is even enabled.
 *
 * Binds to GET / PUT /api/super-admin/entitlements (auth: authorizeAdmin →
 * Bearer token; we use the AdminShell `apiFetch` so the Authorization header is
 * attached — the SAME pattern /super-admin/institutions uses).
 *
 * OWNERSHIP: frontend owns this page's layout / states / i18n. Ops owns WHICH
 * keys exist and what they mean (the catalog); backend owns the resolver + API.
 * This page renders, it does not define entitlement policy.
 *
 * SPARSE WRITES: only dirty rows go into PUT changes[]. A row reverted to
 * "inherit" sends { key, _delete: true }; a row with a set value sends
 * { key, value }. On success we re-read from the server response and discard
 * local edits (the server is the source of truth for the re-resolved set).
 *
 * P7: every user-facing string is bilingual via AuthContext.isHi. Technical /
 * brand terms (Foxy, LMS, XP, CBSE, contract numbers, plan codes) are not
 * translated.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { StatusBadge } from '@alfanumrik/ui/admin-ui';
import {
  ENTITLEMENT_CATALOG,
  UNLIMITED_SENTINEL,
  type EntitlementCategory,
  type EntitlementValue,
} from '@alfanumrik/lib/entitlements/catalog';

/* ------------------------------------------------------------------ */
/*  Server contract types (mirror /api/super-admin/entitlements)       */
/* ------------------------------------------------------------------ */

interface ContractSummary {
  id: string;
  contract_number: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  billing_cycle: string | null;
  seats_purchased: number | null;
  value_inr: number | null;
}

interface OverrideValue {
  value: EntitlementValue;
  contract_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

interface PanelRow {
  key: string;
  category: EntitlementCategory;
  control: 'toggle' | 'number_period';
  valueShape: 'enabled' | 'max_period';
  labelEn: string;
  labelHi: string;
  parentModuleKey: string | null;
  planDefault: EntitlementValue;
  override: OverrideValue | null;
  effective: EntitlementValue;
  effectiveEnabled: boolean | null;
  effectiveMax: number | null;
  resolved_by: string;
  force_disabled_warning: boolean;
}

interface PanelData {
  school_id: string;
  plan: string;
  contract: ContractSummary | null;
  rows: PanelRow[];
}

interface SchoolOption {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Dirty-edit model (client-local, sparse)                            */
/* ------------------------------------------------------------------ */

/**
 * A pending edit for one key. Either a set (new value) or a revert-to-inherit
 * (_delete). Absent from the map ⇒ the row is clean (matches the server).
 */
type PendingEdit =
  | { kind: 'set'; value: EntitlementValue }
  | { kind: 'delete' };

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const CATEGORY_ORDER: EntitlementCategory[] = ['module', 'feature', 'limit'];

function sectionTitle(cat: EntitlementCategory, isHi: boolean): string {
  if (cat === 'module') return isHi ? 'मॉड्यूल' : 'Modules';
  if (cat === 'feature') return isHi ? 'फ़ीचर' : 'Features';
  return isHi ? 'सीमाएँ' : 'Limits';
}

/** Bilingual label: Hindi when isHi and present, else English. Brand/technical
 *  terms inside the labels are not translated (handled in the catalog). */
function rowLabel(row: PanelRow, isHi: boolean): string {
  return isHi && row.labelHi ? row.labelHi : row.labelEn;
}

function isEnabledValue(v: EntitlementValue): v is { enabled: boolean } {
  return typeof (v as { enabled?: unknown }).enabled === 'boolean';
}

function isMaxPeriodValue(
  v: EntitlementValue,
): v is { max: number | null; period: 'day' | 'week' | 'month' } {
  const o = v as unknown as Record<string, unknown>;
  return 'max' in o && 'period' in o;
}

/** "Default: On / Off" or "Default: 30 / day" / "Default: Unlimited". */
function planDefaultLabel(row: PanelRow, isHi: boolean): string {
  const prefix = isHi ? 'डिफ़ॉल्ट' : 'Default';
  if (isEnabledValue(row.planDefault)) {
    const on = row.planDefault.enabled;
    return `${prefix}: ${on ? (isHi ? 'चालू' : 'On') : isHi ? 'बंद' : 'Off'}`;
  }
  if (isMaxPeriodValue(row.planDefault)) {
    const { max } = row.planDefault;
    if (max === null) return `${prefix}: ${isHi ? 'असीमित' : 'Unlimited'}`;
    // The 2 live limits are per-day; render the fixed period label.
    return `${prefix}: ${max} / ${isHi ? 'दिन' : 'day'}`;
  }
  return prefix;
}

/** What the effective preview should read for this row, accounting for a pending
 *  edit. A pending edit changes the OVERRIDE layer only — but module/feature
 *  parent→child force-off can't be recomputed client-side, so when the row is
 *  force-disabled we always show the server's effective off and never let an
 *  edit appear to "turn it on". */
function effectivePreview(
  row: PanelRow,
  pending: PendingEdit | undefined,
  isHi: boolean,
): string {
  const on = isHi ? 'चालू' : 'On';
  const off = isHi ? 'बंद' : 'Off';
  const unlimited = isHi ? 'असीमित' : 'Unlimited';
  const perDay = isHi ? 'दिन' : 'day';

  // Force-disabled rows are pinned off regardless of any local edit — the
  // server is the only authority on parent→child / platform force-off.
  if (row.force_disabled_warning) {
    return row.control === 'toggle' ? off : `0 / ${perDay}`;
  }

  // Resolve the value the override layer would carry after this edit.
  // No pending edit OR delete ⇒ fall back to plan default for the preview when
  // there is no server override; otherwise the server's effective is correct.
  let preview: EntitlementValue;
  if (pending?.kind === 'set') {
    preview = pending.value;
  } else if (pending?.kind === 'delete') {
    // Reverting to inherit ⇒ the plan default becomes effective (parent force-off
    // already handled above).
    preview = row.planDefault;
  } else {
    preview = row.effective;
  }

  if (isEnabledValue(preview)) return preview.enabled ? on : off;
  if (isMaxPeriodValue(preview)) {
    return preview.max === null ? unlimited : `${preview.max} / ${perDay}`;
  }
  return off;
}

/* ------------------------------------------------------------------ */
/*  Page shell                                                         */
/* ------------------------------------------------------------------ */

export default function EntitlementsPage() {
  return (
    <AdminShell>
      <EntitlementsContent />
    </AdminShell>
  );
}

function EntitlementsContent() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();

  /* ----- school picker ----- */
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string>('');

  /* ----- panel data ----- */
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ----- editing ----- */
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  const [attachToContract, setAttachToContract] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  /* ----- load school list for the picker ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSchoolsLoading(true);
      try {
        const res = await apiFetch('/api/super-admin/institutions?page=1&limit=100');
        if (res.ok) {
          const body = await res.json();
          if (!cancelled) {
            const opts: SchoolOption[] = (body.data || []).map(
              (s: { id: string; name: string }) => ({ id: s.id, name: s.name }),
            );
            setSchools(opts);
          }
        }
      } catch {
        /* picker is best-effort; the operator can still paste a UUID via the URL */
      } finally {
        if (!cancelled) setSchoolsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  /* ----- load the entitlement set for the selected school ----- */
  const loadPanel = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      setError(null);
      setPending({});
      setAttachToContract(false);
      try {
        const res = await apiFetch(`/api/super-admin/entitlements?school_id=${encodeURIComponent(id)}`);
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setData(body.data as PanelData);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    if (schoolId) void loadPanel(schoolId);
    else setData(null);
  }, [schoolId, loadPanel]);

  /* ----- auto-dismiss toast ----- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----- derived: rows grouped, resolved-off parent map ----- */
  const rowsByKey = useMemo(() => {
    const m = new Map<string, PanelRow>();
    for (const r of data?.rows ?? []) m.set(r.key, r);
    return m;
  }, [data]);

  /** A feature whose parent module currently resolves OFF should be greyed. We
   *  read the parent's effectiveEnabled from the server-resolved set. */
  const parentOff = useCallback(
    (row: PanelRow): { off: boolean; parentLabel: string } => {
      if (!row.parentModuleKey) return { off: false, parentLabel: '' };
      const parent = rowsByKey.get(row.parentModuleKey);
      if (!parent) return { off: false, parentLabel: '' };
      return {
        off: parent.effectiveEnabled === false,
        parentLabel: rowLabel(parent, isHi),
      };
    },
    [rowsByKey, isHi],
  );

  const dirtyCount = Object.keys(pending).length;

  /* ----- edit actions ----- */
  const setToggle = useCallback((key: string, enabled: boolean) => {
    setPending(prev => ({ ...prev, [key]: { kind: 'set', value: { enabled } } }));
  }, []);

  const setLimit = useCallback((key: string, max: number | null) => {
    // Period is fixed 'day' for the 2 live limits (number_period control).
    setPending(prev => ({ ...prev, [key]: { kind: 'set', value: { max, period: 'day' } } }));
  }, []);

  const revertToInherit = useCallback((row: PanelRow) => {
    setPending(prev => {
      const next = { ...prev };
      // If the row had no server override and no pending edit, reverting is a
      // no-op — just clear any local edit. If it HAS a server override, queue a
      // delete so the PUT removes it.
      if (row.override) {
        next[row.key] = { kind: 'delete' };
      } else {
        delete next[row.key];
      }
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setPending({});
    setAttachToContract(false);
  }, []);

  /* ----- current displayed value for a control (pending overrides server) --- */
  const currentToggle = useCallback(
    (row: PanelRow): boolean => {
      const p = pending[row.key];
      if (p?.kind === 'set' && isEnabledValue(p.value)) return p.value.enabled;
      if (p?.kind === 'delete') {
        // reverting to inherit ⇒ show plan default
        return isEnabledValue(row.planDefault) ? row.planDefault.enabled : false;
      }
      return row.effectiveEnabled ?? false;
    },
    [pending],
  );

  const currentLimit = useCallback(
    (row: PanelRow): { max: number | null } => {
      const p = pending[row.key];
      if (p?.kind === 'set' && isMaxPeriodValue(p.value)) return { max: p.value.max };
      if (p?.kind === 'delete') {
        return { max: isMaxPeriodValue(row.planDefault) ? row.planDefault.max : null };
      }
      // server effective: effectiveMax === UNLIMITED_SENTINEL ⇒ unlimited (null)
      if (row.effectiveMax === null) return { max: null };
      return { max: row.effectiveMax === UNLIMITED_SENTINEL ? null : row.effectiveMax };
    },
    [pending],
  );

  /* ----- state-chip variant ----- */
  function stateChip(row: PanelRow): { label: string; variant: 'info' | 'neutral' } {
    const p = pending[row.key];
    // Effective override state AFTER pending edits.
    let hasOverride: boolean;
    if (p?.kind === 'set') hasOverride = true;
    else if (p?.kind === 'delete') hasOverride = false;
    else hasOverride = row.override !== null;
    return hasOverride
      ? { label: isHi ? 'ओवरराइड' : 'Override', variant: 'info' }
      : { label: isHi ? 'इनहेरिट' : 'Inherit', variant: 'neutral' };
  }

  /* ----- save (sparse PUT) ----- */
  const save = useCallback(async () => {
    if (!data || dirtyCount === 0 || saving) return;
    setSaving(true);
    setToast(null);

    const changes = Object.entries(pending).map(([key, edit]) =>
      edit.kind === 'delete' ? { key, _delete: true as const } : { key, value: edit.value },
    );

    // Stamp contract_id only when the operator opted to attach this session's
    // writes to the linked deal.
    const contractId = attachToContract && data.contract ? data.contract.id : undefined;

    try {
      const res = await apiFetch('/api/super-admin/entitlements', {
        method: 'PUT',
        body: JSON.stringify({
          school_id: data.school_id,
          ...(contractId ? { contract_id: contractId } : {}),
          changes,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Re-read from the server response — do NOT trust local state.
      setData(body.data as PanelData);
      setPending({});
      setAttachToContract(false);
      setToast({ kind: 'ok', msg: isHi ? 'सहेजा गया' : 'Saved' });
    } catch (e) {
      // Keep dirty state so the operator can retry.
      setToast({ kind: 'err', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [data, dirtyCount, saving, pending, attachToContract, apiFetch, isHi]);

  /* ================================================================== */
  /*  Render                                                            */
  /* ================================================================== */

  return (
    <div className="pb-24">
      {/* ---- header ---- */}
      <div className="mb-5">
        <h1 className="m-0 text-lg font-bold text-foreground">
          {isHi ? 'संस्थान एंटाइटलमेंट' : 'Institution Entitlements'}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {isHi
            ? 'किसी स्कूल के डील-आधारित मॉड्यूल, फ़ीचर और सीमाएँ कॉन्फ़िगर करें।'
            : 'Configure a school’s deal-driven modules, features, and limits.'}
        </p>
      </div>

      {/* ---- school picker ---- */}
      <div className="mb-5 max-w-md">
        <label htmlFor="school-picker" className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {isHi ? 'स्कूल चुनें' : 'Select school'}
        </label>
        <select
          id="school-picker"
          value={schoolId}
          onChange={e => setSchoolId(e.target.value)}
          disabled={schoolsLoading}
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">
            {schoolsLoading
              ? isHi
                ? 'लोड हो रहा है…'
                : 'Loading…'
              : isHi
                ? '— स्कूल चुनें —'
                : '— choose a school —'}
          </option>
          {schools.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* ---- empty: no school chosen yet ---- */}
      {!schoolId && (
        <div className="rounded-lg border border-surface-3 bg-surface-2 p-6 text-center text-sm text-muted-foreground">
          {isHi
            ? 'एंटाइटलमेंट देखने और संपादित करने के लिए ऊपर एक स्कूल चुनें।'
            : 'Choose a school above to view and edit its entitlements.'}
        </div>
      )}

      {/* ---- loading skeleton ---- */}
      {schoolId && loading && <PanelSkeleton />}

      {/* ---- error ---- */}
      {schoolId && !loading && error && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--danger) 5%, transparent)',
          }}
        >
          <div className="text-sm text-danger">{error}</div>
          <button
            onClick={() => void loadPanel(schoolId)}
            className="mt-3 rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            {isHi ? 'पुनः प्रयास करें' : 'Retry'}
          </button>
        </div>
      )}

      {/* ---- loaded panel ---- */}
      {schoolId && !loading && !error && data && (
        <>
          {/* deal-context header */}
          <DealHeader
            contract={data.contract}
            plan={data.plan}
            attachToContract={attachToContract}
            setAttachToContract={setAttachToContract}
            isHi={isHi}
          />

          {/* enforcement banner */}
          <div
            className="mb-5 rounded-lg border p-3"
            style={{
              borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--warning) 5%, transparent)',
            }}
          >
            <div className="text-xs font-semibold text-warning">
              {isHi ? 'प्रवर्तन बंद है' : 'Enforcement is OFF'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {isHi
                ? 'अभी डील कॉन्फ़िगर करें — फ़्लैग सक्षम होने पर ये सक्रिय हो जाएँगी।'
                : 'Configure deals now; they activate when the flag is enabled.'}
            </div>
          </div>

          {/* all-inherit empty state */}
          {data.rows.every(r => r.override === null) && dirtyCount === 0 && (
            <div className="mb-5 rounded-lg border border-surface-3 bg-surface-2 p-3 text-[11px] text-muted-foreground">
              {isHi
                ? 'इस स्कूल के लिए कोई ओवरराइड सेट नहीं है — सब कुछ प्लान डिफ़ॉल्ट से इनहेरिट हो रहा है।'
                : 'No overrides set for this school — everything is inheriting from the plan default.'}
            </div>
          )}

          {/* grouped sections: Modules → Features → Limits */}
          {CATEGORY_ORDER.map(cat => {
            const rows = (data.rows ?? []).filter(r => r.category === cat);
            if (rows.length === 0) return null;
            return (
              <section key={cat} className="mb-6">
                <h2 className="mb-2 text-sm font-bold text-foreground">{sectionTitle(cat, isHi)}</h2>
                <div className="overflow-hidden rounded-lg border border-surface-3">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">{isHi ? 'क्षमता' : 'Capability'}</th>
                        <th className="px-3 py-2 font-semibold">{isHi ? 'ओवरराइड' : 'Override'}</th>
                        <th className="px-3 py-2 font-semibold">{isHi ? 'स्थिति' : 'State'}</th>
                        <th className="px-3 py-2 font-semibold">{isHi ? 'प्रभावी' : 'Effective'}</th>
                        <th className="px-3 py-2 font-semibold text-right">{isHi ? 'क्रिया' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <EntitlementRow
                          key={row.key}
                          row={row}
                          pending={pending[row.key]}
                          isHi={isHi}
                          parentOff={parentOff(row)}
                          stateChip={stateChip(row)}
                          currentToggle={currentToggle(row)}
                          currentLimit={currentLimit(row)}
                          onToggle={enabled => setToggle(row.key, enabled)}
                          onLimit={max => setLimit(row.key, max)}
                          onRevert={() => revertToInherit(row)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}

      {/* ---- sticky save bar ---- */}
      {data && dirtyCount > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-20 border-t border-surface-3 px-6 py-3 backdrop-blur"
          style={{ backgroundColor: 'color-mix(in srgb, var(--surface-1) 95%, transparent)' }}
        >
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4">
            <div className="text-sm font-medium text-foreground">
              {dirtyCount}{' '}
              {isHi
                ? dirtyCount === 1
                  ? 'परिवर्तन'
                  : 'परिवर्तन'
                : dirtyCount === 1
                  ? 'change'
                  : 'changes'}
              {attachToContract && data.contract && (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {isHi ? 'अनुबंध से संलग्न' : 'attached to contract'} {data.contract.contract_number || data.contract.id.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={discard}
                disabled={saving}
                className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-surface-2 disabled:opacity-50"
              >
                {isHi ? 'रद्द करें' : 'Discard'}
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (isHi ? 'सहेजा जा रहा है…' : 'Saving…') : isHi ? 'सहेजें' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- toast ---- */}
      {toast && (
        <div
          className={`fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-md px-4 py-2 text-sm font-medium shadow-lg ${
            toast.kind === 'ok' ? 'bg-success text-on-accent' : 'bg-danger text-on-accent'
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Deal-context header                                                */
/* ------------------------------------------------------------------ */

function DealHeader({
  contract,
  plan,
  attachToContract,
  setAttachToContract,
  isHi,
}: {
  contract: ContractSummary | null;
  plan: string;
  attachToContract: boolean;
  setAttachToContract: (v: boolean) => void;
  isHi: boolean;
}) {
  if (!contract) {
    return (
      <div className="mb-5 rounded-lg border border-surface-3 bg-surface-2 p-4">
        <div className="text-sm font-semibold text-foreground">
          {isHi ? 'कोई सक्रिय अनुबंध नहीं' : 'No active contract'}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {isHi
            ? 'ओवरराइड किसी डील से संलग्न नहीं होंगे।'
            : "Overrides won’t be attached to a deal."}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {/* No contract id to attach to — toggle is informational/disabled. */}
          {isHi
            ? `प्लान: ${plan}`
            : `Plan: ${plan}`}
        </div>
      </div>
    );
  }

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const fmtInr = (n: number | null) =>
    n == null ? '—' : `₹${n.toLocaleString('en-IN')}`;

  return (
    <div className="mb-5 rounded-lg border border-surface-3 bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {contract.contract_number || contract.id.slice(0, 8)}
        </span>
        {contract.status && (
          <StatusBadge
            label={contract.status}
            variant={contract.status === 'active' ? 'success' : 'neutral'}
          />
        )}
        <span className="text-[11px] text-muted-foreground">
          {isHi ? 'प्लान' : 'Plan'}: {plan}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-4">
        <Field label={isHi ? 'बिलिंग' : 'Billing'} value={contract.billing_cycle || '—'} />
        <Field
          label={isHi ? 'सीटें' : 'Seats'}
          value={contract.seats_purchased != null ? String(contract.seats_purchased) : '—'}
        />
        <Field
          label={isHi ? 'अवधि' : 'Term'}
          value={`${fmtDate(contract.start_date)} → ${fmtDate(contract.end_date)}`}
        />
        <Field label={isHi ? 'मूल्य' : 'Value'} value={fmtInr(contract.value_inr)} />
      </dl>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-foreground">
        <input
          type="checkbox"
          checked={attachToContract}
          onChange={e => setAttachToContract(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {isHi
          ? 'इस सत्र के परिवर्तनों को इस अनुबंध से संलग्न करें'
          : 'Attach this session’s changes to this contract'}
      </label>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One entitlement row                                                */
/* ------------------------------------------------------------------ */

function EntitlementRow({
  row,
  pending,
  isHi,
  parentOff,
  stateChip,
  currentToggle,
  currentLimit,
  onToggle,
  onLimit,
  onRevert,
}: {
  row: PanelRow;
  pending: PendingEdit | undefined;
  isHi: boolean;
  parentOff: { off: boolean; parentLabel: string };
  stateChip: { label: string; variant: 'info' | 'neutral' };
  currentToggle: boolean;
  currentLimit: { max: number | null };
  onToggle: (enabled: boolean) => void;
  onLimit: (max: number | null) => void;
  onRevert: () => void;
}) {
  // A feature greyed because its parent module resolves OFF. The control is
  // disabled (the operator must enable the module first).
  const greyed = parentOff.off;
  const isUnlimited = currentLimit.max === null;

  return (
    <tr className={`border-t border-surface-3 ${greyed ? 'opacity-50' : ''}`}>
      {/* capability label + plan default */}
      <td className="px-3 py-2.5 align-top">
        <div className="font-medium text-foreground">{rowLabel(row, isHi)}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{planDefaultLabel(row, isHi)}</div>
        {greyed && (
          <div className="mt-1 text-[11px] font-medium text-warning">
            {isHi ? `${parentOff.parentLabel} द्वारा अक्षम` : `Disabled by ${parentOff.parentLabel}`}
          </div>
        )}
      </td>

      {/* override control */}
      <td className="px-3 py-2.5 align-top">
        {row.control === 'toggle' ? (
          <button
            type="button"
            role="switch"
            aria-checked={currentToggle}
            disabled={greyed || row.force_disabled_warning}
            onClick={() => onToggle(!currentToggle)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
              currentToggle ? 'bg-primary' : 'bg-surface-3'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-surface-1 transition-transform ${
                currentToggle ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              disabled={greyed || isUnlimited}
              value={isUnlimited ? '' : String(currentLimit.max ?? '')}
              onChange={e => {
                const raw = e.target.value;
                if (raw === '') return; // keep last value; blank handled by Unlimited
                const n = Math.max(0, Math.floor(Number(raw)));
                if (Number.isFinite(n)) onLimit(n);
              }}
              placeholder={isUnlimited ? (isHi ? 'असीमित' : 'Unlimited') : '0'}
              className="w-20 rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            />
            {/* period is fixed 'day' for the 2 live limits — locked label */}
            <span className="text-[11px] text-muted-foreground">/ {isHi ? 'दिन' : 'day'}</span>
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
              <input
                type="checkbox"
                checked={isUnlimited}
                disabled={greyed}
                onChange={e => onLimit(e.target.checked ? null : 0)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {isHi ? 'असीमित' : 'Unlimited'}
            </label>
          </div>
        )}
      </td>

      {/* state chip */}
      <td className="px-3 py-2.5 align-top">
        <StatusBadge label={stateChip.label} variant={stateChip.variant} />
      </td>

      {/* effective preview + warning */}
      <td className="px-3 py-2.5 align-top">
        <div className="font-medium text-foreground">{effectivePreview(row, pending, isHi)}</div>
        {row.force_disabled_warning && (
          <div className="mt-1">
            <StatusBadge
              label={
                row.category === 'module'
                  ? isHi
                    ? 'प्लेटफ़ॉर्म-व्यापी अक्षम'
                    : 'Force-disabled platform-wide'
                  : isHi
                    ? 'मूल मॉड्यूल बंद'
                    : 'Parent module off'
              }
              variant="warning"
            />
          </div>
        )}
      </td>

      {/* revert-to-inherit */}
      <td className="px-3 py-2.5 text-right align-top">
        <button
          type="button"
          onClick={onRevert}
          disabled={stateChip.label === (isHi ? 'इनहेरिट' : 'Inherit')}
          className="rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2 disabled:opacity-40"
          title={isHi ? 'प्लान डिफ़ॉल्ट पर लौटें' : 'Revert to inherit'}
        >
          {isHi ? 'इनहेरिट पर लौटें' : 'Revert to inherit'}
        </button>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-24 rounded-lg bg-surface-2" />
      <div className="h-12 rounded-lg bg-surface-2" />
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-24 rounded bg-surface-2" />
          <div className="h-32 rounded-lg bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
