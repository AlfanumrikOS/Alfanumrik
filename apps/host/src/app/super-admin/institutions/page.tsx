'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import {
  StatCard,
  StatusBadge,
  DataTable,
  DetailDrawer,
  type Column,
} from '@alfanumrik/ui/admin-ui';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TenantType = 'school' | 'coaching' | 'corporate' | 'government';

interface ProvisionResult {
  school_id: string;
  slug: string;
  subdomain: string;
  invite_code: string;
  admin_invite_sent: boolean;
  warn?: string;
}

interface InstitutionRecord {
  id: string; name: string; board: string; city?: string; state?: string;
  principal_name?: string; email?: string; phone?: string; max_students?: number;
  max_teachers?: number; subscription_plan?: string; is_active?: boolean; created_at?: string;
  slug?: string; subdomain?: string;
  // Phase B fields surfaced by /api/super-admin/institutions GET (see route.ts).
  // tenant_type is editable from this page (super-admin owns the change);
  // typography fields are display-only here — school admin owns them via
  // /school-admin/branding (#563).
  tenant_type?: TenantType;
  font_heading?: string | null;
  font_body?: string | null;
  border_radius_px?: number | null;
  custom_domain?: string | null;
  domain_verified?: boolean | null;
  // Pause audit columns — only populated when is_active=false.
  // Exposed by /api/super-admin/institutions when that endpoint adds them
  // to its select list; meanwhile the drawer renders defensively (NULL
  // means "we don't know the pause context yet, just show the badge").
  paused_at?: string | null;
  pause_reason?: string | null;
  paused_by_super_admin_id?: string | null;
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
  if (total === 0) return '#9CA3AF';
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
        width: 60, height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: '#111827' }}>{value}/100</span>
      </div>
      <div style={{ width: '100%', height: 5, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
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
        <circle cx={55} cy={55} r={r} fill="none" stroke={'#F3F4F6'} strokeWidth={8} />
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
      <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
        Health Score
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provision Modal                                                    */
/* ------------------------------------------------------------------ */

function ProvisionModal({
  open, onClose, onSubmit, submitting, result, onDone,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ProvisionForm) => void;
  submitting: boolean;
  result: ProvisionResult | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ProvisionForm>({ ...EMPTY_FORM });
  const [copied, setCopied] = useState<'subdomain' | 'invite' | null>(null);

  useEffect(() => {
    if (open && !result) setForm({ ...EMPTY_FORM });
  }, [open, result]);

  if (!open) return null;

  const set = (key: keyof ProvisionForm, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const canSubmit = form.school_name.trim() && form.admin_email.trim() && form.admin_name.trim() && !submitting;

  const copyToClipboard = (text: string, which: 'subdomain' | 'invite') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {/* clipboard denied — silent fail */});
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
    color: '#111827',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.8, display: 'block',
  };

  /* ---------- success state ---------- */
  if (result) {
    const subdomainUrl = `${result.slug}.alfanumrik.com`;
    return (
      <>
        <div onClick={onDone} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 999,
        }} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 520, maxHeight: '90vh', overflowY: 'auto',
          background: '#FFFFFF', borderRadius: 12, zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: '1px solid #E5E7EB',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid #E5E7EB',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#16A34A', margin: 0 }}>
              School created!
            </h3>
            <button onClick={onDone} style={{
              background: 'none', border: '1px solid #E5E7EB', borderRadius: 6,
              padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: '#6B7280',
            }}>Close</button>
          </div>

          {/* Body */}
          <div style={{ padding: 20 }}>
            {/* Invite email status */}
            {result.warn ? (
              <div style={{
                padding: 12, marginBottom: 16, borderRadius: 6,
                background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
                fontSize: 12, lineHeight: 1.5,
              }}>
                Invite email failed — share the invite code manually.
              </div>
            ) : result.admin_invite_sent ? (
              <div style={{
                padding: 12, marginBottom: 16, borderRadius: 6,
                background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534',
                fontSize: 12, lineHeight: 1.5,
              }}>
                Admin invite email sent successfully.
              </div>
            ) : null}

            {/* Subdomain */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                Subdomain
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #E5E7EB', background: '#F9FAFB',
                  fontFamily: 'monospace', fontSize: 13, color: '#111827',
                }}>
                  {subdomainUrl}
                </div>
                <button
                  onClick={() => copyToClipboard(subdomainUrl, 'subdomain')}
                  style={{
                    padding: '8px 14px', borderRadius: 6, border: '1px solid #E5E7EB',
                    background: '#FFFFFF', fontSize: 12, cursor: 'pointer',
                    color: copied === 'subdomain' ? '#16A34A' : '#6B7280',
                    fontWeight: 500, whiteSpace: 'nowrap',
                  }}
                >
                  {copied === 'subdomain' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Invite code */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                Admin Invite Code
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1, padding: '10px 14px', borderRadius: 6,
                  border: '2px solid #E5E7EB', background: '#F9FAFB',
                  fontFamily: 'monospace', fontSize: 16, fontWeight: 700,
                  color: '#111827', letterSpacing: 2,
                }}>
                  {result.invite_code}
                </div>
                <button
                  onClick={() => copyToClipboard(result.invite_code, 'invite')}
                  style={{
                    padding: '8px 14px', borderRadius: 6, border: '1px solid #E5E7EB',
                    background: '#FFFFFF', fontSize: 12, cursor: 'pointer',
                    color: copied === 'invite' ? '#16A34A' : '#6B7280',
                    fontWeight: 500, whiteSpace: 'nowrap',
                  }}
                >
                  {copied === 'invite' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                Share this code with the school admin so they can activate their account.
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 20px', borderTop: '1px solid #E5E7EB',
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <button
              onClick={onDone}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ---------- form state ---------- */
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 999,
      }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 560, maxHeight: '90vh', overflowY: 'auto',
        background: '#FFFFFF', borderRadius: 12, zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: `1px solid ${'#E5E7EB'}`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${'#E5E7EB'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>Provision New School</h3>
          <button onClick={onClose} style={{
            background: 'none', border: `1px solid ${'#E5E7EB'}`, borderRadius: 6,
            padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: '#6B7280',
          }}>Close</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>
            This will create the school record, subscription, and school administrator account.
          </div>

          {/* School Details */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 10, borderBottom: `1px solid ${'#F3F4F6'}`, paddingBottom: 6 }}>
              School Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>School Name *</label>
                <input style={inputStyle} value={form.school_name} onChange={e => set('school_name', e.target.value)} placeholder="Delhi Public School" />
              </div>
              <div>
                <label style={labelStyle}>Board</label>
                <select className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer" style={{ boxSizing: 'border-box' as const }} value={form.board} onChange={e => set('board', e.target.value)}>
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
            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 10, borderBottom: `1px solid ${'#F3F4F6'}`, paddingBottom: 6 }}>
              Subscription
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Plan</label>
                <select className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer" style={{ boxSizing: 'border-box' as const }} value={form.plan} onChange={e => set('plan', e.target.value)}>
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
            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 10, borderBottom: `1px solid ${'#F3F4F6'}`, paddingBottom: 6 }}>
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
          padding: '12px 20px', borderTop: `1px solid ${'#E5E7EB'}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Cancel</button>
          <button
            onClick={() => canSubmit && onSubmit(form)}
            disabled={!canSubmit}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
            style={{
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
/*  Pause / Resume Modal                                               */
/*                                                                     */
/*  PostHog-style guardrail: the operator must retype the school name  */
/*  to confirm. Server enforces the same check — see                    */
/*  /api/super-admin/institutions/[id]/{pause,resume}/route.ts — so a   */
/*  malicious or buggy client can't bypass by skipping this modal.      */
/* ------------------------------------------------------------------ */

const PAUSE_REASON_MIN_LENGTH = 10;

function PauseResumeModal({
  open,
  mode,
  schoolName,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  mode: 'pause' | 'resume';
  schoolName: string;
  onClose: () => void;
  onSubmit: (args: { reason: string; expectedSchoolName: string }) => void;
  submitting: boolean;
}) {
  const [retypedName, setRetypedName] = useState('');
  const [reason, setReason] = useState('');

  // Reset whenever the modal opens for a new school / different action.
  useEffect(() => {
    if (open) {
      setRetypedName('');
      setReason('');
    }
  }, [open, schoolName, mode]);

  if (!open) return null;

  const nameMatches = retypedName.trim() === schoolName;
  const reasonOk = mode === 'resume' || reason.trim().length >= PAUSE_REASON_MIN_LENGTH;
  const canSubmit = nameMatches && reasonOk && !submitting;

  const isPause = mode === 'pause';
  const headerColor = isPause ? '#DC2626' : '#16A34A';
  const headerLabel = isPause ? 'Pause School' : 'Resume School';
  const ctaLabel = submitting
    ? isPause ? 'Pausing…' : 'Resuming…'
    : isPause ? 'Pause School' : 'Resume School';

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 999 }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 520, maxHeight: '90vh', overflowY: 'auto',
        background: '#FFFFFF', borderRadius: 12, zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: `1px solid ${'#E5E7EB'}`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${'#E5E7EB'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: headerColor, margin: 0 }}>
            {headerLabel}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${'#E5E7EB'}`, borderRadius: 6,
              padding: '4px 10px', fontSize: 13, cursor: 'pointer', color: '#6B7280',
            }}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          {/* Warning banner */}
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: 6,
            background: isPause ? '#FEF2F2' : '#F0FDF4',
            border: `1px solid ${isPause ? '#FECACA' : '#BBF7D0'}`,
            color: isPause ? '#991B1B' : '#166534',
            fontSize: 12, lineHeight: 1.5,
          }}>
            {isPause ? (
              <>
                <strong>This will immediately block authentication and API access</strong>{' '}
                for every student, teacher, and admin at <strong>{schoolName}</strong>.
                Use this only when ops/billing/legal requires the tenant to be gated.
              </>
            ) : (
              <>
                This will restore authentication and API access for{' '}
                <strong>{schoolName}</strong>.
              </>
            )}
          </div>

          {/* Retype name guardrail */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6,
              textTransform: 'uppercase', letterSpacing: 0.8, display: 'block',
            }}>
              Type the school name to confirm
            </label>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4, fontFamily: 'monospace' }}>
              Expected: {schoolName}
            </div>
            <input
              autoFocus
              type="text"
              value={retypedName}
              onChange={e => setRetypedName(e.target.value)}
              placeholder={schoolName}
              disabled={submitting}
              style={{
                padding: '8px 12px', borderRadius: 6,
                border: `1px solid ${retypedName && !nameMatches ? '#DC2626' : '#E5E7EB'}`,
                background: '#FFFFFF', color: '#111827', fontSize: 13,
                outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
              }}
            />
            {retypedName && !nameMatches && (
              <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>
                Does not match. Type the school name exactly as shown above.
              </div>
            )}
          </div>

          {/* Reason — pause only */}
          {isPause && (
            <div style={{ marginBottom: 8 }}>
              <label style={{
                fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 0.8, display: 'block',
              }}>
                Reason (min {PAUSE_REASON_MIN_LENGTH} chars)
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Explain why — surfaced in the audit log and the operator dashboard."
                disabled={submitting}
                rows={3}
                style={{
                  padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #E5E7EB',
                  background: '#FFFFFF', color: '#111827', fontSize: 13,
                  outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
                  resize: 'vertical', minHeight: 60,
                }}
              />
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                {reason.trim().length} / {PAUSE_REASON_MIN_LENGTH}+ characters
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${'#E5E7EB'}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onSubmit({ reason: reason.trim(), expectedSchoolName: retypedName.trim() })}
            disabled={!canSubmit}
            className="rounded-md px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
            style={{
              background: headerColor,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {ctaLabel}
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
      borderBottom: `1px solid ${'#F3F4F6'}`,
    }}>
      <span style={{ fontSize: 12, color: '#9CA3AF' }}>{label}</span>
      <span style={{ fontSize: 12, color: '#111827', fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

const PAGE_LIMIT = 50;

function InstitutionsContent() {
  const { apiFetch } = useAdmin();
  const searchParams = useSearchParams();
  const router = useRouter();

  /* ----- state ----- */
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, HealthRecord>>({});
  const [total, setTotal] = useState(0);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [selected, setSelected] = useState<SchoolRow | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ----- fetch institutions ----- */
  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/institutions?page=${page}&limit=${PAGE_LIMIT}`);
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

  /* ----- pause / resume workflow -----
     Replaces the old single-click toggleInstitution. The button now opens
     a confirmation modal (PauseResumeModal) that requires the operator to
     retype the school name AND, for pause, provide a >=10-char reason.
     POST hits the dedicated /pause or /resume route — those endpoints
     enforce the guardrail SERVER-SIDE so this UI flow cannot be skipped
     by a custom client. */
  const [pauseTarget, setPauseTarget] = useState<InstitutionRecord | null>(null);
  const [pauseMode, setPauseMode] = useState<'pause' | 'resume'>('pause');
  const [pauseSubmitting, setPauseSubmitting] = useState(false);
  const [pauseToast, setPauseToast] = useState<string | null>(null);

  const openPauseResumeModal = (inst: InstitutionRecord) => {
    setPauseMode(inst.is_active !== false ? 'pause' : 'resume');
    setPauseTarget(inst);
  };

  const closePauseResumeModal = () => {
    if (pauseSubmitting) return;
    setPauseTarget(null);
  };

  const submitPauseOrResume = async (args: { reason: string; expectedSchoolName: string }) => {
    if (!pauseTarget) return;
    setPauseSubmitting(true);
    setError(null);
    setPauseToast(null);
    try {
      const path = pauseMode === 'pause'
        ? `/api/super-admin/institutions/${encodeURIComponent(pauseTarget.id)}/pause`
        : `/api/super-admin/institutions/${encodeURIComponent(pauseTarget.id)}/resume`;
      const payload = pauseMode === 'pause'
        ? { reason: args.reason, expectedSchoolName: args.expectedSchoolName }
        : { expectedSchoolName: args.expectedSchoolName };
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setError(j?.error || `${pauseMode === 'pause' ? 'Pause' : 'Resume'} failed`);
      } else {
        setPauseToast(
          pauseMode === 'pause'
            ? `Paused ${pauseTarget.name}. Tenant access is now gated.`
            : `Resumed ${pauseTarget.name}. Tenant access restored.`,
        );
        setPauseTarget(null);
        // Refresh both the list and the drawer record so the new state
        // shows up immediately.
        fetchInstitutions();
        setSelected(prev =>
          prev && prev.id === pauseTarget.id
            ? { ...prev, is_active: pauseMode === 'resume' }
            : prev,
        );
      }
    } catch {
      setError(`Network error during ${pauseMode}`);
    } finally {
      setPauseSubmitting(false);
    }
  };

  // Auto-dismiss the success toast after a few seconds.
  useEffect(() => {
    if (!pauseToast) return;
    const t = setTimeout(() => setPauseToast(null), 4000);
    return () => clearTimeout(t);
  }, [pauseToast]);

  /* ----- change tenant_type (Phase B super-admin) -----
     Loud, separate handler — distinct from the generic update path so the
     audit log carries the `tenant.type_changed` action (see backend at
     src/app/api/super-admin/institutions/route.ts). Refetches both the
     list and the selected drawer record so the UI reflects the new state
     without a page reload. */
  const [changingType, setChangingType] = useState<string | null>(null);
  const changeTenantType = async (inst: InstitutionRecord, next: TenantType) => {
    if (inst.tenant_type === next) return;
    setChangingType(inst.id);
    try {
      const res = await apiFetch('/api/super-admin/institutions', {
        method: 'PATCH',
        body: JSON.stringify({ id: inst.id, updates: { tenant_type: next } }),
      });
      if (res.ok) {
        // Optimistic refresh of the drawer's row; full list re-fetch follows.
        setSelected(prev => (prev && prev.id === inst.id ? { ...prev, tenant_type: next } : prev));
        fetchInstitutions();
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Failed to change tenant type');
      }
    } finally {
      setChangingType(null);
    }
  };

  /* ----- custom domain (super-admin) -----
     Two operations:
       (a) save / clear the domain via PATCH /institutions
       (b) verify via POST /institutions/verify-domain (DNS TXT lookup)

     The save flow auto-resets domain_verified=false (handled server-side
     in the PATCH endpoint), so the operator must Verify after every Save.
     This is intentional — a domain change is functionally a new domain. */
  const [domainInput, setDomainInput] = useState<string>('');
  const [savingDomain, setSavingDomain] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    verified: boolean;
    expectedRecord: string;
    expectedToken: string;
    message: string;
  } | null>(null);

  // When the drawer opens for a new school, prefill the input + clear stale
  // verify result so old diagnostics don't bleed across selections.
  useEffect(() => {
    setDomainInput(selected?.custom_domain ?? '');
    setVerifyResult(null);
  }, [selected?.id, selected?.custom_domain]);

  const saveCustomDomain = async (inst: InstitutionRecord, raw: string) => {
    const trimmed = raw.trim().toLowerCase();
    setSavingDomain(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await apiFetch('/api/super-admin/institutions', {
        method: 'PATCH',
        body: JSON.stringify({
          id: inst.id,
          updates: { custom_domain: trimmed === '' ? null : trimmed },
        }),
      });
      if (res.ok) {
        setSelected(prev =>
          prev && prev.id === inst.id
            ? { ...prev, custom_domain: trimmed === '' ? null : trimmed, domain_verified: false }
            : prev,
        );
        fetchInstitutions();
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Failed to save custom domain');
      }
    } finally {
      setSavingDomain(false);
    }
  };

  const verifyCustomDomain = async (inst: InstitutionRecord) => {
    setVerifyingDomain(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/institutions/verify-domain', {
        method: 'POST',
        body: JSON.stringify({ id: inst.id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setError(j?.error || 'Verify failed');
      } else {
        setVerifyResult({
          verified: !!j.verified,
          expectedRecord: j.expectedRecord,
          expectedToken: j.expectedToken,
          message: j.message,
        });
        if (j.verified) {
          setSelected(prev =>
            prev && prev.id === inst.id ? { ...prev, domain_verified: true } : prev,
          );
          fetchInstitutions();
        }
      }
    } finally {
      setVerifyingDomain(false);
    }
  };

  /* ----- Vercel attach (white-label routing + TLS) -----
     Independent of the DNS-TXT verify above. The DNS-TXT proves
     ownership; Vercel attach wires routing + auto-TLS via Let's Encrypt.
     Both must complete (in any order) for traffic to reach the tenant. */
  const [attachingVercel, setAttachingVercel] = useState(false);
  const [vercelResult, setVercelResult] = useState<{
    verified: boolean;
    misconfigured?: boolean;
    verification: Array<{ type: string; domain: string; value: string; reason: string }>;
    error?: string;
    code?: string;
  } | null>(null);

  // Reset Vercel result when drawer switches schools so stale records
  // don't bleed across selections.
  useEffect(() => {
    setVercelResult(null);
  }, [selected?.id]);

  const attachVercelDomain = async (inst: InstitutionRecord, action: 'attach' | 'status') => {
    setAttachingVercel(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/institutions/attach-vercel-domain', {
        method: 'POST',
        body: JSON.stringify({ id: inst.id, action }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        // Distinguish "Vercel not configured" (503) from other failures so
        // the UI can render a sticky banner rather than a transient error.
        setVercelResult({
          verified: false,
          verification: [],
          error: j?.error || `Vercel call failed (HTTP ${res.status})`,
          code: j?.code,
        });
      } else {
        setVercelResult({
          verified: !!j.vercel.verified,
          misconfigured: j.vercel.misconfigured,
          verification: Array.isArray(j.vercel.verification) ? j.vercel.verification : [],
        });
      }
    } finally {
      setAttachingVercel(false);
    }
  };

  /* ----- provision ----- */
  const handleProvision = async (form: ProvisionForm) => {
    setProvisioning(true);
    try {
      const res = await apiFetch('/api/super-admin/institutions/provision', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        // Store result and switch modal to success view — do NOT close yet.
        // The operator needs to see/copy the invite code before dismissing.
        setProvisionResult({
          school_id: d?.data?.school_id ?? '',
          slug: d?.data?.slug ?? '',
          subdomain: d?.data?.subdomain ?? '',
          invite_code: d?.data?.invite_code ?? '',
          admin_invite_sent: !!d?.data?.admin_invite_sent,
          warn: d?.data?.warn,
        });
        fetchInstitutions();
        fetchHealth();
      } else {
        setError(d?.error || 'Provisioning failed');
      }
    } catch {
      setError('Network error during provisioning');
    }
    setProvisioning(false);
  };

  const handleProvisionDone = () => {
    setShowProvision(false);
    setProvisionResult(null);
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
          <strong style={{ color: '#111827', fontSize: 13 }}>{r.name || '—'}</strong>
          {r.board && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{r.board}</div>}
        </div>
      ),
    },
    { key: 'city', label: 'City', render: r => <span style={{ fontSize: 12 }}>{r.city || '—'}</span> },
    {
      key: 'health_score', label: 'Health',
      render: r => r.health ? <HealthBar score={r.health.health_score} /> : (
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{healthLoading ? '...' : '—'}</span>
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
          onClick={e => { e.stopPropagation(); openPauseResumeModal(r); }}
          style={{
            background: 'none',
            border: '1px solid #E5E7EB',
            borderRadius: 5,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 500,
            color: r.is_active !== false ? '#DC2626' : '#16A34A',
            borderColor: r.is_active !== false ? '#DC2626' : '#16A34A',
          }}
        >
          {r.is_active !== false ? 'Pause' : 'Resume'}
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
          background: '#FEF2F2', color: '#DC2626', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'none', border: 'none', color: '#DC2626',
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
          }}>x</button>
        </div>
      )}

      {/* Success toast — auto-dismisses after a few seconds (handled by
          useEffect above). Kept inline rather than pulling in a toast lib
          to stay consistent with the rest of this page's lightweight UI. */}
      {pauseToast && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 6,
          background: '#F0FDF4', color: '#166534', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          border: '1px solid #BBF7D0',
        }}>
          <span>{pauseToast}</span>
          <button onClick={() => setPauseToast(null)} style={{
            background: 'none', border: 'none', color: '#166534',
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
          }}>x</button>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="text-xl font-bold text-foreground">School CRM</h1>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>
            Manage school lifecycle, health, and billing
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowProvision(true)} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">
            Provision School
          </button>
          <button onClick={exportCSV} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Export CSV</button>
        </div>
      </div>

      {/* Pipeline View */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 24,
        border: `1px solid ${'#E5E7EB'}`, borderRadius: 8, overflow: 'hidden',
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
                background: isActive ? stage.color + '12' : '#FFFFFF',
                borderRight: idx < PIPELINE_STAGES.length - 1 ? `1px solid ${'#E5E7EB'}` : 'none',
                borderBottom: isActive ? `2px solid ${stage.color}` : '2px solid transparent',
                textAlign: 'center',
                transition: 'background 0.15s, border-bottom 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? stage.color + '12' : '#FFFFFF'; }}
            >
              <div style={{
                fontSize: 24, fontWeight: 800, color: stage.color,
                lineHeight: 1.1,
              }}>
                {count}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: isActive ? stage.color : '#9CA3AF',
                textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4,
              }}>
                {stage.label}
              </div>
              {/* Arrow connector */}
              {idx < PIPELINE_STAGES.length - 1 && (
                <span style={{
                  position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, color: '#9CA3AF', zIndex: 1,
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
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>
            Filtered by: <strong style={{ color: '#111827' }}>{STAGE_LABELS[pipelineFilter]}</strong>
          </span>
          <button onClick={() => setPipelineFilter(null)} style={{
            background: 'none',
            border: '1px solid #E5E7EB',
            borderRadius: 5,
            cursor: 'pointer',
            fontWeight: 500,
            color: '#6B7280',
            fontSize: 11,
            padding: '2px 8px',
          }}>Clear</button>
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Schools" value={total} icon="&#9875;" accentColor={'#2563EB'} />
        <StatCard label="Total Students" value={totalStudents} icon="&#9733;" accentColor={'#16A34A'} />
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
          accentColor={'#2563EB'}
        />
        <StatCard label="Active Trials" value={activeTrials} icon="&#9711;" accentColor="#3B82F6" />
        <StatCard label="At Risk" value={atRiskCount} icon="&#9888;" accentColor="#EAB308" />
      </div>

      {/* School count */}
      <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>
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
      <div className="flex items-center justify-between px-4 py-3 border-t border-surface-3 text-[13px]">
        <span className="text-muted-foreground">
          {total === 0
            ? 'No schools'
            : `${(page - 1) * PAGE_LIMIT + 1}–${Math.min(page * PAGE_LIMIT, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`?page=${page - 1}`)}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-md border border-surface-3 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            onClick={() => router.push(`?page=${page + 1}`)}
            disabled={page * PAGE_LIMIT >= total}
            className="px-3 py-1.5 rounded-md border border-surface-3 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {/* Provision Modal */}
      <ProvisionModal
        open={showProvision}
        onClose={() => { setShowProvision(false); setProvisionResult(null); }}
        onSubmit={handleProvision}
        submitting={provisioning}
        result={provisionResult}
        onDone={handleProvisionDone}
      />

      {/* Pause / Resume Modal — server enforces the retype-name guardrail
          (see /api/super-admin/institutions/[id]/{pause,resume}/route.ts).
          The UI guardrail here is for the operator's safety; the server
          guardrail is what makes it secure. */}
      <PauseResumeModal
        open={!!pauseTarget}
        mode={pauseMode}
        schoolName={pauseTarget?.name ?? ''}
        onClose={closePauseResumeModal}
        onSubmit={submitPauseOrResume}
        submitting={pauseSubmitting}
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
            {/* Paused banner — shown only when this school is currently
                paused. Surfaces who/when/why so ops doesn't have to dig
                into the audit log. Always rendered above the rest of the
                drawer so the context is impossible to miss. */}
            {selected.is_active === false && (
              <div style={{
                padding: 12, marginBottom: 16, borderRadius: 6,
                background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
                fontSize: 12, lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>School is paused</div>
                {selected.pause_reason && (
                  <div style={{ marginBottom: 4 }}>
                    Reason: <strong>{selected.pause_reason}</strong>
                  </div>
                )}
                {selected.paused_at && (
                  <div style={{ color: '#9F1239' }}>
                    Paused at: {new Date(selected.paused_at).toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            )}

            {/* Health Gauge */}
            {h ? (
              <CircularGauge score={h.health_score} />
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#9CA3AF', fontSize: 13 }}>
                {healthLoading ? 'Loading health data...' : 'No health data available'}
              </div>
            )}

            {/* Score Breakdown */}
            {h && (
              <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
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
                onClick={e => { e.stopPropagation(); openPauseResumeModal(selected); }}
                style={{
                  background: 'none',
                  border: '1px solid #E5E7EB',
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                  color: selected.is_active !== false ? '#DC2626' : '#16A34A',
                  borderColor: selected.is_active !== false ? '#DC2626' : '#16A34A',
                  padding: '6px 14px',
                }}
              >
                {selected.is_active !== false ? 'Pause' : 'Resume'}
              </button>
              {selected.slug && (
                <button
                  onClick={() => window.open(`/super-admin/view-as?school=${selected.slug}`, '_blank')}
                  style={{
                    background: 'none',
                    border: '1px solid #E5E7EB',
                    borderRadius: 5,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: 500,
                    color: '#6B7280',
                    padding: '6px 14px',
                  }}
                >
                  View as Admin
                </button>
              )}
            </div>

            {/* School Info */}
            <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
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
                    style={{ color: '#2563EB', textDecoration: 'none', fontSize: 12 }}>
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
              {/* Tenant type — editable inline. Changes go through PATCH
                  /api/super-admin/institutions with audit-log action
                  `tenant.type_changed`. Disabled while a request is in
                  flight to prevent double-submission. */}
              <InfoRow label="Tenant Type" value={
                <select
                  value={selected.tenant_type || 'school'}
                  disabled={changingType === selected.id}
                  onChange={e => changeTenantType(selected, e.target.value as TenantType)}
                  className="rounded-md border border-surface-3 bg-surface-1 cursor-pointer" style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  <option value="school">School</option>
                  <option value="coaching">Coaching Institute</option>
                  <option value="corporate">Corporate</option>
                  <option value="government">Government</option>
                </select>
              } />
            </div>

            {/* Custom Domain — white-label routing */}
            <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Custom Domain
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  type="text"
                  value={domainInput}
                  onChange={e => setDomainInput(e.target.value)}
                  placeholder="learn.dps.com (leave blank to remove)"
                  disabled={savingDomain || verifyingDomain}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button
                  onClick={() => saveCustomDomain(selected, domainInput)}
                  disabled={savingDomain || verifyingDomain || domainInput === (selected.custom_domain ?? '')}
                  style={{ fontSize: 12 }}
                >
                  {savingDomain ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => verifyCustomDomain(selected)}
                  disabled={savingDomain || verifyingDomain || !selected.custom_domain}
                  style={{ fontSize: 12, background: '#2563EB', color: '#fff' }}
                >
                  {verifyingDomain ? 'Checking…' : 'Verify'}
                </button>
              </div>

              {selected.custom_domain && (
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
                  Status:{' '}
                  {selected.domain_verified ? (
                    <StatusBadge label="verified" variant="success" />
                  ) : (
                    <StatusBadge label="unverified" variant="warning" />
                  )}
                </div>
              )}

              {verifyResult && (
                <div
                  style={{
                    fontSize: 11,
                    color: verifyResult.verified ? '#16A34A' : '#6B7280',
                    background: verifyResult.verified ? `${'#16A34A'}10` : '#F9FAFB',
                    padding: 10,
                    borderRadius: 4,
                    marginTop: 6,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {verifyResult.verified ? '✓ Ownership verified' : 'Not yet verified'}
                  </div>
                  <div style={{ marginBottom: 6 }}>{verifyResult.message}</div>
                  {!verifyResult.verified && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                      <div>TXT record name:</div>
                      <div style={{ background: '#FFFFFF', padding: 4, borderRadius: 3, marginBottom: 4 }}>
                        {verifyResult.expectedRecord}
                      </div>
                      <div>TXT record value:</div>
                      <div style={{ background: '#FFFFFF', padding: 4, borderRadius: 3 }}>
                        {verifyResult.expectedToken}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Vercel attach — independent of ownership verification.
                  Pairs with the DNS-TXT verify above. */}
              {selected.custom_domain && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${'#E5E7EB'}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
                    Vercel routing + TLS
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => attachVercelDomain(selected, 'attach')}
                      disabled={attachingVercel || savingDomain || verifyingDomain}
                      style={{ fontSize: 11 }}
                    >
                      {attachingVercel ? 'Calling Vercel…' : 'Attach to Vercel'}
                    </button>
                    <button
                      onClick={() => attachVercelDomain(selected, 'status')}
                      disabled={attachingVercel || savingDomain || verifyingDomain}
                      style={{ fontSize: 11 }}
                    >
                      Refresh status
                    </button>
                  </div>

                  {vercelResult && (
                    <div
                      style={{
                        fontSize: 11,
                        color: vercelResult.verified ? '#16A34A' : '#6B7280',
                        background: vercelResult.verified ? `${'#16A34A'}10` : '#F9FAFB',
                        padding: 10,
                        borderRadius: 4,
                        marginTop: 6,
                      }}
                    >
                      {vercelResult.error ? (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            {vercelResult.code === 'VERCEL_NOT_CONFIGURED'
                              ? 'Vercel API not configured'
                              : 'Vercel call failed'}
                          </div>
                          <div>{vercelResult.error}</div>
                          {vercelResult.code === 'VERCEL_NOT_CONFIGURED' && (
                            <div style={{ marginTop: 4, fontFamily: 'monospace' }}>
                              Set VERCEL_API_TOKEN + VERCEL_PROJECT_ID env vars on the deploy.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            {vercelResult.verified ? '✓ Vercel verified — TLS will provision automatically' : 'Vercel attached, awaiting DNS'}
                          </div>
                          {vercelResult.misconfigured && (
                            <div style={{ marginBottom: 6 }}>DNS records below need to be published.</div>
                          )}
                          {vercelResult.verification.length > 0 && (
                            <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              <div style={{ marginBottom: 4 }}>Required DNS records:</div>
                              {vercelResult.verification.map((rec, i) => (
                                <div key={i} style={{ background: '#FFFFFF', padding: 4, borderRadius: 3, marginBottom: 4 }}>
                                  <div>{rec.type} {rec.domain}</div>
                                  <div style={{ color: '#9CA3AF' }}>→ {rec.value}</div>
                                  {rec.reason && <div style={{ color: '#9CA3AF', marginTop: 2 }}>{rec.reason}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Subscription */}
            {h && (
              <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Subscription
                </div>
                <InfoRow label="Plan" value={selected.subscription_plan || 'free'} />
                <InfoRow label="Seats" value={`${h.active_students} used / ${h.total_seats} total`} />
                <InfoRow label="Price / Seat" value={`₹${h.price_per_seat}`} />
                <InfoRow label="MRR" value={
                  <span style={{ fontWeight: 700, color: '#111827' }}>₹{h.mrr.toLocaleString('en-IN')}</span>
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
              <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
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
                      color: h.days_since_activity > 14 ? '#DC2626' : h.days_since_activity > 7 ? '#D97706' : '#16A34A',
                      fontWeight: 600,
                    }}>
                      {h.days_since_activity} days
                    </span>
                  ) : '—'
                } />
              </div>
            )}

            {/* ID */}
            <div style={{ marginTop: 16, fontSize: 10, color: '#9CA3AF' }}>
              ID: <code style={{ fontSize: 10 }}>{selected.id}</code>
            </div>
            {selected.created_at && (
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
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
