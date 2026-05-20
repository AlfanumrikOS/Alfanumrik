# AlfaBot Knowledge Base

Bilingual (English / Hindi) source-of-truth content for AlfaBot — the landing-page assistant at `/welcome`. Each section is RAG-indexed by `section_id`. Audience filters drive retrieval; canonical sections (marked `canonical: true`) are stuffed into the system prompt verbatim.

Authoring rules:

- English and Hindi are paired per section. Hindi is natural Hindi, not a literal translation.
- Technical terms (CBSE, XP, Bloom's, NEP, DPDPA, AI, NCERT) stay in Latin script per product invariant P7.
- No PII examples (P13). No "coming soon" / future-promise language (P12).
- All factual claims are present-tense, citable, and reflect the product as of `last_reviewed`.

---

## company

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-05-19
-->

### EN

Alfanumrik is an Indian K-12 EdTech company building a CBSE-aligned learning OS for students in grades 6 through 12. We are headquartered in India and serve students, parents, teachers, and schools across the country in English and Hindi. Our mission is simple: every Indian child gets a fair shot at mastery, regardless of language or income. We build for students who learn at home on a phone with patchy 4G, for parents who want honest answers about progress, and for teachers who want time back for teaching. We are independent, India-built, and accountable to the families who use the product.

### HI

Alfanumrik एक भारतीय K-12 EdTech कंपनी है जो कक्षा 6 से 12 तक के बच्चों के लिए CBSE-संरेखित learning OS बनाती है। हमारा मुख्यालय भारत में है और हम पूरे देश में छात्रों, अभिभावकों, शिक्षकों और स्कूलों की अंग्रेज़ी और हिन्दी में सेवा करते हैं। हमारा उद्देश्य सीधा है — हर भारतीय बच्चे को महारत का बराबर मौक़ा मिले, चाहे भाषा कोई हो या आमदनी कितनी भी। हम उन बच्चों के लिए बनाते हैं जो घर पर कमज़ोर 4G वाले फ़ोन पर पढ़ते हैं, उन अभिभावकों के लिए जो प्रगति का सच जानना चाहते हैं, और उन शिक्षकों के लिए जो पढ़ाने के लिए समय वापस चाहते हैं। हम स्वतंत्र हैं, भारत में बने हैं, और उन परिवारों के प्रति जवाबदेह हैं जो हमारा उत्पाद उपयोग करते हैं।

---

## product-features

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-05-19
-->

### EN

Alfanumrik bundles four things into one product. Foxy is the AI tutor — bilingual, NCERT-grounded, and never invents facts outside the syllabus. The mastery x-ray is a parent-friendly map of what the child has actually understood, broken down by chapter and Bloom's level. The Sunday parent letter is honest — it tells you what was learnt and what slipped, with no decorative streaks or leaderboard noise. We cover seven subjects: English, Hindi, Maths, Science, Social Science, Sanskrit, and Computer. Sessions are ten minutes by design, not two-hour lectures. Practice is adaptive — questions get easier or harder based on IRT and BKT signals so the child stays in the right zone.

### HI

Alfanumrik एक उत्पाद में चार चीज़ें देता है। Foxy हमारा AI tutor है — द्विभाषी, NCERT पर आधारित, और पाठ्यक्रम के बाहर कुछ नहीं गढ़ता। महारत-नक़्शा (mastery x-ray) एक अभिभावक-अनुकूल नक़्शा है जो बताता है कि बच्चे ने वास्तव में क्या समझा है — पाठ और Bloom's स्तर के अनुसार। रविवार का अभिभावक पत्र सच बताता है — क्या सीखा, क्या फिसला, बिना किसी सजावटी streak या leaderboard के शोर के। हम सात विषय पढ़ाते हैं — अंग्रेज़ी, हिन्दी, गणित, विज्ञान, सामाजिक विज्ञान, संस्कृत और कंप्यूटर। सत्र दस मिनट के होते हैं, दो घंटे की क्लास नहीं। अभ्यास अनुकूल है — IRT और BKT संकेतों के अनुसार प्रश्न आसान या कठिन होते हैं ताकि बच्चा सही ज़ोन में रहे।

---

## pricing-plans

<!-- meta:
audience: parent, school
canonical: true
last_reviewed: 2026-05-19
-->

### EN

Alfanumrik for families: ₹699 per month — everything included. That covers Foxy, the mastery x-ray, all seven subjects, unlimited quizzes, the Sunday parent letter, and the bilingual experience. No franchise fees, no upsells, no premium-content tier. Free trial — no credit card required — so your child can run a full Foxy session and you can see the parent dashboard before paying anything. Cancel anytime, one tap, no questions. Cancellation takes effect at end of current billing month, and your child keeps access until that date. For schools and bulk orders we have separate plans: School/B2B plans cover 30 to 3,000 seats — contact for quote. Visit `/contact` or email `hello@alfanumrik.com` to start.

### HI

परिवारों के लिए Alfanumrik — "₹699 per month — everything included". इसमें Foxy, महारत-नक़्शा, सातों विषय, असीमित quizzes, रविवार का अभिभावक पत्र और द्विभाषी अनुभव सब शामिल हैं। "No franchise fees, no upsells, no premium-content tier". "Free trial — no credit card required" — आपका बच्चा एक पूरा Foxy सत्र चला सकता है और आप अभिभावक dashboard देख सकते हैं, पैसे देने से पहले। "Cancel anytime, one tap, no questions". "Cancellation takes effect at end of current billing month" — रद्द करने पर भी उस तारीख़ तक access बना रहता है। स्कूल और bulk orders के लिए अलग योजना है — "School/B2B plans: 30 to 3,000 seats — contact for quote". शुरू करने के लिए `/contact` पर जाएँ या `hello@alfanumrik.com` पर लिखें।

---

## school-b2b

<!-- meta:
audience: school
canonical: false
last_reviewed: 2026-05-19
-->

### EN

For schools we sell bulk seats from 30 up to 3,000 per institution. The B2B package includes NEP-aligned reporting, a principal-level dashboard with section-by-section diagnostics, bilingual support for both teachers and students, and a white-label option for select partners. Typical onboarding is two to four weeks — that covers seat provisioning, teacher training, and integration with your existing schedule. Pricing depends on seat count and term length, so we quote per school. To get a quote or schedule a demo, visit `/for-schools` or email `hello@alfanumrik.com`. Our school operations team responds within one business day in IST hours.

### HI

स्कूलों के लिए हम 30 से 3,000 तक के bulk seats बेचते हैं। B2B पैकेज में NEP-संरेखित reporting, principal-स्तर का dashboard, section-दर-section diagnostics, शिक्षकों और छात्रों दोनों के लिए द्विभाषी सहायता, और चुनिंदा साझेदारों के लिए white-label विकल्प शामिल है। सामान्य onboarding दो से चार सप्ताह का होता है — इसमें seat provisioning, शिक्षक प्रशिक्षण, और आपके मौजूदा schedule के साथ integration आता है। मूल्य seat संख्या और अवधि पर निर्भर करता है, इसलिए हम हर स्कूल को अलग quote देते हैं। Demo या quote के लिए `/for-schools` पर जाएँ या `hello@alfanumrik.com` पर लिखें। हमारी school operations टीम IST कार्यदिवसों में एक दिन के भीतर जवाब देती है।

---

## teacher-tools

<!-- meta:
audience: teacher
canonical: false
last_reviewed: 2026-05-19
-->

### EN

The teacher portal gives you a section-level dashboard with Bloom's-level diagnostics — you can see exactly which students are stuck at recall, which are stuck at application, and where the misconceptions cluster. A worksheet generator produces NCERT-aligned practice sheets in minutes, with adjustable difficulty and bilingual output. The interface itself is bilingual, so you teach in the medium your school uses. Teachers get the platform free when their school subscribes to a B2B plan; individual teachers can also start a personal trial without involving the school. For details visit `/for-teachers`.

### HI

शिक्षक portal आपको section-स्तर का dashboard देता है — Bloom's-स्तर के diagnostics के साथ। आप ठीक-ठीक देख सकते हैं कि कौन से छात्र recall पर अटके हैं, कौन application पर, और misconceptions कहाँ इकट्ठा हो रही हैं। एक worksheet generator कुछ मिनटों में NCERT-संरेखित अभ्यास-पत्र बनाता है, समायोज्य कठिनाई और द्विभाषी output के साथ। Interface द्विभाषी है, इसलिए आप उसी माध्यम में पढ़ाएँ जो आपका स्कूल इस्तेमाल करता है। जब आपका स्कूल B2B योजना लेता है तब शिक्षकों को platform मुफ़्त मिलता है; व्यक्तिगत शिक्षक भी स्कूल के बिना personal trial शुरू कर सकते हैं। विवरण के लिए `/for-teachers` देखें।

---

## parent-dashboard

<!-- meta:
audience: parent
canonical: false
last_reviewed: 2026-05-19
-->

### EN

The parent dashboard is built around one promise — tell parents the truth, no fluff. The Sunday parent letter arrives once a week and lays out what your child actually learnt, what slipped, and where attention is needed next. There is no leaderboard, no public ranking, no decorative streak that makes things look better than they are. The mastery x-ray shows chapter-by-chapter understanding with Bloom's level depth. WhatsApp notifications are optional — turn them on if you want a nudge, off if you don't. Cancellation is entirely in your hands — one tap, no retention calls, no friction.

### HI

अभिभावक dashboard एक वादे पर बना है — सच बताओ, सजावट नहीं। रविवार का अभिभावक पत्र सप्ताह में एक बार आता है और बताता है कि आपके बच्चे ने वास्तव में क्या सीखा, क्या फिसला, और अब किस ओर ध्यान देना है। न कोई leaderboard है, न सार्वजनिक ranking, न कोई सजावटी streak जो स्थिति को सच से बेहतर दिखाए। महारत-नक़्शा हर पाठ की समझ Bloom's-स्तर की गहराई के साथ दिखाता है। WhatsApp notifications वैकल्पिक हैं — चाहें तो चालू रखें, चाहें तो बंद। रद्द करने का अधिकार पूरी तरह आपके हाथ में है — एक tap, कोई retention call नहीं, कोई रुकावट नहीं।

---

## student-experience

<!-- meta:
audience: student
canonical: false
last_reviewed: 2026-05-19
-->

### EN

Foxy talks to you in Hindi or English — whatever you are comfortable in. Sessions are ten minutes of focused work, not two-hour videos. Every answer Foxy gives stays inside your NCERT syllabus, so what you learn here lines up with what your teacher covers at school. You earn XP for effort and correct answers, with a daily cap of 200 XP and one level every 500 XP. There is no public leaderboard putting pressure on you, and the app does not use infinite-scroll tricks to keep you stuck on the screen. Quizzes come in 5, 10, or 20-question lengths — pick what fits the time you have.

### HI

Foxy आपसे हिन्दी या अंग्रेज़ी में बात करता है — जो आपको सहज लगे। सत्र दस मिनट के केंद्रित अभ्यास होते हैं, दो घंटे के videos नहीं। Foxy का हर जवाब आपके NCERT पाठ्यक्रम के अंदर रहता है, इसलिए यहाँ जो सीखते हैं वही स्कूल में पढ़ाया जाता है। मेहनत और सही जवाबों पर XP मिलता है — रोज़ की सीमा 200 XP और हर 500 XP पर एक level। न कोई सार्वजनिक leaderboard है जो दबाव डाले, न कोई infinite-scroll वाली चाल जो आपको screen से चिपकाए रखे। Quizzes तीन लम्बाई में आते हैं — 5, 10, या 20 प्रश्न। आपके पास जितना समय हो, वही चुनें।

---

## safety-privacy-dpdpa

<!-- meta:
audience: all
canonical: true
last_reviewed: 2026-05-19
-->

### EN

Your data stays in India and we treat it like we would treat our own child's records. All data is end-to-end encrypted both in transit and at rest. We are aligned with DPDPA, India's data-protection law. We collect the minimum needed to run the product — grade, subjects, and performance signals. We do not collect location, browsing history outside the app, or run third-party tracking pixels. Student data is never sold — not now, not later, not under any condition. You can request export or deletion at any time. Full policy at `/privacy`.

### HI

आपका data भारत में रहता है और हम उसे ऐसे संभालते हैं जैसे अपने बच्चे का record संभालेंगे। सारा data transit और rest दोनों में end-to-end encrypted है। हम DPDPA — भारत के data-protection कानून — के अनुरूप हैं। हम केवल ज़रूरी जानकारी जुटाते हैं — कक्षा, विषय, और प्रदर्शन के संकेत। हम न location जुटाते हैं, न app के बाहर की browsing history, न ही कोई तीसरे-पक्ष का tracking pixel चलाते हैं। छात्र data कभी नहीं बेचा जाता — न अभी, न बाद में, न किसी शर्त पर। आप कभी भी export या deletion की माँग कर सकते हैं। पूरी policy `/privacy` पर देखें।

---

## technical-devices

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-05-19
-->

### EN

Alfanumrik runs on the web in any modern browser — Chrome, Safari, Edge, Firefox — and is engineered to work on patchy 4G with an offline cache for the current session. An Android app is available on the Play Store with the same login. An iOS app is on our roadmap for later in 2026; we have not committed a release date, so we ask you to use the web version on iPhone and iPad for now. No special hardware is required — the product targets the phones and budget laptops that Indian families actually have.

### HI

Alfanumrik किसी भी आधुनिक browser — Chrome, Safari, Edge, Firefox — पर वेब पर चलता है, और कमज़ोर 4G पर काम करने के लिए बनाया गया है, साथ ही चालू सत्र के लिए offline cache भी है। उसी login से Android app Play Store पर मौजूद है। iOS app 2026 की बाक़ी अवधि के लिए हमारे roadmap पर है — हमने कोई release तारीख़ तय नहीं की है, इसलिए iPhone और iPad पर अभी वेब-संस्करण ही उपयोग करें। कोई विशेष hardware नहीं चाहिए — उत्पाद उन फ़ोनों और सस्ते laptops के लिए बना है जो भारतीय परिवारों के पास वास्तव में हैं।

---

## signup-flow

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-05-19
-->

### EN

Signing up takes about sixty seconds. Start free — no credit card needed. Pick your role: student, teacher, or parent. Pick the grade you study in and the board — CBSE is supported today; other boards are on our roadmap and we are not making release commitments yet. Verify your email in one tap from the link we send. You land directly on the dashboard and can start a Foxy session in the next click. If anything breaks during signup, the bootstrap fallback creates your profile server-side so you never get stranded between steps.

### HI

Sign up में लगभग साठ सेकंड लगते हैं। मुफ़्त शुरू करें — credit card नहीं चाहिए। अपनी भूमिका चुनें — student, teacher, या parent। अपनी कक्षा और board चुनें — CBSE आज मौजूद है, अन्य boards हमारे roadmap पर हैं और हम अभी कोई release प्रतिबद्धता नहीं कर रहे। हम जो link भेजते हैं उसे एक tap से verify करें। आप सीधे dashboard पर पहुँचते हैं और अगले click में Foxy सत्र शुरू कर सकते हैं। अगर sign-up के दौरान कुछ टूटता है तो bootstrap fallback server-side पर आपकी profile बना देता है, इसलिए आप कभी बीच में नहीं अटकते।

---

## contact

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-05-19
-->

### EN

The fastest way to reach us is email — `hello@alfanumrik.com`. You can also use the form at `/contact`. We answer within one business day during IST business hours, Monday through Friday. For schools we run a dedicated WhatsApp support line that you can request once your school plan is provisioned. For payment issues, billing receipts, or refund questions, write to the same address and our finance team picks it up. For press or partnership requests, use the same inbox and we route internally.

### HI

हम तक पहुँचने का सबसे तेज़ रास्ता email है — `hello@alfanumrik.com`। आप `/contact` पर मौजूद form भी इस्तेमाल कर सकते हैं। हम IST कार्यदिवसों में, सोमवार से शुक्रवार, एक दिन के भीतर जवाब देते हैं। स्कूलों के लिए हम एक समर्पित WhatsApp सहायता line चलाते हैं — स्कूल योजना चालू होने के बाद माँग करें। भुगतान-संबंधी समस्या, billing receipt, या refund प्रश्नों के लिए उसी पते पर लिखें — हमारी finance टीम वहीं उत्तर देती है। Press या partnership के अनुरोध भी उसी inbox पर भेजें — हम भीतर सही टीम तक पहुँचा देते हैं।

---

## refusal-policy

<!-- meta:
audience: all
canonical: true
last_reviewed: 2026-05-19
-->

### EN

When AlfaBot hits the edge of its scope, it uses these canned replies — verbatim, no paraphrasing:

- "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first."
- "I don't have that info — would you like to talk to our team? hello@alfanumrik.com"
- "I only answer questions about Alfanumrik — not medical, legal, news, or politics."
- "I never share other students' data."

These cover the four refusal categories: (1) homework or tutoring requests that should be routed to Foxy post-signup, (2) unknown facts that should be routed to humans, (3) out-of-scope topics like medical, legal, news, or politics, and (4) any request for other learners' data.

### HI

जब AlfaBot अपनी सीमा पर पहुँचता है, तो वह इन तय जवाबों का ही उपयोग करता है — हू-ब-हू, बिना बदलाव:

- "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first."
- "I don't have that info — would you like to talk to our team? hello@alfanumrik.com"
- "I only answer questions about Alfanumrik — not medical, legal, news, or politics."
- "I never share other students' data."

ये चार श्रेणियाँ ढकते हैं — (1) homework या tutoring की माँग जो sign-up के बाद Foxy को सौंपी जानी चाहिए, (2) अज्ञात तथ्य जो इंसानी टीम को सौंपे जाने चाहिएँ, (3) दायरे से बाहर के विषय जैसे चिकित्सा, क़ानून, समाचार या राजनीति, और (4) किसी और सीखने वाले के data की कोई भी माँग।
