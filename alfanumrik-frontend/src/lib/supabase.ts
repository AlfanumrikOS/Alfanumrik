import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseAnonKey) : null;

// MIGA Tutor API base URL
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ==========================================
// STEP 1: FOXY CHAT — calls miga-tutor-api
// ==========================================

export async function foxyChat(
  messages: { role: string; content: string }[],
  studentName: string,
  grade: number,
  language: string,
  sessionMode: string,
  sessionId?: string
): Promise<string> {
  if (!API_URL) {
    return fallbackResponse(messages[messages.length - 1]?.content || '', studentName, language === 'hi');
  }

  try {
    const res = await fetch(`${API_URL}/api/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: messages[messages.length - 1]?.content || '',
        sessionId: sessionId || undefined,
        context: {
          studentName,
          grade,
          language,
          sessionMode,
          history: messages.slice(-10).map(m => ({
            role: m.role === 'foxy' ? 'assistant' : m.role,
            content: m.content,
          })),
        },
      }),
    });

    if (!res.ok) {
      console.warn('Foxy API error:', res.status);
      return fallbackResponse(messages[messages.length - 1]?.content || '', studentName, language === 'hi');
    }

    const data = await res.json();
    return data.response || data.reply || data.message || data.content || fallbackResponse('', studentName, language === 'hi');
  } catch (err) {
    console.warn('Foxy fetch error:', err);
    return fallbackResponse(messages[messages.length - 1]?.content || '', studentName, language === 'hi');
  }
}

// ==========================================
// STEP 3: SUPABASE PERSISTENCE
// Matches existing students table columns
// ==========================================

export interface DBStudent {
  id: string;
  name: string;
  grade: string; // text in your DB
  board: string;
  preferred_language: string;
  xp_total: number;
  streak_days: number;
  last_active: string;
  onboarding_completed: boolean;
}

// Save/update student in Supabase
export async function upsertStudent(student: {
  id: string; name: string; grade: number; board: string; language: string; xp: number; streak: number;
}): Promise<DBStudent | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('students')
      .upsert({
        id: student.id,
        name: student.name,
        grade: String(student.grade),
        board: student.board,
        preferred_language: student.language,
        xp_total: student.xp,
        streak_days: student.streak,
        last_active: new Date().toISOString(),
        onboarding_completed: true,
      }, { onConflict: 'id' })
      .select()
      .single();
    if (error) console.warn('Upsert student error:', error.message);
    return data;
  } catch (err) {
    console.warn('Upsert student failed:', err);
    return null;
  }
}

// Add XP to student in Supabase
export async function addXPToStudent(studentId: string, xpEarned: number): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_xp', { p_student_id: studentId, p_xp: xpEarned }).catch(() => {
      // Fallback if RPC doesn't exist — direct update
      supabase!.from('students').update({ xp_total: xpEarned }).eq('id', studentId);
    });
  } catch (err) {
    console.warn('Add XP failed:', err);
  }
}

// Save quiz session
export async function saveQuizSession(session: {
  studentId: string; subject: string; questionsAttempted: number;
  questionsCorrect: number; xpEarned: number; durationSeconds: number;
}): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('quiz_sessions').insert({
      student_id: session.studentId,
      subject: session.subject,
      total_questions: session.questionsAttempted,
      correct_answers: session.questionsCorrect,
      xp_earned: session.xpEarned,
      duration_seconds: session.durationSeconds,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Save quiz session failed:', err);
  }
}

// Get leaderboard
export async function getLeaderboard(limit = 20): Promise<DBStudent[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('students')
      .select('id, name, grade, xp_total, streak_days')
      .order('xp_total', { ascending: false })
      .limit(limit);
    return (data || []) as DBStudent[];
  } catch { return []; }
}

// ==========================================
// FALLBACK RESPONSES (when API is offline)
// ==========================================

function fallbackResponse(text: string, name: string, isHi: boolean): string {
  const t = text.toLowerCase();
  if (t.includes('newton') || t.includes('न्यूटन') || t.includes('force') || t.includes('बल'))
    return isHi
      ? `🦊 बढ़िया सवाल, ${name}! चलो न्यूटन के नियम समझते हैं:\n\n🏏 **पहला नियम (जड़त्व):** क्रिकेट की गेंद मैदान में रुकी है — जब तक कोई मारे नहीं, हिलेगी नहीं!\n\n**दूसरा नियम (F=ma):** जितनी ज़ोर से मारोगे, गेंद उतनी तेज़ जाएगी।\n\n**तीसरा नियम:** दीवार को धक्का मारो, दीवार भी उतना ही धक्का मारती है!\n\n🤔 बताओ — साइकिल ब्रेक लगाने पर आगे क्यों झुकते हो?`
      : `🦊 Great question, ${name}! Let's explore Newton's Laws:\n\n🏏 **First Law:** A cricket ball on the pitch won't move until hit!\n\n**Second Law (F=ma):** Harder hit = faster ball.\n\n**Third Law:** Push a wall, it pushes you back equally!\n\n🤔 When you brake your bicycle, why do you lean forward? Which law?`;
  if (t.includes('quadratic') || t.includes('द्विघात') || t.includes('equation') || t.includes('समीकरण'))
    return isHi
      ? `🦊 चलो ${name}, step-by-step सीखते हैं!\n\n📐 **द्विघात समीकरण:** ax² + bx + c = 0\n\nउदाहरण: x² - 5x + 6 = 0\n\n**Step 1:** गुणनफल=6, योग=-5 → -2 और -3\n**Step 2:** (x-2)(x-3) = 0\n**Step 3:** x = 2 या x = 3 ✅\n\nअब तुम try करो: x² - 7x + 12 = 0 का हल?`
      : `🦊 Let's break it down, ${name}!\n\n📐 **Quadratic:** ax² + bx + c = 0\n\nSolve: x² - 5x + 6 = 0\n\n**Step 1:** Find numbers: product=6, sum=-5 → -2,-3\n**Step 2:** (x-2)(x-3)=0\n**Step 3:** x=2 or x=3 ✅\n\nNow you try: x² - 7x + 12 = 0?`;
  if (t.includes('ohm') || t.includes('ओम') || t.includes('circuit') || t.includes('current') || t.includes('विद्युत'))
    return isHi
      ? `🦊 ओम का नियम सीखते हैं, ${name}!\n\n⚡ **V = I × R**\n\nV = वोल्टेज (बैटरी की ताकत)\nI = करंट (बिजली का बहाव)\nR = प्रतिरोध (रुकावट)\n\n**उदाहरण:** 12V बैटरी, 4Ω प्रतिरोध\nI = V/R = 12/4 = **3 Ampere** ⚡\n\n🔬 Virtual Lab में experiment करो!\n\nअगर प्रतिरोध दोगुना (8Ω), करंट कितना?`
      : `🦊 Let's learn Ohm's Law, ${name}!\n\n⚡ **V = I × R**\n\nV = Voltage, I = Current, R = Resistance\n\n**Example:** 12V battery, 4Ω resistance\nI = V/R = 12/4 = **3 Ampere** ⚡\n\n🔬 Try the Virtual Lab to experiment!\n\nIf we double resistance to 8Ω, what happens to current?`;
  if (t.includes('photosynthesis') || t.includes('प्रकाश संश्लेषण') || t.includes('plant') || t.includes('पौधा'))
    return isHi
      ? `🦊 प्रकाश संश्लेषण — पौधे कैसे खाना बनाते हैं!\n\n🌱 **समीकरण:**\nCO₂ + H₂O + सूर्य प्रकाश → ग्लूकोज़ + O₂\n\n**सरल भाषा में:**\n1. 🌞 पत्तियाँ सूरज की रोशनी पकड़ती हैं (क्लोरोफिल)\n2. 💧 जड़ें ज़मीन से पानी लाती हैं\n3. 🌬️ पत्तियाँ हवा से CO₂ लेती हैं\n4. 🍬 ग्लूकोज़ (खाना) बनता है!\n5. 🫁 O₂ बाहर — जो हम साँस लेते हैं!\n\n🤔 पौधे को अँधेरे में रखें तो?`
      : `🦊 Photosynthesis — how plants make food!\n\n🌱 **Equation:**\nCO₂ + H₂O + Sunlight → Glucose + O₂\n\n1. 🌞 Leaves capture sunlight (chlorophyll)\n2. 💧 Roots absorb water\n3. 🌬️ Leaves take CO₂ from air\n4. 🍬 Glucose (food) is made!\n5. 🫁 O₂ released — which we breathe!\n\n🤔 What happens in complete darkness?`;
  return isHi
    ? `🦊 अच्छा सवाल, ${name}! 🤔\n\nमुझे बताओ — इसमें सबसे ज़्यादा क्या confuse करता है? Step by step चलते हैं!\n\n*टिप: जितना specific पूछोगे, उतना अच्छा समझा पाऊँगी* 😊`
    : `🦊 Great question, ${name}! 🤔\n\nTell me — what part confuses you most? Let's go step by step!\n\n*Tip: The more specific, the better I can help* 😊`;
}
