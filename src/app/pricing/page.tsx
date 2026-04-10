'use client';

import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';
import { PricingCards } from './PricingCards';

// SEO metadata is in layout.tsx (Server Component) for SSR indexing

/* ─── Data ─── */

const B2B_FEATURES = [
  { icon: '🏢', title: 'Admin Dashboard', titleHi: 'एडमिन डैशबोर्ड', desc: 'School-wide analytics covering all classes, teachers, and students in one unified view.', descHi: 'एक एकीकृत दृश्य में सभी कक्षाओं, शिक्षकों और छात्रों को कवर करने वाले स्कूल-व्यापी एनालिटिक्स।' },
  { icon: '📚', title: 'Multi-Class Management', titleHi: 'मल्टी-क्लास प्रबंधन', desc: 'Manage multiple sections, grades, and subjects across your entire school from a single admin panel.', descHi: 'एक ही एडमिन पैनल से अपने पूरे स्कूल में कई सेक्शन, ग्रेड और विषयों का प्रबंधन करें।' },
  { icon: '🎯', title: 'Board Exam Analytics', titleHi: 'बोर्ड परीक्षा एनालिटिक्स', desc: 'Track student preparedness for CBSE board examinations with subject-wise mastery data.', descHi: 'विषयवार दक्षता डेटा के साथ CBSE बोर्ड परीक्षा के लिए छात्रों की तैयारी ट्रैक करें।' },
  { icon: '🛠️', title: 'Teacher Tools', titleHi: 'शिक्षक टूल', desc: 'Worksheet generators, assignment management, and class-wide mastery tracking for every teacher.', descHi: 'हर शिक्षक के लिए वर्कशीट जनरेटर, असाइनमेंट प्रबंधन, और कक्षा-व्यापी दक्षता ट्रैकिंग।' },
  { icon: '👨‍👩‍👧', title: 'Parent Portal', titleHi: 'पैरेंट पोर्टल', desc: 'Give parents real-time visibility into their child\'s progress, streaks, and exam readiness.', descHi: 'अभिभावकों को उनके बच्चे की प्रगति, स्ट्रीक, और परीक्षा तैयारी की रियल-टाइम जानकारी दें।' },
  { icon: '🔗', title: 'Custom Integration', titleHi: 'कस्टम इंटीग्रेशन', desc: 'Work with our team to connect Alfanumrik with your existing school ERP, LMS, or student information systems. Available on request.', descHi: 'Alfanumrik को आपके मौजूदा स्कूल ERP, LMS, या छात्र सूचना प्रणाली से जोड़ने के लिए हमारी टीम से संपर्क करें। अनुरोध पर उपलब्ध।' },
];

const FAQS = [
  {
    q: 'Can I try Alfanumrik for free before upgrading?',
    qHi: 'क्या मैं अपग्रेड करने से पहले Alfanumrik मुफ़्त में आज़मा सकता हूँ?',
    a: 'Yes! The Explorer plan is completely free with 5 Foxy chats and 5 quizzes per day across 2 subjects. No credit card required. Upgrade anytime when you need more.',
    aHi: 'हाँ! Explorer प्लान 2 विषयों में प्रतिदिन 5 Foxy चैट और 5 क्विज़ के साथ पूरी तरह मुफ़्त है। क्रेडिट कार्ड की ज़रूरत नहीं। जब ज़रूरत हो तब अपग्रेड करें।',
  },
  {
    q: 'How does the annual billing work?',
    qHi: 'वार्षिक बिलिंग कैसे काम करती है?',
    a: 'When you choose annual billing, you pay for the full year upfront and save 33% compared to monthly billing. For example, the Pro plan is \u20B9699/month or \u20B95,599/year (equivalent to \u20B9467/month).',
    aHi: 'जब आप वार्षिक बिलिंग चुनते हैं, तो आप पूरे साल का अग्रिम भुगतान करते हैं और मासिक बिलिंग की तुलना में 33% बचाते हैं। उदाहरण के लिए, Pro प्लान \u20B9699/माह या \u20B95,599/वर्ष (\u20B9467/माह के बराबर) है।',
  },
  {
    q: 'What is your refund policy?',
    qHi: 'आपकी रिफंड नीति क्या है?',
    a: 'We offer a 7-day money-back guarantee on all paid plans. If you\'re not satisfied within the first 7 days of your subscription, contact us for a full refund. No questions asked.',
    aHi: 'हम सभी सशुल्क प्लान पर 7 दिन की मनी-बैक गारंटी देते हैं। अगर आप अपनी सब्सक्रिप्शन के पहले 7 दिनों में संतुष्ट नहीं हैं, तो पूर्ण रिफंड के लिए हमसे संपर्क करें। कोई सवाल नहीं पूछे जाएँगे।',
  },
  {
    q: 'Can I switch plans at any time?',
    qHi: 'क्या मैं किसी भी समय प्लान बदल सकता हूँ?',
    a: 'Absolutely. You can upgrade or downgrade your plan at any time. When upgrading, you\'ll be charged the prorated difference. When downgrading, the remaining credit will be applied to your next billing cycle.',
    aHi: 'बिल्कुल। आप किसी भी समय अपना प्लान अपग्रेड या डाउनग्रेड कर सकते हैं। अपग्रेड करने पर, आपसे आनुपातिक अंतर लिया जाएगा। डाउनग्रेड करने पर, शेष क्रेडिट आपके अगले बिलिंग चक्र में लागू होगा।',
  },
];

