'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Badge,
  Skeleton,
  EmptyState,
  SheetModal,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface Announcement {
  id: string;
  title: string;
  title_hi: string | null;
  body: string;
  body_hi: string | null;
  /** Grades as strings "6"–"12" per P5 */
  target_grades: string[];
  target_class_ids: string[];
  published_at: string | null;
  created_at: string;
}

interface SchoolClass {
  id: string;
  name: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
}

type TabFilter = 'published' | 'drafts';

/* ─────────────────────────────────────────────────────────────
   GRADE OPTIONS (strings — P5)
───────────────────────────────────────────────────────────── */
const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

/* ─────────────────────────────────────────────────────────────
   DATE HELPER
───────────────────────────────────────────────────────────── */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function AnnouncementCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton variant="title" height={16} width="60%" />
          <Skeleton variant="text" height={12} width="90%" />
          <Skeleton variant="text" height={12} width="50%" />
        </div>
        <Skeleton variant="rect" height={22} width={72} rounded="rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton variant="rect" height={28} width={64} rounded="rounded-lg" />
        <Skeleton variant="rect" height={28} width={64} rounded="rounded-lg" />
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   ANNOUNCEMENT CARD
───────────────────────────────────────────────────────────── */
interface AnnouncementCardProps {
  announcement: Announcement;
  isHi: boolean;
  onEdit: (a: Announcement) => void;
  onTogglePublish: (a: Announcement) => void;
  onDelete: (a: Announcement) => void;
}

