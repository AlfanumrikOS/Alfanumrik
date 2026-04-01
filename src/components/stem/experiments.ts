/**
 * STEM Centre — Guided Experiment Definitions
 * CBSE-aligned experiments that wrap built-in simulations with structured observations,
 * data recording, and viva quizzes.
 *
 * Owner: frontend (content accuracy reviewed by assessment)
 */

/* ─── Types ─── */
export interface ObservationDef {
  prompt: string;
  promptHi: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  expectedHint?: string;
}

export interface VivaQuestion {
  question: string;
  questionHi: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ExperimentDefinition {
  id: string;
  simulationId: string;
  title: string;
  titleHi: string;
  chapterRef: string;
  grades: string[];
  subject: string;
  difficulty: number;
  bloomLevel: string;
  estimatedMinutes: number;
  objective: string;
  objectiveHi: string;
  materials?: string[];
  observations: ObservationDef[];
  dataTable?: { columns: string[]; rows: number };
  conclusionPrompt: string;
  conclusionPromptHi: string;
  quizQuestions: VivaQuestion[];
}

/* ─── Experiment Definitions ─── */
export const GUIDED_EXPERIMENTS: ExperimentDefinition[] = [
  /* ──────────── 1. Ohm's Law ──────────── */
  {
    id: 'exp-ohms-law',
    simulationId: 'builtin-ohms-law',
    title: "Ohm's Law — V = IR",
    titleHi: 'ओम का नियम — V = IR',
    chapterRef: 'Ch 12: Electricity',
    grades: ['10', '11', '12'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective:
      'Verify Ohm\'s Law by varying voltage and resistance in a circuit, recording current values, and plotting V-I characteristics.',
    objectiveHi:
      'परिपथ में वोल्टेज और प्रतिरोध बदलकर ओम के नियम की पुष्टि करें, धारा के मान रिकॉर्ड करें और V-I ग्राफ़ बनाएं।',
    materials: ['Ammeter', 'Voltmeter', 'Resistor (fixed)', 'Battery', 'Connecting wires'],
    observations: [
      {
        prompt: 'What happens to current when you increase voltage (keeping resistance fixed)?',
        promptHi: 'जब आप वोल्टेज बढ़ाते हैं (प्रतिरोध स्थिर रखते हुए) तो धारा पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['Current increases', 'Current decreases', 'Current stays same'],
        expectedHint: 'Current is directly proportional to voltage (I = V/R)',
      },
      {
        prompt: 'What happens to current when you increase resistance (keeping voltage fixed)?',
        promptHi: 'जब आप प्रतिरोध बढ़ाते हैं (वोल्टेज स्थिर रखते हुए) तो धारा पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['Current increases', 'Current decreases', 'Current stays same'],
        expectedHint: 'Current is inversely proportional to resistance (I = V/R)',
      },
      {
        prompt: 'Write the relationship you observe between V, I, and R.',
        promptHi: 'V, I और R के बीच जो संबंध आपने देखा, वह लिखें।',
        type: 'text',
        expectedHint: 'V = I × R (Ohm\'s Law)',
      },
    ],
    dataTable: {
      columns: ['Voltage (V)', 'Resistance (Ω)', 'Current (A)', 'V/I ratio'],
      rows: 5,
    },
    conclusionPrompt:
      'Based on your data, state Ohm\'s Law in your own words. Is the V-I relationship linear? What does the slope represent?',
    conclusionPromptHi:
      'अपने डेटा के आधार पर ओम का नियम अपने शब्दों में लिखें। क्या V-I संबंध रैखिक है? ढलान क्या दर्शाती है?',
    quizQuestions: [
      {
        question: 'If V = 12V and R = 4Ω, what is the current?',
        questionHi: 'यदि V = 12V और R = 4Ω है, तो धारा कितनी होगी?',
        options: ['2 A', '3 A', '4 A', '48 A'],
        correctIndex: 1,
        explanation: 'I = V/R = 12/4 = 3 A',
      },
      {
        question: 'The V-I graph for an ohmic conductor is:',
        questionHi: 'ओमीय चालक के लिए V-I ग्राफ़ होता है:',
        options: ['A straight line through origin', 'A curve', 'A horizontal line', 'A vertical line'],
        correctIndex: 0,
        explanation: 'For an ohmic conductor, V is directly proportional to I, giving a straight line through the origin. The slope equals resistance.',
      },
      {
        question: 'Doubling the resistance while keeping voltage constant will:',
        questionHi: 'वोल्टेज स्थिर रखते हुए प्रतिरोध दोगुना करने पर:',
        options: ['Double the current', 'Halve the current', 'No change in current', 'Quadruple the current'],
        correctIndex: 1,
        explanation: 'I = V/R. If R doubles, I becomes half (inversely proportional).',
      },
    ],
  },

  /* ──────────── 2. pH Scale ──────────── */
  {
    id: 'exp-ph-scale',
    simulationId: 'builtin-ph-scale',
    title: 'Acids, Bases & the pH Scale',
    titleHi: 'अम्ल, क्षार और pH स्केल',
    chapterRef: 'Ch 2: Acids, Bases and Salts',
    grades: ['7', '8', '9', '10'],
    subject: 'chemistry',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Classify common substances as acidic, basic, or neutral using the pH scale, and observe indicator colour changes.',
    objectiveHi:
      'pH स्केल का उपयोग करके सामान्य पदार्थों को अम्लीय, क्षारीय या उदासीन के रूप में वर्गीकृत करें और सूचक के रंग परिवर्तन देखें।',
    observations: [
      {
        prompt: 'What is the pH of lemon juice? Is it acidic or basic?',
        promptHi: 'नींबू के रस का pH कितना है? क्या यह अम्लीय है या क्षारीय?',
        type: 'text',
        expectedHint: 'pH around 2 — strongly acidic',
      },
      {
        prompt: 'What pH value is considered neutral?',
        promptHi: 'कौन सा pH मान उदासीन माना जाता है?',
        type: 'number',
        expectedHint: 'pH 7 is neutral (pure water)',
      },
      {
        prompt: 'What colour does litmus paper turn in an acid?',
        promptHi: 'अम्ल में लिटमस पत्र किस रंग का हो जाता है?',
        type: 'select',
        options: ['Red', 'Blue', 'Green', 'No change'],
        expectedHint: 'Blue litmus turns red in acid',
      },
    ],
    dataTable: {
      columns: ['Substance', 'pH Value', 'Acidic / Basic / Neutral', 'Indicator Colour'],
      rows: 5,
    },
    conclusionPrompt:
      'Summarise the pH ranges for acids, bases, and neutral substances. Why is pH important in daily life?',
    conclusionPromptHi:
      'अम्ल, क्षार और उदासीन पदार्थों की pH सीमा का सारांश लिखें। दैनिक जीवन में pH क्यों महत्वपूर्ण है?',
    quizQuestions: [
      {
        question: 'Which pH range indicates a strong acid?',
        questionHi: 'कौन सी pH सीमा प्रबल अम्ल दर्शाती है?',
        options: ['0–3', '5–7', '7–9', '11–14'],
        correctIndex: 0,
        explanation: 'pH 0-3 indicates strong acids. Lower pH = stronger acid.',
      },
      {
        question: 'What is the pH of pure water?',
        questionHi: 'शुद्ध पानी का pH कितना होता है?',
        options: ['0', '5', '7', '14'],
        correctIndex: 2,
        explanation: 'Pure water is neutral with pH = 7.',
      },
      {
        question: 'Baking soda (sodium bicarbonate) is:',
        questionHi: 'बेकिंग सोडा (सोडियम बाइकार्बोनेट) है:',
        options: ['Strongly acidic', 'Weakly acidic', 'Neutral', 'Mildly basic'],
        correctIndex: 3,
        explanation: 'Baking soda has pH ~8.3, making it mildly basic (alkaline).',
      },
    ],
  },

  /* ──────────── 3. Linear Equations ──────────── */
  {
    id: 'exp-linear-graph',
    simulationId: 'builtin-linear-graph',
    title: 'Linear Equations — y = mx + c',
    titleHi: 'रैखिक समीकरण — y = mx + c',
    chapterRef: 'Ch 4: Linear Equations in Two Variables',
    grades: ['8', '9', '10'],
    subject: 'math',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Explore how slope (m) and y-intercept (c) affect the graph of a linear equation. Compare parallel and intersecting lines.',
    objectiveHi:
      'ढलान (m) और y-अंतःखंड (c) रैखिक समीकरण के ग्राफ़ को कैसे प्रभावित करते हैं, यह जानें। समानांतर और प्रतिच्छेदी रेखाओं की तुलना करें।',
    observations: [
      {
        prompt: 'What does "m" (slope) control in the graph?',
        promptHi: '"m" (ढलान) ग्राफ़ में क्या नियंत्रित करता है?',
        type: 'select',
        options: ['Steepness / angle of line', 'Where line crosses y-axis', 'Length of line', 'Colour of line'],
        expectedHint: 'm controls the steepness — larger |m| = steeper line',
      },
      {
        prompt: 'What does "c" (y-intercept) control?',
        promptHi: '"c" (y-अंतःखंड) क्या नियंत्रित करता है?',
        type: 'select',
        options: ['Steepness of line', 'Where line crosses y-axis', 'Where line crosses x-axis', 'Line thickness'],
        expectedHint: 'c shifts the line up/down — it\'s where the line crosses the y-axis',
      },
      {
        prompt: 'Set two lines with the same slope but different intercepts. What do you observe?',
        promptHi: 'दो रेखाओं को एक ही ढलान लेकिन अलग-अलग अंतःखंड से सेट करें। आप क्या देखते हैं?',
        type: 'text',
        expectedHint: 'Lines with same slope are parallel — they never meet!',
      },
    ],
    conclusionPrompt:
      'Explain in your own words what slope and y-intercept mean. When are two lines parallel? When do they intersect?',
    conclusionPromptHi:
      'अपने शब्दों में बताएं कि ढलान और y-अंतःखंड का क्या अर्थ है। दो रेखाएं कब समानांतर होती हैं? कब प्रतिच्छेद करती हैं?',
    quizQuestions: [
      {
        question: 'What is the slope of the line y = 3x + 5?',
        questionHi: 'रेखा y = 3x + 5 का ढलान क्या है?',
        options: ['5', '3', '8', '15'],
        correctIndex: 1,
        explanation: 'In y = mx + c, m is the slope. Here m = 3.',
      },
      {
        question: 'Two lines y = 2x + 1 and y = 2x - 3 are:',
        questionHi: 'दो रेखाएं y = 2x + 1 और y = 2x - 3 हैं:',
        options: ['Intersecting', 'Parallel', 'Perpendicular', 'Same line'],
        correctIndex: 1,
        explanation: 'Both have slope m = 2 but different intercepts, so they are parallel.',
      },
      {
        question: 'The y-intercept of y = -4x + 7 is:',
        questionHi: 'y = -4x + 7 का y-अंतःखंड है:',
        options: ['-4', '4', '7', '-7'],
        correctIndex: 2,
        explanation: 'The y-intercept is the value of c in y = mx + c. Here c = 7, so the line crosses the y-axis at (0, 7).',
      },
    ],
  },

  /* ──────────── 4. Newton's Laws ──────────── */
  {
    id: 'exp-newton-laws',
    simulationId: 'builtin-newton-laws',
    title: "Newton's Second Law — F = ma",
    titleHi: 'न्यूटन का दूसरा नियम — F = ma',
    chapterRef: 'Ch 9: Force and Laws of Motion',
    grades: ['9', '10', '11'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective:
      'Investigate how force and mass affect acceleration. Verify F = ma by collecting data and observing free body diagrams.',
    objectiveHi:
      'जांचें कि बल और द्रव्यमान त्वरण को कैसे प्रभावित करते हैं। डेटा एकत्र करके और मुक्त पिंड आरेख देखकर F = ma की पुष्टि करें।',
    materials: ['Block', 'Spring balance (force meter)', 'Surface with adjustable friction'],
    observations: [
      {
        prompt: 'Double the force with the same mass. What happens to acceleration?',
        promptHi: 'समान द्रव्यमान के साथ बल दोगुना करें। त्वरण पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['Acceleration doubles', 'Acceleration halves', 'No change', 'Acceleration quadruples'],
        expectedHint: 'a = F/m — doubling F doubles a',
      },
      {
        prompt: 'Double the mass with the same force. What happens to acceleration?',
        promptHi: 'समान बल के साथ द्रव्यमान दोगुना करें। त्वरण पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['Acceleration doubles', 'Acceleration halves', 'No change', 'Acceleration quadruples'],
        expectedHint: 'a = F/m — doubling m halves a',
      },
      {
        prompt: 'What effect does friction have on the net force?',
        promptHi: 'घर्षण का नेट बल पर क्या प्रभाव होता है?',
        type: 'text',
        expectedHint: 'Friction opposes motion, reducing net force and hence acceleration',
      },
    ],
    dataTable: {
      columns: ['Force (N)', 'Mass (kg)', 'Acceleration (m/s²)', 'F/a ratio'],
      rows: 5,
    },
    conclusionPrompt:
      'State Newton\'s Second Law. How does the F/a ratio compare to mass in your data table?',
    conclusionPromptHi:
      'न्यूटन का दूसरा नियम लिखें। आपकी डेटा तालिका में F/a अनुपात की तुलना द्रव्यमान से कैसे होती है?',
    quizQuestions: [
      {
        question: 'A 5 kg block is pushed with 20 N force. What is its acceleration?',
        questionHi: '5 kg के ब्लॉक पर 20 N का बल लगाया जाता है। इसका त्वरण कितना होगा?',
        options: ['2 m/s²', '4 m/s²', '100 m/s²', '0.25 m/s²'],
        correctIndex: 1,
        explanation: 'a = F/m = 20/5 = 4 m/s²',
      },
      {
        question: 'Newton\'s First Law is also called:',
        questionHi: 'न्यूटन के प्रथम नियम को यह भी कहते हैं:',
        options: ['Law of acceleration', 'Law of inertia', 'Law of action-reaction', 'Law of gravitation'],
        correctIndex: 1,
        explanation: 'Newton\'s First Law states that a body continues in its state of rest or uniform motion unless acted upon by an external force — this is the Law of Inertia.',
      },
      {
        question: 'If F = ma, then the SI unit of force is:',
        questionHi: 'यदि F = ma है, तो बल का SI मात्रक है:',
        options: ['kg', 'm/s²', 'Newton (kg·m/s²)', 'Joule'],
        correctIndex: 2,
        explanation: 'Force = mass × acceleration. SI unit: kg × m/s² = Newton (N).',
      },
    ],
  },

  /* ──────────── 5. Pendulum — Period & Gravity ──────────── */
  {
    id: 'exp-pendulum',
    simulationId: 'builtin-pendulum',
    title: 'Simple Pendulum — What Controls the Period?',
    titleHi: 'सरल लोलक — आवर्तकाल किससे नियंत्रित होता है?',
    chapterRef: 'Ch 11: Sound (Oscillations)',
    grades: ['9', '10', '11'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'analyze',
    estimatedMinutes: 12,
    objective:
      'Determine which factors (length, mass, angle, gravity) affect the time period of a simple pendulum by systematic experimentation.',
    objectiveHi:
      'व्यवस्थित प्रयोग द्वारा ज्ञात करें कि कौन से कारक (लंबाई, द्रव्यमान, कोण, गुरुत्व) सरल लोलक के आवर्तकाल को प्रभावित करते हैं।',
    materials: ['Pendulum bob', 'String (variable length)', 'Stopwatch', 'Protractor'],
    observations: [
      {
        prompt: 'Change only the length. Does the period increase or decrease with longer string?',
        promptHi: 'केवल लंबाई बदलें। लंबी डोरी से आवर्तकाल बढ़ता है या घटता है?',
        type: 'select',
        options: ['Period increases', 'Period decreases', 'No change'],
        expectedHint: 'T = 2π√(L/g) — longer L → longer period',
      },
      {
        prompt: 'Change only the angle (small angles). Does the period change?',
        promptHi: 'केवल कोण बदलें (छोटे कोणों पर)। क्या आवर्तकाल बदलता है?',
        type: 'select',
        options: ['Period increases a lot', 'Period decreases a lot', 'Almost no change for small angles'],
        expectedHint: 'For small angles (<15°), the period is nearly independent of amplitude',
      },
      {
        prompt: 'Record the period for 3 different lengths (measure 10 swings, divide by 10).',
        promptHi: '3 अलग-अलग लंबाइयों के लिए आवर्तकाल रिकॉर्ड करें (10 दोलन मापें, 10 से भाग दें)।',
        type: 'text',
        expectedHint: 'E.g., L=25cm → T≈1.0s, L=50cm → T≈1.4s, L=100cm → T≈2.0s',
      },
    ],
    dataTable: {
      columns: ['Length (cm)', 'Time for 10 swings (s)', 'Period T (s)', 'T² (s²)'],
      rows: 5,
    },
    conclusionPrompt:
      'Plot T² vs L. What shape is the graph? What does this tell you about the relationship between period and length?',
    conclusionPromptHi:
      'T² बनाम L का ग्राफ़ बनाएं। ग्राफ़ किस आकार का है? यह आवर्तकाल और लंबाई के संबंध के बारे में क्या बताता है?',
    quizQuestions: [
      {
        question: 'The period of a simple pendulum depends on:',
        questionHi: 'सरल लोलक का आवर्तकाल किस पर निर्भर करता है?',
        options: ['Mass of bob', 'Amplitude (small angles)', 'Length and gravity', 'Colour of bob'],
        correctIndex: 2,
        explanation: 'T = 2π√(L/g). Period depends only on length and gravitational acceleration, not mass or small-angle amplitude.',
      },
      {
        question: 'If the length is made 4 times longer, the period becomes:',
        questionHi: 'यदि लंबाई 4 गुनी कर दी जाए, तो आवर्तकाल हो जाता है:',
        options: ['4 times', '2 times', '½ times', '16 times'],
        correctIndex: 1,
        explanation: 'T ∝ √L. If L becomes 4L, T becomes √4 = 2 times the original period.',
      },
      {
        question: 'On the Moon (g = 1.6 m/s²), a pendulum\'s period will:',
        questionHi: 'चंद्रमा पर (g = 1.6 m/s²), लोलक का आवर्तकाल:',
        options: ['Decrease', 'Stay the same', 'Increase', 'Become zero'],
        correctIndex: 2,
        explanation: 'T = 2π√(L/g). Lower g → larger T. The pendulum swings slower on the Moon.',
      },
    ],
  },
];

/* ─── Helper ─── */

/**
 * Find a guided experiment definition matching a simulation ID and grade.
 * Returns undefined if no experiment exists for that sim+grade combo.
 */
export function getExperimentForSimulation(
  simulationId: string,
  grade: string
): ExperimentDefinition | undefined {
  return GUIDED_EXPERIMENTS.find(
    exp => exp.simulationId === simulationId && exp.grades.includes(grade)
  );
}

/**
 * Get all experiments available for a specific grade and (optionally) subject.
 */
export function getExperimentsForGrade(
  grade: string,
  subject?: string
): ExperimentDefinition[] {
  return GUIDED_EXPERIMENTS.filter(exp => {
    if (!exp.grades.includes(grade)) return false;
    if (subject && subject !== 'all' && exp.subject !== subject) return false;
    return true;
  });
}
