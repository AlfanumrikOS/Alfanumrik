'use client';

/**
 * AlfaBotInquiryForm — Inline "Submit your query" form.
 *
 * Rendered inside the AlfaBotPanel body when `view === 'inquiry'`. Fields:
 *   - Name (optional, ≤120 chars after trim)
 *   - Email (required, RFC-5322 lite, ≤254 chars)
 *   - Question (required, 10-2000 chars after trim, textarea with counter)
 *   - Submit + Cancel
 *
 * UX flow:
 *   idle → submitting (spinner) → success (3s thank-you, then back to chat)
 *                              ↘ error (inline message + retry)
 *
 * Bilingual: every visible string runs through `t(en, hi)`.
 *
 * Analytics (PII-free — no name/email/question content):
 *   - alfabot_inquiry_opened   — fired by the provider when view flips.
 *   - alfabot_inquiry_submitted — fired here on success.
 *   - alfabot_inquiry_failed   — fired here on error.
 *
 * Owner: backend (this PR ships the form alongside the route).
 */

import { useState, type FormEvent } from 'react';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@/components/landing-v2/WelcomeV2Context';
import { submitInquiry } from '@/lib/alfabot/client';
import { track } from '@/lib/posthog/client';
import s from './alfabot.module.css';

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MIN_QUESTION = 10;
const MAX_QUESTION = 2000;
const SUCCESS_AUTO_RETURN_MS = 3000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'idle' | 'submitting' | 'success' | 'error';

function lengthBucket(s: string): 'short' | 'medium' | 'long' {
  const len = s.length;
  if (len < 80) return 'short';
  if (len < 240) return 'medium';
  return 'long';
}