function AnnouncementCard({ announcement, isHi, onEdit, onTogglePublish, onDelete }: AnnouncementCardProps) {
  const isPublished = announcement.published_at !== null;
  const title = isHi && announcement.title_hi ? announcement.title_hi : announcement.title;
  const body = isHi && announcement.body_hi ? announcement.body_hi : announcement.body;
  const bodyPreview = body.length > 100 ? body.slice(0, 100) + '...' : body;

  // Target description
  let targetLabel = t(isHi, 'All students', 'सभी छात्र');
  if (announcement.target_grades.length > 0 && announcement.target_grades.length < GRADE_VALUES.length) {
    targetLabel = t(isHi, 'Grade ', 'कक्षा ') + announcement.target_grades.join(', ');
  } else if (announcement.target_class_ids.length > 0) {
    targetLabel = t(isHi, `${announcement.target_class_ids.length} class(es)`, `${announcement.target_class_ids.length} कक्षा(एँ)`);
  }

  return (
    <Card className="p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3
            className="text-sm font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1 line-clamp-2">
            {bodyPreview}
          </p>
        </div>
        <Badge
          color={isPublished ? 'var(--green)' : '#7D7264'}
          size="sm"
        >
          {isPublished
            ? t(isHi, 'Published', 'प्रकाशित')
            : t(isHi, 'Draft', 'ड्राफ़्ट')}
        </Badge>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <span className="text-xs text-[var(--text-3)]">
          {targetLabel}
        </span>
        <span className="text-xs text-[var(--text-3)]">
          {formatDate(announcement.created_at)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onEdit(announcement)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
            minHeight: 32,
          }}
        >
          {t(isHi, 'Edit', 'संपादित करें')}
        </button>
        <button
          onClick={() => onTogglePublish(announcement)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          style={{
            background: isPublished ? 'rgba(220,38,38,0.06)' : 'rgba(22,163,74,0.06)',
            border: `1px solid ${isPublished ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'}`,
            color: isPublished ? '#DC2626' : '#16A34A',
            minHeight: 32,
          }}
        >
          {isPublished
            ? t(isHi, 'Unpublish', 'अप्रकाशित करें')
            : t(isHi, 'Publish', 'प्रकाशित करें')}
        </button>
        <button
          onClick={() => onDelete(announcement)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          style={{
            background: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.2)',
            color: '#DC2626',
            minHeight: 32,
          }}
        >
          {t(isHi, 'Delete', 'हटाएँ')}
        </button>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   CREATE / EDIT ANNOUNCEMENT FORM (inside SheetModal)
───────────────────────────────────────────────────────────── */
interface AnnouncementFormProps {
  isHi: boolean;
  existing?: Announcement | null;
  classes: SchoolClass[];
  onSave: (payload: AnnouncementPayload) => Promise<void>;
  onClose: () => void;
}

interface AnnouncementPayload {
  id?: string;
  title: string;
  title_hi: string;
  body: string;
  body_hi: string;
  target_grades: string[];
  target_class_ids: string[];
  publish_immediately: boolean;
}

function AnnouncementForm({ isHi, existing, classes, onSave, onClose }: AnnouncementFormProps) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [titleHi, setTitleHi] = useState(existing?.title_hi ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [bodyHi, setBodyHi] = useState(existing?.body_hi ?? '');
  const [selectedGrades, setSelectedGrades] = useState<Set<string>>(
    new Set(existing?.target_grades ?? [])
  );
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(existing?.target_class_ids ?? [])
  );
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleGrade = (g: string) => {
    setSelectedGrades(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const toggleClass = (id: string) => {
    setSelectedClassIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setFormError(t(isHi, 'Title is required', 'शीर्षक आवश्यक है'));
      return;
    }
    if (!body.trim()) {
      setFormError(t(isHi, 'Body is required', 'विवरण आवश्यक है'));
      return;
    }

    setFormError(null);
    setSubmitting(true);

    try {
      await onSave({
        id: existing?.id,
        title: title.trim(),
        title_hi: titleHi.trim(),
        body: body.trim(),
        body_hi: bodyHi.trim(),
        target_grades: Array.from(selectedGrades),
        target_class_ids: Array.from(selectedClassIds),
        publish_immediately: publishImmediately,
      });
      onClose();
    } catch (err: any) {
      setFormError(err.message || t(isHi, 'Failed to save', 'सहेजने में विफल'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">
      {/* Title row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label={t(isHi, 'Title (English)', 'शीर्षक (अंग्रेज़ी)')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(isHi, 'Announcement title', 'घोषणा शीर्षक')}
          autoFocus
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'Title (Hindi)', 'शीर्षक (हिंदी)')}
          value={titleHi}
          onChange={(e) => setTitleHi(e.target.value)}
          placeholder={t(isHi, 'Hindi title (optional)', 'हिंदी शीर्षक (वैकल्पिक)')}
          style={{ minHeight: 48 }}
        />
      </div>

      {/* Body row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label
            className="block text-xs font-semibold mb-1.5"
            style={{ color: 'var(--text-2)' }}
          >
            {t(isHi, 'Body (English)', 'विवरण (अंग्रेज़ी)')}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t(isHi, 'Announcement body', 'घोषणा विवरण')}
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--text-1)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
        <div>
          <label
            className="block text-xs font-semibold mb-1.5"
            style={{ color: 'var(--text-2)' }}
          >
            {t(isHi, 'Body (Hindi)', 'विवरण (हिंदी)')}
          </label>
          <textarea
            value={bodyHi}
            onChange={(e) => setBodyHi(e.target.value)}
            placeholder={t(isHi, 'Hindi body (optional)', 'हिंदी विवरण (वैकल्पिक)')}
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--text-1)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
      </div>

      {/* Target Grades — P5: grades are strings */}
      <div>
        <label
          className="block text-xs font-semibold mb-2"
          style={{ color: 'var(--text-2)' }}
        >
          {t(isHi, 'Target Grades', 'लक्षित कक्षाएँ')}
        </label>
        <div className="flex flex-wrap gap-2">
          {GRADE_VALUES.map(g => (
            <label
              key={g}
              className="flex items-center gap-1.5 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={selectedGrades.has(g)}
                onChange={() => toggleGrade(g)}
                style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
              />
              <span className="text-xs font-medium text-[var(--text-2)]">
                {t(isHi, `Grade ${g}`, `कक्षा ${g}`)}
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-3)] mt-1">
          {t(isHi, 'Leave all unchecked to target all students', 'सभी छात्रों के लिए सभी अनचेक रखें')}
        </p>
      </div>

      {/* Target Classes */}
      {classes.length > 0 && (
        <div>
          <label
            className="block text-xs font-semibold mb-2"
            style={{ color: 'var(--text-2)' }}
          >
            {t(isHi, 'Target Classes', 'लक्षित कक्षा समूह')}
          </label>
          <div
            style={{
              maxHeight: 150,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '8px 12px',
              background: 'var(--surface-1)',
            }}
          >
            {classes.map(cls => (
              <label
                key={cls.id}
                className="flex items-center gap-2 py-1.5 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={selectedClassIds.has(cls.id)}
                  onChange={() => toggleClass(cls.id)}
                  style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                />
                <span className="text-xs font-medium text-[var(--text-2)]">
                  {cls.name} ({t(isHi, `Grade ${cls.grade}`, `कक्षा ${cls.grade}`)})
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Publish immediately */}
      {!existing?.published_at && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={publishImmediately}
            onChange={() => setPublishImmediately(p => !p)}
            style={{ accentColor: 'var(--orange)', width: 18, height: 18 }}
          />
          <span className="text-sm font-medium text-[var(--text-1)]">
            {t(isHi, 'Publish immediately', 'तुरंत प्रकाशित करें')}
          </span>
        </label>
      )}

      {/* Error */}
      {formError && (
        <p
          className="text-xs font-medium px-1"
          style={{ color: '#DC2626' }}
          role="alert"
        >
          {formError}
        </p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          fullWidth
          disabled={submitting}
          style={{ minHeight: 48 }}
        >
          {submitting
            ? t(isHi, 'Saving...', 'सहेज रहे हैं...')
            : existing
              ? t(isHi, 'Update Announcement', 'घोषणा अपडेट करें')
              : t(isHi, 'Create Announcement', 'घोषणा बनाएं')}
        </Button>
        <Button
          type="button"
          variant="soft"
          onClick={onClose}
          style={{ minHeight: 48 }}
        >
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   DELETE CONFIRMATION
───────────────────────────────────────────────────────────── */
interface DeleteConfirmProps {
  isHi: boolean;
  announcementTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteConfirm({ isHi, announcementTitle, onConfirm, onCancel, loading }: DeleteConfirmProps) {
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--text-2)]">
        {t(isHi,
          `Are you sure you want to delete "${announcementTitle}"? This action cannot be undone.`,
          `क्या आप "${announcementTitle}" को हटाना चाहते हैं? यह कार्रवाई पूर्ववत नहीं की जा सकती।`
        )}
      </p>
      <div className="flex gap-3">
        <Button
          variant="primary"
          fullWidth
          onClick={onConfirm}
          disabled={loading}
          style={{ minHeight: 48, background: '#DC2626' }}
        >
          {loading
            ? t(isHi, 'Deleting...', 'हटा रहे हैं...')
            : t(isHi, 'Delete', 'हटाएँ')}
        </Button>
        <Button
          variant="soft"
          onClick={onCancel}
          style={{ minHeight: 48 }}
        >
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminAnnouncementsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabFilter>('published');
  const [classes, setClasses] = useState<SchoolClass[]>([]);

  /* Modal state */
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* Success toast */
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* ── Auth helper: get session token ── */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  /* ── Step 1: Auth guard — fetch school_admins record ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);

    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id, name')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Fetch announcements via API ── */
  const fetchAnnouncements = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setLoadingAnnouncements(true);
    setApiError(null);

    try {
      const res = await fetch('/api/school-admin/announcements', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setAnnouncements((json.data ?? []) as Announcement[]);
    } catch (err: any) {
      setApiError(err.message || t(isHi, 'Failed to load announcements', 'घोषणाएँ लोड करने में विफल'));
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [getToken, isHi]);

  /* ── Fetch classes for targeting ── */
  const fetchClasses = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/school-admin/classes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setClasses((json.data ?? []) as SchoolClass[]);
      }
    } catch {
      // Non-critical; class targeting will just be unavailable
    }
  }, [getToken]);

  /* ── Save announcement (create / update) ── */
  const handleSave = useCallback(async (payload: AnnouncementPayload) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const method = payload.id ? 'PUT' : 'POST';
    const res = await fetch('/api/school-admin/announcements', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');

    setSuccessMsg(
      payload.id
        ? t(isHi, 'Announcement updated!', 'घोषणा अपडेट हो गई!')
        : t(isHi, 'Announcement created!', 'घोषणा बनाई गई!')
    );
    fetchAnnouncements();
  }, [getToken, isHi, fetchAnnouncements]);

  /* ── Toggle publish / unpublish ── */
  const handleTogglePublish = useCallback(async (announcement: Announcement) => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/school-admin/announcements', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: announcement.id,
          action: announcement.published_at ? 'unpublish' : 'publish',
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      setSuccessMsg(
        announcement.published_at
          ? t(isHi, 'Announcement unpublished', 'घोषणा अप्रकाशित हो गई')
          : t(isHi, 'Announcement published!', 'घोषणा प्रकाशित हो गई!')
      );
      fetchAnnouncements();
    } catch (err: any) {
      setApiError(err.message);
    }
  }, [getToken, isHi, fetchAnnouncements]);

  /* ── Delete announcement ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const token = await getToken();
    if (!token) return;

    setDeleteLoading(true);
    try {
      const res = await fetch('/api/school-admin/announcements', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: deleteTarget.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      setSuccessMsg(t(isHi, 'Announcement deleted', 'घोषणा हटाई गई'));
      setDeleteTarget(null);
      fetchAnnouncements();
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, getToken, isHi, fetchAnnouncements]);

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record once auth is ready ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ── Fetch announcements + classes once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchAnnouncements();
      fetchClasses();
    }
  }, [schoolId, fetchAnnouncements, fetchClasses]);

  /* ── Auto-dismiss success message ── */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3500);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /* ── Filter by tab ── */
  const publishedAnnouncements = announcements.filter(a => a.published_at !== null);
  const draftAnnouncements = announcements.filter(a => a.published_at === null);
  const displayedAnnouncements = activeTab === 'published' ? publishedAnnouncements : draftAnnouncements;

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ── Open edit modal ── */
  const openCreate = () => {
    setEditingAnnouncement(null);
    setFormModalOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingAnnouncement(a);
    setFormModalOpen(true);
  };

  /* ══════════════════════════════════════════════════════════
     PAGE HEADER
  ══════════════════════════════════════════════════════════ */
  const PageHeader = (
    <header
      className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
      style={{
        background: 'rgba(251,248,244,0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Back button */}
      <button
        onClick={() => router.push('/school-admin')}
        className="flex items-center justify-center rounded-xl transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          fontSize: '18px',
        }}
        aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस')}
      >
        ←
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Announcements', 'घोषणाएँ')}
        </h1>
      </div>

      {/* Language toggle */}
      <button
        onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
        className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}
        aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
      >
        {isHi ? 'EN' : 'हि'}
      </button>

      {/* Create button */}
      <Button
        variant="primary"
        size="sm"
        onClick={openCreate}
        style={{ minHeight: 44, flexShrink: 0 }}
        aria-label={t(isHi, 'Create Announcement', 'घोषणा बनाएं')}
      >
        + {t(isHi, 'Create', 'बनाएं')}
      </Button>
    </header>
  );

  /* ══════════════════════════════════════════════════════════
     TAB BAR
  ══════════════════════════════════════════════════════════ */
  const TabBar = (
    <div
      className="flex gap-1 rounded-xl p-1"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      role="tablist"
    >
      {(['published', 'drafts'] as TabFilter[]).map(tab => {
        const isActive = activeTab === tab;
        const count = tab === 'published' ? publishedAnnouncements.length : draftAnnouncements.length;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: isActive ? 'var(--surface-1)' : 'transparent',
              color: isActive ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab === 'published'
              ? t(isHi, 'Published', 'प्रकाशित')
              : t(isHi, 'Drafts', 'ड्राफ़्ट')}{' '}
            ({count})
          </button>
        );
      })}
    </div>
  );

  /* ══════════════════════════════════════════════════════════
     FULL PAGE LOADING SKELETON
  ══════════════════════════════════════════════════════════ */
  if (isPageLoading) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(251,248,244,0.94)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="title" height={20} width="40%" className="flex-1" />
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="rect" width={90} height={44} rounded="rounded-xl" />
        </header>
        <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-3">
          <Skeleton variant="rect" height={40} rounded="rounded-xl" />
          {[1, 2, 3].map(i => <AnnouncementCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     ERROR STATE
  ══════════════════════════════════════════════════════════ */
  if (apiError && !loadingAnnouncements && announcements.length === 0) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-2xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{apiError}</p>
            <Button
              variant="primary"
              onClick={fetchAnnouncements}
            >
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     LOADED STATE
  ══════════════════════════════════════════════════════════ */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {PageHeader}

      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-4">

        {/* Tab bar */}
        {TabBar}

        {/* Loading skeleton for announcements */}
        {loadingAnnouncements && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <AnnouncementCardSkeleton key={i} />)}
          </div>
        )}

        {/* Announcement list */}
        {!loadingAnnouncements && displayedAnnouncements.length > 0 && (
          <section
            aria-label={t(isHi, 'Announcement list', 'घोषणाओं की सूची')}
            className="space-y-3"
          >
            {displayedAnnouncements.map(a => (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                isHi={isHi}
                onEdit={openEdit}
                onTogglePublish={handleTogglePublish}
                onDelete={setDeleteTarget}
              />
            ))}
          </section>
        )}

        {/* Empty state: Published tab */}
        {!loadingAnnouncements && activeTab === 'published' && publishedAnnouncements.length === 0 && (
          <EmptyState
            icon="📢"
            title={t(isHi, 'No announcements yet', 'अभी कोई घोषणा नहीं')}
            description={t(
              isHi,
              'Create your first announcement to communicate with students.',
              'छात्रों के साथ संवाद करने के लिए अपनी पहली घोषणा बनाएं।'
            )}
            action={
              <Button variant="primary" onClick={openCreate} style={{ minHeight: 48 }}>
                + {t(isHi, 'Create Announcement', 'घोषणा बनाएं')}
              </Button>
            }
          />
        )}

        {/* Empty state: Drafts tab */}
        {!loadingAnnouncements && activeTab === 'drafts' && draftAnnouncements.length === 0 && (
          <EmptyState
            icon="📝"
            title={t(isHi, 'No drafts', 'कोई ड्राफ़्ट नहीं')}
            description={t(
              isHi,
              'Published announcements appear in the Published tab.',
              'प्रकाशित घोषणाएँ प्रकाशित टैब में दिखाई देती हैं।'
            )}
          />
        )}
      </main>

      {/* ── Create / Edit Modal ── */}
      <SheetModal
        open={formModalOpen}
        onClose={() => { setFormModalOpen(false); setEditingAnnouncement(null); }}
        title={editingAnnouncement
          ? t(isHi, 'Edit Announcement', 'घोषणा संपादित करें')
          : t(isHi, 'Create Announcement', 'घोषणा बनाएं')}
      >
        <AnnouncementForm
          isHi={isHi}
          existing={editingAnnouncement}
          classes={classes}
          onSave={handleSave}
          onClose={() => { setFormModalOpen(false); setEditingAnnouncement(null); }}
        />
      </SheetModal>

      {/* ── Delete Confirmation Modal ── */}
      <SheetModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t(isHi, 'Delete Announcement', 'घोषणा हटाएँ')}
      >
        {deleteTarget && (
          <DeleteConfirm
            isHi={isHi}
            announcementTitle={deleteTarget.title}
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
            loading={deleteLoading}
          />
        )}
      </SheetModal>

      {/* ── Success Toast ── */}
      {successMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl text-sm font-semibold text-white shadow-lg pointer-events-none animate-fade-in"
          style={{
            background: 'rgba(22,163,74,0.92)',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
          role="status"
          aria-live="polite"
        >
          {successMsg}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
