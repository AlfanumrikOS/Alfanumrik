'use client';

import Link from 'next/link';
import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

export default function FinalCtaV2() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.finalCta} id="cta" aria-labelledby="final-cta-title">
      <div className="ornament deva" lang="hi" aria-hidden="true">९</div>
      <div className={s.wrap}>
        <div className="eye">
          {t('Section vi · the invitation', 'खंड vi · निमंत्रण')}
        </div>
        <h2 id="final-cta-title">
          {isHi ? (
            <>
              आज का गृहकार्य <em>अलग</em> हो सकता है।<br />
              अगले दस मिनटों में शुरू करें।
            </>
          ) : (
            <>
              Tonight's homework can be <em>different</em>.<br />
              Start in the next ten minutes.
            </>
          )}
        </h2>
        <p className="sub">
          {t(
            "Sign up takes ninety seconds. Pick your child's grade and one subject they are quietly afraid of. We will show you, this week, what they actually know — and one small thing you can do about it.",
            'साइन-अप में नब्बे सेकंड लगते हैं। बच्चे की कक्षा और एक ऐसा विषय चुनिए जिससे वह चुपचाप डरता है। हम इस सप्ताह दिखाएँगे कि वह सच में क्या जानता है।',
          )}
        </p>
        <p className="devaSub" lang="hi">
          आज की पढ़ाई थोड़ी बेहतर हो सकती है। अभी शुरू कीजिये।
        </p>
        <div className="ctaRow">
          <Link href="/login" className={`${s.btn} ${s.btnPrimary} ${s.btnArrow}`}>
            {t('Start a free session', 'मुफ्त सत्र शुरू करें')}
          </Link>
          <Link href="/contact" className={`${s.btn} ${s.btnCream}`}>
            {t('Talk to the founder', 'संस्थापक से बात करें')}
          </Link>
        </div>
        <div className="fineprint">
          {t(
            'No credit card · Cancel any moment · Made in Bengaluru, India',
            'कोई क्रेडिट कार्ड नहीं · कभी भी रद्द करें · बेंगलुरु में बना',
          )}
        </div>
      </div>
    </section>
  );
}
