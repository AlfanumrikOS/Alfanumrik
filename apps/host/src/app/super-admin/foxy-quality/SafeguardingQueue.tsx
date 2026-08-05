'use client';

/**
 * Safeguarding review queue — platform-wide (Foxy North-Star Phase 1).
 *
 * HISTORY / P10 DECISION (2026-08-05): this queue originally shipped as a
 * standalone route at /super-admin/safeguarding. That route measured
 * 274.1 kB first-load — over the 260 kB P10 per-page cap, which new routes
 * get no grandfathering from — and the cap is structurally unreachable for
 * ANY new route under the super-admin layout (the lightest grandfathered
 * sibling measures 277.5 kB in the CI baseline; the shell alone exceeds the
 * cap, so code-splitting the page's own ~2 kB of content cannot reach 260).
 * Per the approved fallback, the queue now lives as the "Safeguarding" tab of
 * the grandfathered /super-admin/foxy-quality page (deep-link:
 * /super-admin/foxy-quality?tab=safeguarding — safeguarding disclosures
 * originate from Foxy, making this the natural Foxy-safety surface) and is
 * loaded via next/dynamic (ssr:false) so it adds no first-load weight to the
 * host page. The API (/api/super-admin/safeguarding) is unchanged.
 *
 * Data source: GET /api/super-admin/safeguarding → { rows: SafeguardingRow[] }
 *   (detail: GET ?id=<uuid> → { row } — the row adds `disclosure_excerpt`)
 * Transitions: PATCH /api/super-admin/safeguarding { id, status, review_notes? }
 *   Dismissal REQUIRES non-empty review_notes (client-enforced here; the
 *   server independently 400s a notes-less dismiss — handled gracefully).
 *
 * PRIVACY: the list view carries IDs + metadata only. The disclosure excerpt
 * is fetched per-row on demand (detail endpoint) and never cached client-side
 * beyond the open drawer.
 */

import { useEffect, useState, useCallback } from 'react';
import { classifyJsonResponse } from '../_components/AdminShell';

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
  /** Present only on the ?id= detail response. */
  disclosure_excerpt?: string | null;
}

type SafeguardingStatus = 'pending_review' | 'reviewed' | 'actioned' | 'dismissed';

const STATUS_TABS: SafeguardingStatus[] = ['pending_review', 'reviewed', 'actioned', 'dismissed'];

