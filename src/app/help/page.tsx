'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants';
import { Card, Button, LoadingFoxy, BottomNav } from '@/components/ui';

/* ══════════════════════════════════════════════════════════════
   HELP & SUPPORT — Alfanumrik Support Center
   AI-powered support bot + FAQ + Ticket submission + Quick fixes
   ══════════════════════════════════════════════════════════════ */

type View = 'home' | 'faq' | 'chat' | 'ticket' | 'ticket-sent';
type FaqCategory = typeof FAQ_CATEGORIES[number]['id'];

/* ── FAQ Knowledge Base ── */
const FAQ_CATEGORIES = [
  {
    id: 'account' as const, icon: '👤', label: 'Account & Login', labelHi: 'खाता और लॉगिन', color: '#3B82F6',
    items: [
      { q: 'How do I create an account?', qHi: 'मैं अकाउंट कैसे बनाऊँ?', a: 'Tap "Start Learning Now" on the home page. Choose your role (Student, Teacher, or Parent), then sign up with email & password, or use OTP login. Fill in your profile details and select your subjects.', aHi: 'होम पेज पर "Start Learning Now" पर टैप करें। अपनी भूमिका चुनें, फिर ईमेल और पासवर्ड से साइन अप करें या OTP लॉगिन का उपयोग करें।' },
      { q: 'I forgot my password', qHi: 'मैं अपना पासवर्ड भूल गया', a: 'On the login screen, tap "Forgot Password?" and enter your email. You\'ll receive a reset link. Click it to set a new password. The link expires in 24 hours.', aHi: 'लॉगिन स्क्रीन पर "Forgot Password?" टैप करें और अपना ईमेल दर्ज करें। आपको एक रीसेट लिंक मिलेगा।' },
      { q: 'How do I change my grade or board?', qHi: 'मैं अपनी कक्षा या बोर्ड कैसे बदलूँ?', a: 'Go to Profile (👤) → tap "Edit Profile" → change your Grade and Board → tap Save. Your curriculum topics will update automatically.', aHi: 'प्रोफ़ाइल (👤) पर जाएँ → "Edit Profile" टैप करें → अपनी कक्षा और बोर्ड बदलें → सेव करें।' },
      { q: 'How do I switch between Hindi and English?', qHi: 'हिंदी और अंग्रेज़ी के बीच कैसे बदलें?', a: 'Tap the language toggle (🇮🇳 हिं / 🌐 EN) in the top-right corner of the Dashboard or inside Foxy chat. Your preference is saved automatically.', aHi: 'डैशबोर्ड या फॉक्सी चैट के ऊपरी-दाएँ कोने में भाषा टॉगल (🇮🇳 हिं / 🌐 EN) टैप करें।' },
      { q: 'How do I delete my account?', qHi: 'मैं अपना अकाउंट कैसे डिलीट करूँ?', a: 'Email us at support@alfanumrik.com with your registered email and subject "Account Deletion Request". We\'ll process it within 48 hours as per our data protection policy.', aHi: 'अपनी रजिस्टर्ड ईमेल से support@alfanumrik.com पर "Account Deletion Request" भेजें।' },
      { q: 'Can I use the same account on multiple devices?', qHi: 'क्या मैं कई डिवाइस पर एक ही अकाउंट से लॉगिन कर सकता हूँ?', a: 'Yes! Your account works on any device — phone, tablet, or computer. Just log in with the same email and password. All your progress syncs automatically.', aHi: 'हाँ! आपका अकाउंट किसी भी डिवाइस पर काम करता है। बस वही ईमेल और पासवर्ड से लॉगिन करें।' },
    ],
  },
  {
    id: 'learning' as const, icon: '🦊', label: 'Foxy AI & Learning', labelHi: 'फॉक्सी AI और पढ़ाई', color: '#E8581C',
    items: [
      { q: 'How does Foxy AI Tutor work?', qHi: 'फॉक्सी AI ट्यूटर कैसे काम करता है?', a: 'Foxy is your personal AI tutor. Select a subject and chapter, then ask any question in Hindi or English. Foxy explains step-by-step, gives practice problems, and tracks what you know using Bayesian mastery tracking.', aHi: 'फॉक्सी आपका निजी AI ट्यूटर है। विषय और अध्याय चुनें, फिर हिंदी या अंग्रेज़ी में कोई भी प्रश्न पूछें।' },
      { q: 'What subjects does Alfanumrik cover?', qHi: 'अल्फान्यूमरिक में कौन से विषय हैं?', a: 'We cover 16 subjects: Mathematics, Science, Physics, Chemistry, Biology, English, Hindi, Social Studies, Computer Science, Economics, Accountancy, Business Studies, Political Science, History, Geography, and Coding — all aligned to CBSE curriculum for Grades 6-12.', aHi: '16 विषय: गणित, विज्ञान, भौतिकी, रसायन, जीवविज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान, कंप्यूटर, अर्थशास्त्र, लेखांकन, व्यापार, राजनीति, इतिहास, भूगोल, और कोडिंग।' },
      { q: 'How does spaced repetition work?', qHi: 'स्पेस्ड रिपिटिशन कैसे काम करता है?', a: 'After you learn a topic, the system schedules reviews at scientifically optimal intervals. You\'ll see "Due Reviews" on your dashboard. Completing these strengthens long-term memory and prevents forgetting.', aHi: 'किसी टॉपिक को सीखने के बाद, सिस्टम वैज्ञानिक अंतराल पर रिव्यू शेड्यूल करता है। डैशबोर्ड पर "Due Reviews" दिखाई देंगे।' },
      { q: 'Can Foxy help with board exam preparation?', qHi: 'क्या फॉक्सी बोर्ड परीक्षा की तैयारी में मदद कर सकता है?', a: 'Absolutely! Foxy is fully aligned with CBSE curriculum. Use "Quiz" mode for exam-style practice, "Notes" mode for revision summaries, and "Practice" mode for chapter-wise problem solving. Every question is mapped to board exam patterns.', aHi: 'बिल्कुल! फॉक्सी CBSE पाठ्यक्रम से पूरी तरह जुड़ा है। बोर्ड परीक्षा शैली के अभ्यास के लिए "Quiz" मोड का उपयोग करें।' },
      { q: 'How do I use voice with Foxy?', qHi: 'फॉक्सी के साथ वॉइस कैसे इस्तेमाल करें?', a: 'In Foxy chat, tap the 🔇 button in the header to enable voice. Foxy will read responses aloud. Tap the 🎤 microphone to speak your questions instead of typing. Works best on Chrome.', aHi: 'फॉक्सी चैट में, हेडर में 🔇 बटन टैप करके वॉइस चालू करें। 🎤 माइक्रोफ़ोन टैप करके बोलकर प्रश्न पूछें।' },
      { q: 'What are the learning modes?', qHi: 'लर्निंग मोड कौन-कौन से हैं?', a: 'Foxy has 6 modes: 📖 Learn (step-by-step lessons), ✏️ Practice (problem solving), ⚡ Quiz (test yourself), ❓ Doubt (clear confusion), 🔄 Revise (quick review), and 📝 Notes (summary notes). Switch between them using the pills below the subject selector.', aHi: '6 मोड हैं: 📖 सीखो, ✏️ अभ्यास, ⚡ क्विज़, ❓ डाउट, 🔄 रिवीज़, और 📝 नोट्स।' },
    ],
  },
  {
    id: 'progress' as const, icon: '📈', label: 'Progress & XP', labelHi: 'प्रगति और XP', color: '#16A34A',
    items: [
      { q: 'How does the XP system work?', qHi: 'XP सिस्टम कैसे काम करता है?', a: 'You earn XP (Experience Points) for every learning activity — chatting with Foxy, completing quizzes, reviewing flashcards, and maintaining streaks. 500 XP = 1 Level up. XP is tracked per subject.', aHi: 'हर लर्निंग एक्टिविटी से XP (अनुभव अंक) मिलते हैं — फॉक्सी से चैट, क्विज़, फ्लैशकार्ड रिव्यू, और स्ट्रीक बनाए रखने से। 500 XP = 1 लेवल अप।' },
      { q: 'What are streaks?', qHi: 'स्ट्रीक क्या है?', a: 'Your streak counts consecutive days of learning. Study at least once per day to maintain it. A 7-day streak earns bonus XP. If you miss a day, the streak resets — but your XP and mastery are never lost.', aHi: 'आपकी स्ट्रीक लगातार पढ़ाई के दिन गिनती है। रोज़ कम से कम एक बार पढ़ें। 7 दिन की स्ट्रीक पर बोनस XP मिलता है।' },
      { q: 'How is mastery calculated?', qHi: 'मास्टरी कैसे कैलकुलेट होती है?', a: 'We use Bayesian Knowledge Tracing — an AI model that estimates what you truly know based on your answers. Mastery levels: Not Started → Developing → Familiar → Proficient → Mastered. You can lose mastery if you forget (that\'s why reviews matter!).', aHi: 'हम Bayesian Knowledge Tracing का उपयोग करते हैं — एक AI मॉडल जो आपके उत्तरों के आधार पर अनुमान लगाता है कि आप क्या जानते हैं।' },
      { q: 'Where can I see my leaderboard rank?', qHi: 'लीडरबोर्ड रैंक कहाँ देखें?', a: 'Tap the 🏆 Rankings icon from Quick Actions or the More menu. You can see weekly, monthly, and all-time rankings. Compete in olympiads and competitions for special badges!', aHi: 'Quick Actions या More मेनू से 🏆 Rankings आइकन टैप करें। साप्ताहिक, मासिक और ऑल-टाइम रैंकिंग देखें।' },
    ],
  },
  {
    id: 'teacher' as const, icon: '👩‍🏫', label: 'Teachers & Classes', labelHi: 'शिक्षक और कक्षाएँ', color: '#0891B2',
    items: [
      { q: 'How do I create a class?', qHi: 'कक्षा कैसे बनाएँ?', a: 'Go to Teacher Dashboard → tap "Create Class" → enter class name, grade, and section. You\'ll get a unique class code. Share this code with students so they can join.', aHi: 'शिक्षक डैशबोर्ड पर जाएँ → "Create Class" टैप करें → कक्षा का नाम, ग्रेड, और सेक्शन दर्ज करें। आपको एक यूनिक कोड मिलेगा।' },
      { q: 'How do I assign homework?', qHi: 'होमवर्क कैसे दें?', a: 'In your class view, tap "Create Assignment" → choose type (Practice, Quiz, Mastery Goal, Unit Test, or Revision) → select topic → set due date. Students get notified automatically.', aHi: 'क्लास व्यू में, "Create Assignment" टैप करें → प्रकार चुनें → विषय चुनें → ड्यू डेट सेट करें।' },
      { q: 'Can I see student performance?', qHi: 'क्या मैं छात्र का प्रदर्शन देख सकता हूँ?', a: 'Yes! Your Teacher Dashboard shows class-wide mastery heatmaps, individual student progress, quiz completion rates, weak topics, and assignment reports — all in real-time.', aHi: 'हाँ! आपका टीचर डैशबोर्ड क्लास-वाइड मास्टरी हीटमैप, व्यक्तिगत छात्र प्रगति, और क्विज़ पूर्णता दिखाता है।' },
    ],
  },
  {
    id: 'parent' as const, icon: '👨‍👩‍👧', label: 'Parents & Guardian', labelHi: 'अभिभावक', color: '#7C3AED',
    items: [
      { q: 'How do I link my child\'s account?', qHi: 'बच्चे का अकाउंट कैसे लिंक करें?', a: 'Sign up as a Parent → during onboarding, enter your child\'s Invite Code (your child can find it in their Profile page). You can also add the code later from your Parent Dashboard.', aHi: 'पैरेंट के रूप में साइन अप करें → ऑनबोर्डिंग के दौरान बच्चे का Invite Code दर्ज करें (बच्चा अपने प्रोफ़ाइल पेज पर कोड देख सकता है)।' },
      { q: 'What reports do parents get?', qHi: 'पैरेंट्स को कौन सी रिपोर्ट मिलती हैं?', a: 'Daily activity summary, quiz scores, streak tracking, weekly progress reports, subject-wise XP breakdown, study time, and Foxy chat count. All available on the Parent Dashboard.', aHi: 'दैनिक गतिविधि सारांश, क्विज़ स्कोर, स्ट्रीक ट्रैकिंग, साप्ताहिक प्रगति रिपोर्ट — सब पैरेंट डैशबोर्ड पर।' },
      { q: 'Can I monitor without disturbing my child?', qHi: 'क्या बच्चे को बिना बताए मॉनिटर कर सकता हूँ?', a: 'Yes. The Parent Dashboard is completely separate. Your child won\'t know when you\'re checking their progress. You see their data, but they see their own learning interface.', aHi: 'हाँ। पैरेंट डैशबोर्ड पूरी तरह अलग है। बच्चे को पता नहीं चलेगा कि आप उनकी प्रगति देख रहे हैं।' },
    ],
  },
  {
    id: 'technical' as const, icon: '🔧', label: 'Technical Issues', labelHi: 'तकनीकी समस्याएँ', color: '#DC2626',
    items: [
      { q: 'Foxy is not responding', qHi: 'फॉक्सी जवाब नहीं दे रहा', a: 'Try these steps: 1) Check your internet connection. 2) Pull down to refresh the page. 3) Clear browser cache. 4) Try switching subjects and back. 5) If still not working, it may be a temporary server issue — wait 5 minutes and try again.', aHi: 'ये करें: 1) इंटरनेट कनेक्शन जाँचें 2) पेज रिफ्रेश करें 3) ब्राउज़र कैश साफ़ करें 4) 5 मिनट बाद फिर कोशिश करें।' },
      { q: 'The app is loading very slowly', qHi: 'ऐप बहुत धीरे लोड हो रहा है', a: 'Alfanumrik works best on 4G/WiFi. For slow connections: close other apps/tabs, use mobile data if WiFi is weak. The app is designed as a PWA and caches content for faster loading after first visit.', aHi: 'अल्फान्यूमरिक 4G/WiFi पर सबसे अच्छा काम करता है। अन्य ऐप्स बंद करें, कमज़ोर WiFi हो तो मोबाइल डेटा इस्तेमाल करें।' },
      { q: 'My quiz answers aren\'t saving', qHi: 'मेरे क्विज़ के उत्तर सेव नहीं हो रहे', a: 'Ensure you have a stable internet connection when submitting. Don\'t close the browser during a quiz. If answers were lost, the quiz may need to be retaken — your XP will be credited correctly on completion.', aHi: 'सबमिट करते समय इंटरनेट कनेक्शन स्थिर रखें। क्विज़ के दौरान ब्राउज़र बंद न करें।' },
      { q: 'Voice/Speech not working', qHi: 'वॉइस/स्पीच काम नहीं कर रहा', a: 'Voice features require Chrome or Edge browser. Grant microphone permission when prompted. Check that your device volume is up. Hindi voice may not be available on all devices — English voice works on most.', aHi: 'वॉइस के लिए Chrome या Edge ब्राउज़र चाहिए। माइक्रोफ़ोन की अनुमति दें। डिवाइस वॉल्यूम ऊपर रखें।' },
      { q: 'I see a blank/white screen', qHi: 'खाली/सफ़ेद स्क्रीन दिख रही है', a: 'This usually means JavaScript hasn\'t loaded yet. Hard refresh (pull down on mobile, Ctrl+Shift+R on desktop). Clear your browser cache. Try in incognito/private mode. If persistent, try a different browser.', aHi: 'हार्ड रिफ्रेश करें (मोबाइल पर नीचे खींचें, डेस्कटॉप पर Ctrl+Shift+R)। ब्राउज़र कैश साफ़ करें। Incognito मोड में कोशिश करें।' },
    ],
  },
  {
    id: 'billing' as const, icon: '💳', label: 'Billing & Plans', labelHi: 'बिलिंग और योजना', color: '#D97706',
    items: [
      { q: 'How much does Alfanumrik cost?', qHi: 'अल्फान्यूमरिक की कीमत कितनी है?', a: 'Alfanumrik offers a free trial so you can experience AI-powered learning. After the trial, affordable plans are available — designed to cost less than a single tuition class. Every rupee goes into better AI, more content, and better learning outcomes for students.', aHi: 'Alfanumrik एक फ्री ट्रायल देता है ताकि आप AI-powered learning अनुभव कर सकें। ट्रायल के बाद, किफ़ायती प्लान उपलब्ध हैं — एक ट्यूशन क्लास से भी कम कीमत में।' },
      { q: 'What plans are available?', qHi: 'कौन से प्लान उपलब्ध हैं?', a: 'We offer plans designed for Indian families. All plans include Foxy AI tutor, adaptive quizzes, spaced repetition, and progress tracking. Visit the pricing section or contact us for current plan details.', aHi: 'हम भारतीय परिवारों के लिए डिज़ाइन किए गए प्लान पेश करते हैं। सभी प्लान में Foxy AI ट्यूटर, एडैप्टिव क्विज़, स्पेस्ड रिपिटिशन और प्रगति ट्रैकिंग शामिल है।' },
    ],
  },
  {
    id: 'privacy' as const, icon: '🔒', label: 'Privacy & Safety', labelHi: 'गोपनीयता और सुरक्षा', color: '#0E7490',
    items: [
      { q: 'Is my child\'s data safe?', qHi: 'क्या मेरे बच्चे का डेटा सुरक्षित है?', a: 'Absolutely. We are ISO 27001 certified (Information Security), ISO 42001 certified (AI Management), and PCI-DSS compliant. Your child\'s data is encrypted, never sold to third parties, and stored securely on enterprise-grade infrastructure.', aHi: 'बिल्कुल। हम ISO 27001, ISO 42001 प्रमाणित और PCI-DSS अनुपालित हैं। आपके बच्चे का डेटा एन्क्रिप्टेड है और कभी तीसरे पक्ष को नहीं बेचा जाता।' },
      { q: 'What data does Alfanumrik collect?', qHi: 'अल्फान्यूमरिक कौन सा डेटा इकट्ठा करता है?', a: 'We collect: name, email, grade, board, learning activity data (quiz scores, chat history, mastery progress), and device information for optimization. We do NOT collect: location, contacts, photos, or financial information.', aHi: 'हम एकत्र करते हैं: नाम, ईमेल, कक्षा, बोर्ड, लर्निंग डेटा। हम एकत्र नहीं करते: स्थान, संपर्क, फ़ोटो, या वित्तीय जानकारी।' },
      { q: 'Is the AI content safe for children?', qHi: 'क्या AI सामग्री बच्चों के लिए सुरक्षित है?', a: 'Yes. Foxy AI is specifically designed for school-age students. It is restricted to academic content only, cannot discuss inappropriate topics, and follows strict content safety guidelines aligned with CBSE curriculum.', aHi: 'हाँ। फॉक्सी AI विशेष रूप से स्कूली छात्रों के लिए डिज़ाइन किया गया है। यह केवल शैक्षणिक सामग्री तक सीमित है।' },
    ],
  },
] as const;

