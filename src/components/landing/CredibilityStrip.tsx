'use client';

import { useLang } from './LangToggle';
import { IconAshoka, IconShield, IconPadlock, IconBook, IconNoAds } from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem } from './Animations';

const BADGES = [
  { Icon: IconAshoka, label: 'DPIIT Recognized Startup', labelHi: 'DPIIT मान्यता प्राप्त स्टार्टअप' },
  { Icon: IconShield, label: 'DPDPA Compliant', labelHi: 'DPDPA अनुपालित' },
  { Icon: IconPadlock, label: 'Data Encrypted', labelHi: 'डेटा एन्क्रिप्टेड' },
  { Icon: IconBook, label: 'NCERT Aligned', labelHi: 'NCERT के अनुरूप' },
  { Icon: IconNoAds, label: 'No Ads. Ever.', labelHi: 'कभी विज्ञापन नहीं।' },
];

export function CredibilityStrip() {
  const { isHi, t } = useLang();
  return (
    <section className="py-8 sm:py-10 border-y" style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.03), rgba(124,58,237,0.03))', borderColor: 'var(--border)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col items-center gap-5">
        <StaggerContainer className="flex flex-wrap items-center justify-center gap-2.5">
          {BADGES.map((badge) => (
            <StaggerItem key={badge.label}>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.4)', color: 'var(--text-2)' }}>
                <badge.Icon /> {isHi ? badge.labelHi : badge.label}
              </span>
            </StaggerItem>
          ))}
        </StaggerContainer>
        <FadeIn>
          <p className="text-sm font-medium text-center" style={{ color: 'var(--text-2)' }}>
            {[
              { val: '16', label: t('subjects', 'विषय') },
              { val: '7', label: t('grades', 'कक्षाएँ') },
              { val: '115', label: t('STEM experiments', 'STEM प्रयोग') },
              { val: '6', label: t('Bloom\'s levels in every quiz', 'हर क्विज़ में Bloom\'s स्तर') },
              { val: '', label: t('Hindi & English', 'हिन्दी और अंग्रेज़ी') },
              { val: '', label: t('Built in India', 'भारत में निर्मित') },
            ].map((m, i, arr) => (
              <span key={i}>
                {m.val && <span className="font-bold" style={{ color: 'var(--text-1)' }}>{m.val} </span>}
                {m.label}
                {i < arr.length - 1 && <span style={{ color: 'var(--orange)', opacity: 0.5 }}> · </span>}
              </span>
            ))}
          </p>
        </FadeIn>
        <FadeIn>
          <div className="text-center">
            <p className="text-xs italic" style={{ color: 'var(--text-3)' }}>{t('Trusted by parents who want more than tuition classes.', 'उन माता-पिता का भरोसा जो ट्यूशन क्लास से ज़्यादा चाहते हैं।')}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>Cusiosense Learning India Pvt. Ltd. · CIN: U58200UP2025PTC238093</p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}