const STATUS_LABELS: Record<SafeguardingStatus, string> = {
  pending_review: 'Pending review',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

/** Tier → visual severity. Unknown tiers fall back to neutral. */
function tierBadgeClasses(tier: string): string {
  const t = tier.toLowerCase();
  if (t.includes('1') || t.includes('high') || t.includes('immediate') || t.includes('critical')) {
    return 'bg-red-100 text-red-800 border-red-300';
  }
  if (t.includes('2') || t.includes('medium') || t.includes('elevated')) {
    return 'bg-amber-100 text-amber-800 border-amber-300';
  }
  return 'bg-gray-100 text-gray-700 border-gray-300';
}

function statusBadgeClasses(status: SafeguardingStatus): string {
  switch (status) {
    case 'pending_review': return 'bg-red-50 text-red-700 border-red-200';
    case 'reviewed': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'actioned': return 'bg-green-50 text-green-700 border-green-200';
    case 'dismissed': return 'bg-gray-50 text-gray-600 border-gray-200';
  }
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

function DetailDrawer({
  caseId,
  onClose,
  onChanged,
}: {
  caseId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SafeguardingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<SafeguardingStatus | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/safeguarding?id=${encodeURIComponent(caseId)}`,
        { credentials: 'same-origin' },
      );
      const r = await classifyJsonResponse<unknown>(res);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      // Canonical detail contract: GET ?id= → { row: SafeguardingRow }.
      const row = ((r.data as { row?: SafeguardingRow } | null)?.row as SafeguardingRow | undefined) ?? null;
      setDetail(row);
      if (!row) setError('Case not found');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const transition = useCallback(async (status: SafeguardingStatus) => {
    // Advisory rule (backend enforces 400 in parallel): dismissal requires
    // non-empty review notes. The button is disabled too — this guards races.
    if (status === 'dismissed' && notes.trim() === '') {
      setError('Review notes are required to dismiss a case.');
      return;
    }
    setSaving(status);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/safeguarding', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: caseId,
          status,
          ...(notes.trim() ? { review_notes: notes.trim() } : {}),
        }),
      });
      const r = await classifyJsonResponse<unknown>(res);
      if (!r.ok) {
        // 400 = validation (e.g. server-enforced notes-required-on-dismiss):
        // keep the drawer open and show the server's message.
        setError(r.error.message);
      } else {
        onChanged();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setSaving(null);
    }
  }, [caseId, notes, onChanged, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Safeguarding case detail">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close detail"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div className="relative w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Case detail</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            ✕ Close
          </button>
        </div>

        {loading && (
          <div className="space-y-3 animate-pulse" aria-busy="true">
            <div className="h-4 bg-gray-200 rounded w-2/3" />
            <div className="h-24 bg-gray-100 rounded" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 mb-3" role="alert">
            {error}
          </div>
        )}

        {!loading && detail && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tierBadgeClasses(detail.tier)}`}>
                {detail.tier}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                {detail.category}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBadgeClasses(detail.status)}`}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
            </div>

            <dl className="text-xs text-gray-600 space-y-1 mb-4">
              <div><dt className="inline font-semibold">Student:</dt> <dd className="inline font-mono">{detail.student_id}</dd></div>
              <div><dt className="inline font-semibold">School:</dt> <dd className="inline font-mono">{detail.school_id ?? '—'}</dd></div>
              <div><dt className="inline font-semibold">Created:</dt> <dd className="inline">{formatDateTime(detail.created_at)}</dd></div>
              <div><dt className="inline font-semibold">Reviewed by:</dt> <dd className="inline">{detail.reviewed_by ?? '—'}</dd></div>
              <div><dt className="inline font-semibold">Reviewed at:</dt> <dd className="inline">{formatDateTime(detail.reviewed_at)}</dd></div>
            </dl>

            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-1">Disclosure excerpt</h3>
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-gray-900 whitespace-pre-wrap">
                {detail.disclosure_excerpt || '(no excerpt available)'}
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="review-notes" className="block text-sm font-semibold mb-1">Review notes</label>
              <textarea
                id="review-notes"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm min-h-[80px]"
                placeholder="Notes recorded with the status transition"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving !== null}
                aria-describedby="review-notes-help"
              />
              <p id="review-notes-help" className="mt-1 text-[11px] text-gray-500">
                Review notes are required to dismiss a case.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Set status</h3>
              <div className="flex flex-wrap gap-2">
                {STATUS_TABS.filter((s) => s !== detail.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => transition(s)}
                    disabled={saving !== null || (s === 'dismissed' && notes.trim() === '')}
                    className="rounded bg-purple-600 text-white text-sm px-3 py-2 min-h-[44px] hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving === s ? 'Saving…' : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SafeguardingQueue() {
  const [rows, setRows] = useState<SafeguardingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SafeguardingStatus>('pending_review');
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      const res = await fetch(`/api/super-admin/safeguarding?${params}`, { credentials: 'same-origin' });
      const r = await classifyJsonResponse<unknown>(res);
      if (!r.ok) {
        setError(r.error.message);
        setRows([]);
      } else {
        // The server may pre-filter on ?status=; filter client-side too so the
        // tabs stay correct if it returns the full queue.
        setRows(extractRows(r.data).filter((row) => row.status === status));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1 text-foreground">Safeguarding Review</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Foxy safeguarding disclosures awaiting human review. Excerpts open
        per-case in the detail drawer — handle with care and record notes with
        every status change. Dismissing a case requires review notes.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded border border-gray-300 overflow-hidden" role="tablist" aria-label="Status filter">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`px-3 py-1.5 text-sm ${
                status === s ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {loading ? 'Loading…' : `${rows.length} case${rows.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <span>Error: {error}</span>
          <button
            type="button"
            onClick={fetchList}
            className="shrink-0 rounded border border-red-400 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="rounded border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
          No {STATUS_LABELS[status].toLowerCase()} cases.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-purple-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold">Reviewed by</th>
                <th className="px-3 py-2 font-semibold">Reviewed at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-purple-50/40 cursor-pointer"
                  onClick={() => setOpenCaseId(row.id)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenCaseId(row.id); }}
                  aria-label={`Open case ${row.id}`}
                >
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                      {row.category}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tierBadgeClasses(row.tier)}`}>
                      {row.tier}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBadgeClasses(row.status)}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{row.reviewed_by ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{formatDateTime(row.reviewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div className="space-y-2 animate-pulse" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-gray-100 border border-gray-200" />
          ))}
        </div>
      )}

      {openCaseId && (
        <DetailDrawer
          caseId={openCaseId}
          onClose={() => setOpenCaseId(null)}
          onChanged={fetchList}
        />
      )}
    </div>
  );
}
