'use client';

import Link from 'next/link';
import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="py-8 sm:py-10 border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FoxyMark size="sm" />
              <span className="text-base font-extrabold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>Alfanumrik</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {t('Structured learning for CBSE students', 'CBSE छात्रों के लिए संरचित शिक्षा')}<br />Cusiosense Learning India Pvt. Ltd.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>{t('Product', 'उत्पाद')}</h4>
            <div className="space-y-2">
              {[
                { href: '/pricing', label: 'Pricing', labelHi: 'मूल्य' },
                { href: '/for-schools', label: 'For Schools', labelHi: 'स्कूलों के लिए' },
                { href: '/login', label: 'Student Login', labelHi: 'छात्र लॉगिन' },
                { href: '/login?role=parent', label: 'Parent Login', labelHi: 'पैरेंट लॉगिन' },
                { href: '/login?role=teacher', label: 'Teacher Login', labelHi: 'शिक्षक लॉगिन' },
              ].map((l) => (
                <Link key={l.href + l.label} href={l.href} className="block text-sm hover:underline" style={{ color: 'var(--text-2)' }}>{t(l.label, l.labelHi)}</Link>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>{t('Contact & Legal', 'संपर्क और कानूनी')}</h4>
            <div className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
              <p>support@alfanumrik.com</p>
              <Link href="/privacy" className="block hover:underline">{t('Privacy Policy', 'गोपनीयता नीति')}</Link>
              <Link href="/terms" className="block hover:underline">{t('Terms', 'शर्तें')}</Link>
            </div>
          </div>
        </div>
        <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>© {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd. {t('All rights reserved.', 'सर्वाधिकार सुरक्षित।')}</p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{t('DPIIT Recognized · DPDPA Compliant · Data Encrypted · No Ads', 'DPIIT मान्यता प्राप्त · DPDPA अनुपालित · डेटा एन्क्रिप्टेड · कोई विज्ञापन नहीं')}</p>
        </div>
      </div>
    </footer>
  );
}