'use client';

/**
 * Safeguarding review queue — school-scoped (Foxy North-Star Phase 1).
 *
 * HISTORY / P10 DECISION (2026-08-05): this queue originally shipped as a
 * standalone route at /school-admin/safeguarding. That route measured
 * 290.1 kB first-load — over the 260 kB P10 per-page cap — and the cap is
 * structurally unreachable for ANY new route under the school-admin layout
 * (the lightest grandfathered sibling measures 287.4 kB; the shell itself
 * exceeds the cap). Per the quality-gate fold-in rule, the queue now lives as
 * the second tab of the grandfathered /school-admin/escalations page
 * (deep-link: /school-admin/escalations?tab=safeguarding) and is loaded via
 * next/dynamic so it adds no first-load weight to the host page. The API
 * (/api/school-admin/safeguarding) is unchanged.
 *
 * Data source: GET /api/school-admin/safeguarding → { rows: SafeguardingRow[] }
 *   (detail: GET ?id=<uuid> → { row } with `disclosure_excerpt`; server scopes
 *   to the admin's school — the client sends no school filter)
 * Transitions: PATCH /api/school-admin/safeguarding { id, status, review_notes? }
 *   Dismissal REQUIRES non-empty review_notes (client-enforced here; the
 *   server independently 400s a notes-less dismiss — handled gracefully).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';
import { Card, Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

type SafeguardingStatus = 'pending_review' | 'reviewed' | 'actioned' | 'dismissed';

interface SafeguardingRow {
  id: string;
  student_id: string;
  school_id: string | null;
  category: string;
  tier: string;
  status: SafeguardingStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  disclosure_excerpt?: string | null;
}

const STATUS_TABS: SafeguardingStatus[] = ['pending_review', 'reviewed', 'actioned', 'dismissed'];

const STATUS_LABELS: Record<SafeguardingStatus, { en: string; hi: string }> = {
  pending_review: { en: 'Pending review', hi: 'समीक्षा बाकी' },
  reviewed: { en: 'Reviewed', hi: 'समीक्षित' },
  actioned: { en: 'Actioned', hi: 'कार्रवाई की गई' },
  dismissed: { en: 'Dismissed', hi: 'खारिज' },
};

function tierStyle(tier: string): React.CSSProperties {
  const tt = tier.toLowerCase();
  if (tt.includes('1') || tt.includes('high') || tt.includes('immediate') || tt.includes('critical')) {
    return { background: 'rgba(220,38,38,0.1)', color: '#DC2626' };
  }
  if (tt.includes('2') || tt.includes('medium') || tt.includes('elevated')) {
    return { background: 'rgba(245,166,35,0.12)', color: '#B45309' };
  }
  return { background: 'var(--surface-2)', color: 'var(--text-2)' };
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Canonical list contract: GET → { rows: SafeguardingRow[] }. */
function extractRows(payload: unknown): SafeguardingRow[] {
  const p = payload as { rows?: unknown };
  return Array.isArray(p?.rows) ? (p.rows as SafeguardingRow[]) : [];
}

function CaseCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="space-y-2">
        <Skeleton variant="title" height={16} width="40%" />
        <Skeleton variant="text" height={12} width="70%" />
        <Skeleton variant="text" height={12} width="30%" />
      </div>
    </Card>
  );
}

