'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';

// ============================================================
// BILINGUAL HELPER (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ============================================================
// API CONTRACT TYPES (matches /api/support/tickets)
// ============================================================
// Request category enum mirrors the server zod schema exactly. The visible
// label is bilingual; the wire value stays the untranslated technical code.
type TicketCategory = 'bug' | 'billing' | 'content' | 'account' | 'other';
type TicketPriority = 'low' | 'normal' | 'high';
type TicketStatus = string; // server-driven (open / in_progress / resolved / closed …)

interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  priority: string | null;
  status: TicketStatus;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
}

interface TicketListResponse {
  success: boolean;
  data?: {
    tickets: SupportTicket[];
    total: number;
    page: number;
    page_size: number;
  };
  error?: string;
  code?: string;
}

interface TicketCreateResponse {
  success: boolean;
  ticket_id?: string;
  created_at?: string;
  error?: string;
  code?: string;
}

// Bilingual labels for the category select. Wire value = the technical code.
const CATEGORY_OPTIONS: { value: TicketCategory; en: string; hi: string }[] = [
  { value: 'account', en: 'General / Account', hi: 'सामान्य / खाता' },
  { value: 'bug', en: 'Technical Issue', hi: 'तकनीकी समस्या' },
  { value: 'billing', en: 'Billing', hi: 'बिलिंग' },
  { value: 'content', en: 'Content / Learning', hi: 'सामग्री / पढ़ाई' },
  { value: 'other', en: 'Other', hi: 'अन्य' },
];

const PRIORITY_OPTIONS: { value: TicketPriority; en: string; hi: string }[] = [
  { value: 'low', en: 'Low', hi: 'कम' },
  { value: 'normal', en: 'Normal', hi: 'सामान्य' },
  { value: 'high', en: 'High', hi: 'उच्च' },
];

function categoryLabel(isHi: boolean, code: string | null): string {
  const opt = CATEGORY_OPTIONS.find((c) => c.value === code);
  return opt ? t(isHi, opt.en, opt.hi) : t(isHi, 'Other', 'अन्य');
}

function priorityLabel(isHi: boolean, code: string | null): string {
  const opt = PRIORITY_OPTIONS.find((p) => p.value === code);
  return opt ? t(isHi, opt.en, opt.hi) : t(isHi, 'Normal', 'सामान्य');
}

// Bilingual status labels. The server owns the canonical status strings; we map
// the known ones and fall back to a humanized version of any unknown value.
function statusLabel(isHi: boolean, status: string): string {
  switch (status) {
    case 'open':
      return t(isHi, 'Open', 'खुला');
    case 'in_progress':
    case 'in-progress':
      return t(isHi, 'In progress', 'प्रगति पर');
    case 'resolved':
      return t(isHi, 'Resolved', 'हल हो गया');
    case 'closed':
      return t(isHi, 'Closed', 'बंद');
    case 'pending':
      return t(isHi, 'Pending', 'लंबित');
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'resolved':
    case 'closed':
      return 'var(--success)';
    case 'in_progress':
    case 'in-progress':
      return 'var(--info)';
    default:
      return 'var(--primary)';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ============================================================
// AUTHED FETCH (attaches the guardian's Supabase JWT)
// ============================================================
async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — server returns 401 */
  }
  return fetch(url, { ...init, headers });
}

