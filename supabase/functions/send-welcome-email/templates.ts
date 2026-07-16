/**
 * send-welcome-email templates – bilingual (EN + HI) role-specific welcome
 * emails, rendered on the SHARED bilingual primitives in
 * `_shared/bilingual-email.ts` (the send-auth-email v49 template structure:
 * stacked English section → thin divider → Hindi/Devanagari section, one html
 * body + one plain-text mirror, dual-language subject). No parallel templating
 * approach (CEO directive 2026-07-16).
 *
 * P7: all user-facing copy is EN + HI; technical terms (CBSE, ICSE, XP, AI,
 * CSV, PDF, brand/product names like Alfanumrik and Foxy, email addresses,
 * "Parent Link Code") are NOT translated.
 *
 * Pure module: no Deno.env reads, no I/O — `siteUrl` is injected by index.ts
 * (which resolves it from the SITE_URL secret per P15 rule 6). This keeps the
 * templates directly unit-testable under `deno test --allow-read --allow-env`.
 */

import { ctaButton, languageDivider, renderBilingualEmail } from '../_shared/bilingual-email.ts'

export type WelcomeRole = 'student' | 'teacher' | 'parent'

export interface RenderedWelcomeEmail {
  subject: string
  html: string
  text: string
}

// ─── Deliverability headers ──────────────────────────────────────────────────
//
// mailto-only List-Unsubscribe (the address is documented in
// EMAIL_DELIVERABILITY.md). We intentionally do NOT send List-Unsubscribe-Post:
// RFC 8058 one-click requires a real HTTPS POST endpoint, which we do not have —
// advertising one against a mailto-only URI is a fake one-click signal.
export const WELCOME_LIST_UNSUBSCRIBE = '<mailto:unsubscribe@alfanumrik.com>'

/** Per-send custom headers for welcome emails. */
export function welcomeEmailHeaders(role: WelcomeRole): Record<string, string> {
  return {
    'X-Entity-Ref-ID': `welcome-${role}-${Date.now()}`,
    'List-Unsubscribe': WELCOME_LIST_UNSUBSCRIBE,
  }
}

// ─── Local layout pieces (composed from the shared primitives) ───────────────

interface BoxColors {
  bg: string
  accent: string
  title: string
  body: string
}

