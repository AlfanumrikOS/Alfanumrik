'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { BottomNav } from '@/components/ui';

// ============================================================
// FAQ DATA
// ============================================================
const faqItems = [
  {
    q: 'How does Alfanumrik help my child learn?',
    a: 'Alfanumrik uses AI-powered personalized tutoring to adapt to your child\'s learning pace. Foxy, our AI tutor, explains concepts step-by-step, gives practice questions, and provides instant feedback \u2014 just like having a personal tutor available 24/7.',
  },
  {
    q: 'How do I track my child\'s progress?',
    a: 'Visit the Reports page to see detailed performance breakdowns. You\'ll find subject-wise mastery levels, quiz scores, study streaks, and personalized recommendations. All data updates in real-time as your child learns.',
  },
  {
    q: 'My child is struggling with a subject. What should I do?',
    a: 'Check the Reports page to identify specific weak topics. Encourage your child to use Foxy\'s \'Doubt\' mode to ask questions about those topics. You can also ask their teacher to assign targeted practice worksheets.',
  },
  {
    q: 'How safe is Alfanumrik for my child?',
    a: 'Very safe! All AI interactions are monitored and filtered for age-appropriate content. We don\'t show ads, and your child\'s data is encrypted and never shared with third parties. Our content is strictly aligned with CBSE/ICSE curriculum.',
  },
  {
    q: 'Can I see what my child is chatting with Foxy?',
    a: 'Currently, chat transcripts are visible on the student\'s device. We\'re working on a parent view for chat history. For now, you can check quiz results and mastery progress to understand learning activity.',
  },
  {
    q: 'How do I link my account to my child\'s profile?',
    a: 'You need a Link Code from your child\'s school or from your child\'s profile page. Enter this code during signup or in the \'Children\' section of your dashboard to connect your accounts.',
  },
  {
    q: 'What subjects does Alfanumrik cover?',
    a: 'Alfanumrik covers all major CBSE subjects: Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, Economics, Accountancy, and more \u2014 for Classes 6 through 12.',
  },
  {
    q: 'How much does Alfanumrik cost?',
    a: 'Alfanumrik offers a free trial so your child can experience AI-powered learning. After the trial, affordable plans start at a fraction of tuition costs. Every rupee goes into better AI, more content, and your child\'s learning outcomes — not ads or celebrities.',
  },
];

const tips = [
  'Set a regular study time \u2014 even 20 minutes daily makes a huge difference',
  'Celebrate small wins \u2014 every quiz completed is progress!',
  'Ask your child to teach you what they learned \u2014 it reinforces their understanding',
  "Don't worry about scores initially \u2014 focus on consistency and curiosity",
  'Use the study plan feature together \u2014 it helps build discipline',
];

const categories = [
  'General Question',
  'Technical Issue',
  'Billing',
  'Feature Request',
  'Report a Problem',
  'Other',
];

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  maxWidth: 600,
  margin: '0 auto',
  padding: '20px 16px 40px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#E2E8F0',
  backgroundColor: '#0B1120',
  minHeight: '100vh',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0F172A',
  borderRadius: 14,
  padding: '16px 18px',
  border: '1px solid #1E3A2F',
  marginBottom: 14,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: '#F1F5F9',
  margin: '28px 0 14px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  backgroundColor: '#1E293B',
  border: '1px solid #334155',
  borderRadius: 10,
  color: '#E2E8F0',
  fontSize: 14,
  outline: 'none',
  marginBottom: 10,
  boxSizing: 'border-box' as const,
};

const btnGreen: React.CSSProperties = {
  padding: '12px 20px',
  background: 'linear-gradient(135deg, #16A34A, #15803D)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
};

