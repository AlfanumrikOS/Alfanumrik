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
last_reviewed: 2026-07-17
-->

### EN

Alfanumrik for families comes in three transparent tiers. Pro, at ₹699 per month, is our most popular family plan — Foxy with 100 chats a day, unlimited quizzes, all seven subjects, STEM Lab, advanced analytics, the Sunday parent letter, and the full bilingual experience. Starter, at ₹299 per month, covers 4 subjects with 30 Foxy chats and 20 quizzes a day, plus STEM Lab. Unlimited, at ₹1,099 per month, removes every limit — unlimited Foxy chats and quizzes, all subjects, and priority support. Every plan starts free on the Explorer tier (5 Foxy chats and 5 quizzes a day, 2 subjects) — no credit card required — so your child can run a real Foxy session and you can see the parent dashboard before paying anything. No franchise fees, no ads. Cancel anytime, one tap, no questions. Cancellation takes effect at end of current billing month, and your child keeps access until that date. For schools and bulk orders we have separate plans: School/B2B plans cover 30 to 3,000 seats — contact for quote. Visit `/contact` or email `hello@alfanumrik.com` to start.

### HI

परिवारों के लिए Alfanumrik तीन पारदर्शी tiers में आता है। सबसे लोकप्रिय पारिवारिक योजना Pro है — "₹699 per month" — जिसमें Foxy (रोज़ 100 chats), असीमित quizzes, सातों विषय, STEM Lab, advanced analytics, रविवार का अभिभावक पत्र और पूरा द्विभाषी अनुभव शामिल हैं। Starter — "₹299 per month" — में 4 विषय, रोज़ 30 Foxy chats और 20 quizzes, साथ में STEM Lab। Unlimited — "₹1,099 per month" — में कोई सीमा नहीं: असीमित Foxy chats और quizzes, सभी विषय, priority support। हर योजना की शुरुआत मुफ़्त Explorer से होती है (रोज़ 5 Foxy chats, 5 quizzes, 2 विषय) — "no credit card required" — आपका बच्चा एक Foxy सत्र चला सकता है और आप अभिभावक dashboard देख सकते हैं, पैसे देने से पहले। कोई franchise fees नहीं, कोई विज्ञापन नहीं। "Cancel anytime, one tap, no questions". "Cancellation takes effect at end of current billing month" — रद्द करने पर भी उस तारीख़ तक access बना रहता है। स्कूल और bulk orders के लिए अलग योजना है — "School/B2B plans: 30 to 3,000 seats — contact for quote". शुरू करने के लिए `/contact` पर जाएँ या `hello@alfanumrik.com` पर लिखें।

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
last_reviewed: 2026-07-17
-->

### EN

The parent dashboard is built around one promise — tell parents the truth, no fluff. The Sunday parent letter arrives once a week and lays out what your child actually learnt, what slipped, and where attention is needed next. Rankings and competitions exist only in an optional corner your child chooses to open — they are never pushed into daily practice — and there is no decorative streak that makes things look better than they are. The mastery x-ray shows chapter-by-chapter understanding with Bloom's level depth. WhatsApp notifications are optional — turn them on if you want a nudge, off if you don't. Cancellation is entirely in your hands — one tap, no retention calls, no friction.

### HI

अभिभावक dashboard एक वादे पर बना है — सच बताओ, सजावट नहीं। रविवार का अभिभावक पत्र सप्ताह में एक बार आता है और बताता है कि आपके बच्चे ने वास्तव में क्या सीखा, क्या फिसला, और अब किस ओर ध्यान देना है। Ranking और competition सिर्फ़ एक वैकल्पिक कोने में हैं जिसे बच्चा ख़ुद चुनकर खोलता है — वे रोज़ के अभ्यास में कभी धकेले नहीं जाते — और न कोई सजावटी streak है जो स्थिति को सच से बेहतर दिखाए। महारत-नक़्शा हर पाठ की समझ Bloom's-स्तर की गहराई के साथ दिखाता है। WhatsApp notifications वैकल्पिक हैं — चाहें तो चालू रखें, चाहें तो बंद। रद्द करने का अधिकार पूरी तरह आपके हाथ में है — एक tap, कोई retention call नहीं, कोई रुकावट नहीं।

