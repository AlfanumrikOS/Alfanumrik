/** @license Apache-2.0 */
/**
 * /super-admin/announcements — Gate-2 D1: global announcements CRUD.
 *
 * admin_announcements existed in the DB with RLS but had zero UI/API before
 * this page (see api/super-admin/announcements/route.ts header). Distinct
 * from the per-school `school_announcements` feature under /school-admin —
 * this one is platform-wide, not scoped to a single institution.
 *
 * No delete: `is_active` is the archive toggle (soft delete), matching the
 * column the table already defines rather than adding a new RLS policy.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import DataTable, { type Column } from '@alfanumrik/ui/admin-ui/DataTable';
import { AdminErrorState } from '@alfanumrik/ui/admin-ui';
import { AdminDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

interface Announcement {
  id: string;
  title: string;
  content: string;
  target_grades: string[] | null;
  target_subjects: string[] | null;
  is_active: boolean | null;
  created_at: string | null;
  expires_at: string | null;
  [key: string]: unknown;
}

function parseListInput(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function AnnouncementsInner() {
  const { apiFetchJson } = useAdmin();
  const { isHi } = useAuth();

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [grades, setGrades] = useState('');
  const [subjects, setSubjects] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetchJson<{ items: Announcement[] }>('/api/super-admin/announcements');
    if (!res.ok) {
      setError(res.error.message);
    } else {
      setItems(res.data.items);
    }
    setLoading(false);
  }, [apiFetchJson]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = useCallback(async () => {
    setFormError(null);
    if (!title.trim() || !content.trim()) {
      setFormError(isHi ? 'शीर्षक और सामग्री आवश्यक हैं।' : 'Title and content are required.');
      return;
    }
    setSubmitting(true);
    const res = await apiFetchJson('/api/super-admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        content: content.trim(),
        target_grades: parseListInput(grades),
        target_subjects: parseListInput(subjects),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.error.message);
      return;
    }
    setTitle('');
    setContent('');
    setGrades('');
    setSubjects('');
    setExpiresAt('');
    await fetchAll();
  }, [apiFetchJson, title, content, grades, subjects, expiresAt, fetchAll, isHi]);

  const handleToggleActive = useCallback(async (row: Announcement) => {
    const res = await apiFetchJson(`/api/super-admin/announcements/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !row.is_active }),
    });
    if (res.ok) await fetchAll();
  }, [apiFetchJson, fetchAll]);

  const columns: Column<Announcement>[] = [
    { key: 'title', label: isHi ? 'शीर्षक' : 'Title' },
    {
      key: 'content',
      label: isHi ? 'सामग्री' : 'Content',
      render: (row) => (
        <span className="line-clamp-2 max-w-md text-muted-foreground">{row.content}</span>
      ),
    },
    {
      key: 'target_grades',
      label: isHi ? 'कक्षाएँ' : 'Grades',
      render: (row) => (row.target_grades?.length ? row.target_grades.join(', ') : (isHi ? 'सभी' : 'All')),
    },
    {
      key: 'target_subjects',
      label: isHi ? 'विषय' : 'Subjects',
      render: (row) => (row.target_subjects?.length ? row.target_subjects.join(', ') : (isHi ? 'सभी' : 'All')),
    },
    {
      key: 'expires_at',
      label: isHi ? 'समाप्ति' : 'Expires',
      render: (row) => (row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '—'),
    },
    {
      key: 'is_active',
      label: isHi ? 'स्थिति' : 'Status',
      render: (row) => (
        <button
          type="button"
          onClick={() => handleToggleActive(row)}
          className="min-h-[32px] rounded-md border border-surface-3 px-2.5 py-1 text-xs font-semibold"
          style={{
            color: row.is_active ? 'var(--green-strong, #16A34A)' : 'var(--muted-foreground)',
          }}
        >
          {row.is_active ? (isHi ? 'सक्रिय' : 'Active') : (isHi ? 'निष्क्रिय' : 'Inactive')}
        </button>
      ),
    },
  ];

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-xl font-bold text-foreground">
        {isHi ? 'वैश्विक घोषणाएँ' : 'Global Announcements'}
      </h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {isHi
          ? 'प्लेटफ़ॉर्म-व्यापी घोषणाएँ बनाएँ, वैकल्पिक रूप से कक्षा/विषय द्वारा लक्षित।'
          : 'Create platform-wide announcements, optionally targeted by grade/subject.'}
      </p>

      <div className="mb-6 rounded-xl border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          {isHi ? 'नई घोषणा' : 'New announcement'}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isHi ? 'शीर्षक' : 'Title'}
            maxLength={200}
            className="min-h-[44px] rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-foreground"
          />
          <input
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            type="date"
            className="min-h-[44px] rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-foreground"
            aria-label={isHi ? 'समाप्ति तिथि (वैकल्पिक)' : 'Expiry date (optional)'}
          />
          <input
            value={grades}
            onChange={(e) => setGrades(e.target.value)}
            placeholder={isHi ? 'कक्षाएँ, अल्पविराम से अलग (खाली = सभी)' : 'Grades, comma-separated (blank = all)'}
            className="min-h-[44px] rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-foreground"
          />
          <input
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder={isHi ? 'विषय, अल्पविराम से अलग (खाली = सभी)' : 'Subjects, comma-separated (blank = all)'}
            className="min-h-[44px] rounded-md border border-surface-3 bg-surface-1 px-3 text-sm text-foreground"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={isHi ? 'सामग्री' : 'Content'}
            maxLength={5000}
            rows={3}
            className="min-h-[88px] rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm text-foreground md:col-span-2"
          />
        </div>
        {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting}
          className="mt-3 min-h-[44px] rounded-md px-4 text-sm font-semibold text-on-accent"
          style={{ background: 'var(--purple, #7C3AED)', opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? (isHi ? 'बना रहे हैं...' : 'Creating...') : (isHi ? 'प्रकाशित करें' : 'Publish')}
        </button>
      </div>

      {loading ? (
        <AdminDashboardSkeleton />
      ) : error ? (
        <AdminErrorState message={error} onRetry={fetchAll} />
      ) : (
        <DataTable<Announcement>
          columns={columns}
          data={items}
          keyField="id"
          emptyMessage={isHi ? 'अभी तक कोई घोषणा नहीं' : 'No announcements yet'}
        />
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <AdminShell>
      <AnnouncementsInner />
    </AdminShell>
  );
}
