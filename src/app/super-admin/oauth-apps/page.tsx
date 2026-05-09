'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatusBadge, DataTable, type Column, DetailDrawer } from '@/components/admin-ui';

/* ── Types ── */
interface OAuthApp {
  id: string;
  name: string;
  description: string;
  developer_org: string;
  developer_email: string;
  app_type: 'first_party' | 'third_party' | 'school_internal';
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  requested_scopes: ScopeInfo[];
  redirect_uris: string[];
  logo_url: string | null;
  homepage_url: string | null;
  privacy_policy_url: string | null;
  rate_limit: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  active_consents_count: number;
  active_tokens_count: number;
  created_at: string;
  [key: string]: unknown;
}

interface ScopeInfo {
  name: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high';
}

/* ── Helpers ── */
function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'approved': return 'success';
    case 'pending': return 'warning';
    case 'rejected': case 'suspended': return 'danger';
    default: return 'neutral';
  }
}

function appTypeBadge(type: string): { bg: string; fg: string; label: string } {
  switch (type) {
    case 'first_party': return { bg: 'rgba(124,58,237,0.1)', fg: '#7C3AED', label: 'First Party' };
    case 'third_party': return { bg: 'rgba(37,99,235,0.1)', fg: '#2563EB', label: 'Third Party' };
    case 'school_internal': return { bg: 'rgba(249,115,22,0.1)', fg: '#F97316', label: 'School Internal' };
    default: return { bg: '#F9FAFB', fg: '#9CA3AF', label: type };
  }
}

function riskBadge(level: string): { bg: string; fg: string } {
  switch (level) {
    case 'low': return { bg: 'rgba(22,163,74,0.1)', fg: '#16A34A' };
    case 'medium': return { bg: 'rgba(217,119,6,0.1)', fg: '#D97706' };
    case 'high': return { bg: 'rgba(220,38,38,0.1)', fg: '#DC2626' };
    default: return { bg: '#F9FAFB', fg: '#9CA3AF' };
  }
}

