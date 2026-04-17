'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import StatusBadge from '../_components/StatusBadge';
import StatCard from '../_components/StatCard';
import { colors, S } from '../_components/admin-styles';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InstitutionRecord {
  id: string; name: string; board: string; city?: string; state?: string;
  principal_name?: string; email?: string; phone?: string; max_students?: number;
  max_teachers?: number; subscription_plan?: string; is_active?: boolean; created_at?: string;
  slug?: string; subdomain?: string;
  [key: string]: unknown;
}

interface HealthRecord {
  school_id: string;
  health_score: number;
  engagement_score: number;
  seat_utilization_score: number;
  quiz_activity_score: number;
  recency_score: number;
  pipeline_stage: PipelineStage;
  active_students: number;
  total_seats: number;
  price_per_seat: number;
  mrr: number;
  last_quiz_date?: string;
  last_login_date?: string;
  days_since_activity?: number;
  subscription_start?: string;
  subscription_end?: string;
}

type PipelineStage = 'lead' | 'trial' | 'active' | 'at_risk' | 'churned';

interface SchoolRow extends InstitutionRecord {
  health?: HealthRecord;
}

interface ProvisionForm {
  school_name: string;
  board: string;
  city: string;
  state: string;
  principal_name: string;
  principal_email: string;
  plan: string;
  seats: number;
  price_per_seat: number;
  admin_name: string;
  admin_email: string;
}

/* ------------------------------------------------------------------ */
/*  Pipeline constants                                                 */
/* ------------------------------------------------------------------ */

const PIPELINE_STAGES: { key: PipelineStage; label: string; color: string }[] = [
  { key: 'lead', label: 'Lead', color: '#94A3B8' },
  { key: 'trial', label: 'Trial', color: '#3B82F6' },
  { key: 'active', label: 'Active', color: '#22C55E' },
  { key: 'at_risk', label: 'At Risk', color: '#EAB308' },
  { key: 'churned', label: 'Churned', color: '#EF4444' },
];

const PIPELINE_VARIANT: Record<PipelineStage, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  lead: 'neutral',
  trial: 'info',
  active: 'success',
  at_risk: 'warning',
  churned: 'danger',
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: 'Lead',
  trial: 'Trial',
  active: 'Active',
  at_risk: 'At Risk',
  churned: 'Churned',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function healthColor(score: number): string {
  if (score >= 70) return '#22C55E';
  if (score >= 40) return '#EAB308';
  return '#EF4444';
}

function utilizationColor(used: number, total: number): string {
  if (total === 0) return colors.text3;
  const pct = (used / total) * 100;
  if (pct >= 80) return '#22C55E';
  if (pct >= 50) return '#EAB308';
  return '#EF4444';
}

const EMPTY_FORM: ProvisionForm = {
  school_name: '', board: 'CBSE', city: '', state: '',
  principal_name: '', principal_email: '',
  plan: 'trial', seats: 50, price_per_seat: 75,
  admin_name: '', admin_email: '',
};

/* ------------------------------------------------------------------ */
/*  Health Bar (small inline progress bar)                             */
/* ------------------------------------------------------------------ */

function HealthBar({ score }: { score: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 60, height: 6, borderRadius: 3, background: colors.borderLight, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, score))}%`, height: '100%',
          borderRadius: 3, background: healthColor(score), transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: healthColor(score), minWidth: 24, textAlign: 'right' }}>
        {score}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini Score Bar (drawer breakdown)                                  */
/* ------------------------------------------------------------------ */

function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.text2, marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: colors.text1 }}>{value}/100</span>
      </div>
      <div style={{ width: '100%', height: 5, borderRadius: 3, background: colors.borderLight, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, value))}%`, height: '100%',
          borderRadius: 3, background: healthColor(value), transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Circular Gauge (drawer hero)                                       */
/* ------------------------------------------------------------------ */