---

## student-experience

<!-- meta:
audience: student
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Foxy talks to you in Hindi or English — whatever you are comfortable in. Sessions are ten minutes of focused work, not two-hour videos. Every answer Foxy gives stays inside your NCERT syllabus, so what you learn here lines up with what your teacher covers at school. You earn XP for effort and correct answers, with a daily cap of 200 XP and one level every 500 XP. The leaderboard and competitions are opt-in — they sit in an optional corner you have to choose to open, and they never appear during your practice — and the app does not use infinite-scroll tricks to keep you stuck on the screen. Quizzes come in 5, 10, or 20-question lengths — pick what fits the time you have.

### HI

Foxy आपसे हिन्दी या अंग्रेज़ी में बात करता है — जो आपको सहज लगे। सत्र दस मिनट के केंद्रित अभ्यास होते हैं, दो घंटे के videos नहीं। Foxy का हर जवाब आपके NCERT पाठ्यक्रम के अंदर रहता है, इसलिए यहाँ जो सीखते हैं वही स्कूल में पढ़ाया जाता है। मेहनत और सही जवाबों पर XP मिलता है — रोज़ की सीमा 200 XP और हर 500 XP पर एक level। Leaderboard और competition वैकल्पिक हैं — वे एक अलग कोने में हैं जिसे आप ख़ुद चुनकर खोलते हैं, और अभ्यास के दौरान कभी सामने नहीं आते — और न कोई infinite-scroll वाली चाल है जो आपको screen से चिपकाए रखे। Quizzes तीन लम्बाई में आते हैं — 5, 10, या 20 प्रश्न। आपके पास जितना समय हो, वही चुनें।

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

---

## parent-value

<!-- meta:
audience: parent
canonical: false
last_reviewed: 2026-07-17
-->

### EN

For ₹699 per month, Pro — our most popular family plan — gives your child what a single-subject tuition class usually cannot cover: all seven subjects, unlimited adaptive quizzes, Foxy the bilingual AI tutor, and daily mastery tracking. Our pricing page puts it plainly: less than a single tuition class a month. The value shows up in the mechanism, not in promises — the mastery x-ray tracks what your child actually understands, chapter by chapter, and the Sunday parent letter proves it to you every week: what was learnt, what slipped. The product is ad-free, with no franchise fees and a transparent tier ladder — Starter at ₹299 per month if you want to begin lighter, Unlimited at ₹1,099 per month if your child wants no limits. You can verify all of this before paying anything — the free Explorer start needs no credit card.

### HI

"₹699 per month" वाली Pro — सबसे लोकप्रिय पारिवारिक योजना — में आपके बच्चे को वह मिलता है जो एक विषय की tuition class अक्सर नहीं दे पाती — सातों विषय, असीमित अनुकूली quizzes, द्विभाषी AI tutor Foxy, और रोज़ाना की महारत-निगरानी। हमारा pricing पन्ना साफ़ कहता है — महीने की एक tuition class से भी कम। मूल्य वादों में नहीं, तरीक़े में दिखता है — महारत-नक़्शा पाठ-दर-पाठ बताता है कि बच्चे ने वास्तव में क्या समझा, और रविवार का अभिभावक पत्र हर हफ़्ते उसका प्रमाण देता है — क्या सीखा, क्या फिसला। उत्पाद विज्ञापन-मुक्त है, कोई franchise fees नहीं, और tiers पारदर्शी हैं — हल्की शुरुआत के लिए Starter "₹299 per month", और बिना किसी सीमा के लिए Unlimited "₹1,099 per month"। पैसे देने से पहले सब परख सकते हैं — मुफ़्त Explorer शुरुआत में credit card नहीं लगता।

---

## screen-time-wellbeing

<!-- meta:
audience: parent
canonical: false
last_reviewed: 2026-07-17
-->

### EN

