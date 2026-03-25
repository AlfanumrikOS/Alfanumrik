'use client';

import Link from 'next/link';
import { useState } from 'react';

/* ─── Sub-Components ─── */

function Navbar() {
  return (
    <nav style={navStyle}>
      <div style={navInner}>
        <Link href="/welcome" style={logoLink}>
          <span style={{ fontSize: 24 }}>🦊</span>
          <span style={logoText}>Alfanumrik</span>
        </Link>
        <Link href="/welcome" style={navLinkStyle}>Home</Link>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={footerStyle}>
      <div style={footerInner}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/privacy" style={footerLink}>Privacy Policy</Link>
          <Link href="/terms" style={footerLink}>Terms of Service</Link>
          <Link href="/contact" style={footerLink}>Contact</Link>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 16 }}>
          &copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. All rights reserved.
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

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', role: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    // Simulate form submission
    setTimeout(() => {
      setSending(false);
      setSubmitted(true);
    }, 800);
  };

  if (submitted) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
        <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Message Sent!
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-2, #444)', lineHeight: 1.7 }}>
          Thank you for reaching out. We&apos;ll get back to you within 24-48 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={card}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="Your full name"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Email</label>
        <input
          type="email"
          required
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          placeholder="you@example.com"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>I am a...</label>
        <select
          required
          value={form.role}
          onChange={e => setForm({ ...form, role: e.target.value })}
          style={inputStyle}
        >
          <option value="">Select your role</option>
          <option value="Student">Student</option>
          <option value="Parent">Parent</option>
          <option value="Teacher">Teacher</option>
          <option value="School Administrator">School Administrator</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Message</label>
        <textarea
          required
          value={form.message}
          onChange={e => setForm({ ...form, message: e.target.value })}
          placeholder="How can we help you?"
          rows={5}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
      <button type="submit" disabled={sending} style={buttonStyle}>
        {sending ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}

/* ─── Main Page ─── */

export default function ContactPage() {
  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>GET IN TOUCH</span>
        <h1 style={h1Style}>Contact Us</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 520, margin: '0 auto' }}>
          Have a question, feedback, or partnership inquiry? We&apos;d love to hear from you.
        </p>
      </section>

      {/* Contact Info */}
      <section style={{ padding: '0 16px 40px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 40 }}>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>📧</div>
              <h3 style={cardTitle}>General Support</h3>
              <a href="mailto:support@alfanumrik.com" style={emailLink}>support@alfanumrik.com</a>
            </div>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🏫</div>
              <h3 style={cardTitle}>For Schools</h3>
              <a href="mailto:schools@alfanumrik.com" style={emailLink}>schools@alfanumrik.com</a>
            </div>
            <div style={card}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🤝</div>
              <h3 style={cardTitle}>Partnerships</h3>
              <a href="mailto:partnerships@alfanumrik.com" style={emailLink}>partnerships@alfanumrik.com</a>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Form */}
            <div>
              <SectionTitle
                badge="SEND A MESSAGE"
                title="Write to Us"
                subtitle="Fill out the form and we'll get back to you within 24-48 hours."
              />
              <ContactForm />
            </div>

            {/* Office Info */}
            <div>
              <SectionTitle
                badge="OFFICE"
                title="Where We Are"
                subtitle="We're a remote-first team building from across India."
              />
              <div style={card}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>🇮🇳</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8 }}>India</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>
                  <strong>Cusiosense Learning India Pvt. Ltd.</strong><br />
                  DPIIT Recognised Startup
                </p>
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border, #e5e0d8)' }}>
                  <p style={{ fontSize: 12, color: 'var(--text-3, #888)', lineHeight: 1.7 }}>
                    Response Times:<br />
                    General queries: 24-48 hours<br />
                    School partnerships: 12-24 hours<br />
                    Technical support: Same business day
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
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
const buttonStyle: React.CSSProperties = {
  width: '100%', padding: '12px 24px', fontSize: 14, fontWeight: 700, borderRadius: 12,
  border: 'none', background: 'var(--orange, #E8581C)', color: '#fff', cursor: 'pointer',
  fontFamily: 'var(--font-display)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