export default function AlfaBotInquiryForm() {
  const { audience, lang, closeInquiry } = useAlfaBot();
  const { t } = useWelcomeV2();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedQuestion = question.trim();
  const questionLen = trimmedQuestion.length;
  const overLimit = questionLen > MAX_QUESTION;
  const underLimit = questionLen > 0 && questionLen < MIN_QUESTION;

  const emailValid = EMAIL_RE.test(trimmedEmail) && trimmedEmail.length <= MAX_EMAIL;
  const canSubmit =
    status === 'idle' &&
    emailValid &&
    questionLen >= MIN_QUESTION &&
    !overLimit &&
    trimmedName.length <= MAX_NAME;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    setErrorKey(null);

    const result = await submitInquiry({
      name: trimmedName || undefined,
      email: trimmedEmail.toLowerCase(),
      question: trimmedQuestion,
    });

    if ('ok' in result && result.ok === true) {
      setStatus('success');
      track('alfabot_inquiry_submitted', {
        audience,
        language: lang,
        has_name: trimmedName.length > 0,
        length_bucket: lengthBucket(trimmedQuestion),
      });
      // Auto-return to chat after 3s.
      setTimeout(() => {
        closeInquiry();
      }, SUCCESS_AUTO_RETURN_MS);
      return;
    }

    // Error envelope. TS narrows here because the success arm returned above.
    const reason = 'error' in result ? result.error : 'upstream_failed';
    setErrorKey(reason);
    setStatus('error');
    track('alfabot_inquiry_failed', {
      audience,
      language: lang,
      reason: (reason ?? 'upstream_failed') as
        | 'invalid_input'
        | 'rate_limited'
        | 'denied'
        | 'mail_send_failed'
        | 'upstream_failed'
        | 'network_error',
    });
  };

  const onRetry = () => {
    setStatus('idle');
    setErrorKey(null);
  };

  // ─── Success view ──
  if (status === 'success') {
    return (
      <div className={s.inquiryForm} data-testid="alfabot-inquiry-success">
        <div className={s.inquirySuccess} role="status" aria-live="polite">
          <strong>
            {t('Thank you! We’ll reply shortly.', 'धन्यवाद! हम जल्द ही जवाब देंगे।')}
          </strong>
          <p className={s.inquirySuccessHint}>
            {t(
              'Your question has reached our team. Returning to chat…',
              'आपका सवाल हमारी टीम तक पहुँच गया है। चैट पर लौट रहे हैं…',
            )}
          </p>
        </div>
      </div>
    );
  }

  // ─── Error key → bilingual copy ──
  const errorMessage =
    errorKey === 'rate_limited'
      ? t(
          'You’ve reached the daily limit. Please try again tomorrow.',
          'आपने आज की सीमा पूरी कर ली है। कृपया कल फिर कोशिश करें।',
        )
      : errorKey === 'denied'
        ? t(
            'We can’t accept this inquiry right now.',
            'अभी हम यह सवाल स्वीकार नहीं कर सकते।',
          )
        : errorKey === 'invalid_input'
          ? t(
              'Please check your name, email, and question, then try again.',
              'कृपया अपना नाम, ईमेल और सवाल जाँचें और फिर कोशिश करें।',
            )
          : t(
              'We couldn’t send your question. Please try again, or use Contact / WhatsApp.',
              'हम आपका सवाल नहीं भेज सके। कृपया दोबारा कोशिश करें, या Contact / WhatsApp इस्तेमाल करें।',
            );

  // ─── Form view ──
  return (
    <form className={s.inquiryForm} onSubmit={onSubmit} data-testid="alfabot-inquiry-form">
      <p className={s.inquiryIntro}>
        {t(
          'Send us your question and we’ll reply by email.',
          'अपना सवाल भेजें — हम ईमेल से जवाब देंगे।',
        )}
      </p>

      <label className={s.inquiryField}>
        <span className={s.inquiryLabel}>
          {t('Your name', 'आपका नाम')}{' '}
          <span className={s.inquiryOptional}>{t('(optional)', '(वैकल्पिक)')}</span>
        </span>
        <input
          type="text"
          className={s.inquiryInput}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
          maxLength={MAX_NAME}
          autoComplete="name"
          disabled={status === 'submitting'}
          placeholder={t('e.g. Asha Sharma', 'जैसे आशा शर्मा')}
        />
      </label>

      <label className={s.inquiryField}>
        <span className={s.inquiryLabel}>
          {t('Email', 'ईमेल')} <span className={s.inquiryRequired}>*</span>
        </span>
        <input
          type="email"
          className={s.inquiryInput}
          value={email}
          onChange={(e) => setEmail(e.target.value.slice(0, MAX_EMAIL))}
          maxLength={MAX_EMAIL}
          autoComplete="email"
          required
          disabled={status === 'submitting'}
          placeholder={t('you@example.com', 'aap@example.com')}
        />
      </label>

      <label className={s.inquiryField}>
        <span className={s.inquiryLabel}>
          {t('Your question', 'आपका सवाल')} <span className={s.inquiryRequired}>*</span>
        </span>
        <textarea
          className={s.inquiryTextarea}
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
          maxLength={MAX_QUESTION}
          rows={4}
          required
          disabled={status === 'submitting'}
          placeholder={t(
            'Type your question here… (10-2000 characters)',
            'अपना सवाल यहाँ लिखें… (10-2000 अक्षर)',
          )}
        />
        <span
          className={`${s.inquiryCharCounter} ${overLimit || underLimit ? s.inquiryCharCounterWarn : ''}`}
          aria-live="polite"
        >
          {questionLen}/{MAX_QUESTION}
          {underLimit && (
            <span className={s.inquiryHint}>
              {' '}
              · {t(`min ${MIN_QUESTION}`, `कम-से-कम ${MIN_QUESTION}`)}
            </span>
          )}
        </span>
      </label>

      <p className={s.inquiryPrivacy}>
        {t(
          'We’ll only use this to reply to your question. We don’t sell your data.',
          'हम इसका इस्तेमाल केवल आपके सवाल का जवाब देने के लिए करेंगे। हम आपका डेटा नहीं बेचते।',
        )}
      </p>

      {status === 'error' && (
        <div
          className={s.inquiryError}
          role="alert"
          aria-live="assertive"
          data-testid="alfabot-inquiry-error"
        >
          {errorMessage}
        </div>
      )}

      <div className={s.inquiryActions}>
        <button
          type="button"
          className={s.inquiryCancel}
          onClick={() => (status === 'error' ? onRetry() : closeInquiry())}
          disabled={status === 'submitting'}
        >
          {status === 'error'
            ? t('Try again', 'फिर कोशिश करें')
            : t('Cancel', 'रद्द करें')}
        </button>
        <button
          type="submit"
          className={s.inquirySubmit}
          disabled={!canSubmit}
          data-testid="alfabot-inquiry-submit"
        >
          {status === 'submitting' ? (
            <>
              <span className={s.sendSpinner} aria-hidden="true" />
              <span className={s.inquirySubmitLabel}>
                {t('Sending…', 'भेज रहे हैं…')}
              </span>
            </>
          ) : (
            t('Send question', 'सवाल भेजें')
          )}
        </button>
      </div>
    </form>
  );
}