We design for less screen time, not more. Sessions are ten minutes of focused work by design — not two-hour lectures. There is no infinite scroll and there are no ads anywhere in the product; rankings and competitions live in an optional corner your child has to choose to open — they are never pushed into the daily practice flow. Even XP, the effort reward, has a daily cap of 200 — so there is no incentive to grind endlessly. The product is built so that ten focused minutes a day is enough: practise, see what slipped, stop. The Sunday letter tells you how much real learning happened each week, so you can judge by mastery, not by minutes on a screen.

### HI

हम कम screen time के लिए design करते हैं, ज़्यादा के लिए नहीं। सत्र जान-बूझकर दस मिनट के केंद्रित अभ्यास हैं — दो घंटे के lecture नहीं। न कोई infinite scroll है, न उत्पाद में कहीं कोई विज्ञापन; ranking और competition एक वैकल्पिक कोने में हैं जिसे बच्चा ख़ुद चुनकर खोलता है — वे रोज़ के अभ्यास के रास्ते में कभी नहीं आते। XP — मेहनत का इनाम — की भी रोज़ की सीमा 200 है, इसलिए अंतहीन घिसाई का कोई प्रलोभन नहीं। उत्पाद ऐसा बना है कि रोज़ दस केंद्रित मिनट काफ़ी हैं — अभ्यास करो, देखो क्या फिसला, रुक जाओ। रविवार का पत्र बताता है कि हफ़्ते में कितनी असली पढ़ाई हुई — ताकि आप screen के मिनटों से नहीं, महारत से आँकें।

---

## alfanumrik-with-tuition

<!-- meta:
audience: parent
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Alfanumrik is not positioned against your child's tuition — it is the revision and mastery layer that sits underneath whatever else your child is doing. Tuition gives explanation hours; Alfanumrik adds what most tuition cannot: daily adaptive practice on exactly the topics that slipped that week, and weekly proof in the Sunday parent letter. Ten minutes after dinner is enough. Many families keep both. Some parents later decide their child needs less tuition because chapters were understood the first time — that is entirely your call to make, with the mastery x-ray as your evidence. We never ask you to drop anything. Start free, read one Sunday letter, and decide with data.

### HI

Alfanumrik आपके बच्चे की tuition के ख़िलाफ़ नहीं खड़ा है — यह revision और महारत की वह परत है जो बच्चे की बाक़ी पढ़ाई के नीचे बैठती है। Tuition समझाने के घंटे देती है; Alfanumrik वह जोड़ता है जो अधिकतर tuition नहीं दे पाती — ठीक उन्हीं topics पर रोज़ का अनुकूली अभ्यास जो उस हफ़्ते फिसले, और रविवार के पत्र में साप्ताहिक प्रमाण। खाने के बाद दस मिनट काफ़ी हैं। कई परिवार दोनों रखते हैं। कुछ अभिभावक बाद में तय करते हैं कि बच्चे को कम tuition चाहिए क्योंकि पाठ पहली बार में ही समझ आ गए — यह फ़ैसला पूरी तरह आपका है, और महारत-नक़्शा आपका प्रमाण है। हम कभी नहीं कहते कि कुछ छोड़िए। मुफ़्त शुरू करें, एक रविवार-पत्र पढ़ें, और आँकड़ों से तय करें।

---

## ai-safety-for-parents

<!-- meta:
audience: parent
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Foxy, the AI tutor, is grounded in NCERT content and never invents facts outside your child's syllabus. Answers stay bounded to the CBSE curriculum for your child's grade, in English or Hindi, and are written to be age-appropriate for grades 6 to 12. Foxy is a tutor, not an open chatbot — it does not discuss news, politics, or anything outside academics. On data: we are DPDPA-aligned, data stays in India, we collect only the minimum (grade, subjects, performance signals), and student data is never sold. There is always a human path too — write to hello@alfanumrik.com and a person answers within one business day. If you want to see it before trusting it, the free Explorer plan lets you watch a Foxy session yourself — no credit card needed.

### HI

