'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supportSlaLine, supportSlaFull } from '@alfanumrik/lib/support/response-sla';

/**
 * /contact — public contact form.
 *
 * 2026-08-11 SEV1 fix: this form previously called `setTimeout(…, 800)` and
 * rendered "Message Sent!" without ever contacting the server — every
 * submission from the 12 marketing surfaces that link here was silently
 * discarded. It now POSTs to the existing unauthenticated intake route
 * `/api/support/ticket`, which persists a guest row in `support_tickets`
 * (student_id: null, user_role: 'guest'), and renders honest
 * pending / success / failure states. Failure keeps the user's input and
 * offers a retry plus the support mailto — it must never fake success again.
 *
 * P7: fully bilingual via AuthContext.isHi (the page was English-only).
 * P13: nothing from the form is logged client-side.
 *
 * ── RESPONSE-TIME COPY (2026-08-11) ────────────────────────────────────────
 * This page publishes the SAME SLA as the authenticated surfaces, sourced from
 * @alfanumrik/lib/support/response-sla. It is a guest/marketing form, but the
 * submission is NOT a different thing: it POSTs to /api/support/ticket, which
 * writes a row into the same `support_tickets` table, worked by the same
 * operator console and the same rota as a student's ticket. A guest promise
 * that is faster than the logged-in one would be a promise the rota cannot
 * separately honour.
 *
 * It previously carried THREE unmeasured, mutually inconsistent numbers
 * ("24-48 hours" twice, plus a tiered block promising 12-24h for school
 * partnerships and same-business-day for technical support). Tiered,
 * per-category SLAs are explicitly out until first-response time is measured —
 * one promise, one number. Do not reintroduce a tier here.
 */

/** The drift this comment used to describe is CLOSED (same batch). The intake
 *  route no longer carries an inline enum; it validates
 *  `z.enum(SUPPORT_TICKET_CATEGORY_INPUTS)` from
 *  packages/lib/src/support/ticket-categories.ts — the 7 canonical categories
 *  plus the 2 legacy aliases ('payment'→'billing', 'feature'→'other'), 9 wire
 *  values, normalised to canonical on write.
 *
 *  'other' is canonical and unaffected: it was accepted before and is accepted
 *  now, so a general contact enquiry still files under it and this constant
 *  needs no change. Kept named rather than inlined so the choice stays
 *  greppable against the category list. */
const CONTACT_TICKET_CATEGORY = 'other';

/* ─── Sub-Components ─── */

function Navbar({ isHi }: { isHi: boolean }) {
  return (
    <nav style={navStyle}>
      <div style={navInner}>
        <Link href="/welcome" style={logoLink}>
          <span style={{ fontSize: 24 }}>🦊</span>
          <span style={logoText}>Alfanumrik</span>
        </Link>
        <Link href="/welcome" style={navLinkStyle}>{isHi ? 'होम' : 'Home'}</Link>
      </div>
    </nav>
  );
}

function Footer({ isHi }: { isHi: boolean }) {
  return (
    <footer style={footerStyle}>
      <div style={footerInner}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/privacy" style={footerLink}>{isHi ? 'गोपनीयता नीति' : 'Privacy Policy'}</Link>
          <Link href="/terms" style={footerLink}>{isHi ? 'सेवा की शर्तें' : 'Terms of Service'}</Link>
          <Link href="/contact" style={footerLink}>{isHi ? 'संपर्क' : 'Contact'}</Link>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 16 }}>
          &copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.{' '}
          {isHi ? 'सर्वाधिकार सुरक्षित।' : 'All rights reserved.'}
        </p>
      </div>
    </footer>
  );
}

function SectionTitle({ badge, title, subtitle }: { badge: string; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
      <span style={badgeStyle}>{badge}</span>
      <h2 style={h2Style}>{title}</h2>
      <p style={subtitleStyle}>{subtitle}</p>
    </div>
  );
}

/* ─── Contact Form ─── */

/** Honest submission lifecycle. 'error' is now reachable — before this fix
 *  failure was structurally impossible because nothing was ever sent. */
type SubmitStatus = 'idle' | 'sending' | 'sent' | 'error';

/** The intake route requires message >= 10 chars (route.ts:18). Mirrored here
 *  so the user gets a bilingual inline hint instead of a server 400. */
const MIN_MESSAGE_LENGTH = 10;
/** Route cap is 5000 (route.ts:18); the name/role footer appended below needs
 *  headroom, so the free-text field is capped short of it. */
const MAX_MESSAGE_LENGTH = 4800;

const ROLE_OPTIONS: { value: string; en: string; hi: string }[] = [
  { value: 'Student', en: 'Student', hi: 'विद्यार्थी' },
  { value: 'Parent', en: 'Parent', hi: 'अभिभावक' },
  { value: 'Teacher', en: 'Teacher', hi: 'शिक्षक' },
  { value: 'School Administrator', en: 'School Administrator', hi: 'स्कूल प्रशासक' },
  { value: 'Other', en: 'Other', hi: 'अन्य' },
];