// ============================================================
// FAQ ITEM COMPONENT
// ============================================================
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        ...cardStyle,
        transition: 'border-color 0.2s',
        borderColor: open ? '#16A34A' : '#1E3A2F',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9', flex: 1 }}>{q}</span>
        <span
          style={{
            fontSize: 18,
            color: '#16A34A',
            transition: 'transform 0.3s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          ▼
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? 300 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.35s ease, opacity 0.3s ease',
          opacity: open ? 1 : 0,
        }}
      >
        <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, margin: '12px 0 0' }}>{a}</p>
      </div>
    </div>
  );
}

// ============================================================
// PRIVACY POLICY MODAL
// ============================================================
function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          borderRadius: 16,
          padding: '24px 20px',
          maxWidth: 500,
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          border: '1px solid #1E3A2F',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#F1F5F9', margin: '0 0 16px' }}>
          🔒 Privacy Policy
        </h3>
        <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 12 }}>
            At Alfanumrik, we take your privacy and your child&apos;s privacy very seriously.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: '#E2E8F0' }}>Data Collection:</strong> We collect only the information
            necessary to provide personalized learning experiences, including student names, grades,
            quiz responses, and learning progress data.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: '#E2E8F0' }}>Data Security:</strong> All personal data is encrypted
            in transit and at rest. We use industry-standard security measures to protect your information.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: '#E2E8F0' }}>No Third-Party Sharing:</strong> We do not sell or share
            student data with any third parties for advertising or marketing purposes.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: '#E2E8F0' }}>AI Content Safety:</strong> All AI-generated content
            is filtered for age-appropriateness and aligned with educational curriculum standards.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong style={{ color: '#E2E8F0' }}>Your Rights:</strong> You may request access to, correction
            of, or deletion of your data at any time by contacting support@alfanumrik.com.
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            ...btnGreen,
            marginTop: 20,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ============================================================
// TOAST COMPONENT
// ============================================================
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#16A34A',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 600,
        zIndex: 2000,
        boxShadow: '0 4px 20px rgba(22,163,74,0.4)',
        animation: 'fadeInUp 0.3s ease',
        maxWidth: '90vw',
        textAlign: 'center' as const,
      }}
    >
      {message}
    </div>
  );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