AI tutor Foxy NCERT सामग्री पर आधारित है और आपके बच्चे के पाठ्यक्रम के बाहर कभी तथ्य नहीं गढ़ता। जवाब बच्चे की कक्षा के CBSE पाठ्यक्रम की सीमा में रहते हैं — अंग्रेज़ी या हिन्दी में — और कक्षा 6 से 12 की उम्र के अनुरूप लिखे जाते हैं। Foxy एक tutor है, खुला chatbot नहीं — वह समाचार, राजनीति या पढ़ाई से बाहर की कोई बात नहीं करता। Data के मामले में — हम DPDPA-अनुरूप हैं, data भारत में रहता है, हम केवल न्यूनतम जानकारी (कक्षा, विषय, प्रदर्शन-संकेत) जुटाते हैं, और छात्र data कभी नहीं बेचा जाता। इंसानी रास्ता हमेशा खुला है — hello@alfanumrik.com पर लिखें, एक व्यक्ति एक कार्यदिवस में जवाब देता है। भरोसा करने से पहले देखना चाहें, तो मुफ़्त Explorer plan में आप ख़ुद एक Foxy सत्र देख सकते हैं — credit card की ज़रूरत नहीं।

---

## outcomes-how-we-measure

<!-- meta:
audience: parent, teacher
canonical: false
last_reviewed: 2026-07-17
-->

### EN

We do not publish invented success statistics, unverifiable testimonials, or rank promises. Our outcome story is: measured, not promised. What you can actually inspect: mastery percentage per chapter — what your child genuinely got right and at what depth; Bloom's levels — whether they can only recall, or also apply and analyse; and the Sunday parent letter, which reports what moved and what slipped every week in numbers, not reassurances. Teachers see the same signals at section level in their dashboard. If a claim about your child cannot be traced to their own practice data, we do not make it. Judge us on your child's own dashboard after a couple of weeks — the free Explorer plan exists so you can.

### HI

हम गढ़े हुए success आँकड़े, अपुष्ट testimonials या rank के वादे प्रकाशित नहीं करते। हमारी परिणाम-कहानी है — नापा हुआ, वादा नहीं। आप वास्तव में क्या देख सकते हैं: हर पाठ की महारत प्रतिशत — बच्चे ने सचमुच क्या और कितनी गहराई से सही किया; Bloom's स्तर — केवल रटना आता है, या apply और analyse भी; और रविवार का अभिभावक पत्र, जो हर हफ़्ते संख्याओं में बताता है कि क्या आगे बढ़ा और क्या फिसला — दिलासों में नहीं। शिक्षक अपने dashboard में यही संकेत section-स्तर पर देखते हैं। जो दावा बच्चे के अपने अभ्यास-data से साबित न हो, वह दावा हम करते ही नहीं। कुछ हफ़्तों बाद बच्चे के अपने dashboard पर हमें परखिए — मुफ़्त Explorer plan इसीलिए है।

---

## competition-prep

<!-- meta:
audience: student, parent
canonical: false
last_reviewed: 2026-07-17
-->

### EN

The path we build is: NCERT foundation first, board mastery second, competition awareness on top. For grades 11 and 12, practice questions can display JEE Main, JEE Advanced, and NEET tags, so you can see how board-level questions map to competitive-exam patterns — the toggle sits right on the quiz screen. Students who set a competitive-exam or Olympiad goal get practice weighted toward higher-order Bloom's levels — apply, analyse, evaluate — including some ahead-of-grade material. Honest boundary: Alfanumrik is a mastery platform, not a full competitive-exam coaching program. What we deliver is the strong NCERT and board foundation that every JEE/NEET aspirant needs underneath everything else.

### HI