export default function SafeguardingQueue({ isHi }: { isHi: boolean }) {
  const [rows, setRows] = useState<SafeguardingRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [status, setStatus] = useState<SafeguardingStatus>('pending_review');

  // Detail drawer state
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SafeguardingRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<SafeguardingStatus | null>(null);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const fetchRows = useCallback(async () => {
    const token = await getToken();
    // `loadingRows` starts true, so bailing here left a permanently spinning
    // skeleton on a safeguarding queue — the same stuck-skeleton defect fixed on
    // /teacher/submissions. Fail visibly and retryably instead.
    if (!token) {
      setLoadingRows(false);
      setApiError(t(isHi, 'Your session has expired. Please sign in again.', 'आपका सेशन समाप्त हो गया। कृपया दोबारा साइन इन करें।'));
      return;
    }
    setLoadingRows(true);
    setApiError(null);
    try {
      const res = await fetch(`/api/school-admin/safeguarding?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setRows(extractRows(json).filter((r) => r.status === status));
    } catch (err: any) {
      setApiError(err.message || t(isHi, 'Failed to load cases', 'मामले लोड करने में विफल'));
    } finally {
      setLoadingRows(false);
    }
  }, [getToken, status, isHi]);

  const openDetail = useCallback(async (caseId: string) => {
    setOpenCaseId(caseId);
    setDetail(null);
    setNotes('');
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const token = await getToken();
      if (!token) throw new Error(t(isHi, 'Session expired', 'सेशन समाप्त'));
      const res = await fetch(`/api/school-admin/safeguarding?id=${encodeURIComponent(caseId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      // Canonical detail contract: GET ?id= → { row: SafeguardingRow }.
      const row = (json?.row as SafeguardingRow | undefined) ?? null;
      if (!row) throw new Error(t(isHi, 'Case not found', 'मामला नहीं मिला'));
      setDetail(row);
    } catch (err: any) {
      setDetailError(err.message || 'unknown');
    } finally {
      setLoadingDetail(false);
    }
  }, [getToken, isHi]);

  const transition = useCallback(async (next: SafeguardingStatus) => {
    if (!openCaseId) return;
    // Advisory rule (backend enforces 400 in parallel): dismissal requires
    // non-empty review notes. The button is disabled too — this is a guard
    // against races.
    if (next === 'dismissed' && notes.trim() === '') {
      setDetailError(
        t(
          isHi,
          'Review notes are required to dismiss a case.',
          'मामला खारिज करने के लिए समीक्षा नोट्स आवश्यक हैं।',
        ),
      );
      return;
    }
    setSaving(next);
    setDetailError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error(t(isHi, 'Session expired', 'सेशन समाप्त'));
      const res = await fetch('/api/school-admin/safeguarding', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: openCaseId,
          status: next,
          ...(notes.trim() ? { review_notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 400 = validation (e.g. server-enforced notes-required-on-dismiss):
        // keep the drawer open and show the server's message.
        throw new Error(
          body.error ||
            (res.status === 400
              ? t(isHi, 'Review notes are required to dismiss a case.', 'मामला खारिज करने के लिए समीक्षा नोट्स आवश्यक हैं।')
              : `Request failed (${res.status})`),
        );
      }
      setOpenCaseId(null);
      fetchRows();
    } catch (err: any) {
      setDetailError(err.message || 'unknown');
    } finally {
      setSaving(null);
    }
  }, [openCaseId, notes, getToken, isHi, fetchRows]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  return (
    <>
      <div className="space-y-4 max-w-4xl">
        {/* Status tabs */}
        <div
          className="flex gap-1.5 overflow-x-auto no-scrollbar"
          role="tablist"
          aria-label={t(isHi, 'Status filter', 'स्थिति फ़िल्टर')}
        >
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className="flex-shrink-0 px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all active:scale-[0.97]"
              style={
                status === s
                  ? { background: 'var(--orange, #F97316)', color: '#fff' }
                  : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border)' }
              }
            >
              {t(isHi, STATUS_LABELS[s].en, STATUS_LABELS[s].hi)}
            </button>
          ))}
        </div>

        {apiError && !loadingRows && rows.length === 0 && (
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{apiError}</p>
            <Button variant="primary" onClick={fetchRows}>
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        )}

        {loadingRows && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <CaseCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loadingRows && !apiError && rows.length === 0 && (
          <EmptyState
            icon="⛨"
            title={t(isHi, 'No cases', 'कोई मामला नहीं')}
            description={t(
              isHi,
              'When a safeguarding case is raised for a student at your school, it will appear here.',
              'जब आपके स्कूल के किसी छात्र के लिए सुरक्षा मामला दर्ज होगा, तो वह यहाँ दिखाई देगा।',
            )}
          />
        )}

        {!loadingRows && rows.length > 0 && (
          <section aria-label={t(isHi, 'Safeguarding cases', 'सुरक्षा मामले')} className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id} className="p-0">
                <button
                  type="button"
                  onClick={() => openDetail(row.id)}
                  className="w-full text-left p-4 min-h-[44px]"
                  aria-label={t(isHi, 'Open case detail', 'मामले का विवरण खोलें')}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={tierStyle(row.tier)}>
                        {row.tier}
                      </span>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED' }}
                      >
                        {row.category}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-3)]">{formatDateTime(row.created_at)}</span>
                  </div>
                  <p className="text-xs text-[var(--text-2)] mt-2">
                    {t(isHi, 'Status', 'स्थिति')}: {t(isHi, STATUS_LABELS[row.status].en, STATUS_LABELS[row.status].hi)}
                    {row.reviewed_at && ` · ${t(isHi, 'Reviewed', 'समीक्षित')} ${formatDateTime(row.reviewed_at)}`}
                  </p>
                </button>
              </Card>
            ))}
          </section>
        )}
      </div>

      {/* Detail drawer */}
      {openCaseId && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={t(isHi, 'Case detail', 'मामले का विवरण')}
        >
          <button
            type="button"
            aria-label={t(isHi, 'Close', 'बंद करें')}
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpenCaseId(null)}
          />
          <div className="relative w-full max-w-md h-full overflow-y-auto p-5" style={{ background: 'var(--surface-1, #fff)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-1)]" style={{ fontFamily: 'var(--font-display)' }}>
                {t(isHi, 'Case detail', 'मामले का विवरण')}
              </h2>
              <Button variant="ghost" onClick={() => setOpenCaseId(null)}>
                {t(isHi, 'Close', 'बंद करें')}
              </Button>
            </div>

            {loadingDetail && (
              <div className="space-y-3">
                <Skeleton variant="title" height={16} width="50%" />
                <Skeleton variant="rect" height={90} rounded="rounded-xl" />
                <Skeleton variant="text" height={12} width="40%" />
              </div>
            )}

            {!loadingDetail && detailError && !detail && (
              <Card className="text-center py-6">
                <p className="text-sm text-[var(--text-2)]">{detailError}</p>
              </Card>
            )}

            {!loadingDetail && detail && (
              <>
                {detailError && (
                  <div
                    className="rounded-xl p-3 text-sm mb-3"
                    style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#DC2626' }}
                    role="alert"
                  >
                    {detailError}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={tierStyle(detail.tier)}>
                    {detail.tier}
                  </span>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED' }}
                  >
                    {detail.category}
                  </span>
                </div>

                <p className="text-[11px] text-[var(--text-3)] mb-3">
                  {t(isHi, 'Created', 'बनाया गया')}: {formatDateTime(detail.created_at)}
                  {' · '}
                  {t(isHi, 'Reviewed', 'समीक्षित')}: {formatDateTime(detail.reviewed_at)}
                </p>

                <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">
                  {t(isHi, 'Disclosure excerpt', 'प्रकटीकरण अंश')}
                </h3>
                <div
                  className="rounded-xl p-3 text-sm whitespace-pre-wrap mb-4"
                  style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', color: 'var(--text-1)' }}
                >
                  {detail.disclosure_excerpt || t(isHi, '(no excerpt available)', '(कोई अंश उपलब्ध नहीं)')}
                </div>

                <label htmlFor="sg-review-notes" className="block text-sm font-bold text-[var(--text-1)] mb-1">
                  {t(isHi, 'Review notes', 'समीक्षा नोट्स')}
                </label>
                <textarea
                  id="sg-review-notes"
                  className="w-full rounded-xl px-3 py-2 text-sm min-h-[80px] mb-1"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-1)' }}
                  placeholder={t(isHi, 'Notes recorded with the status change', 'स्थिति बदलाव के साथ दर्ज नोट्स')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving !== null}
                  aria-describedby="sg-review-notes-help"
                />
                <p id="sg-review-notes-help" className="text-[11px] mb-4" style={{ color: 'var(--text-3)' }}>
                  {t(
                    isHi,
                    'Review notes are required to dismiss a case.',
                    'मामला खारिज करने के लिए समीक्षा नोट्स आवश्यक हैं।',
                  )}
                </p>

                <h3 className="text-sm font-bold text-[var(--text-1)] mb-2">
                  {t(isHi, 'Set status', 'स्थिति बदलें')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {STATUS_TABS.filter((s) => s !== detail.status).map((s) => (
                    <Button
                      key={s}
                      variant="primary"
                      onClick={() => transition(s)}
                      disabled={saving !== null || (s === 'dismissed' && notes.trim() === '')}
                    >
                      {saving === s
                        ? t(isHi, 'Saving…', 'सहेजा जा रहा है…')
                        : t(isHi, STATUS_LABELS[s].en, STATUS_LABELS[s].hi)}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