function ContactForm({ isHi }: { isHi: boolean }) {
  const [form, setForm] = useState({ name: '', email: '', role: '', message: '' });
  const [status, setStatus] = useState<SubmitStatus>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;

    const name = form.name.trim();
    const email = form.email.trim();
    const role = form.role.trim();
    const message = form.message.trim();
    if (message.length < MIN_MESSAGE_LENGTH) {
      setStatus('error');
      return;
    }

    setStatus('sending');

    // The intake route stores guests as user_name 'Guest' and has no role
    // column, so name + role ride along in the ticket body (never in a log).
    const body = {
      category: CONTACT_TICKET_CATEGORY,
      subject: `Contact form — ${role || 'Other'}`.slice(0, 200),
      email,
      message: `${message}\n\n---\nName: ${name || '(not provided)'}\nRole: ${role || '(not provided)'}\nSource: /contact`.slice(0, 5000),
    };

    try {
      const res = await fetch('/api/support/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let ok = res.ok;
      try {
        const data = (await res.json()) as { success?: boolean };
        ok = res.ok && data?.success === true;
      } catch {
        ok = false;
      }
      setStatus(ok ? 'sent' : 'error');
    } catch {
      // Network/offline. No logging — the payload carries user PII (P13).
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 40 }} role="status">
        <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
        <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          {isHi ? 'संदेश भेज दिया गया!' : 'Message Sent!'}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-2, #444)', lineHeight: 1.7 }}>
          {isHi
            ? `संपर्क करने के लिए धन्यवाद। ${supportSlaFull(true)}`
            : `Thank you for reaching out. ${supportSlaFull(false)}`}
        </p>
      </div>
    );
  }

  const sending = status === 'sending';
  const messageTooShort = form.message.trim().length < MIN_MESSAGE_LENGTH;

  return (
    <form onSubmit={handleSubmit} style={{ ...card, position: 'relative' }}>
      {status === 'error' && (
        <div role="alert" style={errorBoxStyle}>
          <strong style={{ display: 'block', marginBottom: 4 }}>
            {isHi ? 'संदेश नहीं भेजा जा सका' : 'We couldn’t send your message'}
          </strong>
          {messageTooShort ? (
            <span>
              {isHi
                ? `कृपया कम से कम ${MIN_MESSAGE_LENGTH} अक्षरों का संदेश लिखें।`
                : `Please write a message of at least ${MIN_MESSAGE_LENGTH} characters.`}
            </span>
          ) : (
            <span>
              {isHi ? 'कृपया दोबारा प्रयास करें, या हमें ' : 'Please try again, or email us at '}
              <a href="mailto:support@alfanumrik.com" style={{ ...emailLink, fontSize: 13 }}>
                support@alfanumrik.com
              </a>
              {isHi ? ' पर ईमेल करें।' : '.'}
            </span>
          )}
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="contact-name" style={labelStyle}>{isHi ? 'नाम' : 'Name'}</label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          disabled={sending}
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder={isHi ? 'आपका पूरा नाम' : 'Your full name'}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="contact-email" style={labelStyle}>{isHi ? 'ईमेल' : 'Email'}</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          disabled={sending}
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          placeholder="you@example.com"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="contact-role" style={labelStyle}>{isHi ? 'मैं हूँ...' : 'I am a...'}</label>
        <select
          id="contact-role"
          name="role"
          required
          disabled={sending}
          value={form.role}
          onChange={e => setForm({ ...form, role: e.target.value })}
          style={inputStyle}
        >
          <option value="">{isHi ? 'अपनी भूमिका चुनें' : 'Select your role'}</option>
          {ROLE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{isHi ? opt.hi : opt.en}</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label htmlFor="contact-message" style={labelStyle}>{isHi ? 'संदेश' : 'Message'}</label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={MIN_MESSAGE_LENGTH}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={sending}
          value={form.message}
          onChange={e => setForm({ ...form, message: e.target.value })}
          placeholder={isHi ? 'हम आपकी कैसे मदद कर सकते हैं?' : 'How can we help you?'}
          rows={5}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-3, #888)', marginTop: 6 }}>
          {isHi
            ? `कम से कम ${MIN_MESSAGE_LENGTH} अक्षर।`
            : `At least ${MIN_MESSAGE_LENGTH} characters.`}
        </p>
      </div>
      <button type="submit" disabled={sending} style={{ ...buttonStyle, opacity: sending ? 0.7 : 1, cursor: sending ? 'progress' : 'pointer' }}>
        {sending
          ? (isHi ? 'भेजा जा रहा है...' : 'Sending...')
          : status === 'error'
            ? (isHi ? 'फिर से भेजें' : 'Try again')
            : (isHi ? 'संदेश भेजें' : 'Send Message')}
      </button>
      <p aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {sending ? (isHi ? 'संदेश भेजा जा रहा है' : 'Sending your message') : ''}
      </p>
    </form>
  );
}

/* ─── Main Page ─── */

export default function ContactPage() {
  const { isHi } = useAuth();
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar isHi={isHi} />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>{isHi ? 'संपर्क करें' : 'GET IN TOUCH'}</span>
        <h1 style={h1Style}>{isHi ? 'हमसे संपर्क करें' : 'Contact Us'}</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 520, margin: '0 auto' }}>
          {isHi
            ? 'कोई प्रश्न, सुझाव या साझेदारी की बात? हम आपसे सुनना चाहेंगे।'
            : 'Have a question, feedback, or partnership inquiry? We’d love to hear from you.'}
        </p>
      </section>

      {/* Contact Info */}
      <section style={{ padding: '0 16px 40px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>📧</div>
              <h3 style={cardTitle}>{isHi ? 'सामान्य सहायता' : 'General Support'}</h3>
              <a href="mailto:support@alfanumrik.com" style={emailLink}>support@alfanumrik.com</a>
            </div>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🏫</div>
              <h3 style={cardTitle}>{isHi ? 'स्कूलों के लिए' : 'For Schools'}</h3>
              <a href="mailto:schools@alfanumrik.com" style={emailLink}>schools@alfanumrik.com</a>
            </div>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🤝</div>
              <h3 style={cardTitle}>{isHi ? 'साझेदारी' : 'Partnerships'}</h3>
              <a href="mailto:partnerships@alfanumrik.com" style={emailLink}>partnerships@alfanumrik.com</a>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Form */}
            <div>
              <SectionTitle
                badge={isHi ? 'संदेश भेजें' : 'SEND A MESSAGE'}
                title={isHi ? 'हमें लिखें' : 'Write to Us'}
                subtitle={isHi
                  ? `फ़ॉर्म भरें। ${supportSlaLine(true)}`
                  : `Fill out the form. ${supportSlaLine(false)}`}
              />
              <ContactForm isHi={isHi} />
            </div>

            {/* Office Info */}
            <div>
              <SectionTitle
                badge={isHi ? 'कार्यालय' : 'OFFICE'}
                title={isHi ? 'हम कहाँ हैं' : 'Where We Are'}
                subtitle={isHi
                  ? 'हम एक रिमोट-फर्स्ट टीम हैं, जो पूरे भारत से काम करती है।'
                  : 'We’re a remote-first team building from across India.'}
              />
              <div style={card}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>🇮🇳</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
                  {isHi ? 'भारत' : 'India'}
                </h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>
                  <strong>Cusiosense Learning India Pvt. Ltd.</strong><br />
                  {isHi ? 'DPIIT मान्यता प्राप्त स्टार्टअप' : 'DPIIT Recognised Startup'}
                </p>
                {/* One published promise for every enquiry that reaches this
                    page. The per-channel tiers that used to live here
                    (school partnerships 12-24h, technical support same-day)
                    were never measured and are gone: the schools@ and
                    partnerships@ inboxes now carry NO published commitment
                    rather than an invented one. If ops wants a separate
                    partnership SLA it is a CEO decision, set the same way this
                    one was, and it belongs in response-sla.ts — not inline. */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border, #e5e0d8)' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-3, #888)', lineHeight: 1.7 }}>
                    <strong>{isHi ? 'प्रतिक्रिया समय' : 'Response time'}</strong><br />
                    {supportSlaFull(isHi)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer isHi={isHi} />
    </div>
  );
}

/* ─── Styles ─── */

const navStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 50,
  background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  borderBottom: '1px solid var(--border, #e5e0d8)',
};
const navInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const logoLink: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' };
const logoText: React.CSSProperties = { fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-1, #1a1a1a)' };
const navLinkStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-2, #444)', textDecoration: 'none' };

const badgeStyle: React.CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
  background: 'rgba(232,88,28,0.08)', color: 'var(--orange, #E8581C)', marginBottom: 12, letterSpacing: 0.5,
};
const h1Style: React.CSSProperties = { fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1.2, marginBottom: 16 };
const h2Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 12, color: 'var(--text-1, #1a1a1a)' };
const subtitleStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' };

const card: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};
const cardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 };
const emailLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-1, #1a1a1a)' };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
  border: '1px solid var(--border, #e5e0d8)', background: 'var(--surface-1, #f5f2ed)',
  color: 'var(--text-1, #1a1a1a)', fontFamily: 'var(--font-body)', outline: 'none',
  boxSizing: 'border-box',
};
const errorBoxStyle: React.CSSProperties = {
  marginBottom: 16, padding: '12px 14px', borderRadius: 10,
  border: '1px solid #f0b4a0', background: 'rgba(232,88,28,0.07)',
  color: '#8a2d0c', fontSize: 13, lineHeight: 1.6,
};
const buttonStyle: React.CSSProperties = {
  width: '100%', padding: '12px 24px', fontSize: 14, fontWeight: 700, borderRadius: 12,
  border: 'none', background: 'var(--orange, #E8581C)', color: '#fff', cursor: 'pointer',
  fontFamily: 'var(--font-display)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