हमारा रास्ता है — पहले NCERT की नींव, फिर board की महारत, और ऊपर competition की समझ। कक्षा 11 और 12 में अभ्यास-प्रश्नों पर JEE Main, JEE Advanced और NEET के tag दिख सकते हैं, ताकि दिखे कि board-स्तर के प्रश्न competitive परीक्षा के पैटर्न से कैसे जुड़ते हैं — यह toggle quiz screen पर ही है। जो छात्र competitive-exam या Olympiad का लक्ष्य चुनते हैं, उन्हें ऊँचे Bloom's स्तरों — apply, analyse, evaluate — की ओर झुका अभ्यास मिलता है, जिसमें कुछ ahead-of-grade सामग्री भी शामिल है। ईमानदार सीमा: Alfanumrik एक महारत-मंच है, पूरा competitive-exam coaching कार्यक्रम नहीं। हम वह मज़बूत NCERT और board नींव देते हैं जो हर JEE/NEET aspirant को बाक़ी सबके नीचे चाहिए।

---

## teacher-time-savings

<!-- meta:
audience: teacher
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Two places we give teachers time back. First, the worksheet generator: NCERT-aligned worksheets in about 90 seconds — pick topics, difficulty, and question types, with bilingual output. Second, the section dashboard: Bloom's-level diagnostics show which students are stuck at recall, which at application, and where misconceptions cluster — so on Monday morning you are already briefed, without marking a diagnostic test yourself. Parent-facing reporting is automated too, so "how is my child doing" conversations start from shared data instead of memory. Teachers get the platform free when their school subscribes to a B2B plan, and you can start a personal trial without involving the school.

### HI

दो जगह हम शिक्षकों का समय लौटाते हैं। पहली — worksheet generator: क़रीब 90 सेकंड में NCERT-संरेखित worksheet — topics, कठिनाई और प्रश्न-प्रकार चुनिए, output द्विभाषी मिलता है। दूसरी — section dashboard: Bloom's-स्तर के diagnostics दिखाते हैं कि कौन छात्र recall पर अटका है, कौन application पर, और misconceptions कहाँ इकट्ठा हैं — यानी सोमवार सुबह आप पहले से तैयार हैं, बिना ख़ुद कोई diagnostic test जाँचे। अभिभावकों की reporting भी अपने-आप बनती है, इसलिए "मेरा बच्चा कैसा कर रहा है" की बातचीत याददाश्त से नहीं, साझा data से शुरू होती है। स्कूल के B2B plan लेने पर शिक्षकों को platform मुफ़्त मिलता है, और स्कूल के बिना personal trial भी शुरू कर सकते हैं।

---

## choosing-a-platform

<!-- meta:
audience: all
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Whichever learning platform you evaluate — including us — ask five questions. (1) Is it grounded in your child's actual syllabus, or generic content? Alfanumrik is NCERT-grounded and CBSE-aligned per grade. (2) Does it measure mastery, or just minutes watched? We track chapter-level mastery with Bloom's depth. (3) Does it work in your family's language? We are bilingual — English and Hindi. (4) How is the child's data treated? We are DPDPA-aligned; data stays in India and is never sold. (5) Is the pricing honest? Ours is a transparent tier ladder — Pro at ₹699 per month is the most popular family plan, with Starter at ₹299 per month and Unlimited at ₹1,099 per month alongside — plus a free Explorer start and one-tap cancellation. We do not name or judge other platforms — apply the same five questions to anything you consider, and decide what fits your child.

### HI

आप जो भी learning platform परखें — हमें भी — पाँच सवाल पूछिए। (1) क्या वह बच्चे के असली पाठ्यक्रम पर आधारित है, या generic सामग्री पर? Alfanumrik NCERT-आधारित और कक्षा-अनुसार CBSE-संरेखित है। (2) क्या वह महारत नापता है, या सिर्फ़ देखे गए मिनट? हम पाठ-स्तर की महारत Bloom's गहराई के साथ नापते हैं। (3) क्या वह आपके परिवार की भाषा में चलता है? हम द्विभाषी हैं — अंग्रेज़ी और हिन्दी। (4) बच्चे के data के साथ क्या होता है? हम DPDPA-अनुरूप हैं; data भारत में रहता है और कभी बेचा नहीं जाता। (5) क्या क़ीमत ईमानदार है? हमारे tiers पारदर्शी हैं — सबसे लोकप्रिय पारिवारिक योजना Pro "₹699 per month", साथ में Starter "₹299 per month" और Unlimited "₹1,099 per month" — मुफ़्त Explorer शुरुआत और एक-tap रद्दीकरण के साथ। हम किसी और platform का नाम या मूल्यांकन नहीं करते — यही पाँच सवाल हर विकल्प से पूछिए, और वही चुनिए जो आपके बच्चे पर सही बैठे।