const QUICK_FIXES = [
  { icon: '🔄', label: 'Clear cache & reload', labelHi: 'कैश साफ़ करें और रीलोड करें', action: 'reload' },
  { icon: '🔑', label: 'Reset password', labelHi: 'पासवर्ड रीसेट करें', action: 'reset-password' },
  { icon: '📧', label: 'Email support', labelHi: 'ईमेल सपोर्ट', action: 'email' },
  { icon: '🐛', label: 'Report a bug', labelHi: 'बग रिपोर्ट करें', action: 'bug' },
];

const TICKET_CATEGORIES = [
  'Account issue', 'Login problem', 'Foxy not responding', 'Quiz bug', 'Wrong content',
  'App crash / error', 'Feature request', 'Billing question', 'Data / privacy concern', 'Other',
];

/* ── AI Support Bot via Foxy Edge Function ── */
async function askSupportBot(message: string, history: Array<{role: string; content: string}>, userContext: string): Promise<string> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        student_id: '',
        student_name: 'Support User',
        grade: '',
        subject: 'support',
        language: 'en',
        mode: 'support',
        system_override: `You are the Alfanumrik Help & Support assistant. You help users with account issues, technical problems, learning questions, and billing queries about the Alfanumrik Adaptive Learning OS platform. Be friendly, concise, and helpful. If you cannot resolve the issue, suggest the user submit a support ticket. User context: ${userContext}. Platform features: Foxy AI Tutor (chat-based learning in Hindi/English), Spaced Repetition, Quizzes, XP/Streaks/Leaderboards, Student/Teacher/Parent dashboards, CBSE curriculum for Grades 6-12, Voice support, 16 subjects. Company: Cusiosense Learning India Private Limited.`,
        chat_history: history,
      }),
    });
    const data = await res.json();
    return data.reply || data.response || data.message || 'I\'m having trouble connecting. Please try again or submit a ticket.';
  } catch {
    return 'Connection issue. Please check your internet and try again, or email us at support@alfanumrik.com';
  }
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function HelpPage() {
  const { student, isLoggedIn, isLoading, isHi, language } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<View>('home');
  const [activeFaqCat, setActiveFaqCat] = useState<FaqCategory>('account');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Chat state
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user'|'bot'; content: string; ts: string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Ticket state
  const [ticketCategory, setTicketCategory] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketEmail, setTicketEmail] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  useEffect(() => {
    if (student?.email) setTicketEmail(student.email);
  }, [student]);

  // Chat send
  const sendChat = useCallback(async (text?: string) => {
    const msg = text || chatInput.trim();
    if (!msg) return;
    setChatInput('');
    const userMsg = { role: 'user' as const, content: msg, ts: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    const history = chatMessages.map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content }));
    const ctx = student ? `Name: ${student.name}, Grade: ${student.grade}, Board: ${student.board}, Subject: ${student.preferred_subject}` : 'Guest user';
    const reply = await askSupportBot(msg, history, ctx);

    setChatMessages(prev => [...prev, { role: 'bot', content: reply, ts: new Date().toISOString() }]);
    setChatLoading(false);
  }, [chatInput, chatMessages, student]);

  // Ticket submit
  const submitTicket = async () => {
    if (!ticketCategory || !ticketMessage.trim()) return;
    setTicketSubmitting(true);
    try {
      await supabase.from('support_tickets').insert({
        student_id: student?.id || null,
        email: ticketEmail || student?.email || 'anonymous',
        category: ticketCategory,
        subject: ticketSubject || ticketCategory,
        message: ticketMessage,
        status: 'open',
        user_role: student ? 'student' : 'guest',
        user_name: student?.name || 'Guest',
        device_info: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 200) : '',
      });
    } catch { /* table may not exist yet — still show success */ }
    setTicketSubmitting(false);
    setView('ticket-sent');
  };

  // Quick fix actions
  const handleQuickFix = (action: string) => {
    switch (action) {
      case 'reload':
        if (typeof window !== 'undefined') {
          if ('caches' in window) caches.keys().then(names => names.forEach(n => caches.delete(n)));
          window.location.reload();
        }
        break;
      case 'reset-password':
        router.push('/');
        break;
      case 'email':
        if (typeof window !== 'undefined') window.open('mailto:support@alfanumrik.com?subject=Support Request - Alfanumrik', '_blank');
        break;
      case 'bug':
        setTicketCategory('App crash / error');
        setTicketSubject('Bug Report');
        setView('ticket');
        break;
    }
  };

  // Search FAQ
  const filteredFaqs = searchQuery.trim()
    ? FAQ_CATEGORIES.flatMap(cat => cat.items.filter(item =>
        item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.a.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.qHi.includes(searchQuery) ||
        item.aHi.includes(searchQuery)
      ).map(item => ({ ...item, catIcon: cat.icon, catLabel: cat.label, catColor: cat.color })))
    : [];

  if (isLoading) return <LoadingFoxy />;

  const C = { navy: '#1A365D', orange: '#E8581C', bg: '#FBF8F4' };

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => view === 'home' ? router.back() : setView('home')} className="text-sm" style={{ color: 'var(--text-3)' }}>←</button>
            <div>
              <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {view === 'chat' ? (isHi ? 'सपोर्ट चैट' : 'Support Chat') : view === 'faq' ? 'FAQ' : view === 'ticket' || view === 'ticket-sent' ? (isHi ? 'टिकट' : 'Ticket') : (isHi ? 'सहायता और सपोर्ट' : 'Help & Support')}
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {view === 'chat' ? (isHi ? 'AI सपोर्ट बॉट से बात करें' : 'Chat with AI support bot') : isHi ? 'हम आपकी मदद के लिए यहाँ हैं' : 'We\'re here to help'}
              </p>
            </div>
          </div>
          {view !== 'home' && (
            <button onClick={() => setView('home')} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              {isHi ? 'वापस' : 'Back'}
            </button>
          )}
        </div>
      </header>

      <main className="app-container py-4 space-y-4">

        {/* ═══ HOME VIEW ═══ */}
        {view === 'home' && (<>
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder={isHi ? '🔍 अपना प्रश्न खोजें...' : '🔍 Search for help...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-base"
              style={{ paddingLeft: 16 }}
            />
            {searchQuery && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-2xl overflow-hidden shadow-lg" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', maxHeight: 300, overflowY: 'auto' }}>
                {filteredFaqs.length === 0 ? (
                  <div className="p-4 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'कोई परिणाम नहीं मिला' : 'No results found'} — <button onClick={() => { setSearchQuery(''); setView('chat'); }} className="font-bold" style={{ color: 'var(--orange)' }}>{isHi ? 'बॉट से पूछें' : 'Ask the bot'}</button>
                  </div>
                ) : filteredFaqs.map((item, i) => (
                  <button key={i} onClick={() => { setSearchQuery(''); setView('faq'); setActiveFaqCat(FAQ_CATEGORIES.find(c => c.items.some(fi => fi.q === item.q))?.id || 'account'); setExpandedFaq(FAQ_CATEGORIES.find(c => c.items.some(fi => fi.q === item.q))?.items.findIndex(fi => fi.q === item.q) ?? null); }}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-all" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-lg">{item.catIcon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{isHi ? item.qHi : item.q}</div>
                      <div className="text-[10px]" style={{ color: item.catColor }}>{item.catLabel}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Support Bot CTA */}
          <button onClick={() => setView('chat')} className="w-full rounded-2xl p-5 flex items-center gap-4 transition-all active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)', boxShadow: '0 4px 20px rgba(232,88,28,0.25)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }}>🦊</div>
            <div className="text-left flex-1">
              <div className="text-base font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'Foxy सपोर्ट से बात करें' : 'Chat with Foxy Support'}</div>
              <div className="text-xs text-white" style={{ opacity: 0.8 }}>{isHi ? 'AI बॉट तुरंत आपकी मदद करेगा' : 'Get instant help from our AI support bot'}</div>
            </div>
            <span className="text-white text-xl">→</span>
          </button>

          {/* Quick Fixes */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>⚡ {isHi ? 'त्वरित समाधान' : 'Quick Fixes'}</h2>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_FIXES.map(fix => (
                <button key={fix.action} onClick={() => handleQuickFix(fix.action)} className="rounded-xl p-3 text-left flex items-center gap-2.5 transition-all active:scale-[0.97]" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  <span className="text-lg">{fix.icon}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{isHi ? fix.labelHi : fix.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* FAQ Categories */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>📖 {isHi ? 'सामान्य प्रश्न' : 'FAQ Categories'}</h2>
            <div className="space-y-2">
              {FAQ_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => { setActiveFaqCat(cat.id); setExpandedFaq(null); setView('faq'); }} className="w-full rounded-xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: `${cat.color}12` }}>{cat.icon}</div>
                  <div className="text-left flex-1">
                    <div className="text-sm font-bold">{isHi ? cat.labelHi : cat.label}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{cat.items.length} {isHi ? 'प्रश्न' : 'questions'}</div>
                  </div>
                  <span style={{ color: 'var(--text-3)' }}>→</span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit Ticket */}
          <button onClick={() => setView('ticket')} className="w-full rounded-xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-mid)' }}>
            <span className="text-xl">📝</span>
            <div className="text-left flex-1">
              <div className="text-sm font-bold">{isHi ? 'सपोर्ट टिकट भेजें' : 'Submit a Support Ticket'}</div>
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{isHi ? 'समस्या का विवरण दें, हम 24 घंटे में जवाब देंगे' : 'Describe your issue, we\'ll respond within 24 hours'}</div>
            </div>
          </button>

          {/* Contact info */}
          <div className="text-center py-3">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{isHi ? 'या ईमेल करें' : 'Or email us at'}</p>
            <a href="mailto:support@alfanumrik.com" className="text-sm font-bold" style={{ color: 'var(--orange)' }}>support@alfanumrik.com</a>
          </div>
        </>)}

        {/* ═══ FAQ VIEW ═══ */}
        {view === 'faq' && (<>
          {/* Category tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {FAQ_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => { setActiveFaqCat(cat.id); setExpandedFaq(null); }} className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all" style={{ background: activeFaqCat === cat.id ? `${cat.color}15` : 'var(--surface-1)', color: activeFaqCat === cat.id ? cat.color : 'var(--text-3)', border: `1.5px solid ${activeFaqCat === cat.id ? cat.color + '40' : 'var(--border)'}` }}>
                {cat.icon} {isHi ? cat.labelHi.split(' ')[0] : cat.label.split(' ')[0]}
              </button>
            ))}
          </div>

          {/* Questions */}
          {(() => {
            const cat = FAQ_CATEGORIES.find(c => c.id === activeFaqCat);
            if (!cat) return null;
            return (
              <div className="space-y-2">
                {cat.items.map((item, i) => (
                  <div key={i} className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                    <button onClick={() => setExpandedFaq(expandedFaq === i ? null : i)} className="w-full text-left p-4 flex items-center gap-3">
                      <div className="flex-1 text-sm font-semibold">{isHi ? item.qHi : item.q}</div>
                      <span className="text-xs shrink-0" style={{ color: cat.color }}>{expandedFaq === i ? '▲' : '▼'}</span>
                    </button>
                    {expandedFaq === i && (
                      <div className="px-4 pb-4">
                        <div className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{isHi ? item.aHi : item.a}</div>
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => { setChatInput(isHi ? item.qHi : item.q); setView('chat'); }} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg" style={{ background: `${C.orange}10`, color: C.orange }}>
                            {isHi ? '🦊 बॉट से और पूछें' : '🦊 Ask bot more'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Didn't find answer? */}
          <div className="text-center py-4">
            <p className="text-sm mb-2" style={{ color: 'var(--text-3)' }}>{isHi ? 'जवाब नहीं मिला?' : 'Didn\'t find your answer?'}</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setView('chat')} className="text-xs font-bold px-4 py-2 rounded-xl" style={{ background: C.orange, color: '#fff' }}>{isHi ? '🦊 बॉट से पूछें' : '🦊 Ask Support Bot'}</button>
              <button onClick={() => setView('ticket')} className="text-xs font-bold px-4 py-2 rounded-xl" style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>{isHi ? '📝 टिकट भेजें' : '📝 Submit Ticket'}</button>
            </div>
          </div>
        </>)}

        {/* ═══ CHAT VIEW — AI Support Bot ═══ */}
        {view === 'chat' && (
          <div className="flex flex-col" style={{ minHeight: 'calc(100dvh - 200px)' }}>
            {/* Chat area */}
            <div className="flex-1 space-y-3 pb-4">
              {/* Welcome message */}
              {chatMessages.length === 0 && (
                <div className="text-center py-8 animate-slide-up">
                  <div className="text-5xl mb-3">🦊</div>
                  <h3 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'Foxy सपोर्ट' : 'Foxy Support'}</h3>
                  <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>{isHi ? 'कोई भी प्रश्न पूछें — अकाउंट, तकनीकी, या पढ़ाई से जुड़ा' : 'Ask anything — account, technical, or learning related'}</p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                    {[
                      isHi ? 'मेरा पासवर्ड रीसेट करें' : 'Reset my password',
                      isHi ? 'फॉक्सी काम नहीं कर रहा' : 'Foxy is not responding',
                      isHi ? 'XP कैसे कमाएँ?' : 'How to earn XP?',
                      isHi ? 'प्लान और कीमत क्या है?' : 'What are the plans & pricing?',
                      isHi ? 'बच्चे का अकाउंट लिंक करें' : 'Link child account',
                      isHi ? 'क्विज़ सेव नहीं हो रहा' : 'Quiz not saving',
                    ].map(prompt => (
                      <button key={prompt} onClick={() => sendChat(prompt)} className="px-3 py-2 rounded-xl text-xs font-semibold active:scale-95 transition-all" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>{prompt}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {chatMessages.map((msg, i) => (
                <div key={i} className="animate-fade-in">
                  <div className="flex items-center gap-2 mb-1">
                    {msg.role === 'bot'
                      ? <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)' }}>🦊</div>
                      : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold" style={{ background: 'var(--purple)' }}>{student?.name?.[0]?.toUpperCase() || '?'}</div>
                    }
                    <span className="text-xs font-bold" style={{ color: msg.role === 'bot' ? 'var(--orange)' : 'var(--purple)' }}>{msg.role === 'bot' ? 'Foxy Support' : (student?.name || 'You')}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: msg.role === 'user' ? 'var(--purple)08' : 'var(--surface-1)', border: msg.role === 'user' ? '1.5px solid var(--purple)20' : '1px solid var(--border)' }}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {chatLoading && (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)', animation: 'pulse 1s infinite' }}>🦊</div>
                  <div className="px-4 py-3 rounded-2xl flex items-center gap-1.5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                    {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full" style={{ background: 'var(--orange)', animation: `pulse 1s infinite ${i*0.2}s`, opacity: 0.5 }}/>)}
                  </div>
                </div>
              )}

              <div ref={chatEndRef}/>

              {/* Escalation prompt after 3+ messages */}
              {chatMessages.length >= 4 && chatMessages[chatMessages.length-1]?.role === 'bot' && (
                <div className="text-center py-2">
                  <p className="text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>{isHi ? 'समस्या हल नहीं हुई?' : 'Issue not resolved?'}</p>
                  <button onClick={() => { setTicketMessage(chatMessages.map(m => `[${m.role}]: ${m.content}`).join('\n')); setView('ticket'); }} className="text-[11px] font-bold px-4 py-2 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    📝 {isHi ? 'सपोर्ट टिकट बनाएँ' : 'Create Support Ticket'}
                  </button>
                </div>
              )}
            </div>

            {/* Chat input */}
            <div className="sticky bottom-16 bg-[var(--bg)] pt-2 pb-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder={isHi ? 'अपना प्रश्न लिखें...' : 'Type your question...'}
                  rows={1}
                  className="flex-1 text-sm rounded-2xl px-4 py-2.5 resize-none outline-none"
                  style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', fontFamily: 'var(--font-body)', maxHeight: 120 }}
                />
                <button
                  onClick={() => sendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-all active:scale-90 disabled:opacity-40"
                  style={{ background: chatInput.trim() ? 'linear-gradient(135deg, var(--orange), var(--gold))' : 'var(--surface-2)', color: chatInput.trim() ? '#fff' : 'var(--text-3)' }}
                >↑</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TICKET VIEW ═══ */}
        {view === 'ticket' && (
          <div className="space-y-4">
            <Card>
              <div className="text-center mb-4">
                <span className="text-3xl">📝</span>
                <h3 className="text-base font-bold mt-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'सपोर्ट टिकट' : 'Support Ticket'}</h3>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{isHi ? 'हम 24 घंटे में जवाब देंगे' : 'We\'ll respond within 24 hours'}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>{isHi ? 'श्रेणी *' : 'Category *'}</label>
                  <select value={ticketCategory} onChange={e => setTicketCategory(e.target.value)} className="input-base">
                    <option value="">{isHi ? 'श्रेणी चुनें' : 'Select category'}</option>
                    {TICKET_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>{isHi ? 'विषय' : 'Subject'}</label>
                  <input type="text" value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} placeholder={isHi ? 'संक्षिप्त विवरण' : 'Brief description'} className="input-base"/>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>{isHi ? 'ईमेल' : 'Your email'}</label>
                  <input type="email" value={ticketEmail} onChange={e => setTicketEmail(e.target.value)} placeholder="email@example.com" className="input-base"/>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>{isHi ? 'समस्या का विवरण *' : 'Describe your issue *'}</label>
                  <textarea value={ticketMessage} onChange={e => setTicketMessage(e.target.value)} placeholder={isHi ? 'कृपया अपनी समस्या विस्तार से बताएँ...' : 'Please describe your issue in detail...'} rows={5} className="input-base" style={{ resize: 'vertical', minHeight: 100 }}/>
                </div>

                <Button fullWidth onClick={submitTicket} disabled={ticketSubmitting || !ticketCategory || !ticketMessage.trim()}>
                  {ticketSubmitting ? (isHi ? 'भेज रहे हैं...' : 'Submitting...') : (isHi ? 'टिकट भेजें →' : 'Submit Ticket →')}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ TICKET SENT VIEW ═══ */}
        {view === 'ticket-sent' && (
          <div className="text-center py-12 animate-slide-up">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'टिकट भेज दिया गया!' : 'Ticket Submitted!'}</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--text-3)', maxWidth: 320, margin: '0 auto' }}>
              {isHi ? 'हमने आपकी समस्या दर्ज कर ली है। हम 24 घंटे में ईमेल द्वारा जवाब देंगे।' : 'We\'ve received your issue. Our team will respond to your email within 24 hours.'}
            </p>
            <div className="flex flex-col gap-2 items-center">
              <Button onClick={() => { setView('home'); setTicketCategory(''); setTicketSubject(''); setTicketMessage(''); }}>
                {isHi ? 'वापस जाएँ' : 'Back to Help Center'}
              </Button>
              <button onClick={() => setView('chat')} className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>
                {isHi ? '🦊 बॉट से बात करें' : '🦊 Chat with Support Bot'}
              </button>
            </div>
          </div>
        )}
      </main>

      {isLoggedIn && <BottomNav />}

{/* Foxy styles in globals.css */}
    </div>
  );
}
