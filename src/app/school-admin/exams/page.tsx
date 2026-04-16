'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
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
   CONSTANTS
───────────────────────────────────────────────────────────── */
/** P5: Grades are always strings */
const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

const SUBJECT_OPTIONS = [
  { value: '', label: 'All Subjects', labelHi: 'सभी विषय' },
  { value: 'Mathematics', label: 'Mathematics', labelHi: 'गणित' },
  { value: 'Science', label: 'Science', labelHi: 'विज्ञान' },
  { value: 'English', label: 'English', labelHi: 'अंग्रेज़ी' },
  { value: 'Social Science', label: 'Social Science', labelHi: 'सामाजिक विज्ञान' },
  { value: 'Hindi', label: 'Hindi', labelHi: 'हिंदी' },
  { value: 'Computer Science', label: 'Computer Science', labelHi: 'कंप्यूटर विज्ञान' },
];

type ExamStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';

const STATUS_FILTER_EN = [
  { value: '', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_FILTER_HI = [
  { value: '', label: 'सभी स्थिति' },
  { value: 'draft', label: 'ड्राफ़्ट' },
  { value: 'scheduled', label: 'निर्धारित' },
  { value: 'active', label: 'सक्रिय' },
  { value: 'completed', label: 'पूर्ण' },
  { value: 'cancelled', label: 'रद्द' },
];

const GRADE_FILTER_EN = [
  { value: '', label: 'All Grades' },
  ...GRADE_VALUES.map(g => ({ value: g, label: `Grade ${g}` })),
];

const GRADE_FILTER_HI = [
  { value: '', label: 'सभी कक्षा' },
  ...GRADE_VALUES.map(g => ({ value: g, label: `कक्षा ${g}` })),
];

const PAGE_SIZE = 20;

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface SchoolClass {
  id: string;
  name: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
}

interface Exam {
  id: string;
  title: string;
  subject: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
  target_class_ids: string[];
  target_class_names: string[];
  question_count: number;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  status: ExamStatus;
  created_at: string;
}

interface ExamFormData {
  title: string;
  subject: string;
  grade: string;
  target_class_ids: string[];
  question_count: number;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  status: 'draft' | 'scheduled';
}

interface FormErrors {
  title?: string;
  subject?: string;
  grade?: string;
  question_count?: string;
  duration_minutes?: string;
  start_time?: string;
  end_time?: string;
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ', ' + d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateRange(startStr: string, endStr: string): string {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const sameDay = start.toDateString() === end.toDateString();

  const datePart = start.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
  });
  const startTime = start.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const endTime = end.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (sameDay) {
    return `${datePart}, ${startTime} - ${endTime}`;
  }
  return `${formatDateTime(startStr)} - ${formatDateTime(endStr)}`;
}

function statusColor(status: ExamStatus): string {
  switch (status) {
    case 'draft': return '#7D7264';
    case 'scheduled': return '#3B82F6';
    case 'active': return '#22C55E';
    case 'completed': return '#6B7280';
    case 'cancelled': return '#EF4444';
    default: return 'var(--text-3)';
  }
}

function statusLabel(status: ExamStatus, isHi: boolean): string {
  switch (status) {
    case 'draft': return t(isHi, 'Draft', 'ड्राफ़्ट');
    case 'scheduled': return t(isHi, 'Scheduled', 'निर्धारित');
    case 'active': return t(isHi, 'Active', 'सक्रिय');
    case 'completed': return t(isHi, 'Completed', 'पूर्ण');
    case 'cancelled': return t(isHi, 'Cancelled', 'रद्द');
    default: return status;
  }
}

/** Convert datetime-local value to ISO string for display */
function toDatetimeLocal(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  // Adjust for local timezone
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

/* ─────────────────────────────────────────────────────────────
   FORM VALIDATION
───────────────────────────────────────────────────────────── */
function validateExam(data: ExamFormData, isHi: boolean, isEditing: boolean): FormErrors {
  const errors: FormErrors = {};

  if (!data.title.trim()) {
    errors.title = t(isHi, 'Title is required', 'शीर्षक आवश्यक है');
  }
  if (!data.subject) {
    errors.subject = t(isHi, 'Subject is required', 'विषय आवश्यक है');
  }
  if (!data.grade) {
    errors.grade = t(isHi, 'Grade is required', 'कक्षा आवश्यक है');
  }
  if (data.question_count < 5 || data.question_count > 100) {
    errors.question_count = t(isHi, 'Question count must be 5-100', 'प्रश्नों की संख्या 5-100 होनी चाहिए');
  }
  if (data.duration_minutes < 10 || data.duration_minutes > 180) {
    errors.duration_minutes = t(isHi, 'Duration must be 10-180 minutes', 'अवधि 10-180 मिनट होनी चाहिए');
  }
  if (!data.start_time) {
    errors.start_time = t(isHi, 'Start time is required', 'प्रारंभ समय आवश्यक है');
  }
  if (!data.end_time) {
    errors.end_time = t(isHi, 'End time is required', 'समाप्ति समय आवश्यक है');
  }
  if (data.start_time && data.end_time) {
    const start = new Date(data.start_time);
    const end = new Date(data.end_time);
    if (end <= start) {
      errors.end_time = t(isHi, 'End time must be after start time', 'समाप्ति समय प्रारंभ समय के बाद होना चाहिए');
    }
    if (!isEditing && start <= new Date()) {
      errors.start_time = t(isHi, 'Start time must be in the future', 'प्रारंभ समय भविष्य में होना चाहिए');
    }
  }

  return errors;
}

/* ─────────────────────────────────────────────────────────────
   SKELETON
───────────────────────────────────────────────────────────── */
function ExamCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton variant="title" height={16} width="50%" />
          <Skeleton variant="text" height={12} width="70%" />
          <Skeleton variant="text" height={12} width="40%" />
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
   UPCOMING EXAM CARD
───────────────────────────────────────────────────────────── */
interface ExamCardProps {
  exam: Exam;
  isHi: boolean;
  onEdit: (e: Exam) => void;
  onStatusChange: (e: Exam, newStatus: ExamStatus) => void;
}

function UpcomingExamCard({ exam, isHi, onEdit, onStatusChange }: ExamCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3
            className="text-sm font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {exam.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-[var(--text-2)]">{exam.subject}</span>
            <Badge color="var(--purple)" size="sm">
              {t(isHi, `Grade ${exam.grade}`, `कक्षा ${exam.grade}`)}
            </Badge>
          </div>
        </div>
        <Badge color={statusColor(exam.status)} size="sm">
          {statusLabel(exam.status, isHi)}
        </Badge>
      </div>

      {/* Date/time */}
      <p className="text-xs text-[var(--text-3)] mt-2">
        {formatDateRange(exam.start_time, exam.end_time)}
      </p>

      {/* Meta */}
      <div className="flex items-center gap-4 mt-2">
        <span className="text-xs text-[var(--text-3)]">
          {exam.question_count} {t(isHi, 'questions', 'प्रश्न')}
        </span>
        <span className="text-xs text-[var(--text-3)]">
          {exam.duration_minutes} {t(isHi, 'min', 'मिनट')}
        </span>
        {exam.target_class_names.length > 0 && (
          <span className="text-xs text-[var(--text-3)]">
            {exam.target_class_names.join(', ')}
          </span>
        )}
      </div>

      {/* Actions based on status */}
      <div className="flex items-center gap-2 mt-3">
        {(exam.status === 'draft' || exam.status === 'scheduled') && (
          <button
            onClick={() => onEdit(exam)}
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
        )}
        {exam.status === 'draft' && (
          <button
            onClick={() => onStatusChange(exam, 'scheduled')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'rgba(59,130,246,0.06)',
              border: '1px solid rgba(59,130,246,0.2)',
              color: '#3B82F6',
              minHeight: 32,
            }}
          >
            {t(isHi, 'Schedule', 'निर्धारित करें')}
          </button>
        )}
        {exam.status === 'scheduled' && (
          <>
            <button
              onClick={() => onStatusChange(exam, 'active')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{
                background: 'rgba(22,163,74,0.06)',
                border: '1px solid rgba(22,163,74,0.2)',
                color: '#16A34A',
                minHeight: 32,
              }}
            >
              {t(isHi, 'Start Now', 'अभी शुरू करें')}
            </button>
            <button
              onClick={() => onStatusChange(exam, 'cancelled')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.2)',
                color: '#DC2626',
                minHeight: 32,
              }}
            >
              {t(isHi, 'Cancel', 'रद्द करें')}
            </button>
          </>
        )}
        {exam.status === 'active' && (
          <>
            <button
              onClick={() => onStatusChange(exam, 'completed')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{
                background: 'rgba(107,114,128,0.06)',
                border: '1px solid rgba(107,114,128,0.2)',
                color: '#6B7280',
                minHeight: 32,
              }}
            >
              {t(isHi, 'Complete', 'पूर्ण करें')}
            </button>
            <button
              onClick={() => onStatusChange(exam, 'cancelled')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{
                background: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.2)',
                color: '#DC2626',
                minHeight: 32,
              }}
            >
              {t(isHi, 'Cancel', 'रद्द करें')}
            </button>
          </>
        )}
        {exam.status === 'completed' && (
          <button
            onClick={() => {/* View results - placeholder */}}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              minHeight: 32,
            }}
          >
            {t(isHi, 'View Results', 'परिणाम देखें')}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   EXAM FORM COMPONENT