---

## refunds-cancellation

<!-- meta:
audience: parent, school
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Cancellation: cancel anytime from your account settings or by emailing billing@alfanumrik.com. It takes effect at the end of the current billing month, you keep full access until then, and there are no retention calls. Refunds on monthly plans: within the first 7 days of the first paid month, 100% refund on request, no questions; beyond 7 days, the subscription runs to the end of the month and there is no partial refund. Annual plans: a prorated refund within the first 30 days, adjusted for any usage above the equivalent monthly rate; after that, a refund applies only if the platform is unavailable for more than 7 consecutive days. Refunds go back to the original payment method within 7 working days — email billing@alfanumrik.com with your account email and Razorpay payment ID. Full policy at /refunds.

### HI

रद्दीकरण: कभी भी account settings से या billing@alfanumrik.com पर email करके रद्द करें। यह चालू billing माह के अंत में लागू होता है, तब तक पूरा access बना रहता है, और कोई retention call नहीं आती। Monthly plans पर refund: पहले paid माह के शुरुआती 7 दिनों में माँगने पर 100% refund, बिना सवाल; 7 दिनों के बाद subscription माह के अंत तक चलता है और आंशिक refund नहीं है। Annual plans: पहले 30 दिनों में आनुपातिक (prorated) refund — मासिक दर से अधिक उपयोग को समायोजित करके; उसके बाद refund केवल तभी जब platform लगातार 7 दिनों से अधिक अनुपलब्ध रहे। Refund मूल भुगतान-माध्यम में 7 कार्यदिवसों में लौटता है — billing@alfanumrik.com पर अपना account email और Razorpay payment ID भेजें। पूरी policy /refunds पर।

---

## getting-started-first-week

<!-- meta:
audience: parent, student
canonical: false
last_reviewed: 2026-07-17
-->

### EN

Day one takes about sixty seconds: start free — no credit card — pick your role and grade (CBSE), verify your email in one tap, and you land on the dashboard ready for a first Foxy session. Days two to six are the habit: roughly ten focused minutes daily — an adaptive quiz or a Foxy session on the chapter being studied at school, with practice automatically targeting whatever slipped. XP rewards the effort along the way, with a daily cap so there is no grinding. Then the first Sunday: the parent letter arrives with the first honest picture — what was practised, what was mastered, what needs attention next. That first letter is the moment to judge us. Questions along the way? hello@alfanumrik.com.

### HI

पहला दिन — लगभग साठ सेकंड: मुफ़्त शुरू करें — credit card नहीं — भूमिका और कक्षा (CBSE) चुनें, एक tap में email verify करें, और आप dashboard पर पहले Foxy सत्र के लिए तैयार हैं। दूसरे से छठे दिन — आदत: रोज़ क़रीब दस केंद्रित मिनट — स्कूल में चल रहे पाठ पर एक अनुकूली quiz या Foxy सत्र, और अभ्यास अपने-आप उसी पर निशाना साधता है जो फिसला। रास्ते में मेहनत पर XP मिलता है — रोज़ की सीमा के साथ, ताकि घिसाई न हो। फिर पहला रविवार: अभिभावक पत्र पहली ईमानदार तस्वीर लेकर आता है — क्या अभ्यास हुआ, क्या पक्का हुआ, आगे किस पर ध्यान चाहिए। हमें परखने की घड़ी वही पहला पत्र है। बीच में कोई सवाल? hello@alfanumrik.com।

---

<!-- KEEP this trailing "---": scripts/embed-alfabot-kb.mjs terminates the
LAST section's HI body on `^---` (its `\Z` fallback is not a real JS regex
end-anchor), so without this rule the final section's Hindi chunk is silently
skipped from embedding. Pinned by alfabot-kb-structure.test.ts. -->