// ============================================================
// FAQ DATA (P7 — bilingual)
// ============================================================
const faqItems: { q: { en: string; hi: string }; a: { en: string; hi: string } }[] = [
  {
    q: {
      en: 'How does Alfanumrik help my child learn?',
      hi: 'Alfanumrik मेरे बच्चे को सीखने में कैसे मदद करता है?',
    },
    a: {
      en: "Alfanumrik uses AI-powered personalized tutoring to adapt to your child's learning pace. Foxy, our AI tutor, explains concepts step-by-step, gives practice questions, and provides instant feedback — just like having a personal tutor available 24/7.",
      hi: 'Alfanumrik AI-आधारित वैयक्तिक ट्यूशन का उपयोग करके आपके बच्चे की सीखने की गति के अनुसार ढलता है। हमारा AI ट्यूटर Foxy अवधारणाओं को चरण-दर-चरण समझाता है, अभ्यास प्रश्न देता है और तुरंत फीडबैक देता है — ठीक एक निजी ट्यूटर की तरह जो 24/7 उपलब्ध हो।',
    },
  },
  {
    q: {
      en: "How do I track my child's progress?",
      hi: 'मैं अपने बच्चे की प्रगति कैसे ट्रैक करूँ?',
    },
    a: {
      en: "Visit the Reports page to see detailed performance breakdowns. You'll find subject-wise mastery levels, quiz scores, study streaks, and personalized recommendations. All data updates in real-time as your child learns.",
      hi: 'विस्तृत प्रदर्शन देखने के लिए रिपोर्ट पेज पर जाएँ। वहाँ आपको विषय-वार महारत स्तर, क्विज़ स्कोर, अध्ययन स्ट्रीक और वैयक्तिक सुझाव मिलेंगे। जैसे-जैसे आपका बच्चा सीखता है, सारा डेटा रीयल-टाइम में अपडेट होता है।',
    },
  },
  {
    q: {
      en: 'My child is struggling with a subject. What should I do?',
      hi: 'मेरा बच्चा किसी विषय में संघर्ष कर रहा है। मुझे क्या करना चाहिए?',
    },
    a: {
      en: "Check the Reports page to identify specific weak topics. Encourage your child to use Foxy's 'Doubt' mode to ask questions about those topics. You can also ask their teacher to assign targeted practice worksheets.",
      hi: "कमज़ोर टॉपिक पहचानने के लिए रिपोर्ट पेज देखें। अपने बच्चे को उन टॉपिक पर सवाल पूछने के लिए Foxy के 'Doubt' मोड का उपयोग करने के लिए प्रोत्साहित करें। आप शिक्षक से लक्षित अभ्यास वर्कशीट देने का अनुरोध भी कर सकते हैं।",
    },
  },
  {
    q: {
      en: 'How safe is Alfanumrik for my child?',
      hi: 'Alfanumrik मेरे बच्चे के लिए कितना सुरक्षित है?',
    },
    a: {
      en: "Very safe! All AI interactions are monitored and filtered for age-appropriate content. We don't show ads, and your child's data is encrypted and never shared with third parties. Our content is strictly aligned with CBSE curriculum.",
      hi: 'बहुत सुरक्षित! सभी AI बातचीत की निगरानी की जाती है और उम्र-उपयुक्त सामग्री के लिए फ़िल्टर किया जाता है। हम विज्ञापन नहीं दिखाते, और आपके बच्चे का डेटा एन्क्रिप्टेड है और किसी तीसरे पक्ष के साथ साझा नहीं किया जाता। हमारी सामग्री पूरी तरह CBSE पाठ्यक्रम के अनुरूप है।',
    },
  },
  {
    q: {
      en: "Can I see what my child is chatting with Foxy?",
      hi: 'क्या मैं देख सकता हूँ कि मेरा बच्चा Foxy से क्या बातचीत करता है?',
    },
    a: {
      en: "Yes. Open the Children page, expand your child's card, and open the 'Foxy Conversations' section to read their chat history. It is read-only — you can view, but not send messages on their behalf.",
      hi: "हाँ। बच्चे पेज खोलें, अपने बच्चे का कार्ड विस्तृत करें और उनकी चैट देखने के लिए 'Foxy बातचीत' सेक्शन खोलें। यह केवल-पढ़ने के लिए है — आप देख सकते हैं, लेकिन उनकी ओर से संदेश नहीं भेज सकते।",
    },
  },
  {
    q: {
      en: "How do I link my account to my child's profile?",
      hi: 'मैं अपना खाता अपने बच्चे की प्रोफ़ाइल से कैसे जोड़ूँ?',
    },
    a: {
      en: "You need a Link Code from your child's school or from your child's profile page. Enter this code during signup or in the 'Children' section of your dashboard to connect your accounts.",
      hi: "आपको अपने बच्चे के स्कूल या बच्चे के प्रोफ़ाइल पेज से एक लिंक कोड चाहिए। अपने खातों को जोड़ने के लिए साइनअप के दौरान या डैशबोर्ड के 'बच्चे' सेक्शन में यह कोड दर्ज करें।",
    },
  },
  {
    q: {
      en: 'What subjects does Alfanumrik cover?',
      hi: 'Alfanumrik किन विषयों को कवर करता है?',
    },
    a: {
      en: 'Alfanumrik covers all major CBSE subjects: Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, Economics, Accountancy, and more — for Classes 6 through 12.',
      hi: 'Alfanumrik सभी प्रमुख CBSE विषयों को कवर करता है: गणित, विज्ञान, भौतिकी, रसायन विज्ञान, जीव विज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान, कंप्यूटर विज्ञान, अर्थशास्त्र, लेखाशास्त्र और बहुत कुछ — कक्षा 6 से 12 तक।',
    },
  },
  {
    q: {
      en: 'How much does Alfanumrik cost?',
      hi: 'Alfanumrik की कीमत कितनी है?',
    },
    a: {
      en: 'Alfanumrik offers a free trial so your child can experience AI-powered learning. After the trial, affordable plans are available. Every rupee goes into better AI, more content, and your child’s learning outcomes — not ads or celebrities.',
      hi: 'Alfanumrik एक मुफ़्त ट्रायल देता है ताकि आपका बच्चा AI-आधारित शिक्षा का अनुभव कर सके। ट्रायल के बाद किफ़ायती प्लान उपलब्ध हैं। हर रुपया बेहतर AI, अधिक सामग्री और आपके बच्चे के सीखने के परिणामों में जाता है — न कि विज्ञापनों या सेलिब्रिटी पर।',
    },
  },
];