───────────────────────────────────────────────────────────── */
interface ExamFormProps {
  isHi: boolean;
  existing?: Exam | null;
  classes: SchoolClass[];
  onSave: (payload: any) => Promise<void>;
  onClose: () => void;
}

function ExamForm({ isHi, existing, classes, onSave, onClose }: ExamFormProps) {
  const [form, setForm] = useState<ExamFormData>({
    title: existing?.title ?? '',
    subject: existing?.subject ?? '',
    grade: existing?.grade ?? '',
    target_class_ids: existing?.target_class_ids ?? [],
    question_count: existing?.question_count ?? 20,
    duration_minutes: existing?.duration_minutes ?? 30,
    start_time: existing?.start_time ? toDatetimeLocal(existing.start_time) : '',
    end_time: existing?.end_time ? toDatetimeLocal(existing.end_time) : '',
    status: (existing?.status === 'draft' || existing?.status === 'scheduled') ? existing.status : 'draft',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update = (key: keyof ExamFormData, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const toggleClass = (classId: string) => {
    setForm(prev => {
      const ids = prev.target_class_ids.includes(classId)
        ? prev.target_class_ids.filter(id => id !== classId)
        : [...prev.target_class_ids, classId];
      return { ...prev, target_class_ids: ids };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateExam(form, isHi, !!existing);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSave({
        id: existing?.id,
        title: form.title.trim(),
        subject: form.subject,
        grade: form.grade, // P5: string
        target_class_ids: form.target_class_ids,
        question_count: form.question_count,
        duration_minutes: form.duration_minutes,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        status: form.status,
      });
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || t(isHi, 'Failed to save exam', 'परीक्षा सहेजने में विफल'));
    } finally {
      setSubmitting(false);
    }
  };

  const subjectOpts = SUBJECT_OPTIONS.slice(1).map(s => ({
    value: s.value,
    label: isHi ? s.labelHi : s.label,
  }));
  const gradeOpts = GRADE_VALUES.map(g => ({
    value: g,
    label: t(isHi, `Grade ${g}`, `कक्षा ${g}`),
  }));

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">
      {/* Title */}
      <Input
        label={t(isHi, 'Exam Title', 'परीक्षा शीर्षक') + ' *'}
        value={form.title}
        onChange={(e) => update('title', e.target.value)}
        placeholder={t(isHi, 'e.g. Mid-Term Mathematics', 'उदा. मध्यावधि गणित')}
        error={errors.title}
        autoFocus
        style={{ minHeight: 48 }}
      />

      {/* Subject + Grade */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <Select
            label={t(isHi, 'Subject', 'विषय') + ' *'}
            value={form.subject}
            onChange={(v) => update('subject', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...subjectOpts]}
          />
          {errors.subject && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.subject}</p>
          )}
        </div>
        <div>
          <Select
            label={t(isHi, 'Grade', 'कक्षा') + ' *'}
            value={form.grade}
            onChange={(v) => update('grade', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...gradeOpts]}
          />
          {errors.grade && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.grade}</p>
          )}
        </div>
      </div>

      {/* Target Classes (optional multi-select) */}
      {classes.length > 0 && (
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
            {t(isHi, 'Target Classes (optional)', 'लक्षित कक्षा समूह (वैकल्पिक)')}
          </label>
          <div
            style={{
              maxHeight: 130,
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
                  checked={form.target_class_ids.includes(cls.id)}
                  onChange={() => toggleClass(cls.id)}
                  style={{ accentColor: 'var(--orange)', width: 16, height: 16 }}
                />
                <span className="text-xs font-medium text-[var(--text-2)]">
                  {cls.name} ({t(isHi, `Grade ${cls.grade}`, `कक्षा ${cls.grade}`)})
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--text-3)] mt-1">
            {t(isHi, 'Leave all unchecked to include all classes', 'सभी अनचेक रखें सभी कक्षाओं को शामिल करने के लिए')}
          </p>
        </div>
      )}

      {/* Question Count + Duration */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label={t(isHi, 'Question Count', 'प्रश्नों की संख्या') + ' *'}
          type="number"
          min={5}
          max={100}
          value={String(form.question_count)}
          onChange={(e) => update('question_count', Math.max(0, parseInt(e.target.value) || 0))}
          error={errors.question_count}
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'Duration (minutes)', 'अवधि (मिनट)') + ' *'}
          type="number"
          min={10}
          max={180}
          value={String(form.duration_minutes)}
          onChange={(e) => update('duration_minutes', Math.max(0, parseInt(e.target.value) || 0))}
          error={errors.duration_minutes}
          style={{ minHeight: 48 }}
        />
      </div>

      {/* Start/End Time */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label={t(isHi, 'Start Date & Time', 'प्रारंभ तिथि और समय') + ' *'}
          type="datetime-local"
          value={form.start_time}
          onChange={(e) => update('start_time', e.target.value)}
          error={errors.start_time}
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'End Date & Time', 'समाप्ति तिथि और समय') + ' *'}
          type="datetime-local"
          value={form.end_time}
          onChange={(e) => update('end_time', e.target.value)}
          error={errors.end_time}
          style={{ minHeight: 48 }}
        />
      </div>

      {/* Status */}
      <Select
        label={t(isHi, 'Status', 'स्थिति')}
        value={form.status}
        onChange={(v) => update('status', v)}
        options={[
          { value: 'draft', label: t(isHi, 'Draft', 'ड्राफ़्ट') },
          { value: 'scheduled', label: t(isHi, 'Scheduled', 'निर्धारित') },
        ]}
      />

      {/* Submit error */}
      {submitError && (
        <p className="text-xs font-medium px-1" style={{ color: '#DC2626' }} role="alert">{submitError}</p>
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
              ? t(isHi, 'Update Exam', 'परीक्षा अपडेट करें')
              : t(isHi, 'Create Exam', 'परीक्षा बनाएं')}
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
   STATUS CHANGE CONFIRMATION
───────────────────────────────────────────────────────────── */
interface StatusConfirmProps {
  isHi: boolean;
  examTitle: string;
  newStatus: ExamStatus;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function StatusChangeConfirm({ isHi, examTitle, newStatus, onConfirm, onCancel, loading }: StatusConfirmProps) {
  const actionDescriptions: Record<ExamStatus, { en: string; hi: string }> = {
    scheduled: { en: `schedule "${examTitle}"`, hi: `"${examTitle}" को निर्धारित करना` },
    active: { en: `start "${examTitle}" now`, hi: `"${examTitle}" अभी शुरू करना` },
    completed: { en: `mark "${examTitle}" as completed`, hi: `"${examTitle}" को पूर्ण करना` },
    cancelled: { en: `cancel "${examTitle}"`, hi: `"${examTitle}" को रद्द करना` },
    draft: { en: `revert "${examTitle}" to draft`, hi: `"${examTitle}" को ड्राफ़्ट में वापस करना` },
  };

  const desc = actionDescriptions[newStatus] ?? { en: `change status of "${examTitle}"`, hi: `"${examTitle}" की स्थिति बदलना` };

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--text-2)]">
        {t(isHi,
          `Are you sure you want to ${desc.en}?`,
          `क्या आप ${desc.hi} चाहते हैं?`
        )}
      </p>
      {newStatus === 'cancelled' && (
        <p className="text-xs text-[var(--text-3)]">
          {t(isHi, 'This action cannot be undone.', 'यह कार्रवाई पूर्ववत नहीं की जा सकती।')}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="primary"
          fullWidth
          onClick={onConfirm}
          disabled={loading}
          style={{
            minHeight: 48,
            background: newStatus === 'cancelled' ? '#DC2626' : undefined,
          }}
        >
          {loading
            ? t(isHi, 'Processing...', 'प्रक्रिया हो रही है...')
            : t(isHi, 'Confirm', 'पुष्टि करें')}
        </Button>
        <Button variant="soft" onClick={onCancel} style={{ minHeight: 48 }}>
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminExamsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);

  /* Filter state */
  const [statusFilter, setStatusFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');

  /* Pagination */
  const [currentPage, setCurrentPage] = useState(1);

  /* View mode: 'upcoming' shows cards, 'list' shows table */
  const [viewMode, setViewMode] = useState<'upcoming' | 'list'>('upcoming');

  /* Modal state */
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [statusChangeTarget, setStatusChangeTarget] = useState<{ exam: Exam; newStatus: ExamStatus } | null>(null);
  const [statusChangeLoading, setStatusChangeLoading] = useState(false);

  /* Toast */
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

  /* ── Fetch exams via API ── */
  const fetchExams = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setLoadingExams(true);
    setApiError(null);

    try {
      const res = await fetch('/api/school-admin/exams', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setExams((json.data ?? []) as Exam[]);
    } catch (err: any) {
      setApiError(err.message || t(isHi, 'Failed to load exams', 'परीक्षाएं लोड करने में विफल'));
    } finally {
      setLoadingExams(false);
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
      // Non-critical
    }
  }, [getToken]);

  /* ── Save exam (create / update) ── */
  const handleSaveExam = useCallback(async (payload: any) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const method = payload.id ? 'PUT' : 'POST';
    const res = await fetch('/api/school-admin/exams', {
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
        ? t(isHi, 'Exam updated!', 'परीक्षा अपडेट हो गई!')
        : t(isHi, 'Exam created!', 'परीक्षा बनाई गई!')
    );
    fetchExams();
  }, [getToken, isHi, fetchExams]);

  /* ── Change exam status ── */
  const handleStatusChange = useCallback(async () => {
    if (!statusChangeTarget) return;
    const token = await getToken();
    if (!token) return;

    setStatusChangeLoading(true);
    try {
      const res = await fetch('/api/school-admin/exams', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: statusChangeTarget.exam.id,
          status: statusChangeTarget.newStatus,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      setSuccessMsg(t(isHi, 'Exam status updated!', 'परीक्षा स्थिति अपडेट हो गई!'));
      setStatusChangeTarget(null);
      fetchExams();
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setStatusChangeLoading(false);
    }
  }, [statusChangeTarget, getToken, isHi, fetchExams]);

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

  /* ── Fetch exams + classes once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchExams();
      fetchClasses();
    }
  }, [schoolId, fetchExams, fetchClasses]);

  /* ── Auto-dismiss success message ── */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3500);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /* ── Client-side filtering ── */
  const filteredExams = useMemo(() => {
    return exams.filter(exam => {
      if (statusFilter && exam.status !== statusFilter) return false;
      if (gradeFilter && exam.grade !== gradeFilter) return false;
      return true;
    });
  }, [exams, statusFilter, gradeFilter]);

  /* ── Upcoming exams (next 5 non-cancelled, non-completed, sorted by start_time) ── */
  const upcomingExams = useMemo(() => {
    return exams
      .filter(e => e.status !== 'cancelled' && e.status !== 'completed')
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .slice(0, 5);
  }, [exams]);

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(filteredExams.length / PAGE_SIZE));
  const paginatedExams = filteredExams.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, gradeFilter]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  const openCreate = () => {
    setEditingExam(null);
    setFormModalOpen(true);
  };

  const openEdit = (exam: Exam) => {
    setEditingExam(exam);
    setFormModalOpen(true);
  };

  const requestStatusChange = (exam: Exam, newStatus: ExamStatus) => {
    setStatusChangeTarget({ exam, newStatus });
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
        &#8592;
      </button>

      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Exam Schedule', 'परीक्षा अनुसूची')}
        </h1>
      </div>

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

      <Button
        variant="primary"
        size="sm"
        onClick={openCreate}
        style={{ minHeight: 44, flexShrink: 0 }}
        aria-label={t(isHi, 'Create Exam', 'परीक्षा बनाएं')}
      >
        + {t(isHi, 'Create', 'बनाएं')}
      </Button>
    </header>
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
          <Skeleton variant="title" height={20} width="35%" className="flex-1" />
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="rect" width={90} height={44} rounded="rounded-xl" />
        </header>
        <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto space-y-3">
          <Skeleton variant="rect" height={40} rounded="rounded-xl" />
          {[1, 2, 3].map(i => <ExamCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     ERROR STATE
  ══════════════════════════════════════════════════════════ */
  if (apiError && !loadingExams && exams.length === 0) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-4xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">&#9888;</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{apiError}</p>
            <Button variant="primary" onClick={fetchExams}>
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

      <main className="px-4 pt-4 pb-24 max-w-4xl mx-auto space-y-4">

        {/* ── View toggle ── */}
        <div
          className="flex gap-1 rounded-xl p-1"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          role="tablist"
        >
          {(['upcoming', 'list'] as const).map(mode => {
            const isActive = viewMode === mode;
            return (
              <button
                key={mode}
                role="tab"
                aria-selected={isActive}
                onClick={() => setViewMode(mode)}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: isActive ? 'var(--surface-1)' : 'transparent',
                  color: isActive ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {mode === 'upcoming'
                  ? t(isHi, 'Upcoming', 'आगामी')
                  : t(isHi, 'All Exams', 'सभी परीक्षाएं')}
              </button>
            );
          })}
        </div>

        {/* ── Loading skeleton ── */}
        {loadingExams && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <ExamCardSkeleton key={i} />)}
          </div>
        )}

        {/* ══════════════ UPCOMING VIEW ══════════════ */}
        {viewMode === 'upcoming' && !loadingExams && (
          <>
            {upcomingExams.length > 0 ? (
              <section aria-label={t(isHi, 'Upcoming Exams', 'आगामी परीक्षाएं')} className="space-y-3">
                {upcomingExams.map(exam => (
                  <UpcomingExamCard
                    key={exam.id}
                    exam={exam}
                    isHi={isHi}
                    onEdit={openEdit}
                    onStatusChange={requestStatusChange}
                  />
                ))}
              </section>
            ) : (
              <EmptyState
                icon="&#128197;"
                title={t(isHi, 'No upcoming exams', 'कोई आगामी परीक्षा नहीं')}
                description={t(isHi,
                  'Create an exam to get started.',
                  'शुरू करने के लिए एक परीक्षा बनाएं।'
                )}
                action={
                  <Button variant="primary" onClick={openCreate} style={{ minHeight: 48 }}>
                    + {t(isHi, 'Create Exam', 'परीक्षा बनाएं')}
                  </Button>
                }
              />
            )}
          </>
        )}

        {/* ══════════════ LIST VIEW ══════════════ */}
        {viewMode === 'list' && !loadingExams && (
          <>
            {/* Filters */}
            <section aria-label={t(isHi, 'Filters', 'फ़िल्टर')}>
              <div className="flex gap-2 flex-wrap">
                <div className="flex-1" style={{ minWidth: 130 }}>
                  <Select
                    label={t(isHi, 'Status', 'स्थिति')}
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={isHi ? STATUS_FILTER_HI : STATUS_FILTER_EN}
                  />
                </div>
                <div className="flex-1" style={{ minWidth: 130 }}>
                  <Select
                    label={t(isHi, 'Grade', 'कक्षा')}
                    value={gradeFilter}
                    onChange={setGradeFilter}
                    options={isHi ? GRADE_FILTER_HI : GRADE_FILTER_EN}
                  />
                </div>
              </div>
            </section>

            {/* Count */}
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              {filteredExams.length} {t(isHi, 'exams', 'परीक्षाएं')}
              {(statusFilter || gradeFilter) && (
                <span> {t(isHi, '(filtered)', '(फ़िल्टर किए गए)')}</span>
              )}
            </p>

            {/* Exam table */}
            {paginatedExams.length > 0 && (
              <Card className="p-0 overflow-hidden">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Title', 'शीर्षक')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Subject', 'विषय')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Grade', 'कक्षा')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Date', 'तिथि')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Duration', 'अवधि')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Questions', 'प्रश्न')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Status', 'स्थिति')}
                        </th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {t(isHi, 'Actions', 'कार्रवाई')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedExams.map(exam => (
                        <tr key={exam.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 12px', color: 'var(--text-1)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {exam.title}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                            {exam.subject}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <Badge color="var(--purple)" size="sm">
                              {t(isHi, `Grade ${exam.grade}`, `कक्षा ${exam.grade}`)}
                            </Badge>
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                            {formatDateTime(exam.start_time)}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                            {exam.duration_minutes} {t(isHi, 'min', 'मिनट')}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                            {exam.question_count}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <Badge color={statusColor(exam.status)} size="sm">
                              {statusLabel(exam.status, isHi)}
                            </Badge>
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <div className="flex items-center gap-1.5 justify-end">
                              {(exam.status === 'draft' || exam.status === 'scheduled') && (
                                <button
                                  onClick={() => openEdit(exam)}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-2)',
                                    minHeight: 30,
                                  }}
                                >
                                  {t(isHi, 'Edit', 'संपादित')}
                                </button>
                              )}
                              {exam.status === 'draft' && (
                                <button
                                  onClick={() => requestStatusChange(exam, 'scheduled')}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: 'rgba(59,130,246,0.06)',
                                    border: '1px solid rgba(59,130,246,0.2)',
                                    color: '#3B82F6',
                                    minHeight: 30,
                                  }}
                                >
                                  {t(isHi, 'Schedule', 'निर्धारित')}
                                </button>
                              )}
                              {(exam.status === 'scheduled' || exam.status === 'active') && (
                                <button
                                  onClick={() => requestStatusChange(exam, 'cancelled')}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: 'rgba(220,38,38,0.06)',
                                    border: '1px solid rgba(220,38,38,0.2)',
                                    color: '#DC2626',
                                    minHeight: 30,
                                  }}
                                >
                                  {t(isHi, 'Cancel', 'रद्द')}
                                </button>
                              )}
                              {exam.status === 'completed' && (
                                <button
                                  onClick={() => {/* View results placeholder */}}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-2)',
                                    minHeight: 30,
                                  }}
                                >
                                  {t(isHi, 'Results', 'परिणाम')}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: currentPage === 1 ? 'var(--text-3)' : 'var(--text-1)',
                    opacity: currentPage === 1 ? 0.5 : 1,
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  &#8592; {t(isHi, 'Prev', 'पिछला')}
                </button>
                <span className="text-xs text-[var(--text-3)] font-medium">
                  {t(isHi, `Page ${currentPage} of ${totalPages}`, `पृष्ठ ${currentPage} / ${totalPages}`)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: currentPage === totalPages ? 'var(--text-3)' : 'var(--text-1)',
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t(isHi, 'Next', 'अगला')} &#8594;
                </button>
              </div>
            )}

            {/* Empty states */}
            {filteredExams.length === 0 && exams.length > 0 && (
              <Card className="py-2">
                <EmptyState
                  icon="&#128269;"
                  title={t(isHi, 'No exams found', 'कोई परीक्षा नहीं मिली')}
                  description={t(isHi, 'Try adjusting your filters.', 'फ़िल्टर बदलकर देखें।')}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStatusFilter('');
                        setGradeFilter('');
                      }}
                    >
                      {t(isHi, 'Clear filters', 'फ़िल्टर हटाएं')}
                    </Button>
                  }
                />
              </Card>
            )}

            {exams.length === 0 && !apiError && (
              <EmptyState
                icon="&#128203;"
                title={t(isHi, 'No exams yet', 'अभी कोई परीक्षा नहीं')}
                description={t(isHi,
                  'Create your first exam to get started.',
                  'शुरू करने के लिए अपनी पहली परीक्षा बनाएं।'
                )}
                action={
                  <Button variant="primary" onClick={openCreate} style={{ minHeight: 48 }}>
                    + {t(isHi, 'Create Exam', 'परीक्षा बनाएं')}
                  </Button>
                }
              />
            )}
          </>
        )}
      </main>

      {/* ── Create/Edit Exam Modal ── */}
      <SheetModal
        open={formModalOpen}
        onClose={() => { setFormModalOpen(false); setEditingExam(null); }}
        title={editingExam
          ? t(isHi, 'Edit Exam', 'परीक्षा संपादित करें')
          : t(isHi, 'Create Exam', 'परीक्षा बनाएं')}
      >
        <ExamForm
          isHi={isHi}
          existing={editingExam}
          classes={classes}
          onSave={handleSaveExam}
          onClose={() => { setFormModalOpen(false); setEditingExam(null); }}
        />
      </SheetModal>

      {/* ── Status Change Confirmation Modal ── */}
      <SheetModal
        open={statusChangeTarget !== null}
        onClose={() => setStatusChangeTarget(null)}
        title={t(isHi, 'Change Exam Status', 'परीक्षा स्थिति बदलें')}
      >
        {statusChangeTarget && (
          <StatusChangeConfirm
            isHi={isHi}
            examTitle={statusChangeTarget.exam.title}
            newStatus={statusChangeTarget.newStatus}
            onConfirm={handleStatusChange}
            onCancel={() => setStatusChangeTarget(null)}
            loading={statusChangeLoading}
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