/* ─── Main Page ─── */

export default function PricingPage() {
  return (
    <LangProvider>
      <PricingContent />
    </LangProvider>
  );
}

function PricingContent() {
  const { t } = useLang();

  return (
    <div style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)', minHeight: '100vh' }}>
      {/* Navbar */}
      <nav style={navStyle}>
        <div style={navInner}>
          <Link href="/welcome" style={logoLink}>
            <span style={{ fontSize: 24 }}>🦊</span>
            <span style={logoText}>Alfanumrik</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LangToggle />
            <Link href="/welcome" style={navLinkStyle}>{t('Home', 'होम')}</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 16px 32px', maxWidth: 800, margin: '0 auto' }}>
        <span style={badgeStyle}>{t('PRICING', 'मूल्य')}</span>
        <h1 style={h1Style}>{t('Simple, Transparent Pricing', 'सरल, पारदर्शी मूल्य')}</h1>
        <p style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text-2, #444)', maxWidth: 520, margin: '0 auto' }}>
          {t(
            'Start free, upgrade when you\'re ready. Every plan includes Foxy, your personal AI tutor.',
            'मुफ़्त शुरू करें, जब तैयार हों तब अपग्रेड करें। हर प्लान में Foxy, आपका व्यक्तिगत AI ट्यूटर शामिल है।'
          )}
        </p>
      </section>

      {/* Toggle + Plan Cards (client component for interactivity) */}
      <PricingCards />

      {/* B2B School Section */}
      <section style={{ background: 'var(--surface-1, #f5f2ed)', padding: '64px 16px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            <span style={badgeStyle}>{t('FOR SCHOOLS', 'स्कूलों के लिए')}</span>
            <h2 style={h2Style}>{t('For Schools & Institutions', 'स्कूलों और संस्थानों के लिए')}</h2>
            <p style={subtitleStyle}>
              {t(
                'Custom pricing based on student count. Deploy Alfanumrik across your entire school with dedicated support, training, and integration assistance.',
                'छात्र संख्या के आधार पर कस्टम मूल्य। समर्पित सहायता, प्रशिक्षण, और इंटीग्रेशन सहायता के साथ अपने पूरे स्कूल में Alfanumrik लागू करें।'
              )}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {B2B_FEATURES.map(f => (
              <div key={f.title} style={card}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>{t(f.title, f.titleHi)}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>{t(f.desc, f.descHi)}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 40, flexWrap: 'wrap' }}>
            <Link href="/contact" style={ctaPrimary}>{t('Contact Sales', 'सेल्स से संपर्क करें')}</Link>
            <Link href="/demo" style={ctaSecondary}>{t('Book a Demo', 'डेमो बुक करें')}</Link>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section style={{ padding: '64px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <span style={badgeStyle}>FAQ</span>
            <h2 style={h2Style}>{t('Frequently Asked Questions', 'अक्सर पूछे जाने वाले प्रश्न')}</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FAQS.map(faq => (
              <div key={faq.q} style={faqCard}>
                <h3 style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 8, color: 'var(--text-1, #1a1a1a)' }}>
                  {t(faq.q, faq.qHi)}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-2, #444)' }}>
                  {t(faq.a, faq.aHi)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={footerStyle}>
        <div style={footerInner}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/privacy" style={footerLink}>{t('Privacy Policy', 'गोपनीयता नीति')}</Link>
            <Link href="/terms" style={footerLink}>{t('Terms of Service', 'सेवा की शर्तें')}</Link>
            <Link href="/contact" style={footerLink}>{t('Contact', 'संपर्क')}</Link>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 16 }}>
            &copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─── Styles ─── */

const navStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 50,
  background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  borderBottom: '1px solid var(--border, #e5e0d8)',
};
const navInner: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
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
const faqCard: React.CSSProperties = {
  background: 'var(--surface-1, #FFFFFF)', border: '1px solid var(--border, #e5e0d8)', borderRadius: 16, padding: 24,
};

const ctaPrimary: React.CSSProperties = {
  display: 'inline-block', padding: '14px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12,
  background: 'var(--orange, #E8581C)', color: '#fff', textDecoration: 'none',
  fontFamily: 'var(--font-display)',
};
const ctaSecondary: React.CSSProperties = {
  display: 'inline-block', padding: '14px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12,
  background: 'transparent', color: 'var(--orange, #E8581C)', textDecoration: 'none',
  fontFamily: 'var(--font-display)', border: '2px solid var(--orange, #E8581C)',
};

const footerStyle: React.CSSProperties = { borderTop: '1px solid var(--border, #e5e0d8)', padding: '32px 16px', textAlign: 'center' };
const footerInner: React.CSSProperties = { maxWidth: 1100, margin: '0 auto' };
const footerLink: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--orange, #E8581C)', textDecoration: 'none' };