const tips: { en: string; hi: string }[] = [
  {
    en: 'Set a regular study time — even 20 minutes daily makes a huge difference',
    hi: 'नियमित अध्ययन समय तय करें — रोज़ाना 20 मिनट भी बड़ा अंतर लाते हैं',
  },
  {
    en: 'Celebrate small wins — every quiz completed is progress!',
    hi: 'छोटी जीत का जश्न मनाएँ — हर पूरी की गई क्विज़ प्रगति है!',
  },
  {
    en: 'Ask your child to teach you what they learned — it reinforces their understanding',
    hi: 'अपने बच्चे से पूछें कि उन्होंने क्या सीखा — यह उनकी समझ को मज़बूत करता है',
  },
  {
    en: "Don't worry about scores initially — focus on consistency and curiosity",
    hi: 'शुरुआत में स्कोर की चिंता न करें — निरंतरता और जिज्ञासा पर ध्यान दें',
  },
  {
    en: 'Use the study plan feature together — it helps build discipline',
    hi: 'अध्ययन योजना सुविधा का साथ मिलकर उपयोग करें — यह अनुशासन बनाने में मदद करती है',
  },
];

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  maxWidth: 600,
  margin: '0 auto',
  padding: '20px 16px 40px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: 'var(--text-1)',
  backgroundColor: 'var(--surface-2)',
  minHeight: '100dvh',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-1)',
  borderRadius: 14,
  padding: '16px 18px',
  border: '1px solid var(--surface-2)',
  marginBottom: 14,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-1)',
  margin: '28px 0 14px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  backgroundColor: 'var(--surface-2)',
  border: '1px solid var(--surface-2)',
  borderRadius: 10,
  color: 'var(--text-1)',
  fontSize: 14,
  outline: 'none',
  marginBottom: 10,
  boxSizing: 'border-box' as const,
};

const btnPrimary: React.CSSProperties = {
  padding: '12px 20px',
  background: 'linear-gradient(135deg, var(--primary), var(--primary))',
  color: 'var(--surface-1)',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
  minHeight: 48,
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
        borderColor: open ? 'var(--primary)' : 'var(--surface-2)',
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
          minHeight: 44,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>{q}</span>
        <span
          style={{
            fontSize: 18,
            color: 'var(--primary)',
            transition: 'transform 0.3s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          &#x25BC;
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? 400 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.35s ease, opacity 0.3s ease',
          opacity: open ? 1 : 0,
        }}
      >
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, margin: '12px 0 0' }}>{a}</p>
      </div>
    </div>
  );
}

