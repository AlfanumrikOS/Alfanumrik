/**
 * STEM Centre — Guided Experiment Definitions
 *
 * Each experiment wraps a built-in simulation (or a future DB simulation)
 * with structured observations, data recording, and viva-style quiz questions.
 *
 * Grade format: string "6"–"12" (Product Invariant P5).
 * Hindi translations are manual, not machine-translated.
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
  simulationId: string; // matches BuiltInSimulation.id or DB sim ID
  title: string;
  titleHi: string;
  chapterRef: string;
  grades: string[]; // e.g., ["8", "9", "10"]
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
    title: "Ohm's Law: Voltage, Current & Resistance",
    titleHi: 'ओम का नियम: वोल्टेज, धारा और प्रतिरोध',
    chapterRef: 'Class 10 Science Ch 12 — Electricity',
    grades: ['10', '11', '12'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 15,
    objective:
      "Verify Ohm's Law by varying voltage across a fixed resistor and measuring current. Establish the linear relationship V = IR and plot the V-I graph.",
    objectiveHi:
      'एक निश्चित प्रतिरोध पर वोल्टेज बदलकर धारा मापें और ओम के नियम V = IR को सत्यापित करें। V-I ग्राफ़ बनाएँ।',
    materials: [
      'Ammeter',
      'Voltmeter',
      'Rheostat',
      'Resistor (known value)',
      'Battery / Power supply',
      'Connecting wires',
      'Key (switch)',
    ],
    observations: [
      {
        prompt:
          'What happens to current when you increase voltage while keeping resistance constant?',
        promptHi:
          'जब प्रतिरोध स्थिर रखते हुए वोल्टेज बढ़ाते हैं तो धारा पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: [
          'Current increases',
          'Current decreases',
          'Current stays the same',
          'Current becomes zero',
        ],
        expectedHint:
          'Current increases proportionally with voltage (V = IR).',
      },
      {
        prompt:
          'What is the mathematical relationship between V and I for a fixed resistance?',
        promptHi:
          'निश्चित प्रतिरोध के लिए V और I के बीच गणितीय संबंध क्या है?',
        type: 'text',
        expectedHint:
          'V = IR, i.e., voltage is directly proportional to current.',
      },
      {
        prompt:
          'If you double the resistance while keeping voltage constant, what happens to the current?',
        promptHi:
          'यदि वोल्टेज स्थिर रखते हुए प्रतिरोध दोगुना कर दें तो धारा पर क्या प्रभाव होगा?',
        type: 'select',
        options: [
          'Current doubles',
          'Current halves',
          'Current stays the same',
          'Current becomes zero',
        ],
        expectedHint: 'Current becomes half (I = V/R).',
      },
      {
        prompt:
          'Record the slope of the V-I graph. What does it represent?',
        promptHi:
          'V-I ग्राफ़ का ढलान (slope) नोट करें। यह किसे दर्शाता है?',
        type: 'text',
        expectedHint: 'The slope of V vs I graph equals the resistance (R).',
      },
    ],
    dataTable: {
      columns: [
        'S.No.',
        'Voltage (V)',
        'Current (A)',
        'Resistance R = V/I (Ω)',
      ],
      rows: 5,
    },
    conclusionPrompt:
      "Based on your observations and the data table, state Ohm's Law in your own words. Was the V-I graph a straight line? What does the slope represent?",
    conclusionPromptHi:
      'अपने प्रेक्षणों और डेटा तालिका के आधार पर ओम का नियम अपने शब्दों में लिखें। क्या V-I ग्राफ़ एक सरल रेखा था? ढलान क्या दर्शाता है?',
    quizQuestions: [
      {
        question:
          'A resistor of 5 Ω is connected to a 10 V battery. What is the current flowing through it?',
        questionHi:
          '5 Ω का प्रतिरोध 10 V की बैटरी से जुड़ा है। इसमें प्रवाहित धारा कितनी होगी?',
        options: ['0.5 A', '2 A', '50 A', '15 A'],
        correctIndex: 1,
        explanation: "Using Ohm's Law: I = V/R = 10/5 = 2 A.",
      },
      {
        question: 'The V-I graph for an ohmic conductor is:',
        questionHi: 'ओमीय चालक का V-I ग्राफ़ होता है:',
        options: [
          'A straight line passing through the origin',
          'A curve',
          'A horizontal line',
          'A vertical line',
        ],
        correctIndex: 0,
        explanation:
          'For an ohmic conductor, V is directly proportional to I, giving a straight line through the origin with slope = R.',
      },
      {
        question:
          'If the resistance in a circuit is doubled and voltage is kept the same, the current will:',
        questionHi:
          'यदि परिपथ में प्रतिरोध दोगुना कर दिया जाए और वोल्टेज वही रहे, तो धारा:',
        options: ['Double', 'Become half', 'Remain the same', 'Become zero'],
        correctIndex: 1,
        explanation: 'I = V/R. If R doubles, I becomes half.',
      },
    ],
  },

  /* ──────────── 2. Photosynthesis ──────────── */
  {
    id: 'exp-photosynthesis',
    simulationId: 'builtin-photosynthesis',
    title: 'Photosynthesis: Light, CO\u2082 and Glucose',
    titleHi: 'प्रकाश संश्लेषण: प्रकाश, CO\u2082 और ग्लूकोज़',
    chapterRef:
      'Class 7 Science Ch 1 — Nutrition in Plants / Class 10 Science Ch 6 — Life Processes',
    grades: ['7', '8', '9', '10'],
    subject: 'biology',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective:
      'Explore how light intensity, CO\u2082 concentration, and water availability affect the rate of photosynthesis and glucose production.',
    objectiveHi:
      'जानें कि प्रकाश की तीव्रता, CO\u2082 की सांद्रता और जल की उपलब्धता प्रकाश संश्लेषण की दर और ग्लूकोज़ उत्पादन को कैसे प्रभावित करती है।',
    materials: [
      'Hydrilla plant (aquatic)',
      'Beaker with water',
      'Funnel',
      'Test tube',
      'Sodium bicarbonate (NaHCO\u2083)',
      'Light source',
    ],
    observations: [
      {
        prompt:
          'Which input — light, CO\u2082, or water — increases glucose production the most when doubled?',
        promptHi:
          'कौन सा कारक — प्रकाश, CO\u2082 या जल — दोगुना करने पर ग्लूकोज़ उत्पादन सबसे अधिक बढ़ाता है?',
        type: 'select',
        options: ['Light', 'CO\u2082', 'Water', 'All equally'],
        expectedHint:
          'Light is typically the limiting factor at normal CO\u2082 levels.',
      },
      {
        prompt:
          'What happens to glucose output when light is removed completely?',
        promptHi:
          'जब प्रकाश पूरी तरह हटा दिया जाए तो ग्लूकोज़ उत्पादन पर क्या प्रभाव होता है?',
        type: 'select',
        options: [
          'Glucose production stops',
          'Glucose production continues at half rate',
          'Glucose increases',
          'No effect',
        ],
        expectedHint:
          'Photosynthesis requires light energy; without it, the light reactions cannot occur.',
      },
      {
        prompt:
          'What gas is released as a byproduct? How can you test for it?',
        promptHi:
          'उपोत्पाद के रूप में कौन सी गैस निकलती है? इसकी जाँच कैसे करेंगे?',
        type: 'text',
        expectedHint:
          'Oxygen (O\u2082) is released. It can be tested with a glowing splint which relights.',
      },
      {
        prompt:
          'Write the balanced chemical equation for photosynthesis.',
        promptHi:
          'प्रकाश संश्लेषण का संतुलित रासायनिक समीकरण लिखें।',
        type: 'text',
        expectedHint:
          '6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082 (in the presence of sunlight and chlorophyll).',
      },
    ],
    conclusionPrompt:
      'Summarise which factors affect the rate of photosynthesis and explain why light is often the limiting factor in nature.',
    conclusionPromptHi:
      'संक्षेप में बताएँ कि कौन से कारक प्रकाश संश्लेषण की दर को प्रभावित करते हैं और प्रकृति में प्रकाश अक्सर सीमाकारी कारक क्यों होता है।',
    quizQuestions: [
      {
        question:
          'The correct balanced equation for photosynthesis is:',
        questionHi:
          'प्रकाश संश्लेषण का सही संतुलित समीकरण है:',
        options: [
          '6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082',
          'C\u2086H\u2081\u2082O\u2086 + 6O\u2082 \u2192 6CO\u2082 + 6H\u2082O',
          'CO\u2082 + H\u2082O \u2192 CH\u2082O + O\u2082',
          '6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 12O\u2082',
        ],
        correctIndex: 0,
        explanation:
          '6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082 is the standard simplified equation used in CBSE.',
      },
      {
        question:
          'Which pigment in leaves absorbs sunlight for photosynthesis?',
        questionHi:
          'पत्तियों में कौन सा वर्णक प्रकाश संश्लेषण के लिए सूर्य का प्रकाश अवशोषित करता है?',
        options: ['Haemoglobin', 'Chlorophyll', 'Melanin', 'Carotene'],
        correctIndex: 1,
        explanation:
          'Chlorophyll (found in chloroplasts) absorbs mainly red and blue light, reflecting green.',
      },
      {
        question:
          'Photosynthesis occurs in which part of the plant cell?',
        questionHi:
          'प्रकाश संश्लेषण पादप कोशिका के किस भाग में होता है?',
        options: ['Mitochondria', 'Chloroplast', 'Nucleus', 'Ribosome'],
        correctIndex: 1,
        explanation:
          'Chloroplasts contain chlorophyll and are the site of photosynthesis. Mitochondria are for cellular respiration.',
      },
    ],
  },

  /* ──────────── 3. Acid-Base pH Scale ──────────── */
  {
    id: 'exp-ph-scale',
    simulationId: 'builtin-ph-scale',
    title: 'Acids, Bases & the pH Scale',
    titleHi: 'अम्ल, क्षार और pH पैमाना',
    chapterRef: 'Class 10 Science Ch 2 — Acids, Bases and Salts',
    grades: ['7', '8', '9', '10'],
    subject: 'chemistry',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective:
      'Classify common substances as acidic, basic, or neutral using the pH scale. Observe indicator colour changes and understand neutralisation.',
    objectiveHi:
      'pH पैमाने का उपयोग करके सामान्य पदार्थों को अम्लीय, क्षारीय या उदासीन के रूप में वर्गीकृत करें। सूचक के रंग परिवर्तन और उदासीनीकरण को समझें।',
    materials: [
      'pH paper / Universal indicator',
      'Test tubes',
      'Dropper',
      'Dilute HCl',
      'Dilute NaOH',
      'Lemon juice',
      'Baking soda solution',
      'Distilled water',
    ],
    observations: [
      {
        prompt:
          'What colour does the indicator show at pH 1 (strong acid) vs pH 14 (strong base)?',
        promptHi:
          'pH 1 (प्रबल अम्ल) और pH 14 (प्रबल क्षार) पर सूचक किस रंग का दिखता है?',
        type: 'text',
        expectedHint: 'pH 1 \u2192 red; pH 14 \u2192 dark blue/violet.',
      },
      {
        prompt: 'What is the pH of a neutral substance?',
        promptHi: 'उदासीन पदार्थ का pH कितना होता है?',
        type: 'number',
        expectedHint: 'pH 7 is neutral (pure water).',
      },
      {
        prompt:
          'Arrange these in order of increasing pH: lemon juice, blood, stomach acid, soap solution.',
        promptHi:
          'इन्हें बढ़ते pH के क्रम में लिखें: नींबू का रस, रक्त, पेट का अम्ल, साबुन का घोल।',
        type: 'text',
        expectedHint:
          'Stomach acid (~1.5) < Lemon juice (~2.5) < Blood (~7.4) < Soap solution (~9\u201310).',
      },
      {
        prompt:
          'What happens to pH when you add a base to an acidic solution gradually?',
        promptHi:
          'जब अम्लीय विलयन में धीरे-धीरे क्षार मिलाया जाता है तो pH पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: [
          'pH increases',
          'pH decreases',
          'pH stays the same',
          'pH oscillates',
        ],
        expectedHint:
          'pH increases as the solution becomes less acidic, passes through 7 (neutralisation), then becomes basic.',
      },
    ],
    dataTable: {
      columns: [
        'S.No.',
        'Solution',
        'pH Value',
        'Indicator Colour',
        'Acidic / Basic / Neutral',
      ],
      rows: 4,
    },
    conclusionPrompt:
      'Explain what the pH scale measures. Why is it important that our blood maintains a pH close to 7.4?',
    conclusionPromptHi:
      'बताएँ कि pH पैमाना क्या मापता है। हमारे रक्त का pH 7.4 के आसपास बना रहना क्यों ज़रूरी है?',
    quizQuestions: [
      {
        question: 'Which of the following has the lowest pH?',
        questionHi: 'निम्नलिखित में से किसका pH सबसे कम है?',
        options: [
          'Pure water',
          'Lemon juice',
          'Blood',
          'Baking soda solution',
        ],
        correctIndex: 1,
        explanation:
          'Lemon juice has a pH of about 2.5, which is the most acidic option listed.',
      },
      {
        question: 'A solution with pH = 7 is:',
        questionHi: 'pH = 7 वाला विलयन होता है:',
        options: [
          'Strongly acidic',
          'Weakly acidic',
          'Neutral',
          'Strongly basic',
        ],
        correctIndex: 2,
        explanation:
          'pH 7 is neutral \u2014 neither acidic nor basic. Pure water at 25\u00b0C has pH 7.',
      },
      {
        question:
          'When an acid reacts with a base, the reaction is called:',
        questionHi:
          'जब अम्ल क्षार से अभिक्रिया करता है, तो इस अभिक्रिया को कहते हैं:',
        options: [
          'Oxidation',
          'Neutralisation',
          'Decomposition',
          'Displacement',
        ],
        correctIndex: 1,
        explanation:
          'Acid + Base \u2192 Salt + Water. This is a neutralisation reaction.',
      },
    ],
  },

  /* ──────────── 4. Linear Equations: y = mx + c ──────────── */
  {
    id: 'exp-linear-equations',
    simulationId: 'builtin-linear-graph',
    title: 'Linear Equations: Slope & Intercept',
    titleHi: 'रैखिक समीकरण: ढलान और अंतःखंड',
    chapterRef: 'Class 9 Maths Ch 4 — Linear Equations in Two Variables',
    grades: ['8', '9', '10'],
    subject: 'math',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective:
      'Explore how the slope (m) and y-intercept (c) control the graph of y = mx + c. Understand what parallel and perpendicular lines look like.',
    objectiveHi:
      'जानें कि ढलान (m) और y-अंतःखंड (c) रैखिक समीकरण y = mx + c के ग्राफ़ को कैसे नियंत्रित करते हैं। समांतर और लम्बवत रेखाओं को पहचानें।',
    observations: [
      {
        prompt:
          'What does the value of m (slope) control in the graph?',
        promptHi:
          'ग्राफ़ में m (ढलान) का मान किसे नियंत्रित करता है?',
        type: 'select',
        options: [
          'Steepness and direction of the line',
          'Where the line crosses the y-axis',
          'The length of the line',
          'The colour of the line',
        ],
        expectedHint:
          'm controls how steep the line is and whether it goes up (positive) or down (negative).',
      },
      {
        prompt: 'What does the value of c (y-intercept) control?',
        promptHi: 'c (y-अंतःखंड) का मान किसे नियंत्रित करता है?',
        type: 'select',
        options: [
          'Steepness of the line',
          'Where the line crosses the y-axis',
          'Where the line crosses the x-axis',
          'The slope of the line',
        ],
        expectedHint:
          "c tells you where the line crosses the y-axis (the point (0, c)).",
      },
      {
        prompt:
          'Set m = 0. What kind of line do you get? What is its equation?',
        promptHi:
          'm = 0 रखें। कैसी रेखा बनती है? इसका समीकरण क्या है?',
        type: 'text',
        expectedHint: 'A horizontal line: y = c.',
      },
      {
        prompt:
          'Graph y = 2x + 1 and y = 2x \u2212 3. What do you notice about these two lines?',
        promptHi:
          'y = 2x + 1 और y = 2x \u2212 3 का ग्राफ़ बनाएँ। इन दोनों रेखाओं में क्या समानता है?',
        type: 'text',
        expectedHint:
          'They are parallel \u2014 same slope (m = 2) but different y-intercepts.',
      },
    ],
    conclusionPrompt:
      'Explain in your own words how m and c together determine the position and direction of a straight line on the coordinate plane.',
    conclusionPromptHi:
      'अपने शब्दों में बताएँ कि m और c मिलकर निर्देशांक तल पर सरल रेखा की स्थिति और दिशा कैसे निर्धारित करते हैं।',
    quizQuestions: [
      {
        question: 'What is the slope of the line y = \u22123x + 5?',
        questionHi: 'रेखा y = \u22123x + 5 का ढलान (slope) कितना है?',
        options: ['5', '\u22123', '3', '\u22125'],
        correctIndex: 1,
        explanation:
          'In y = mx + c, the coefficient of x is the slope. Here m = \u22123.',
      },
      {
        question:
          'Two lines y = 4x + 1 and y = 4x \u2212 7 are:',
        questionHi:
          'दो रेखाएँ y = 4x + 1 और y = 4x \u2212 7 हैं:',
        options: [
          'Perpendicular',
          'Parallel',
          'Intersecting at origin',
          'The same line',
        ],
        correctIndex: 1,
        explanation:
          'Both lines have the same slope (m = 4) but different intercepts, so they are parallel and never intersect.',
      },
      {
        question:
          'The y-intercept of the line y = 7x \u2212 2 is:',
        questionHi:
          'रेखा y = 7x \u2212 2 का y-अंतःखंड है:',
        options: ['7', '\u22122', '2', '\u22127'],
        correctIndex: 1,
        explanation:
          'The y-intercept is the value of c in y = mx + c. Here c = \u22122, meaning the line crosses the y-axis at (0, \u22122).',
      },
    ],
  },

  /* ──────────── 5. Human Heart & Double Circulation ──────────── */
  {
    id: 'exp-human-heart',
    simulationId: 'builtin-human-heart',
    title: 'The Human Heart & Double Circulation',
    titleHi: 'मानव हृदय और दोहरा परिसंचरण',
    chapterRef: 'Class 10 Science Ch 6 — Life Processes',
    grades: ['10', '11', '12'],
    subject: 'biology',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedMinutes: 15,
    objective:
      'Trace the path of blood through the four chambers of the heart. Understand why humans have double circulation (pulmonary + systemic) and the role of valves.',
    objectiveHi:
      'हृदय के चार कक्षों से होकर रक्त के मार्ग का पता लगाएँ। समझें कि मनुष्यों में दोहरा परिसंचरण (फुफ्फुसीय + दैहिक) क्यों होता है और वाल्वों की भूमिका क्या है।',
    materials: [
      'Heart model or chart',
      'Colour pencils (red and blue)',
      'Diagram sheet',
    ],
    observations: [
      {
        prompt:
          'Trace the complete path of blood starting from the right atrium. List the four chambers in order.',
        promptHi:
          'दाएँ आलिंद से शुरू करते हुए रक्त का पूरा मार्ग बताएँ। चारों कक्षों को क्रम में लिखें।',
        type: 'text',
        expectedHint:
          'Right atrium \u2192 Right ventricle \u2192 Lungs (oxygenation) \u2192 Left atrium \u2192 Left ventricle \u2192 Body.',
      },
      {
        prompt: 'Which chamber pumps blood to the lungs?',
        promptHi: 'कौन सा कक्ष फेफड़ों को रक्त भेजता है?',
        type: 'select',
        options: [
          'Right atrium',
          'Right ventricle',
          'Left atrium',
          'Left ventricle',
        ],
        expectedHint:
          'The right ventricle pumps deoxygenated blood to the lungs via the pulmonary artery.',
      },
      {
        prompt:
          'Why is the wall of the left ventricle thicker than the right ventricle?',
        promptHi:
          'बाएँ निलय की दीवार दाएँ निलय से मोटी क्यों होती है?',
        type: 'text',
        expectedHint:
          'The left ventricle pumps blood to the entire body (systemic circulation), requiring more force than pumping to the nearby lungs.',
      },
      {
        prompt: 'What is the function of valves in the heart?',
        promptHi: 'हृदय में वाल्वों (कपाटों) का क्या कार्य है?',
        type: 'text',
        expectedHint:
          'Valves prevent the backflow of blood, ensuring one-directional flow through the heart.',
      },
    ],
    conclusionPrompt:
      'Explain why double circulation is necessary in mammals. What advantage does separating oxygenated and deoxygenated blood provide?',
    conclusionPromptHi:
      'स्तनधारियों में दोहरा परिसंचरण क्यों आवश्यक है? ऑक्सीजनयुक्त और ऑक्सीजनरहित रक्त को अलग रखने से क्या लाभ है, समझाएँ।',
    quizQuestions: [
      {
        question:
          'Which blood vessel carries oxygenated blood from the lungs to the heart?',
        questionHi:
          'कौन सी रक्त वाहिका फेफड़ों से ऑक्सीजनयुक्त रक्त हृदय तक ले जाती है?',
        options: [
          'Pulmonary artery',
          'Pulmonary vein',
          'Aorta',
          'Vena cava',
        ],
        correctIndex: 1,
        explanation:
          'The pulmonary vein carries oxygenated blood from the lungs to the left atrium. This is the only vein that carries oxygenated blood.',
      },
      {
        question:
          'Double circulation means blood passes through the heart ___ time(s) in one complete cycle.',
        questionHi:
          'दोहरे परिसंचरण का अर्थ है कि एक पूर्ण चक्र में रक्त हृदय से ___ बार गुज़रता है।',
        options: ['One', 'Two', 'Three', 'Four'],
        correctIndex: 1,
        explanation:
          'In double circulation, blood passes through the heart twice: once for pulmonary circulation (heart \u2192 lungs \u2192 heart) and once for systemic circulation (heart \u2192 body \u2192 heart).',
      },
      {
        question:
          'The muscular wall between the left and right sides of the heart is called the:',
        questionHi:
          'हृदय के बाएँ और दाएँ भाग के बीच की मांसपेशीय दीवार को कहते हैं:',
        options: ['Pericardium', 'Septum', 'Valve', 'Ventricle'],
        correctIndex: 1,
        explanation:
          'The septum is the thick muscular wall that separates the left and right halves of the heart, preventing mixing of oxygenated and deoxygenated blood.',
      },
    ],
  },
];

/* ─── Helpers ─── */

/**
 * Find a guided experiment definition matching a simulation ID and grade.
 * If no exact grade match exists, returns the first experiment for that simulation.
 * Returns undefined if no experiment exists for the simulation.
 */
export function getExperimentForSimulation(
  simId: string,
  grade: string,
): ExperimentDefinition | undefined {
  const matches = GUIDED_EXPERIMENTS.filter(
    (exp) => exp.simulationId === simId,
  );
  if (matches.length === 0) return undefined;

  const gradeMatch = matches.find((exp) => exp.grades.includes(grade));
  return gradeMatch ?? matches[0];
}

/**
 * Get all experiments available for a specific grade and optionally a subject.
 */
export function getExperimentsForGrade(
  grade: string,
  subject?: string,
): ExperimentDefinition[] {
  return GUIDED_EXPERIMENTS.filter((exp) => {
    if (!exp.grades.includes(grade)) return false;
    if (subject && subject !== 'all' && exp.subject !== subject) return false;
    return true;
  });
}