/* ── Main Content ── */
function OAuthAppsContent() {
  const { apiFetch } = useAdmin();

  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [pendingApps, setPendingApps] = useState<OAuthApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState<OAuthApp | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Reject reason state per app
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const showMsg = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  /* ── Fetchers ── */
  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/oauth-apps?action=list');
      if (res.ok) {
        const d = await res.json();
        setApps(d.data || []);
      }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/oauth-apps?action=list&status=pending');
      if (res.ok) {
        const d = await res.json();
        setPendingApps(d.data || []);
      }
    } catch { /* */ }
  }, [apiFetch]);

  useEffect(() => {
    fetchApps();
    fetchPending();
  }, [fetchApps, fetchPending]);

  /* ── Actions ── */
  const approveApp = async (appId: string) => {
    try {
      const res = await apiFetch('/api/super-admin/oauth-apps', {
        method: 'POST',
        body: JSON.stringify({ action: 'approve_app', appId }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg('App approved', 'success');
        fetchApps();
        fetchPending();
      } else showMsg(d.error || 'Failed to approve', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const rejectApp = async (appId: string) => {
    if (!rejectReason.trim()) {
      showMsg('Please provide a rejection reason', 'error');
      return;
    }
    try {
      const res = await apiFetch('/api/super-admin/oauth-apps', {
        method: 'POST',
        body: JSON.stringify({ action: 'reject_app', appId, reason: rejectReason.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg('App rejected', 'success');
        setRejectingId(null);
        setRejectReason('');
        fetchApps();
        fetchPending();
      } else showMsg(d.error || 'Failed to reject', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const suspendApp = async (appId: string) => {
    try {
      const res = await apiFetch('/api/super-admin/oauth-apps', {
        method: 'POST',
        body: JSON.stringify({ action: 'suspend_app', appId }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg('App suspended', 'success');
        fetchApps();
        fetchPending();
        if (selectedApp?.id === appId) setSelectedApp(null);
      } else showMsg(d.error || 'Failed to suspend', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  /* ── Reusable styles for actions ── */
  const dangerActionClass = "rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-surface-2";
  const successActionClass = "rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-surface-2";
  const neutralActionClass = "rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-2";
  const dangerActionStyle: React.CSSProperties = { color: '#DC2626', borderColor: '#DC2626' };
  const successActionStyle: React.CSSProperties = { color: '#16A34A', borderColor: '#16A34A' };

  /* ── Column Definitions ── */
  const columns: Column<OAuthApp>[] = [
    {
      key: 'name', label: 'Name',
      render: r => <strong style={{ color: '#111827' }}>{r.name || '—'}</strong>,
    },
    {
      key: 'developer_org', label: 'Developer',
      render: r => <span style={{ fontSize: 12, color: '#6B7280' }}>{r.developer_org || '—'}</span>,
    },
    {
      key: 'app_type', label: 'Type',
      render: r => {
        const badge = appTypeBadge(r.app_type);
        return (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
            background: badge.bg, color: badge.fg, whiteSpace: 'nowrap',
          }}>
            {badge.label}
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Status',
      render: r => <StatusBadge label={r.status} variant={statusVariant(r.status)} />,
    },
    {
      key: 'requested_scopes', label: 'Scopes', sortable: false,
      render: r => (
        <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
          {Array.isArray(r.requested_scopes) ? r.requested_scopes.length : 0}
        </span>
      ),
    },
    {
      key: 'rate_limit', label: 'Rate Limit',
      render: r => <span style={{ fontSize: 12, color: '#6B7280' }}>{r.rate_limit ? `${r.rate_limit}/h` : '—'}</span>,
    },
    {
      key: 'created_at', label: 'Created',
      render: r => <span style={{ fontSize: 12, color: '#6B7280' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span>,
    },
    {
      key: '_actions', label: 'Actions', sortable: false,
      render: r => {
        if (r.status === 'approved') {
          return (
            <button
              onClick={e => { e.stopPropagation(); suspendApp(r.id); }}
              className={dangerActionClass}
              style={dangerActionStyle}
            >
              Suspend
            </button>
          );
        }
        if (r.status === 'rejected' || r.status === 'suspended') {
          return (
            <button
              onClick={e => { e.stopPropagation(); approveApp(r.id); }}
              className={successActionClass}
              style={successActionStyle}
            >
              Approve
            </button>
          );
        }
        return <span style={{ fontSize: 12, color: '#9CA3AF' }}>{'—'}</span>;
      },
    },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1 className="text-xl font-bold text-foreground">OAuth Apps</h1>
            <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>Manage registered OAuth applications and review requests</p>
          </div>
          {pendingApps.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 12,
              background: '#FFFBEB', color: '#D97706',
            }}>
              {pendingApps.length} Pending Review
            </span>
          )}
        </div>
      </div>

      {/* Inline toast */}
      {message && (
        <div
          className="rounded-lg border border-surface-3 bg-surface-1"
          style={{
            marginBottom: 16,
            borderLeft: `3px solid ${message.type === 'success' ? '#16A34A' : '#DC2626'}`,
            padding: '10px 16px',
            fontSize: 13,
            color: message.type === 'success' ? '#16A34A' : '#DC2626',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Pending Review Section */}
      {pendingApps.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1.5,
            fontWeight: 600, marginBottom: 12,
          }}>
            Pending Review ({pendingApps.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
            {pendingApps.map(app => (
              <div
                key={app.id}
                className="rounded-lg border border-surface-3 bg-surface-1 p-4"
                style={{ borderLeft: `3px solid #D97706` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{app.name}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{app.developer_org}</div>
                  </div>
                  {(() => {
                    const badge = appTypeBadge(app.app_type);
                    return (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        background: badge.bg, color: badge.fg,
                      }}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Requested scopes */}
                {Array.isArray(app.requested_scopes) && app.requested_scopes.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {app.requested_scopes.map(scope => {
                      const risk = riskBadge(scope.risk_level);
                      return (
                        <span key={scope.name} style={{
                          fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
                          background: risk.bg, color: risk.fg,
                        }}>
                          {scope.name}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Privacy policy link */}
                {app.privacy_policy_url && (
                  <div style={{ marginBottom: 10 }}>
                    <a
                      href={app.privacy_policy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#2563EB', textDecoration: 'underline' }}
                      onClick={e => e.stopPropagation()}
                    >
                      Privacy Policy
                    </a>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => approveApp(app.id)}
                    className={successActionClass}
                    style={successActionStyle}
                  >
                    Approve
                  </button>
                  {rejectingId === app.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Rejection reason..."
                        className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        style={{ flex: 1, minWidth: 140 }}
                        onKeyDown={e => { if (e.key === 'Enter') rejectApp(app.id); }}
                        autoFocus
                      />
                      <button
                        onClick={() => rejectApp(app.id)}
                        className={dangerActionClass}
                        style={dangerActionStyle}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectReason(''); }}
                        className={neutralActionClass}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setRejectingId(app.id); setRejectReason(''); }}
                      className={dangerActionClass}
                      style={dangerActionStyle}
                    >
                      Reject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Apps section header */}
      <div style={{
        fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1.5,
        fontWeight: 600, marginBottom: 12,
      }}>
        All Apps ({apps.length})
      </div>

      {/* All Apps Table */}
      <DataTable
        columns={columns}
        data={apps}
        keyField="id"
        onRowClick={setSelectedApp}
        loading={loading}
        emptyMessage="No OAuth apps registered"
      />

      {/* App Detail Drawer */}
      <DetailDrawer open={!!selectedApp} onClose={() => setSelectedApp(null)} title={selectedApp?.name || 'App Details'} width={520}>
        {selectedApp && (
          <div>
            {/* App info */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                App Information
              </div>

              {selectedApp.logo_url && (
                <div style={{ marginBottom: 12 }}>
                  <img
                    src={selectedApp.logo_url}
                    alt={`${selectedApp.name} logo`}
                    style={{ width: 48, height: 48, borderRadius: 8, border: `1px solid #E5E7EB`, objectFit: 'cover' }}
                  />
                </div>
              )}

              {[
                { label: 'Name', value: selectedApp.name },
                { label: 'Description', value: selectedApp.description },
                { label: 'Developer', value: selectedApp.developer_org },
                { label: 'Developer Email', value: selectedApp.developer_email },
                { label: 'Created', value: selectedApp.created_at ? new Date(selectedApp.created_at).toLocaleString() : null },
              ].filter(f => f.value).map(f => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid #F3F4F6` }}>
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>{f.label}</span>
                  <span style={{ fontSize: 13, color: '#111827', fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{f.value}</span>
                </div>
              ))}

              {/* Status and type */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <StatusBadge label={selectedApp.status} variant={statusVariant(selectedApp.status)} />
                {(() => {
                  const badge = appTypeBadge(selectedApp.app_type);
                  return (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
                      background: badge.bg, color: badge.fg,
                    }}>
                      {badge.label}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* Links */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                Links
              </div>
              {[
                { label: 'Homepage', url: selectedApp.homepage_url },
                { label: 'Privacy Policy', url: selectedApp.privacy_policy_url },
              ].filter(l => l.url).map(l => (
                <div key={l.label} style={{ padding: '6px 0', borderBottom: `1px solid #F3F4F6` }}>
                  <span style={{ fontSize: 12, color: '#9CA3AF', marginRight: 8 }}>{l.label}:</span>
                  <a
                    href={l.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: '#2563EB', textDecoration: 'underline', wordBreak: 'break-all' }}
                  >
                    {l.url}
                  </a>
                </div>
              ))}
              {!selectedApp.homepage_url && !selectedApp.privacy_policy_url && (
                <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>No links provided</div>
              )}
            </div>

            {/* Redirect URIs */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                Redirect URIs
              </div>
              {Array.isArray(selectedApp.redirect_uris) && selectedApp.redirect_uris.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedApp.redirect_uris.map((uri, i) => (
                    <code key={i} style={{
                      fontSize: 11, padding: '4px 8px', borderRadius: 4,
                      background: '#F9FAFB', border: `1px solid #F3F4F6`,
                      color: '#111827', wordBreak: 'break-all',
                    }}>
                      {uri}
                    </code>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>No redirect URIs</div>
              )}
            </div>

            {/* Requested Scopes with risk levels */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                Requested Scopes ({Array.isArray(selectedApp.requested_scopes) ? selectedApp.requested_scopes.length : 0})
              </div>
              {Array.isArray(selectedApp.requested_scopes) && selectedApp.requested_scopes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedApp.requested_scopes.map(scope => {
                    const risk = riskBadge(scope.risk_level);
                    return (
                      <div key={scope.name} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 10px', borderRadius: 6,
                        border: `1px solid #F3F4F6`, background: '#F9FAFB',
                      }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{scope.name}</div>
                          {scope.description && (
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>{scope.description}</div>
                          )}
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: risk.bg, color: risk.fg, flexShrink: 0,
                        }}>
                          {scope.risk_level}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>No scopes requested</div>
              )}
            </div>

            {/* Review history */}
            {(selectedApp.reviewed_by || selectedApp.reviewed_at) && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                  Review History
                </div>
                <div
                  className="rounded-lg border border-surface-3"
                  style={{ padding: 12, background: '#F9FAFB' }}
                >
                  {selectedApp.reviewed_by && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ fontSize: 12, color: '#9CA3AF' }}>Reviewed By</span>
                      <code style={{ fontSize: 11, color: '#111827' }}>{selectedApp.reviewed_by}</code>
                    </div>
                  )}
                  {selectedApp.reviewed_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ fontSize: 12, color: '#9CA3AF' }}>Reviewed At</span>
                      <span style={{ fontSize: 12, color: '#111827' }}>{new Date(selectedApp.reviewed_at).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedApp.review_reason && (
                    <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: '#FFFFFF', border: `1px solid #F3F4F6` }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>Reason: </span>
                      <span style={{ fontSize: 12, color: '#111827' }}>{selectedApp.review_reason}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Usage stats */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>
                Usage
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div
                  className="rounded-lg border border-surface-3 bg-surface-1"
                  style={{ padding: 12, textAlign: 'center' }}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
                    {selectedApp.active_consents_count ?? 0}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Active Consents</div>
                </div>
                <div
                  className="rounded-lg border border-surface-3 bg-surface-1"
                  style={{ padding: 12, textAlign: 'center' }}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>
                    {selectedApp.active_tokens_count ?? 0}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Active Tokens</div>
                </div>
              </div>
            </div>

            {/* Rate limit */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid #F3F4F6` }}>
                <span style={{ fontSize: 13, color: '#9CA3AF' }}>Rate Limit</span>
                <span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>
                  {selectedApp.rate_limit ? `${selectedApp.rate_limit} requests/hour` : '—'}
                </span>
              </div>
            </div>

            {/* Drawer actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedApp.status === 'approved' && (
                <button
                  onClick={() => { suspendApp(selectedApp.id); }}
                  className={dangerActionClass}
                  style={{ ...dangerActionStyle, padding: '8px 16px' }}
                >
                  Suspend App
                </button>
              )}
              {(selectedApp.status === 'rejected' || selectedApp.status === 'suspended') && (
                <button
                  onClick={() => { approveApp(selectedApp.id); setSelectedApp(null); }}
                  className={successActionClass}
                  style={{ ...successActionStyle, padding: '8px 16px' }}
                >
                  Approve App
                </button>
              )}
              {selectedApp.status === 'pending' && (
                <>
                  <button
                    onClick={() => { approveApp(selectedApp.id); setSelectedApp(null); }}
                    className={successActionClass}
                    style={{ ...successActionStyle, padding: '8px 16px' }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { suspendApp(selectedApp.id); setSelectedApp(null); }}
                    className={dangerActionClass}
                    style={{ ...dangerActionStyle, padding: '8px 16px' }}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>

            {/* ID */}
            <div style={{ marginTop: 20, fontSize: 10, color: '#9CA3AF' }}>
              App ID: <code>{selectedApp.id}</code>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function OAuthAppsPage() {
  return <AdminShell><OAuthAppsContent /></AdminShell>;
}
