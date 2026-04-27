'use client';

import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface Item {
  roman: string;
  h4En: string;
  h4Hi: string;
  pEn: React.ReactNode;
  pHi: React.ReactNode;
  tagEn: string;
  tagHi: string;
}

const PROBLEMS: Item[] = [
  {
    roman: 'i.',
    h4En: 'Tuition has eaten the evening.',
    h4Hi: 'ट्यूशन ने पूरी शाम खा ली है।',
    pEn: <>Three classes, two coaching tabs, one parent waiting in a Maruti at 8:40 pm. The child has not actually understood the chapter — they have been re-told it.</>,
    pHi: <>तीन कक्षाएँ, दो कोचिंग टैब, और 8:40 बजे मारुति में बैठे एक अभिभावक। बच्चे ने पाठ समझा नहीं — उसे दोहरा कर सुनाया गया है।</>,
    tagEn: 'Observation, Lucknow · Mar 2026',
    tagHi: 'अवलोकन, लखनऊ · मार्च 2026',
  },
  {
    roman: 'ii.',
    h4En: 'Apps reward attendance, not learning.',
    h4Hi: 'ऐप उपस्थिति को इनाम देते हैं, सीखने को नहीं।',
    pEn: <>Streaks, gems, Lottie confetti. Your child has a 47-day streak and still cannot identify a transitive verb. The metrics are decorative.</>,
    pHi: <>स्ट्रीक, जेम, कन्फेटी। बच्चे की 47-दिन की स्ट्रीक है, फिर भी वह सकर्मक क्रिया नहीं पहचान पाता। ये मीट्रिक सजावटी हैं।</>,
    tagEn: 'Issue · gamification debt',
    tagHi: 'समस्या · गेमिफ़िकेशन क़र्ज़',
  },
  {
    roman: 'iii.',
    h4En: 'Parents are flying blind.',
    h4Hi: 'अभिभावक अंधेरे में हैं।',
    pEn: <>The PTM is twice a year. The report card is one row of percentages. There is no honest weekly answer to the question every parent quietly asks: <em>are they alright?</em></>,
    pHi: <>PTM साल में दो बार। रिपोर्ट कार्ड में बस प्रतिशत की एक पंक्ति। हर अभिभावक के मन में चुपके से एक सवाल — <em>क्या बच्चा ठीक है?</em></>,
    tagEn: 'Survey · n = 1,840 parents',
    tagHi: 'सर्वेक्षण · n = 1,840 अभिभावक',
  },
];

const SOLUTIONS: Item[] = [
  {
    roman: 'i.',
    h4En: 'Ten minutes, then we stop.',
    h4Hi: 'दस मिनट, फिर रुक जाते हैं।',
    pEn: <>Sessions are short by design. Our cognitive engine watches latency and accuracy and ends the session before fatigue sets in. The child leaves wanting more — that is the point.</>,
    pHi: <>सत्र जान-बूझ कर छोटे हैं। हमारा कॉग्निटिव इंजन गति और शुद्धता देखता है, और थकान से पहले सत्र समाप्त कर देता है। बच्चा और चाहता हुआ उठता है — यही मक़सद है।</>,
    tagEn: 'CME · cognitive moderation',
    tagHi: 'CME · संज्ञानात्मक संयम',
  },
  {
    roman: 'ii.',
    h4En: "Mastery, measured by Bloom's.",
    h4Hi: 'महारत, ब्लूम के अनुसार।',
    pEn: <>Every question is tagged Remember → Understand → Apply → Analyse. We do not say "level up" — we say "she can now <em>apply</em> the photosynthesis equation; she still cannot <em>analyse</em> the Calvin cycle." Specific. Useful.</>,
    pHi: <>हर प्रश्न पर ब्लूम-स्तर का टैग है: स्मरण → समझ → अनुप्रयोग → विश्लेषण। हम "लेवल अप" नहीं कहते — हम कहते हैं "वह अब प्रकाश-संश्लेषण समीकरण <em>लागू</em> कर सकती है, पर केल्विन चक्र का <em>विश्लेषण</em> अब भी नहीं।"</>,
    tagEn: 'Bayesian Knowledge Tracing',
    tagHi: 'बायेसियन ज्ञान-ट्रेसिंग',
  },
  {
    roman: 'iii.',
    h4En: 'One honest weekly note for the parent.',
    h4Hi: 'अभिभावक के लिए एक ईमानदार साप्ताहिक नोट।',
    pEn: <>Every Sunday morning, in <span className="deva" lang="hi">हिन्दी</span> or English, you receive a short letter — what was learnt, what slipped, what to talk about at dinner. Written by the engine; reviewed by a human; never algorithmic gibberish.</>,
    pHi: <>हर रविवार सुबह, <span className="deva" lang="hi">हिन्दी</span> या अंग्रेज़ी में एक छोटा पत्र — क्या सीखा, क्या छूटा, और रात के खाने पर क्या बात करें। इंजन लिखता है; इंसान जाँचता है।</>,
    tagEn: 'Parent letter · weekly',
    tagHi: 'अभिभावक पत्र · साप्ताहिक',
  },
];

function Column({
  heading,
  items,
  isHi,
}: {
  heading: React.ReactNode;
  items: Item[];
  isHi: boolean;
}) {
  return (
    <div className={s.spreadCol}>
      <h3>{heading}</h3>
      {items.map((it) => (
        <div className={s.spreadItem} key={it.roman}>
          <div className="roman">{it.roman}</div>
          <div>
            <h4>{isHi ? it.h4Hi : it.h4En}</h4>
            <p>{isHi ? it.pHi : it.pEn}</p>
            <span className="tag">{isHi ? it.tagHi : it.tagEn}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorkbookV2() {
  const { isHi, t } = useWelcomeV2();
  return (
    <section className={s.spread} id="how" aria-labelledby="spread-title">
      <div className={s.wrap}>
        <div className={s.spreadHead}>
          <h2 id="spread-title">
            {t('The honest ', 'ईमानदार ')}
            <em>{t('diagnosis', 'निदान')}</em>
            {isHi ? '।' : '.'}
          </h2>
          <div className="meta">
            {t('A workbook spread · sec. ii', 'एक कार्यपुस्तिका · खंड ii')}
          </div>
        </div>

        <div className={s.spreadGrid}>
          <Column
            isHi={isHi}
            heading={
              <>
                {t('What is ', 'भारतीय घरों में ')}
                <strong>{t('actually happening', 'वास्तव में हो रहा है')}</strong>
                {t(' in Indian homes', '')}
              </>
            }
            items={PROBLEMS}
          />
          <div className="divider" aria-hidden="true"></div>
          <Column
            isHi={isHi}
            heading={
              <>
                {t('What Alfanumrik ', 'अल्फ़ान्यूमरिक इसके बजाय ')}
                <strong>{t('does instead', 'क्या करता है')}</strong>
              </>
            }
            items={SOLUTIONS}
          />
        </div>
      </div>
    </section>
  );
}