// ============================================================
// TOAST COMPONENT
// ============================================================
function Toast({ message, kind, onDone }: { message: string; kind: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const tm = setTimeout(onDone, 5000);
    return () => clearTimeout(tm);
  }, [onDone]);

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: kind === 'success' ? 'var(--success)' : 'var(--danger)',
        color: 'var(--surface-1)',
        padding: '12px 24px',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 600,
        zIndex: 2000,
        boxShadow: '0 4px 20px color-mix(in srgb, var(--text-1) 25%, transparent)',
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
// MY TICKETS LIST
// ============================================================
function MyTickets({
  isHi,
  tickets,
  loading,
  error,
  onRetry,
}: {
  isHi: boolean;
  tickets: SupportTicket[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  // Loading state
  if (loading) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '28px 18px' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '3px solid var(--surface-2)',
            borderTopColor: 'var(--primary)',
            borderRadius: '50%',
            margin: '0 auto 10px',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
          {t(isHi, 'Loading your tickets...', 'आपके टिकट लोड हो रहे हैं...')}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>&#x26A0;&#xFE0F;</div>
        <p style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 12px' }}>{error}</p>
        <button
          onClick={onRetry}
          style={{
            padding: '8px 18px',
            backgroundColor: 'transparent',
            color: 'var(--primary)',
            border: '1px solid var(--surface-3)',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
        </button>
      </div>
    );
  }

  // Empty state
  if (tickets.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '28px 18px' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>&#x1F4ED;</div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>
          {t(isHi, 'No tickets yet', 'अभी तक कोई टिकट नहीं')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
          {t(
            isHi,
            'When you contact support, your requests will appear here so you can track their status.',
            'जब आप सहायता से संपर्क करेंगे, तो आपके अनुरोध यहाँ दिखेंगे ताकि आप उनकी स्थिति ट्रैक कर सकें।'
          )}
        </p>
      </div>
    );
  }

  // Loaded state
  return (
    <div style={cardStyle}>
      {tickets.map((ticket, i) => (
        <div
          key={ticket.id}
          style={{
            padding: '12px 0',
            borderBottom: i < tickets.length - 1 ? '1px solid var(--surface-2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0, lineHeight: 1.4 }}>
                {ticket.subject}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
                {categoryLabel(isHi, ticket.category)}
                {' · '}
                {priorityLabel(isHi, ticket.priority)}
                {' · '}
                {formatDate(ticket.created_at)}
              </p>
            </div>
            <span
              style={{
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                color: statusColor(ticket.status),
                backgroundColor: `${statusColor(ticket.status)}18`,
                borderRadius: 8,
                padding: '3px 10px',
                whiteSpace: 'nowrap',
              }}
            >
              {statusLabel(isHi, ticket.status)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
export default function ParentSupportPage() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  // Compose form state
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('account');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  // My-tickets list state
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      window.location.href = '/';
    }
  }, [isLoading, isLoggedIn]);

  // Fetch the guardian's own tickets
  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await authedFetch('/api/support/tickets?page=1&page_size=20');
      if (res.status === 401) {
        setTicketsError(t(isHi, 'Please sign in again to view your tickets.', 'अपने टिकट देखने के लिए कृपया दोबारा साइन इन करें।'));
        return;
      }
      const json = (await res.json().catch(() => ({}))) as TicketListResponse;
      if (!res.ok || !json.success) {
        setTicketsError(t(isHi, 'Could not load your tickets.', 'आपके टिकट लोड नहीं हो सके।'));
        return;
      }
      setTickets(json.data?.tickets ?? []);
    } catch {
      setTicketsError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया दोबारा कोशिश करें।'));
    } finally {
      setTicketsLoading(false);
    }
  }, [isHi]);

  useEffect(() => {
    if (!isLoading && isLoggedIn) fetchTickets();
  }, [isLoading, isLoggedIn, fetchTickets]);

  const subjectValid = subject.trim().length >= 1 && subject.trim().length <= 200;
  const descriptionValid = description.trim().length >= 20 && description.trim().length <= 5000;
  const canSubmit = subjectValid && descriptionValid && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!subjectValid) {
      setToast({ message: t(isHi, 'Please enter a subject.', 'कृपया एक विषय दर्ज करें।'), kind: 'error' });
      return;
    }
    if (!descriptionValid) {
      setToast({
        message: t(isHi, 'Please enter at least 20 characters describing your issue.', 'कृपया अपनी समस्या बताने के लिए कम से कम 20 अक्षर दर्ज करें।'),
        kind: 'error',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await authedFetch('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim().slice(0, 200),
          description: description.trim().slice(0, 5000),
          category,
          priority,
        }),
      });

      // Status-specific error handling (P7: every message bilingual)
      if (res.status === 401) {
        setToast({
          message: t(isHi, 'Your session expired. Please sign in again.', 'आपका सत्र समाप्त हो गया। कृपया दोबारा साइन इन करें।'),
          kind: 'error',
        });
        return;
      }
      if (res.status === 403) {
        const json = (await res.json().catch(() => ({}))) as TicketCreateResponse;
        if (json.code === 'NO_LINKED_CHILD') {
          setToast({
            message: t(
              isHi,
              'Link a child to your account before contacting support.',
              'सहायता से संपर्क करने से पहले अपने खाते से एक बच्चा जोड़ें।'
            ),
            kind: 'error',
          });
        } else {
          setToast({
            message: t(isHi, "You don't have permission to do this.", 'आपके पास ऐसा करने की अनुमति नहीं है।'),
            kind: 'error',
          });
        }
        return;
      }
      if (res.status === 429) {
        setToast({
          message: t(
            isHi,
            "You've reached the limit of 5 tickets per day. Please try again later.",
            'आपने प्रति दिन 5 टिकट की सीमा पार कर ली है। कृपया बाद में दोबारा कोशिश करें।'
          ),
          kind: 'error',
        });
        return;
      }
      if (res.status === 400) {
        setToast({
          message: t(
            isHi,
            'Please check the subject and description and try again.',
            'कृपया विषय और विवरण जाँचें और दोबारा कोशिश करें।'
          ),
          kind: 'error',
        });
        return;
      }

      const json = (await res.json().catch(() => ({}))) as TicketCreateResponse;

      if (!res.ok || !json.success || !json.ticket_id) {
        setToast({
          message: t(
            isHi,
            'Something went wrong sending your message. Please try again.',
            'आपका संदेश भेजने में कुछ गड़बड़ हुई। कृपया दोबारा कोशिश करें।'
          ),
          kind: 'error',
        });
        return;
      }

      // Success — show a real confirmation with the ticket id.
      const shortId = json.ticket_id.slice(0, 8);
      setToast({
        message: t(
          isHi,
          `Ticket #${shortId} created. We'll respond within 24 hours.`,
          `टिकट #${shortId} बना दिया गया। हम 24 घंटे के भीतर जवाब देंगे।`
        ),
        kind: 'success',
      });

      // Reset the form and refresh the list so the new ticket appears.
      setSubject('');
      setDescription('');
      setCategory('account');
      setPriority('normal');
      void fetchTickets();
    } catch {
      setToast({
        message: t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया दोबारा कोशिश करें।'),
        kind: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }, [subject, description, category, priority, subjectValid, descriptionValid, isHi, fetchTickets]);

  // Page loading state (auth resolving)
  if (isLoading || !isLoggedIn) {
    return (
      <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color: 'var(--text-3)', fontSize: 14 }}>{t(isHi, 'Loading...', 'लोड हो रहा है...')}</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Inject keyframe animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--primary))',
          borderRadius: 16,
          padding: '28px 22px',
          marginBottom: 24,
          textAlign: 'center' as const,
          position: 'relative' as const,
        }}
      >
        <button
          onClick={() => router.push('/parent')}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            background: 'color-mix(in srgb, var(--surface-1) 20%, transparent)',
            border: 'none',
            borderRadius: 8,
            padding: '6px 12px',
            color: 'var(--surface-1)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 32,
          }}
        >
          &larr; {t(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <div style={{ fontSize: 36, marginBottom: 8 }}>&#x1F4AC;</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--surface-1)', margin: '0 0 6px' }}>
          {t(isHi, 'Help & Support', 'सहायता और समर्थन')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--surface-1)', margin: 0 }}>
          {t(isHi, "We're here to help you and your child succeed", 'हम आपकी और आपके बच्चे की सफलता में मदद के लिए यहाँ हैं')}
        </p>
      </div>

      {/* Section 1: FAQ */}
      <h2 style={sectionTitle}>&#x2753; {t(isHi, 'Frequently Asked Questions', 'अक्सर पूछे जाने वाले प्रश्न')}</h2>
      {faqItems.map((item, i) => (
        <FaqItem key={i} q={t(isHi, item.q.en, item.q.hi)} a={t(isHi, item.a.en, item.a.hi)} />
      ))}

      {/* Section 2: Contact Support */}
      <h2 style={sectionTitle}>&#x1F4E9; {t(isHi, 'Contact Support', 'सहायता से संपर्क करें')}</h2>
      <div style={cardStyle}>
        {/* Subject */}
        <label htmlFor="support-subject" style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
          {t(isHi, 'Subject', 'विषय')} *
        </label>
        <input
          id="support-subject"
          style={inputStyle}
          placeholder={t(isHi, 'Brief summary of your request', 'अपने अनुरोध का संक्षिप्त सारांश')}
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
        />

        {/* Category */}
        <label htmlFor="support-category" style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
          {t(isHi, 'Category', 'श्रेणी')}
        </label>
        <select
          id="support-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as TicketCategory)}
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
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {t(isHi, c.en, c.hi)}
            </option>
          ))}
        </select>

        {/* Priority */}
        <label htmlFor="support-priority" style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
          {t(isHi, 'Priority', 'प्राथमिकता')}
        </label>
        <select
          id="support-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
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
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(isHi, p.en, p.hi)}
            </option>
          ))}
        </select>

        {/* Description */}
        <label htmlFor="support-message" style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
          {t(isHi, 'Message', 'संदेश')}{' '}
          <span style={{ color: 'var(--text-3)' }}>{t(isHi, '(min 20 characters)', '(कम से कम 20 अक्षर)')}</span>
        </label>
        <textarea
          id="support-message"
          style={{
            ...inputStyle,
            minHeight: 100,
            resize: 'vertical' as const,
            fontFamily: 'inherit',
          }}
          placeholder={t(isHi, 'Describe your question or issue...', 'अपना प्रश्न या समस्या बताएँ...')}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...btnPrimary,
            opacity: canSubmit ? 1 : 0.6,
            cursor: canSubmit ? 'pointer' : 'default',
            transition: 'opacity 0.2s',
          }}
        >
          {submitting ? t(isHi, 'Sending...', 'भेज रहे हैं...') : t(isHi, 'Send Message', 'संदेश भेजें')}
        </button>
      </div>

      {/* Section 3: My Tickets */}
      <h2 style={sectionTitle}>&#x1F4CB; {t(isHi, 'My Tickets', 'मेरे टिकट')}</h2>
      <MyTickets
        isHi={isHi}
        tickets={tickets}
        loading={ticketsLoading}
        error={ticketsError}
        onRetry={fetchTickets}
      />

      {/* Section 4: Quick Links */}
      <h2 style={sectionTitle}>&#x1F517; {t(isHi, 'Quick Links', 'त्वरित लिंक')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Email Support Note */}
        <div style={{ ...cardStyle, textAlign: 'center' as const, marginBottom: 0 }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>&#x1F4E7;</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
            {t(isHi, 'Need Help?', 'मदद चाहिए?')}
          </span>
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 0', lineHeight: 1.4 }}>
            {t(
              isHi,
              'For urgent queries, use the form above. We typically respond within 24 hours.',
              'तत्काल प्रश्नों के लिए ऊपर दिया फ़ॉर्म उपयोग करें। हम आमतौर पर 24 घंटे में जवाब देते हैं।'
            )}
          </p>
        </div>

        {/* Email Us */}
        <a href="mailto:support@alfanumrik.com" style={{ textDecoration: 'none' }}>
          <div style={{ ...cardStyle, textAlign: 'center' as const, cursor: 'pointer', marginBottom: 0 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>&#x1F4E7;</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              {t(isHi, 'Email Us', 'हमें ईमेल करें')}
            </span>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>support@alfanumrik.com</p>
          </div>
        </a>

        {/* Help Centre */}
        <a href="/help" style={{ textDecoration: 'none' }}>
          <div style={{ ...cardStyle, textAlign: 'center' as const, cursor: 'pointer', marginBottom: 0 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>&#x1F9ED;</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              {t(isHi, 'Help Centre', 'सहायता केंद्र')}
            </span>
          </div>
        </a>

        {/* Privacy Policy */}
        <a href="/privacy" style={{ textDecoration: 'none' }}>
          <div style={{ ...cardStyle, textAlign: 'center' as const, cursor: 'pointer', marginBottom: 0 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>&#x1F512;</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              {t(isHi, 'Privacy Policy', 'गोपनीयता नीति')}
            </span>
          </div>
        </a>
      </div>

      {/* Section 5: Tips for Parents */}
      <h2 style={{ ...sectionTitle, marginTop: 28 }}>&#x1F4A1; {t(isHi, 'Tips for Parents', 'अभिभावकों के लिए सुझाव')}</h2>
      <div style={cardStyle}>
        {tips.map((tip, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 0',
              borderBottom: i < tips.length - 1 ? '1px solid var(--surface-2)' : 'none',
            }}
          >
            <span
              style={{
                backgroundColor: 'var(--surface-2)',
                color: 'var(--primary)',
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
            <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{t(isHi, tip.en, tip.hi)}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', margin: '20px 0 12px' }}>
        Alfanumrik Learning OS | {t(isHi, 'Parent Portal', 'अभिभावक पोर्टल')}
      </p>

      {/* Toast */}
      {toast && <Toast message={toast.message} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}
