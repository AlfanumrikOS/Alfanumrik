'use client';

/**
 * /support/new — create a new support ticket.
 *
 * Audit F22 (frontend portion). Hits POST /api/support/tickets with the
 * contract negotiated with backend:
 *   subject (1-200), description (1-5000), category, priority
 * Returns { ticket_id, success } on 200.
 *
 * P7 — bilingual via AuthContext.isHi.
 */

import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  LoadingFoxy,
  FormField,
  BottomNav,
} from '@/components/ui';

type TicketCategory = 'bug' | 'billing' | 'content' | 'account' | 'other';
type TicketPriority = 'low' | 'normal' | 'high';

const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 5000;

interface FieldErrors {
  subject?: string;
  description?: string;
  category?: string;
  priority?: string;
  form?: string;
}

interface ToastState {
  type: 'success' | 'error' | 'info';
  message: string;
}

export default function SupportNewPage() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  // Auth gate
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('other');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  // Auto-dismiss the toast after 4s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const categoryOptions = useMemo(
    () => [
      { value: 'bug', en: 'Bug', hi: 'बग' },
      { value: 'billing', en: 'Billing', hi: 'बिलिंग' },
      { value: 'content', en: 'Content', hi: 'सामग्री' },
      { value: 'account', en: 'Account', hi: 'खाता' },
      { value: 'other', en: 'Other', hi: 'अन्य' },
    ] as const,
    [],
  );

  const priorityOptions = useMemo(
    () => [
      { value: 'low', en: 'Low', hi: 'कम' },
      { value: 'normal', en: 'Normal', hi: 'सामान्य' },
      { value: 'high', en: 'High', hi: 'उच्च' },
    ] as const,
    [],
  );

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    const s = subject.trim();
    const d = description.trim();
    if (s.length === 0) {
      e.subject = isHi ? 'विषय आवश्यक है' : 'Subject is required';
    } else if (s.length > SUBJECT_MAX) {
      e.subject = isHi
        ? `विषय अधिकतम ${SUBJECT_MAX} अक्षर का होना चाहिए`
        : `Subject must be at most ${SUBJECT_MAX} characters`;
    }
    if (d.length === 0) {
      e.description = isHi ? 'विवरण आवश्यक है' : 'Description is required';
    } else if (d.length > DESCRIPTION_MAX) {
      e.description = isHi
        ? `विवरण अधिकतम ${DESCRIPTION_MAX} अक्षर का होना चाहिए`
        : `Description must be at most ${DESCRIPTION_MAX} characters`;
    }
    return e;
  }

  async function handleSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (submitting) return;

    const v = validate();
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      } catch { /* fall through to cookie auth */ }

      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
        }),
      });

      // Map status codes per spec.
      if (res.status === 200 || res.status === 201) {
        let json: { ticket_id?: string; data?: { ticket_id?: string } } = {};
        try { json = await res.json(); } catch { /* ignore */ }
        const ticketId = json?.ticket_id ?? json?.data?.ticket_id;

        // Best-effort toast persistence across the upcoming navigation.
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(
              'alfanumrik_support_toast',
              JSON.stringify({ type: 'success', message: isHi ? 'टिकट बनाया गया' : 'Ticket created' }),
            );
          } catch { /* non-blocking */ }
        }

        if (ticketId) {
          router.push(`/support/${ticketId}`);
        } else {
          // Fallback: list page if backend did not return an id
          router.push('/support');
        }
        return;
      }

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      if (res.status === 400) {
        let json: { error?: string; errors?: FieldErrors; data?: { errors?: FieldErrors } } = {};
        try { json = await res.json(); } catch { /* ignore */ }
        const fieldErrors = json?.errors ?? json?.data?.errors ?? {};
        // Inline field errors from API where provided; otherwise general form error.
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
        } else {
          setErrors({
            form: json?.error
              ?? (isHi ? 'जमा नहीं हो सका। कृपया फ़ील्ड जाँचें।' : 'Could not submit. Please check the fields.'),
          });
        }
        setSubmitting(false);
        return;
      }

      if (res.status === 429) {
        setToast({
          type: 'error',
          message: isHi
            ? 'आज की टिकट सीमा पूरी हो गई। कृपया कल पुनः प्रयास करें।'
            : "You've reached today's ticket limit. Please try again tomorrow.",
        });
        setSubmitting(false);
        return;
      }

      // 5xx and anything else — generic retry message.
      setToast({
        type: 'error',
        message: isHi
          ? 'जमा नहीं हो सका। कृपया पुनः प्रयास करें।'
          : 'Could not submit. Please try again.',
      });
    } catch {
      setToast({
        type: 'error',
        message: isHi
          ? 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'
          : 'Network error. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn) return <LoadingFoxy />;

  const subjectRemaining = SUBJECT_MAX - subject.length;
  const descRemaining = DESCRIPTION_MAX - description.length;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            onClick={() => router.push('/support')}
            className="text-sm"
            style={{ color: 'var(--text-3)' }}
            aria-label={isHi ? 'वापस' : 'Back'}
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'नया टिकट' : 'New ticket'}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'हम 24 घंटे में जवाब देंगे' : "We'll respond within 24 hours"}
            </p>
          </div>
        </div>
      </header>

      <main className="app-container py-4">
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl p-3 mb-3 text-sm"
            style={{
              background: toast.type === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
              border: `1px solid ${toast.type === 'success' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}`,
              color: toast.type === 'success' ? '#16A34A' : '#DC2626',
            }}
            data-testid="support-toast"
          >
            {toast.message}
          </div>
        )}

        <Card>
          <form onSubmit={handleSubmit} noValidate aria-label={isHi ? 'सपोर्ट टिकट फ़ॉर्म' : 'Support ticket form'}>
            <div className="space-y-4">
              {/* Subject */}
              <FormField
                label={isHi ? 'विषय' : 'Subject'}
                htmlFor="ticket-subject"
                required
                error={errors.subject}
                helperText={
                  !errors.subject
                    ? `${subject.length}/${SUBJECT_MAX} ${isHi ? 'अक्षर' : 'characters'}`
                    : undefined
                }
              >
                <input
                  id="ticket-subject"
                  type="text"
                  className="input-base"
                  maxLength={SUBJECT_MAX}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={isHi ? 'समस्या का संक्षेप में वर्णन' : 'Briefly describe the issue'}
                  aria-invalid={errors.subject ? 'true' : undefined}
                  aria-describedby={errors.subject ? 'ticket-subject-err' : undefined}
                  required
                />
              </FormField>

              {/* Category */}
              <FormField
                label={isHi ? 'श्रेणी' : 'Category'}
                htmlFor="ticket-category"
                error={errors.category}
              >
                <select
                  id="ticket-category"
                  className="input-base"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TicketCategory)}
                >
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {isHi ? opt.hi : opt.en}
                    </option>
                  ))}
                </select>
              </FormField>

              {/* Priority — radio group */}
              <fieldset>
                <legend className="text-xs text-[var(--text-3)] mb-1.5 ml-1 font-medium">
                  {isHi ? 'प्राथमिकता' : 'Priority'}
                </legend>
                <div
                  className="flex gap-2 flex-wrap"
                  role="radiogroup"
                  aria-label={isHi ? 'प्राथमिकता' : 'Priority'}
                >
                  {priorityOptions.map((opt) => {
                    const active = priority === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className="cursor-pointer select-none"
                        htmlFor={`ticket-priority-${opt.value}`}
                      >
                        <input
                          id={`ticket-priority-${opt.value}`}
                          type="radio"
                          name="priority"
                          value={opt.value}
                          checked={active}
                          onChange={() => setPriority(opt.value)}
                          className="sr-only"
                        />
                        <span
                          className="inline-flex items-center px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                          style={{
                            background: active ? 'rgb(var(--orange-rgb) / 0.12)' : 'var(--surface-1)',
                            border: `1.5px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
                            color: active ? 'var(--orange)' : 'var(--text-2)',
                          }}
                        >
                          {isHi ? opt.hi : opt.en}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.priority && (
                  <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">
                    {errors.priority}
                  </p>
                )}
              </fieldset>

              {/* Description */}
              <FormField
                label={isHi ? 'विवरण' : 'Description'}
                htmlFor="ticket-description"
                required
                error={errors.description}
                helperText={
                  !errors.description
                    ? `${description.length}/${DESCRIPTION_MAX} ${isHi ? 'अक्षर' : 'characters'}`
                    : undefined
                }
              >
                <textarea
                  id="ticket-description"
                  className="input-base"
                  maxLength={DESCRIPTION_MAX}
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isHi
                      ? 'क्या हुआ? आप क्या चाहते थे?'
                      : 'What happened? What did you expect?'
                  }
                  aria-invalid={errors.description ? 'true' : undefined}
                  aria-describedby={errors.description ? 'ticket-description-err' : undefined}
                  style={{ resize: 'vertical', minHeight: 120 }}
                  required
                />
              </FormField>

              {errors.form && (
                <p className="text-xs ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">
                  {errors.form}
                </p>
              )}

              <Button
                type="submit"
                fullWidth
                loading={submitting}
                disabled={submitting}
                data-testid="support-submit"
              >
                {submitting
                  ? (isHi ? 'भेज रहे हैं…' : 'Submitting…')
                  : (isHi ? 'टिकट भेजें' : 'Submit ticket')}
              </Button>

              {/* Hidden hints (for screen readers when over limit, even if maxLength caps input) */}
              <p className="sr-only" aria-live="polite">
                {subjectRemaining < 0 || descRemaining < 0
                  ? (isHi ? 'सीमा पार हो गई' : 'Character limit exceeded')
                  : ''}
              </p>
            </div>
          </form>
        </Card>
      </main>

      <BottomNav />
    </div>
  );
}