/** Accent-bordered content box (feature list / tip / guide), one per topic. */
function sectionBox(colors: BoxColors, title: string, bodyHtml: string, lang?: 'hi'): string {
  const langAttr = lang ? ` lang="${lang}"` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td${langAttr} style="padding:16px;background:${colors.bg};border-left:4px solid ${colors.accent};">
              <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${colors.title};">${title}</p>
              ${bodyHtml}
            </td></tr>
          </table>`
}

function bulletList(colors: BoxColors, items: string[]): string {
  return `<ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:${colors.body};line-height:2;">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

function numberedList(colors: BoxColors, items: string[]): string {
  return `<ol style="margin:8px 0 0;padding-left:20px;font-size:13px;color:${colors.body};line-height:2;">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`
}

function boxParagraph(colors: BoxColors, body: string): string {
  return `<p style="margin:4px 0 0;font-size:13px;color:${colors.body};line-height:1.6;">${body}</p>`
}

interface WelcomeSection {
  heading: string
  intro: string
  boxes: string[]
  ctaLabel: string
  note: string
}

/**
 * One language section in the v49 stacked structure: heading → intro →
 * content boxes → CTA (shared ctaButton) → small note.
 */
function languageSection(s: WelcomeSection, ctaUrl: string, lang?: 'hi'): string {
  const langAttr = lang ? ` lang="${lang}"` : ''
  const introLineHeight = lang === 'hi' ? '1.7' : '1.6'
  return `<h2${langAttr} style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">${s.heading}</h2>
          <p${langAttr} style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:${introLineHeight};">${s.intro}</p>
          ${s.boxes.join('\n          ')}
          ${ctaButton(ctaUrl, s.ctaLabel)}
          <p${langAttr} style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">${s.note}</p>`
}

/** Stacked EN → divider → HI welcome body, finalized by the shared renderer. */
function renderBilingualWelcome(
  opts: {
    subject: string
    preheader: string
    siteUrl: string
    ctaUrl: string
    en: WelcomeSection
    hi: WelcomeSection
  },
): RenderedWelcomeEmail {
  const content = `
          ${languageSection(opts.en, opts.ctaUrl)}
          ${languageDivider()}
          <div style="height:28px;font-size:0;line-height:0;">&nbsp;</div>
          ${languageSection(opts.hi, opts.ctaUrl, 'hi')}
    `
  const { html, text } = renderBilingualEmail(content, opts.preheader, opts.siteUrl)
  return { subject: opts.subject, html, text }
}

const SUPPORT_LINK = '<a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a>'

// ─── Student ─────────────────────────────────────────────────────────────────

const STUDENT_FEATURES: BoxColors = { bg: '#F5F3FF', accent: '#6C5CE7', title: '#6C5CE7', body: '#4B5563' }
const STUDENT_TIP: BoxColors = { bg: '#FEF3C7', accent: '#F59E0B', title: '#D97706', body: '#92400E' }

export function studentEmail(siteUrl: string, name: string, grade?: string, board?: string): RenderedWelcomeEmail {
  const firstName = name.split(' ')[0]
  // P5: grades are strings ("6".."12") — interpolated verbatim, never parsed.
  const gradeText = grade ? ` (Grade ${grade}${board ? `, ${board}` : ''})` : ''
  const hiGradeText = grade ? ` (कक्षा ${grade}${board ? `, ${board}` : ''})` : ''
  return renderBilingualWelcome({
    subject: `Welcome to Alfanumrik, ${firstName}! Your learning adventure begins | आपके सीखने का सफ़र यहाँ से शुरू!`,
    preheader: `Welcome to Alfanumrik, ${firstName}! Your AI-powered learning journey starts now. | Alfanumrik में आपका स्वागत है — सीखना अभी शुरू करें।`,
    siteUrl,
    ctaUrl: `${siteUrl}/dashboard`,
    en: {
      heading: `🌟 Welcome aboard, ${firstName}!`,
      intro: `You're now part of Alfanumrik${gradeText}. Let's make learning fun and effective!`,
      boxes: [
        sectionBox(STUDENT_FEATURES, `🎯 What's waiting for you`, bulletList(STUDENT_FEATURES, [
          `<strong>Foxy</strong> — Your personal study buddy that explains concepts in your language`,
          `<strong>Adaptive Quizzes</strong> — Smart questions that match your level and help you grow`,
          `<strong>XP &amp; Streaks</strong> — Earn points, maintain streaks, and climb the leaderboard`,
          `<strong>Spaced Repetition</strong> — Never forget what you learn with scientifically-timed reviews`,
        ])),
        sectionBox(STUDENT_TIP, `💡 Pro Tip for Day 1`, boxParagraph(STUDENT_TIP,
          `Start with a 5-question quiz in your favourite subject. It takes just 3 minutes and helps Alfanumrik understand your level!`)),
      ],
      ctaLabel: 'Start Learning Now',
      note: `Questions? Just ask Foxy inside the app or email ${SUPPORT_LINK}`,
    },
    hi: {
      heading: `🌟 आपका स्वागत है, ${firstName}!`,
      intro: `अब आप Alfanumrik${hiGradeText} का हिस्सा हैं। चलिए, पढ़ाई को मज़ेदार और असरदार बनाते हैं!`,
      boxes: [
        sectionBox(STUDENT_FEATURES, `🎯 आपके लिए क्या-क्या तैयार है`, bulletList(STUDENT_FEATURES, [
          `<strong>Foxy</strong> — आपका पर्सनल स्टडी बडी, जो हर कॉन्सेप्ट आपकी अपनी भाषा में समझाता है`,
          `<strong>एडैप्टिव क्विज़</strong> — स्मार्ट सवाल जो आपके लेवल से मेल खाते हैं और आपको आगे बढ़ने में मदद करते हैं`,
          `<strong>XP और स्ट्रीक्स</strong> — पॉइंट कमाएँ, स्ट्रीक बनाए रखें और लीडरबोर्ड पर ऊपर चढ़ें`,
          `<strong>स्पेस्ड रिपीटीशन</strong> — वैज्ञानिक रूप से तय समय पर रिवीज़न, ताकि सीखा हुआ कभी न भूलें`,
        ]), 'hi'),
        sectionBox(STUDENT_TIP, `💡 पहले दिन की प्रो टिप`, boxParagraph(STUDENT_TIP,
          `अपने पसंदीदा विषय में 5 सवालों की क्विज़ से शुरुआत करें। सिर्फ़ 3 मिनट लगेंगे और Alfanumrik को आपका लेवल समझने में मदद मिलेगी!`), 'hi'),
      ],
      ctaLabel: 'अभी सीखना शुरू करें',
      note: `कोई सवाल? ऐप में Foxy से पूछें या ${SUPPORT_LINK} पर ईमेल करें`,
    },
  })
}

// ─── Teacher ─────────────────────────────────────────────────────────────────

const TEACHER_FEATURES: BoxColors = { bg: '#EFF6FF', accent: '#3B82F6', title: '#2563EB', body: '#4B5563' }
const TEACHER_SETUP: BoxColors = { bg: '#ECFDF5', accent: '#10B981', title: '#059669', body: '#065F46' }

export function teacherEmail(siteUrl: string, name: string, schoolName?: string): RenderedWelcomeEmail {
  const firstName = name.split(' ')[0]
  const schoolText = schoolName ? ` at ${schoolName}` : ''
  const hiSchoolText = schoolName ? ` (${schoolName})` : ''
  return renderBilingualWelcome({
    subject: `Welcome to Alfanumrik, ${firstName}! Your classroom just got smarter | आपकी क्लासरूम अब और स्मार्ट!`,
    preheader: `Welcome to Alfanumrik, ${firstName}! Your AI-powered classroom tools are ready. | आपके स्मार्ट क्लासरूम टूल्स तैयार हैं।`,
    siteUrl,
    ctaUrl: `${siteUrl}/dashboard`,
    en: {
      heading: `🎨 Welcome, ${firstName}!`,
      intro: `Thank you for joining Alfanumrik${schoolText}. You now have access to India's most adaptive classroom tools.`,
      boxes: [
        sectionBox(TEACHER_FEATURES, `📚 Your Teaching Superpowers`, bulletList(TEACHER_FEATURES, [
          `<strong>Create Classes</strong> — Set up classrooms and invite students with a code`,
          `<strong>Assign Smart Quizzes</strong> — AI-generated questions aligned to CBSE/ICSE syllabus`,
          `<strong>Live Performance Dashboard</strong> — See exactly where each student excels or struggles`,
          `<strong>Export Reports</strong> — Download class performance reports as CSV or PDF`,
          `<strong>Concept Mastery Tracker</strong> — Topic-by-topic mastery view across your class`,
        ])),
        sectionBox(TEACHER_SETUP, `🚀 Quick Setup (3 Steps)`, numberedList(TEACHER_SETUP, [
          `Go to <strong>Dashboard → Classes</strong> and create your first class`,
          `Share the <strong>class invite code</strong> with your students`,
          `Assign a quiz and watch real-time results roll in!`,
        ])),
      ],
      ctaLabel: 'Open Your Dashboard',
      note: `Need help onboarding your school? Write to ${SUPPORT_LINK}`,
    },
    hi: {
      heading: `🎨 स्वागत है, ${firstName}!`,
      intro: `Alfanumrik से जुड़ने के लिए धन्यवाद${hiSchoolText}। अब आपके पास भारत के सबसे एडैप्टिव क्लासरूम टूल्स हैं।`,
      boxes: [
        sectionBox(TEACHER_FEATURES, `📚 आपकी टीचिंग सुपरपावर्स`, bulletList(TEACHER_FEATURES, [
          `<strong>क्लास बनाएँ</strong> — क्लासरूम सेट करें और स्टूडेंट्स को कोड से इनवाइट करें`,
          `<strong>स्मार्ट क्विज़ असाइन करें</strong> — CBSE/ICSE सिलेबस से जुड़े AI-जनरेटेड सवाल`,
          `<strong>लाइव परफ़ॉर्मेंस डैशबोर्ड</strong> — देखें कि हर स्टूडेंट कहाँ आगे है और कहाँ मदद चाहिए`,
          `<strong>रिपोर्ट एक्सपोर्ट करें</strong> — क्लास की परफ़ॉर्मेंस रिपोर्ट CSV या PDF में डाउनलोड करें`,
          `<strong>कॉन्सेप्ट मास्टरी ट्रैकर</strong> — पूरी क्लास की टॉपिक-दर-टॉपिक मास्टरी एक नज़र में`,
        ]), 'hi'),
        sectionBox(TEACHER_SETUP, `🚀 क्विक सेटअप (3 स्टेप)`, numberedList(TEACHER_SETUP, [
          `<strong>डैशबोर्ड → क्लासेज़</strong> में जाकर अपनी पहली क्लास बनाएँ`,
          `<strong>क्लास इनवाइट कोड</strong> अपने स्टूडेंट्स के साथ शेयर करें`,
          `एक क्विज़ असाइन करें और रियल-टाइम रिज़ल्ट आते देखें!`,
        ]), 'hi'),
      ],
      ctaLabel: 'अपना डैशबोर्ड खोलें',
      note: `स्कूल ऑनबोर्डिंग में मदद चाहिए? ${SUPPORT_LINK} पर लिखें`,
    },
  })
}

// ─── Parent ──────────────────────────────────────────────────────────────────

const PARENT_TRACK: BoxColors = { bg: '#FFF7ED', accent: '#F97316', title: '#EA580C', body: '#9A3412' }
const PARENT_LINK: BoxColors = { bg: '#FDF2F8', accent: '#EC4899', title: '#DB2777', body: '#9D174D' }

export function parentEmail(siteUrl: string, name: string): RenderedWelcomeEmail {
  const firstName = name.split(' ')[0]
  return renderBilingualWelcome({
    subject: `Welcome to Alfanumrik, ${firstName}! Stay connected to your child's learning | अपने बच्चे की पढ़ाई से जुड़े रहें`,
    preheader: `Welcome to Alfanumrik, ${firstName}! Your parent portal is ready. | आपका पेरेंट पोर्टल तैयार है।`,
    siteUrl,
    ctaUrl: `${siteUrl}/parent`,
    en: {
      heading: `👨‍👩‍👧 Welcome, ${firstName}!`,
      intro: `Thank you for joining Alfanumrik. You'll now receive insights on your child's learning progress.`,
      boxes: [
        sectionBox(PARENT_TRACK, `📊 What You Can Track`, bulletList(PARENT_TRACK, [
          `<strong>Daily Digest</strong> — Receive a daily summary of quizzes taken, topics studied, and XP earned`,
          `<strong>Subject Mastery</strong> — See your child's progress in each subject, topic by topic`,
          `<strong>Study Streaks</strong> — Know if your child is maintaining consistent study habits`,
          `<strong>Weekly Reports</strong> — Detailed weekly performance summaries delivered to your inbox`,
          `<strong>Teacher Updates</strong> — View assignments and class performance from teachers`,
        ])),
        sectionBox(PARENT_LINK, `🔗 Link Your Child's Account`, boxParagraph(PARENT_LINK,
          `If you haven't linked your child's account yet, ask them to share their <strong>Parent Link Code</strong> from their profile page. Enter it in <strong>Dashboard → Link Child</strong> to start tracking their progress.`)),
      ],
      ctaLabel: 'Open Parent Portal',
      note: `Questions? Email us at ${SUPPORT_LINK}`,
    },
    hi: {
      heading: `👨‍👩‍👧 स्वागत है, ${firstName}!`,
      intro: `Alfanumrik से जुड़ने के लिए धन्यवाद। अब आपको अपने बच्चे की पढ़ाई की प्रगति की जानकारी मिलती रहेगी।`,
      boxes: [
        sectionBox(PARENT_TRACK, `📊 आप क्या-क्या ट्रैक कर सकते हैं`, bulletList(PARENT_TRACK, [
          `<strong>डेली डाइजेस्ट</strong> — हर दिन की क्विज़, पढ़े गए टॉपिक और कमाए गए XP का सारांश`,
          `<strong>विषय मास्टरी</strong> — हर विषय में बच्चे की टॉपिक-दर-टॉपिक प्रगति देखें`,
          `<strong>स्टडी स्ट्रीक्स</strong> — जानें कि बच्चे की पढ़ाई की आदत नियमित बनी हुई है या नहीं`,
          `<strong>साप्ताहिक रिपोर्ट</strong> — विस्तृत वीकली परफ़ॉर्मेंस रिपोर्ट सीधे आपके इनबॉक्स में`,
          `<strong>टीचर अपडेट्स</strong> — टीचर्स के असाइनमेंट और क्लास परफ़ॉर्मेंस देखें`,
        ]), 'hi'),
        sectionBox(PARENT_LINK, `🔗 अपने बच्चे का खाता लिंक करें`, boxParagraph(PARENT_LINK,
          `अगर आपने अभी तक अपने बच्चे का खाता लिंक नहीं किया है, तो उनसे उनकी प्रोफ़ाइल पेज से <strong>Parent Link Code</strong> शेयर करने को कहें। इसे <strong>डैशबोर्ड → Link Child</strong> में डालें और उनकी प्रगति ट्रैक करना शुरू करें।`), 'hi'),
      ],
      ctaLabel: 'पेरेंट पोर्टल खोलें',
      note: `कोई सवाल? हमें ${SUPPORT_LINK} पर ईमेल करें`,
    },
  })
}
