'use client';

/**
 * AlfaBotStarterChips — Empty-state guidance for a fresh conversation.
 *
 * Renders four bilingual chips per audience. The chip text is the user
 * message we ship when clicked. Below the chips, a "Switch role" link
 * exposes an inline 4-pill audience selector that calls
 * `setAudience(..., 'starter')`.
 *
 * Why we ship both EN and HI strings (instead of just translating the EN):
 *   PostHog analytics (alfabot_starter_chip_clicked) carry the EN string so
 *   funnel analysis works regardless of UI language. The HI string is
 *   strictly a display artifact.
 *
 * Owner: frontend.
 */

import { useState } from 'react';
import type { AlfabotAudience } from '@alfanumrik/lib/alfabot/types';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import s from './alfabot.module.css';

const STARTER_CHIPS: Record<AlfabotAudience, Array<{ en: string; hi: string }>> = {
  // Counseling-intent refresh (2026-07-17): chips lead with the underlying
  // concern (value vs tuition, AI trust, honest progress) instead of pure FAQ.
  // PINNED texts — do not change without updating their tests:
  //   - parent[0] "Does this match my child's CBSE syllabus?" (AlfaBotPanel.test.tsx)
  //   - parent[1] must contain "₹699/month" verbatim (AlfaBotPanel.test.tsx)
  //   - school[0] "What's pricing for 30–3,000 seats?" en-dash (e2e/alfabot.spec.ts)
  parent: [
    { en: "Does this match my child's CBSE syllabus?", hi: 'क्या यह मेरे बच्चे की CBSE पाठ्यक्रम से मेल खाता है?' },
    { en: 'Is ₹699/month worth it vs tuition?', hi: 'क्या ₹699/माह tuition के मुक़ाबले सही है?' },
    { en: 'Is AI safe for my child?', hi: 'क्या AI मेरे बच्चे के लिए सुरक्षित है?' },
    { en: 'How do I see real progress?', hi: 'असली प्रगति कैसे देखूँ?' },
  ],
  student: [
    { en: 'What is Foxy?', hi: 'Foxy क्या है?' },
    { en: 'Can this help with boards and JEE/NEET?', hi: 'क्या यह boards और JEE/NEET में मदद करेगा?' },
    { en: 'How do I fix my weak chapters?', hi: 'अपने कमज़ोर चैप्टर कैसे सुधारूँ?' },
    { en: 'How long is a quiz?', hi: 'क्विज़ कितनी देर का होता है?' },
  ],
  teacher: [
    { en: 'How much time can this save me each week?', hi: 'यह हर हफ़्ते मेरा कितना समय बचा सकता है?' },
    { en: "How do Bloom's diagnostics work?", hi: "Bloom's डायग्नॉस्टिक्स कैसे काम करते हैं?" },
    { en: 'What does the worksheet generator do?', hi: 'वर्कशीट जेनरेटर क्या करता है?' },
    { en: 'Is there a teacher free trial?', hi: 'क्या टीचर के लिए मुफ़्त ट्रायल है?' },
  ],
  school: [
    { en: "What's pricing for 30–3,000 seats?", hi: '30–3,000 सीटों की क़ीमत क्या है?' },
    { en: 'How do NEP-aligned reports work?', hi: 'NEP-aligned रिपोर्ट्स कैसे काम करती हैं?' },
    { en: 'How long does onboarding take?', hi: 'ऑनबोर्डिंग में कितना समय लगता है?' },
    { en: 'How do you protect student data?', hi: 'आप छात्र data की सुरक्षा कैसे करते हैं?' },
  ],
};

const AUDIENCE_LABELS: Record<AlfabotAudience, { en: string; hi: string }> = {
  parent: { en: 'Parent', hi: 'अभिभावक' },
  student: { en: 'Student', hi: 'विद्यार्थी' },
  teacher: { en: 'Teacher', hi: 'शिक्षक' },
  school: { en: 'School', hi: 'विद्यालय' },
};

export default function AlfaBotStarterChips() {
  const { audience, sendMessage, setAudience } = useAlfaBot();
  const { t, lang } = useWelcomeV2();
  const [pickerOpen, setPickerOpen] = useState(false);

  const chips = STARTER_CHIPS[audience];

  const handleChip = (chip: { en: string; hi: string }, index: number) => {
    track('alfabot_starter_chip_clicked', {
      audience,
      language: lang,
      chip_index: index,
      chip_text_en: chip.en,
    });
    const text = lang === 'hi' ? chip.hi : chip.en;
    void sendMessage(text, 'starter_chip');
  };

  return (
    <div className={s.starterWrap}>
      <p className={s.starterIntro}>
        {t(
          'Pick a question to start, or type your own below.',
          'शुरू करने के लिए कोई सवाल चुनें, या नीचे अपना सवाल लिखें।',
        )}
      </p>
      <div className={s.starterChips} role="list">
        {chips.map((chip, i) => (
          <button
            key={chip.en}
            type="button"
            role="listitem"
            className={s.starterChip}
            onClick={() => handleChip(chip, i)}
          >
            {lang === 'hi' ? chip.hi : chip.en}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={s.starterSwitchLink}
        onClick={() => setPickerOpen((p) => !p)}
        aria-expanded={pickerOpen}
      >
        {pickerOpen
          ? t('Hide role selector', 'भूमिका चयन छिपाएँ')
          : t('Switch role', 'भूमिका बदलें')}
      </button>
      {pickerOpen && (
        <div className={s.starterAudiencePicker} role="radiogroup" aria-label={t('Audience', 'दर्शक')}>
          {(Object.keys(AUDIENCE_LABELS) as AlfabotAudience[]).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={a === audience}
              className={
                a === audience
                  ? `${s.starterAudiencePill} ${s.starterAudiencePillActive}`
                  : s.starterAudiencePill
              }
              onClick={() => {
                setAudience(a, 'starter');
                setPickerOpen(false);
              }}
            >
              {t(AUDIENCE_LABELS[a].en, AUDIENCE_LABELS[a].hi)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