function CircularGauge({ score }: { score: number }) {
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const color = healthColor(score);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
      <svg width={110} height={110} viewBox="0 0 110 110">
        <circle cx={55} cy={55} r={r} fill="none" stroke={colors.borderLight} strokeWidth={8} />
        <circle
          cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circumference} strokeDashoffset={circumference - filled}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        <text x={55} y={55} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: 26, fontWeight: 800, fill: color }}>
          {score}
        </text>
      </svg>
      <span style={{ fontSize: 11, color: colors.text3, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
        Health Score
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provision Modal                                                    */
/* ------------------------------------------------------------------ */

function ProvisionModal({
  open, onClose, onSubmit, submitting,
}: { open: boolean; onClose: () => void; onSubmit: (form: ProvisionForm) => void; submitting: boolean }) {
  const [form, setForm] = useState<ProvisionForm>({ ...EMPTY_FORM });

  useEffect(() => {
    if (open) setForm({ ...EMPTY_FORM });
  }, [open]);

  if (!open) return null;

  const set = (key: keyof ProvisionForm, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const canSubmit = form.school_name.trim() && form.admin_email.trim() && form.admin_name.trim() && !submitting;

  const inputStyle: React.CSSProperties = {
    ...S.searchInput,
    width: '100%',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: colors.text2, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.8, display: 'block',
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 999,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 560, maxHeight: '90vh', overflowY: 'auto',
        background: colors.bg, borderRadius: 12, zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: `1px solid ${colors.border}`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text1, margin: 0 }}>Provision New School</h3>
          <button onClick={onClose} style={{
            background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6,
            padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: colors.text2,
          }}>Close</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: colors.text3, marginBottom: 16 }}>
            This will create the school record, subscription, and school administrator account.
          </div>

          {/* School Details */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text1, marginBottom: 10, borderBottom: `1px solid ${colors.borderLight}`, paddingBottom: 6 }}>
              School Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>School Name *</label>
                <input style={inputStyle} value={form.school_name} onChange={e => set('school_name', e.target.value)} placeholder="Delhi Public School" />
              </div>
              <div>
                <label style={labelStyle}>Board</label>
                <select style={{ ...S.select, width: '100%', boxSizing: 'border-box' as const }} value={form.board} onChange={e => set('board', e.target.value)}>
                  <option value="CBSE">CBSE</option>
                  <option value="ICSE">ICSE</option>
                  <option value="State Board">State Board</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>City</label>
                <input style={inputStyle} value={form.city} onChange={e => set('city', e.target.value)} placeholder="New Delhi" />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <input style={inputStyle} value={form.state} onChange={e => set('state', e.target.value)} placeholder="Delhi" />
              </div>
              <div>
                <label style={labelStyle}>Principal Name</label>
                <input style={inputStyle} value={form.principal_name} onChange={e => set('principal_name', e.target.value)} placeholder="Dr. Sharma" />
              </div>
              <div>
                <label style={labelStyle}>Principal Email</label>
                <input style={inputStyle} value={form.principal_email} onChange={e => set('principal_email', e.target.value)} placeholder="principal@school.edu.in" />
              </div>
            </div>
          </div>

          {/* Subscription */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text1, marginBottom: 10, borderBottom: `1px solid ${colors.borderLight}`, paddingBottom: 6 }}>
              Subscription
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Plan</label>
                <select style={{ ...S.select, width: '100%', boxSizing: 'border-box' as const }} value={form.plan} onChange={e => set('plan', e.target.value)}>
                  <option value="trial">Trial</option>
                  <option value="pro">Pro</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Seats</label>
                <input style={inputStyle} type="number" min={1} value={form.seats} onChange={e => set('seats', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label style={labelStyle}>Price / Seat (INR)</label>
                <input style={inputStyle} type="number" min={0} value={form.price_per_seat} onChange={e => set('price_per_seat', parseInt(e.target.value) || 0)} />
              </div>
            </div>
          </div>

          {/* Admin Account */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text1, marginBottom: 10, borderBottom: `1px solid ${colors.borderLight}`, paddingBottom: 6 }}>
              School Administrator Account
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Admin Name *</label>
                <input style={inputStyle} value={form.admin_name} onChange={e => set('admin_name', e.target.value)} placeholder="Rahul Verma" />
              </div>
              <div>
                <label style={labelStyle}>Admin Email *</label>
                <input style={inputStyle} value={form.admin_email} onChange={e => set('admin_email', e.target.value)} placeholder="admin@school.edu.in" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} style={S.secondaryBtn}>Cancel</button>
          <button
            onClick={() => canSubmit && onSubmit(form)}
            disabled={!canSubmit}
            style={{
              ...S.primaryBtn,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Provisioning...' : 'Provision School'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawer Info Row                                                    */
/* ------------------------------------------------------------------ */

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '7px 0',
      borderBottom: `1px solid ${colors.borderLight}`,
    }}>
      <span style={{ fontSize: 12, color: colors.text3 }}>{label}</span>
      <span style={{ fontSize: 12, color: colors.text1, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function InstitutionsContent() {
  const { apiFetch } = useAdmin();

  /* ----- state ----- */
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, HealthRecord>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [selected, setSelected] = useState<SchoolRow | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ----- fetch institutions ----- */
  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/institutions?page=${page}&limit=25`);
      if (res.ok) {
        const d = await res.json();
        setInstitutions(d.data || []);
        setTotal(d.total || 0);
      } else {
        setError('Failed to load institutions');
      }
    } catch {
      setError('Network error loading institutions');
    }
    setLoading(false);
  }, [apiFetch, page]);

  /* ----- fetch health data ----- */
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/institutions/health');
      if (res.ok) {
        const d = await res.json();
        const map: Record<string, HealthRecord> = {};
        for (const h of (d.data || [])) {
          map[h.school_id] = h;
        }
        setHealthMap(map);
      }
    } catch {
      // health data is supplementary, don't block on failure
    }
    setHealthLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchInstitutions(); }, [fetchInstitutions]);
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  /* ----- merge institution + health into SchoolRow ----- */
  const schoolRows: SchoolRow[] = institutions.map(inst => ({
    ...inst,
    health: healthMap[inst.id],
  }));

  /* ----- pipeline counts ----- */
  const pipelineCounts: Record<PipelineStage, number> = {
    lead: 0, trial: 0, active: 0, at_risk: 0, churned: 0,
  };
  for (const row of schoolRows) {
    const stage = row.health?.pipeline_stage;
    if (stage && stage in pipelineCounts) {
      pipelineCounts[stage]++;
    } else {
      // Schools without health data default to lead
      pipelineCounts.lead++;
    }
  }

  /* ----- filtered data ----- */
  const filteredRows = pipelineFilter
    ? schoolRows.filter(r => {
        const stage = r.health?.pipeline_stage || 'lead';
        return stage === pipelineFilter;
      })
    : schoolRows;

  /* ----- aggregate stats ----- */
  const totalStudents = schoolRows.reduce((sum, r) => sum + (r.health?.active_students ?? 0), 0);
  const healthScores = schoolRows.filter(r => r.health?.health_score != null).map(r => r.health!.health_score);
  const avgHealth = healthScores.length > 0
    ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length)
    : 0;
  const totalMRR = schoolRows.reduce((sum, r) => sum + (r.health?.mrr ?? 0), 0);
  const activeTrials = pipelineCounts.trial;
  const atRiskCount = schoolRows.filter(r => (r.health?.health_score ?? 100) < 60).length;

  /* ----- toggle active ----- */
  const toggleInstitution = async (inst: InstitutionRecord) => {
    await apiFetch('/api/super-admin/institutions', {
      method: 'PATCH', body: JSON.stringify({ id: inst.id, updates: { is_active: !inst.is_active } }),
    });
    fetchInstitutions();
  };

  /* ----- provision ----- */
  const handleProvision = async (form: ProvisionForm) => {
    setProvisioning(true);
    try {
      const res = await apiFetch('/api/super-admin/institutions/provision', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowProvision(false);
        fetchInstitutions();
        fetchHealth();
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Provisioning failed');
      }
    } catch {
      setError('Network error during provisioning');
    }
    setProvisioning(false);
  };

  /* ----- export CSV ----- */
  const exportCSV = () => {
    const header = 'Name,Board,City,State,Principal,Email,Plan,Status,Pipeline,Health,Students,Seats,MRR';
    const rows = schoolRows.map(r =>
      `"${r.name || ''}","${r.board || ''}","${r.city || ''}","${r.state || ''}","${r.principal_name || ''}","${r.email || ''}","${r.subscription_plan || ''}","${r.is_active !== false ? 'Active' : 'Suspended'}","${r.health?.pipeline_stage || 'lead'}","${r.health?.health_score ?? ''}","${r.health?.active_students ?? ''}","${r.health?.total_seats ?? r.max_students ?? ''}","${r.health?.mrr ?? ''}"`
    );
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'alfanumrik-school-crm.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  /* ----- build selected with health for drawer ----- */
  const openDrawer = (row: SchoolRow) => {
    setSelected(row);
  };

  /* ----- table columns ----- */
  const columns: Column<SchoolRow>[] = [
    {
      key: 'name', label: 'School',
      render: r => (
        <div>
          <strong style={{ color: colors.text1, fontSize: 13 }}>{r.name || '—'}</strong>
          {r.board && <div style={{ fontSize: 11, color: colors.text3 }}>{r.board}</div>}
        </div>
      ),
    },
    { key: 'city', label: 'City', render: r => <span style={{ fontSize: 12 }}>{r.city || '—'}</span> },
    {
      key: 'health_score', label: 'Health',
      render: r => r.health ? <HealthBar score={r.health.health_score} /> : (
        <span style={{ fontSize: 11, color: colors.text3 }}>{healthLoading ? '...' : '—'}</span>
      ),
    },
    {
      key: 'students_seats', label: 'Students / Seats', sortable: false,
      render: r => {
        const active = r.health?.active_students ?? 0;
        const seats = r.health?.total_seats ?? r.max_students ?? 0;
        return (
          <span style={{ fontSize: 12, fontWeight: 600, color: utilizationColor(active, seats) }}>
            {active}/{seats}
          </span>
        );
      },
    },
    {
      key: 'subscription_plan', label: 'Plan',
      render: r => (
        <StatusBadge
          label={r.subscription_plan || 'free'}
          variant={r.subscription_plan && r.subscription_plan !== 'free' ? 'info' : 'neutral'}
        />
      ),
    },
    {
      key: 'is_active', label: 'Status',
      render: r => (
        <StatusBadge
          label={r.is_active !== false ? 'Active' : 'Suspended'}
          variant={r.is_active !== false ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'pipeline_stage', label: 'Pipeline',
      render: r => {
        const stage = r.health?.pipeline_stage || 'lead';
        return <StatusBadge label={STAGE_LABELS[stage]} variant={PIPELINE_VARIANT[stage]} />;
      },
    },
    {
      key: '_actions', label: 'Actions', sortable: false,
      render: r => (
        <button
          onClick={e => { e.stopPropagation(); toggleInstitution(r); }}
          style={{
            ...S.actionBtn,
            color: r.is_active !== false ? colors.danger : colors.success,
            borderColor: r.is_active !== false ? colors.danger : colors.success,
          }}
        >
          {r.is_active !== false ? 'Suspend' : 'Activate'}
        </button>
      ),
    },
  ];

  /* ----- drawer content ----- */
  const h = selected?.health;

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: colors.dangerLight, color: colors.danger, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'none', border: 'none', color: colors.danger,
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
          }}>x</button>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={S.h1}>School CRM</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Manage school lifecycle, health, and billing
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowProvision(true)} style={S.primaryBtn}>
            Provision School
          </button>
          <button onClick={exportCSV} style={S.secondaryBtn}>Export CSV</button>
        </div>
      </div>

      {/* Pipeline View */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 24,
        border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden',
      }}>
        {PIPELINE_STAGES.map((stage, idx) => {
          const count = pipelineCounts[stage.key];
          const isActive = pipelineFilter === stage.key;
          return (
            <div
              key={stage.key}
              onClick={() => setPipelineFilter(isActive ? null : stage.key)}
              style={{
                flex: 1,
                padding: '14px 16px',
                cursor: 'pointer',
                background: isActive ? stage.color + '12' : colors.bg,
                borderRight: idx < PIPELINE_STAGES.length - 1 ? `1px solid ${colors.border}` : 'none',
                borderBottom: isActive ? `2px solid ${stage.color}` : '2px solid transparent',
                textAlign: 'center',
                transition: 'background 0.15s, border-bottom 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = colors.surfaceHover; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? stage.color + '12' : colors.bg; }}
            >
              <div style={{
                fontSize: 24, fontWeight: 800, color: stage.color,
                lineHeight: 1.1,
              }}>
                {count}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: isActive ? stage.color : colors.text3,
                textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
              }}>
                {stage.label}
              </div>
              {/* Arrow connector */}
              {idx < PIPELINE_STAGES.length - 1 && (
                <span style={{
                  position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, color: colors.text3, zIndex: 1,
                }}>
                  &#9654;
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pipeline filter indicator */}
      {pipelineFilter && (
        <div style={{
          marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 12, color: colors.text3 }}>
            Filtered by: <strong style={{ color: colors.text1 }}>{STAGE_LABELS[pipelineFilter]}</strong>
          </span>
          <button onClick={() => setPipelineFilter(null)} style={{
            ...S.actionBtn, fontSize: 11, padding: '2px 8px',
          }}>Clear</button>
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Schools" value={total} icon="&#9875;" accentColor={colors.accent} />
        <StatCard label="Total Students" value={totalStudents} icon="&#9733;" accentColor={colors.success} />
        <StatCard
          label="Avg Health"
          value={avgHealth}
          icon="&#9829;"
          accentColor={healthColor(avgHealth)}
          subtitle={healthScores.length > 0 ? `across ${healthScores.length} schools` : 'no data'}
        />
        <StatCard
          label="MRR"
          value={`₹${totalMRR.toLocaleString('en-IN')}`}
          icon="&#8377;"
          accentColor={colors.accent}
        />
        <StatCard label="Active Trials" value={activeTrials} icon="&#9711;" accentColor="#3B82F6" />
        <StatCard label="At Risk" value={atRiskCount} icon="&#9888;" accentColor="#EAB308" />
      </div>

      {/* School count */}
      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>
        {pipelineFilter ? `${filteredRows.length} schools in ${STAGE_LABELS[pipelineFilter]}` : `${total} schools found`}
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredRows}
        keyField="id"
        onRowClick={openDrawer}
        loading={loading}
        emptyMessage={pipelineFilter ? `No schools in ${STAGE_LABELS[pipelineFilter]} stage` : 'No schools onboarded yet'}
      />

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>
          Page {page} of {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button disabled={institutions.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      {/* Provision Modal */}
      <ProvisionModal
        open={showProvision}
        onClose={() => setShowProvision(false)}
        onSubmit={handleProvision}
        submitting={provisioning}
      />

      {/* Detail Drawer */}
      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || 'School Details'}
        width={520}
      >
        {selected && (
          <div>
            {/* Health Gauge */}
            {h ? (
              <CircularGauge score={h.health_score} />
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: colors.text3, fontSize: 13 }}>
                {healthLoading ? 'Loading health data...' : 'No health data available'}
              </div>
            )}

            {/* Score Breakdown */}
            {h && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Score Breakdown
                </div>
                <MiniBar label="Engagement" value={h.engagement_score} />
                <MiniBar label="Seat Utilization" value={h.seat_utilization_score} />
                <MiniBar label="Quiz Activity" value={h.quiz_activity_score} />
                <MiniBar label="Recency" value={h.recency_score} />
              </div>
            )}

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button
                onClick={e => { e.stopPropagation(); toggleInstitution(selected); setSelected(null); }}
                style={{
                  ...S.actionBtn,
                  color: selected.is_active !== false ? colors.danger : colors.success,
                  borderColor: selected.is_active !== false ? colors.danger : colors.success,
                  padding: '6px 14px',
                }}
              >
                {selected.is_active !== false ? 'Suspend' : 'Activate'}
              </button>
              {selected.slug && (
                <button
                  onClick={() => window.open(`/super-admin/view-as?school=${selected.slug}`, '_blank')}
                  style={{ ...S.actionBtn, padding: '6px 14px' }}
                >
                  View as Admin
                </button>
              )}
            </div>

            {/* School Info */}
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                School Info
              </div>
              <InfoRow label="Name" value={selected.name} />
              <InfoRow label="Board" value={selected.board} />
              <InfoRow label="City" value={selected.city || '—'} />
              <InfoRow label="State" value={selected.state || '—'} />
              <InfoRow label="Principal" value={selected.principal_name || '—'} />
              <InfoRow label="Email" value={selected.email || '—'} />
              {selected.slug && <InfoRow label="Slug" value={selected.slug} />}
              {selected.subdomain && (
                <InfoRow label="Subdomain" value={
                  <a href={`https://${selected.subdomain}.alfanumrik.com`} target="_blank" rel="noopener noreferrer"
                    style={{ color: colors.accent, textDecoration: 'none', fontSize: 12 }}>
                    {selected.subdomain}.alfanumrik.com
                  </a>
                } />
              )}
              <InfoRow label="Status" value={
                <StatusBadge
                  label={selected.is_active !== false ? 'Active' : 'Suspended'}
                  variant={selected.is_active !== false ? 'success' : 'danger'}
                />
              } />
              <InfoRow label="Pipeline" value={
                <StatusBadge
                  label={STAGE_LABELS[h?.pipeline_stage || 'lead']}
                  variant={PIPELINE_VARIANT[h?.pipeline_stage || 'lead']}
                />
              } />
            </div>

            {/* Subscription */}
            {h && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Subscription
                </div>
                <InfoRow label="Plan" value={selected.subscription_plan || 'free'} />
                <InfoRow label="Seats" value={`${h.active_students} used / ${h.total_seats} total`} />
                <InfoRow label="Price / Seat" value={`₹${h.price_per_seat}`} />
                <InfoRow label="MRR" value={
                  <span style={{ fontWeight: 700, color: colors.text1 }}>₹{h.mrr.toLocaleString('en-IN')}</span>
                } />
                {h.subscription_start && (
                  <InfoRow label="Period" value={
                    `${new Date(h.subscription_start).toLocaleDateString('en-IN')}${h.subscription_end ? ` — ${new Date(h.subscription_end).toLocaleDateString('en-IN')}` : ''}`
                  } />
                )}
              </div>
            )}

            {/* Activity */}
            {h && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Activity
                </div>
                <InfoRow label="Last Quiz" value={
                  h.last_quiz_date ? new Date(h.last_quiz_date).toLocaleDateString('en-IN') : '—'
                } />
                <InfoRow label="Last Login" value={
                  h.last_login_date ? new Date(h.last_login_date).toLocaleDateString('en-IN') : '—'
                } />
                <InfoRow label="Days Since Activity" value={
                  h.days_since_activity != null ? (
                    <span style={{
                      color: h.days_since_activity > 14 ? colors.danger : h.days_since_activity > 7 ? colors.warning : colors.success,
                      fontWeight: 600,
                    }}>
                      {h.days_since_activity} days
                    </span>
                  ) : '—'
                } />
              </div>
            )}

            {/* ID */}
            <div style={{ marginTop: 16, fontSize: 10, color: colors.text3 }}>
              ID: <code style={{ fontSize: 10 }}>{selected.id}</code>
            </div>
            {selected.created_at && (
              <div style={{ fontSize: 10, color: colors.text3, marginTop: 4 }}>
                Created: {new Date(selected.created_at).toLocaleDateString('en-IN')}
              </div>
            )}
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export default function InstitutionsPage() {
  return <AdminShell><InstitutionsContent /></AdminShell>;
}
