'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

// ── Types ─────────────────────────────────────────────────────
interface Subject {
  code: string;
  name: string;
  name_hi: string | null;
  icon: string | null;
  color: string | null;
  subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  is_active: boolean;
  display_order: number;
  [key: string]: unknown;
}

interface FormState {
  code: string;
  name: string;
  name_hi: string;
  icon: string;
  color: string;
  subject_kind: Subject['subject_kind'];
  display_order: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  name_hi: '',
  icon: '',
  color: '',
  subject_kind: 'cbse_core',
  display_order: '0',
  is_active: true,
};

const KIND_VARIANT: Record<Subject['subject_kind'], 'info' | 'warning' | 'neutral'> = {
  cbse_core: 'info',
  cbse_elective: 'warning',
  platform_elective: 'neutral',
};

function SubjectsContent() {
  const { apiFetch } = useAdmin();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Subject | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // ── Data load ──
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/super-admin/subjects');
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSubjects(data.data || data.subjects || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Form helpers ──
  const openEdit = (row: Subject) => {
    setEditing(row);
    setCreating(false);
    setSaveError('');
    setForm({
      code: row.code,
      name: row.name,
      name_hi: row.name_hi || '',
      icon: row.icon || '',
      color: row.color || '',
      subject_kind: row.subject_kind,
      display_order: String(row.display_order ?? 0),
      is_active: row.is_active,
    });
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setSaveError('');
    setForm(EMPTY_FORM);
  };

  const closeDrawer = () => {
    setEditing(null);
    setCreating(false);
    setSaveError('');
  };

  const drawerOpen = creating || editing != null;

  // ── Save / delete ──
  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        name_hi: form.name_hi.trim() || null,
        icon: form.icon.trim() || null,
        color: form.color.trim() || null,
        subject_kind: form.subject_kind,
        display_order: parseInt(form.display_order, 10) || 0,
        is_active: form.is_active,
      };
      let res: Response;
      if (creating) {
        res = await apiFetch('/api/super-admin/subjects', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else if (editing) {
        const { code: _omit, ...patch } = payload;
        res = await apiFetch(`/api/super-admin/subjects/${encodeURIComponent(editing.code)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      } else {
        return;
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      closeDrawer();
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async () => {
    if (!editing) return;
    if (!confirm(`Mark subject "${editing.code}" as inactive? This is a soft delete.`)) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/super-admin/subjects/${encodeURIComponent(editing.code)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      closeDrawer();
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Columns ──
  const columns: Column<Subject>[] = [
    { key: 'code', label: 'Code', width: 160, render: (r) => <code style={{ fontSize: 12, color: colors.text1 }}>{r.code}</code> },
    { key: 'name', label: 'Name (EN)' },
    { key: 'name_hi', label: 'Name (HI)', render: (r) => r.name_hi || <span style={{ color: colors.text3 }}>—</span> },
    {
      key: 'icon',
      label: 'Icon',
      width: 60,
      render: (r) => <span style={{ fontSize: 18 }}>{r.icon || '·'}</span>,
    },
    {
      key: 'color',
      label: 'Color',
      width: 90,
      render: (r) =>
        r.color ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden
              style={{
                display: 'inline-block', width: 14, height: 14, borderRadius: 4,
                background: r.color, border: `1px solid ${colors.border}`,
              }}
            />
            <code style={{ fontSize: 11, color: colors.text2 }}>{r.color}</code>
          </span>
        ) : (
          <span style={{ color: colors.text3 }}>—</span>
        ),
    },
    {
      key: 'subject_kind',
      label: 'Kind',
      width: 150,
      render: (r) => <StatusBadge label={r.subject_kind} variant={KIND_VARIANT[r.subject_kind] || 'neutral'} />,
    },
    {
      key: 'is_active',
      label: 'Status',
      width: 90,
      render: (r) => <StatusBadge label={r.is_active ? 'active' : 'inactive'} variant={r.is_active ? 'success' : 'neutral'} />,
    },
    { key: 'display_order', label: 'Order', width: 80 },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>Subjects</h1>
          <div style={S.subtitle}>
            Master catalog of all subjects. Changes are logged to <code style={{ fontSize: 12 }}>admin_audit_log</code>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.secondaryBtn} onClick={() => load()} disabled={loading}>
            Refresh
          </button>
          <button style={S.primaryBtn} onClick={openCreate}>
            + New subject
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: 12, marginBottom: 16, borderRadius: 8,
            border: `1px solid ${colors.danger}`, background: colors.dangerLight,
            color: colors.danger, fontSize: 13,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>Error loading subjects: {error}</span>
          <button style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }} onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <DataTable
        columns={columns}
        data={subjects}
        keyField="code"
        loading={loading}
        onRowClick={openEdit}
        emptyMessage="No subjects yet. Click + New subject to seed the catalog."
      />

      {/* Drawer */}
      <DetailDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={creating ? 'New Subject' : `Edit: ${editing?.code ?? ''}`}
        width={520}
      >
        <div ref={drawerRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Code" required hint={creating ? 'snake_case, immutable after creation' : 'Cannot change after creation'}>
            <input
              style={S.searchInput}
              value={form.code}
              disabled={!creating}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="math"
              aria-label="Subject code"
            />
          </Field>

          <Field label="Name (English)" required>
            <input
              style={S.searchInput}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Mathematics"
              aria-label="Subject name English"
            />
          </Field>

          <Field label="Name (Hindi)">
            <input
              style={S.searchInput}
              value={form.name_hi}
              onChange={(e) => setForm({ ...form, name_hi: e.target.value })}
              placeholder="गणित"
              aria-label="Subject name Hindi"
            />
          </Field>

          <Field label="Icon">
            <input
              style={S.searchInput}
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="🧮 (emoji or symbol)"
              aria-label="Subject icon"
            />
          </Field>

          <Field label="Color">
            <input
              style={S.searchInput}
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              placeholder="#F97316"
              aria-label="Subject color hex"
            />
          </Field>

          <Field label="Subject kind" required>
            <select
              style={S.select}
              value={form.subject_kind}
              onChange={(e) => setForm({ ...form, subject_kind: e.target.value as Subject['subject_kind'] })}
              aria-label="Subject kind"
            >
              <option value="cbse_core">cbse_core</option>
              <option value="cbse_elective">cbse_elective</option>
              <option value="platform_elective">platform_elective</option>
            </select>
          </Field>

          <Field label="Display order">
            <input
              style={S.searchInput}
              type="number"
              value={form.display_order}
              onChange={(e) => setForm({ ...form, display_order: e.target.value })}
              aria-label="Display order"
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text1 }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span>Active (visible to students within their grade and plan)</span>
          </label>

          {saveError && (
            <div role="alert" style={{
              padding: 10, borderRadius: 6, border: `1px solid ${colors.danger}`,
              background: colors.dangerLight, color: colors.danger, fontSize: 12,
            }}>
              {saveError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {!creating && editing && (
              <button style={S.dangerBtn} onClick={softDelete} disabled={saving}>
                Soft-delete (mark inactive)
              </button>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={S.secondaryBtn} onClick={closeDrawer} disabled={saving}>
                Cancel
              </button>
              <button
                style={S.primaryBtn}
                onClick={save}
                disabled={saving || !form.code.trim() || !form.name.trim()}
              >
                {saving ? 'Saving…' : creating ? 'Create' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </DetailDrawer>
    </div>
  );
}

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: colors.text2 }}>
        {label}{required && <span style={{ color: colors.danger }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: colors.text3 }}>{hint}</span>}
    </label>
  );
}

export default function SubjectsPage() {
  return (
    <AdminShell>
      <SubjectsContent />
    </AdminShell>
  );
}