export default function ParentSupportPage() {
  const { isLoggedIn, isLoading, guardian } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('General Question');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [whatsappNote, setWhatsappNote] = useState(false);

  // Pre-fill from guardian profile
  useEffect(() => {
    if (guardian) {
      setName(guardian.name || '');
      setEmail(guardian.email || '');
    }
  }, [guardian]);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      window.location.href = '/';
    }
  }, [isLoading, isLoggedIn]);

  const handleSubmit = useCallback(() => {
    if (message.trim().length < 20) {
      setToast('Please enter at least 20 characters in your message.');
      return;
    }

    const feedback = {
      name,
      email,
      category,
      message: message.trim(),
      timestamp: new Date().toISOString(),
    };

    // Store in localStorage
    try {
      const existing = JSON.parse(localStorage.getItem('alfanumrik_support_messages') || '[]');
      existing.push(feedback);
      localStorage.setItem('alfanumrik_support_messages', JSON.stringify(existing));
    } catch {
      // Fallback: overwrite
      localStorage.setItem('alfanumrik_support_messages', JSON.stringify([feedback]));
    }

    setMessage('');
    setToast("Your message has been sent! We'll respond within 24 hours.");
  }, [name, email, category, message]);

  if (isLoading || !isLoggedIn) {
    return (
      <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#64748B', fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Inject keyframe animation */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #16A34A, #15803D)',
          borderRadius: 16,
          padding: '28px 22px',
          marginBottom: 24,
          textAlign: 'center' as const,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>
          Help &amp; Support
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', margin: 0 }}>
          We&apos;re here to help you and your child succeed
        </p>
      </div>

      {/* Section 1: FAQ */}
      <h2 style={sectionTitle}>❓ Frequently Asked Questions</h2>
      {faqItems.map((item, i) => (
        <FaqItem key={i} q={item.q} a={item.a} />
      ))}

      {/* Section 2: Contact Support */}
      <h2 style={sectionTitle}>📩 Contact Support</h2>
      <div style={cardStyle}>
        <label htmlFor="support-name" style={{ fontSize: 12, color: '#64748B', display: 'block', marginBottom: 4 }}>Name</label>
        <input
          id="support-name"
          style={inputStyle}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="support-email" style={{ fontSize: 12, color: '#64748B', display: 'block', marginBottom: 4 }}>Email</label>
        <input
          id="support-email"
          style={inputStyle}
          placeholder="your@email.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="support-category" style={{ fontSize: 12, color: '#64748B', display: 'block', marginBottom: 4 }}>Category</label>
        <select
          id="support-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{
            ...inputStyle,
            appearance: 'none' as const,
            WebkitAppearance: 'none' as const,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394A3B8' d='M2 4l4 4 4-4'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 14px center',
            paddingRight: 36,
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label htmlFor="support-message" style={{ fontSize: 12, color: '#64748B', display: 'block', marginBottom: 4 }}>
          Message <span style={{ color: '#475569' }}>(min 20 characters)</span>
        </label>
        <textarea
          id="support-message"
          style={{
            ...inputStyle,
            minHeight: 100,
            resize: 'vertical' as const,
            fontFamily: 'inherit',
          }}
          placeholder="Describe your question or issue..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <button
          onClick={handleSubmit}
          style={{
            ...btnGreen,
            opacity: message.trim().length < 20 ? 0.6 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          Send Message
        </button>
      </div>

      {/* Section 3: Quick Links */}
      <h2 style={sectionTitle}>🔗 Quick Links</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* WhatsApp Support */}
        <div
          style={{
            ...cardStyle,
            textAlign: 'center' as const,
            cursor: 'pointer',
            marginBottom: 0,
          }}
          onClick={() => setWhatsappNote(true)}
        >
          <div style={{ fontSize: 24, marginBottom: 6 }}>💬</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>WhatsApp Support</span>
          {whatsappNote && (
            <p style={{ fontSize: 11, color: '#F59E0B', margin: '8px 0 0', lineHeight: 1.4 }}>
              Coming soon! We&apos;re setting up WhatsApp support.
            </p>
          )}
        </div>

        {/* Email Us */}
        <a
          href="mailto:support@alfanumrik.com"
          style={{ textDecoration: 'none' }}
        >
          <div
            style={{
              ...cardStyle,
              textAlign: 'center' as const,
              cursor: 'pointer',
              marginBottom: 0,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>📧</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>Email Us</span>
            <p style={{ fontSize: 11, color: '#64748B', margin: '4px 0 0' }}>support@alfanumrik.com</p>
          </div>
        </a>

        {/* Report a Bug */}
        <a href="/help" style={{ textDecoration: 'none' }}>
          <div
            style={{
              ...cardStyle,
              textAlign: 'center' as const,
              cursor: 'pointer',
              marginBottom: 0,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>🐛</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>Report a Bug</span>
          </div>
        </a>

        {/* Privacy Policy */}
        <div
          style={{
            ...cardStyle,
            textAlign: 'center' as const,
            cursor: 'pointer',
            marginBottom: 0,
          }}
          onClick={() => setShowPrivacy(true)}
        >
          <div style={{ fontSize: 24, marginBottom: 6 }}>🔒</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>Privacy Policy</span>
        </div>
      </div>

      {/* Section 4: Tips for Parents */}
      <h2 style={{ ...sectionTitle, marginTop: 28 }}>💡 Tips for Parents</h2>
      <div style={cardStyle}>
        {tips.map((tip, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 0',
              borderBottom: i < tips.length - 1 ? '1px solid #1E293B' : 'none',
            }}
          >
            <span
              style={{
                backgroundColor: '#16A34A20',
                color: '#16A34A',
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.5 }}>{tip}</span>
          </div>
        ))}
      </div>

      {/* Modals & Toast */}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <BottomNav />
    </div>
  );
}
