/**
 * STEM Lab — Guided Experiment Definitions
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

  /* ──────────── 6. Electric Circuit Builder ──────────── */
  {
    id: 'exp-electric-circuit-basic',
    simulationId: 'builtin-electric-circuit-basic',
    title: 'Electric Circuits: Open, Closed & Components',
    titleHi: 'विद्युत परिपथ: खुला, बंद और घटक',
    chapterRef: 'Class 6 Science Ch 12 — Electricity and Circuits',
    grades: ['6', '7', '8'],
    subject: 'physics',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Build simple electric circuits to understand the difference between open and closed circuits. Identify conductors and insulators by testing materials.',
    objectiveHi:
      'सरल विद्युत परिपथ बनाकर खुले और बंद परिपथ का अंतर समझें। विभिन्न पदार्थों की जाँच करके चालक और कुचालक पहचानें।',
    materials: [
      'Battery (cell)',
      'Bulb',
      'Connecting wires',
      'Switch',
      'Various materials (iron nail, rubber band, plastic spoon, coin)',
    ],
    observations: [
      {
        prompt: 'What happens to the bulb when the switch is closed (ON)?',
        promptHi: 'जब स्विच बंद (ON) किया जाता है तो बल्ब पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['Bulb glows', 'Bulb does not glow', 'Bulb breaks', 'Nothing happens'],
        expectedHint: 'When the switch is closed, the circuit is complete and current flows, making the bulb glow.',
      },
      {
        prompt: 'What is the difference between an open and a closed circuit?',
        promptHi: 'खुले और बंद परिपथ में क्या अंतर है?',
        type: 'text',
        expectedHint: 'In a closed circuit, the path is complete and current flows. In an open circuit, there is a gap and current cannot flow.',
      },
      {
        prompt: 'Which of these materials allows electricity to pass through: iron nail, rubber band, plastic spoon, coin?',
        promptHi: 'इनमें से कौन सा पदार्थ विद्युत को गुज़रने देता है: लोहे की कील, रबर बैंड, प्लास्टिक चम्मच, सिक्का?',
        type: 'text',
        expectedHint: 'Iron nail and coin are conductors (metals allow electricity to pass). Rubber and plastic are insulators.',
      },
    ],
    conclusionPrompt:
      'Explain why a circuit must be closed for a bulb to glow. Give two examples of conductors and two examples of insulators from your daily life.',
    conclusionPromptHi:
      'समझाएँ कि बल्ब जलने के लिए परिपथ का बंद होना क्यों ज़रूरी है। अपने दैनिक जीवन से दो चालकों और दो कुचालकों के उदाहरण दें।',
    quizQuestions: [
      {
        question: 'In which type of circuit does the bulb glow?',
        questionHi: 'किस प्रकार के परिपथ में बल्ब जलता है?',
        options: ['Open circuit', 'Closed circuit', 'Both', 'Neither'],
        correctIndex: 1,
        explanation: 'A bulb glows only in a closed (complete) circuit where current can flow continuously from the battery through the bulb and back.',
      },
      {
        question: 'Which of the following is an insulator?',
        questionHi: 'निम्नलिखित में से कौन कुचालक है?',
        options: ['Copper wire', 'Iron nail', 'Rubber eraser', 'Aluminium foil'],
        correctIndex: 2,
        explanation: 'Rubber is an insulator — it does not allow electric current to pass through. Copper, iron, and aluminium are all conductors (metals).',
      },
      {
        question: 'What is the function of a switch in a circuit?',
        questionHi: 'परिपथ में स्विच का क्या कार्य है?',
        options: ['It increases current', 'It stores electricity', 'It opens or closes the circuit', 'It generates electricity'],
        correctIndex: 2,
        explanation: 'A switch is used to open (break) or close (complete) an electric circuit, controlling whether current flows or not.',
      },
    ],
  },

  /* ──────────── 7. Cell Structure Explorer ──────────── */
  {
    id: 'exp-cell-structure',
    simulationId: 'builtin-cell-structure',
    title: 'Cell Structure: Plant vs Animal Cells',
    titleHi: 'कोशिका संरचना: पादप और जंतु कोशिका',
    chapterRef: 'Class 8 Science Ch 8 — Cell: Structure and Functions',
    grades: ['6', '7', '8'],
    subject: 'biology',
    difficulty: 1,
    bloomLevel: 'remember',
    estimatedMinutes: 10,
    objective:
      'Identify the main parts of a cell — cell membrane, nucleus, cytoplasm — and compare plant and animal cells to find their differences.',
    objectiveHi:
      'कोशिका के मुख्य भागों — कोशिका झिल्ली, केंद्रक, कोशिकाद्रव्य — को पहचानें और पादप व जंतु कोशिकाओं की तुलना करें।',
    materials: [
      'Microscope (virtual)',
      'Onion peel slide',
      'Cheek cell slide',
      'Iodine / Methylene blue stain',
    ],
    observations: [
      {
        prompt: 'Name three organelles found in both plant and animal cells.',
        promptHi: 'तीन ऐसे कोशिकांग बताएँ जो पादप और जंतु दोनों कोशिकाओं में पाए जाते हैं।',
        type: 'text',
        expectedHint: 'Cell membrane, nucleus, and cytoplasm are found in both plant and animal cells.',
      },
      {
        prompt: 'Which structure is present in plant cells but absent in animal cells?',
        promptHi: 'कौन सी संरचना पादप कोशिका में होती है लेकिन जंतु कोशिका में नहीं?',
        type: 'select',
        options: ['Cell wall', 'Nucleus', 'Cytoplasm', 'Cell membrane'],
        expectedHint: 'Cell wall is present only in plant cells. It provides rigidity and shape to the plant cell.',
      },
      {
        prompt: 'What is the function of the nucleus?',
        promptHi: 'केंद्रक (nucleus) का क्या कार्य है?',
        type: 'text',
        expectedHint: 'The nucleus controls all cell activities and contains genetic material (DNA) that carries instructions for the cell.',
      },
      {
        prompt: 'Do plant cells have chloroplasts? What is their function?',
        promptHi: 'क्या पादप कोशिकाओं में हरितलवक (chloroplast) होते हैं? उनका क्या कार्य है?',
        type: 'text',
        expectedHint: 'Yes, plant cells have chloroplasts which contain chlorophyll and carry out photosynthesis (making food from sunlight).',
      },
    ],
    conclusionPrompt:
      'List three differences between plant and animal cells. Why do plant cells need a cell wall but animal cells do not?',
    conclusionPromptHi:
      'पादप और जंतु कोशिकाओं के बीच तीन अंतर लिखें। पादप कोशिकाओं को कोशिका भित्ति की आवश्यकता क्यों होती है लेकिन जंतु कोशिकाओं को नहीं?',
    quizQuestions: [
      {
        question: 'The outermost covering of an animal cell is the:',
        questionHi: 'जंतु कोशिका का सबसे बाहरी आवरण है:',
        options: ['Cell wall', 'Cell membrane', 'Nucleus', 'Cytoplasm'],
        correctIndex: 1,
        explanation: 'Animal cells do not have a cell wall. Their outermost boundary is the cell membrane (plasma membrane), which is thin and flexible.',
      },
      {
        question: 'Which organelle is called the "powerhouse of the cell"?',
        questionHi: 'किस कोशिकांग को "कोशिका का पावरहाउस" कहा जाता है?',
        options: ['Nucleus', 'Chloroplast', 'Mitochondria', 'Ribosome'],
        correctIndex: 2,
        explanation: 'Mitochondria break down food (glucose) to release energy (ATP) for the cell, which is why they are called the powerhouse of the cell.',
      },
      {
        question: 'Chloroplasts are found in:',
        questionHi: 'हरितलवक (Chloroplast) पाए जाते हैं:',
        options: ['Only animal cells', 'Only plant cells', 'Both plant and animal cells', 'Neither'],
        correctIndex: 1,
        explanation: 'Chloroplasts are found only in plant cells. They contain chlorophyll and carry out photosynthesis. Animal cells cannot make their own food.',
      },
    ],
  },

  /* ──────────── 8. Light Reflection Lab ──────────── */
  {
    id: 'exp-light-reflection',
    simulationId: 'builtin-light-reflection',
    title: 'Light Reflection: Laws & Mirror Images',
    titleHi: 'प्रकाश परावर्तन: नियम और दर्पण प्रतिबिम्ब',
    chapterRef: 'Class 8 Science Ch 16 — Light',
    grades: ['6', '7', '8'],
    subject: 'physics',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Explore how light reflects off a mirror. Verify the law of reflection: the angle of incidence equals the angle of reflection.',
    objectiveHi:
      'जानें कि प्रकाश दर्पण से कैसे परावर्तित होता है। परावर्तन का नियम सत्यापित करें: आपतन कोण = परावर्तन कोण।',
    materials: ['Plane mirror', 'Torch / light source', 'Protractor', 'White paper sheet', 'Pins'],
    observations: [
      {
        prompt: 'When you shine light at a mirror at 30\u00b0 to the normal, at what angle does the reflected ray leave?',
        promptHi: 'जब आप दर्पण पर अभिलम्ब से 30\u00b0 पर प्रकाश डालते हैं, तो परावर्तित किरण किस कोण पर निकलती है?',
        type: 'number',
        expectedHint: 'The reflected ray leaves at 30\u00b0 to the normal. Angle of incidence = Angle of reflection.',
      },
      {
        prompt: 'The incident ray, reflected ray, and the normal all lie in the same _____.',
        promptHi: 'आपतित किरण, परावर्तित किरण और अभिलम्ब सभी एक ही _____ में होते हैं।',
        type: 'select',
        options: ['Plane', 'Line', 'Circle', 'Curve'],
        expectedHint: 'They all lie in the same plane. This is the second law of reflection.',
      },
      {
        prompt: 'What happens to the angle of reflection when you increase the angle of incidence?',
        promptHi: 'जब आपतन कोण बढ़ाया जाता है तो परावर्तन कोण पर क्या प्रभाव पड़ता है?',
        type: 'select',
        options: ['It increases equally', 'It decreases', 'It stays the same', 'It becomes zero'],
        expectedHint: 'The angle of reflection increases equally — it always equals the angle of incidence.',
      },
    ],
    dataTable: {
      columns: ['S.No.', 'Angle of Incidence (\u00b0)', 'Angle of Reflection (\u00b0)', 'Equal? (Yes/No)'],
      rows: 4,
    },
    conclusionPrompt:
      'State the two laws of reflection in your own words. Why is the normal line important when measuring angles of reflection?',
    conclusionPromptHi:
      'परावर्तन के दो नियम अपने शब्दों में लिखें। परावर्तन कोण मापते समय अभिलम्ब रेखा क्यों महत्वपूर्ण है?',
    quizQuestions: [
      {
        question: 'The angle of incidence is measured between the:',
        questionHi: 'आपतन कोण मापा जाता है:',
        options: ['Incident ray and mirror surface', 'Incident ray and normal', 'Reflected ray and mirror', 'Two reflected rays'],
        correctIndex: 1,
        explanation: 'The angle of incidence is the angle between the incident ray and the normal (perpendicular to the mirror surface at the point of incidence).',
      },
      {
        question: 'If the angle of incidence is 45\u00b0, the angle of reflection is:',
        questionHi: 'यदि आपतन कोण 45\u00b0 है, तो परावर्तन कोण होगा:',
        options: ['0\u00b0', '45\u00b0', '90\u00b0', '135\u00b0'],
        correctIndex: 1,
        explanation: 'By the law of reflection, the angle of reflection always equals the angle of incidence. So it is 45\u00b0.',
      },
    ],
  },

  /* ──────────── 9. Magnetic Field Lines ──────────── */
  {
    id: 'exp-magnet-field-lines',
    simulationId: 'builtin-magnet-field-lines',
    title: 'Magnets: Poles, Field Lines & Attraction',
    titleHi: 'चुम्बक: ध्रुव, क्षेत्र रेखाएँ और आकर्षण',
    chapterRef: 'Class 6 Science Ch 13 — Fun with Magnets',
    grades: ['6', '7', '8'],
    subject: 'physics',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Observe the pattern of magnetic field lines around a bar magnet. Understand attraction and repulsion between magnetic poles.',
    objectiveHi:
      'एक छड़ चुम्बक के चारों ओर चुम्बकीय क्षेत्र रेखाओं का पैटर्न देखें। चुम्बकीय ध्रुवों के बीच आकर्षण और प्रतिकर्षण को समझें।',
    materials: ['Bar magnet', 'Iron filings', 'White paper', 'Compass needle', 'Second bar magnet'],
    observations: [
      {
        prompt: 'Where are the field lines closest together — near the poles or in the middle?',
        promptHi: 'क्षेत्र रेखाएँ कहाँ सबसे पास-पास हैं — ध्रुवों के पास या बीच में?',
        type: 'select',
        options: ['Near the poles', 'In the middle', 'Same everywhere', 'No pattern visible'],
        expectedHint: 'Field lines are most concentrated (closest together) near the poles, where the magnetic field is strongest.',
      },
      {
        prompt: 'What happens when you bring two north poles close to each other?',
        promptHi: 'जब दो उत्तरी ध्रुव एक-दूसरे के पास लाए जाते हैं तो क्या होता है?',
        type: 'select',
        options: ['They attract', 'They repel', 'Nothing happens', 'They stick together'],
        expectedHint: 'Like poles (N-N or S-S) repel each other. Unlike poles (N-S) attract each other.',
      },
      {
        prompt: 'Do the field lines ever cross each other?',
        promptHi: 'क्या क्षेत्र रेखाएँ कभी एक-दूसरे को काटती हैं?',
        type: 'select',
        options: ['Yes, always', 'No, never', 'Only near poles', 'Only far from magnet'],
        expectedHint: 'Magnetic field lines never cross. If they did, it would mean two directions at one point, which is impossible.',
      },
    ],
    conclusionPrompt:
      'Describe the pattern of field lines around a bar magnet. Explain the rule for attraction and repulsion between magnetic poles.',
    conclusionPromptHi:
      'एक छड़ चुम्बक के चारों ओर क्षेत्र रेखाओं के पैटर्न का वर्णन करें। चुम्बकीय ध्रुवों के बीच आकर्षण और प्रतिकर्षण के नियम को समझाएँ।',
    quizQuestions: [
      {
        question: 'Magnetic field lines emerge from:',
        questionHi: 'चुम्बकीय क्षेत्र रेखाएँ निकलती हैं:',
        options: ['South pole to north pole (outside)', 'North pole to south pole (outside)', 'Both poles equally outward', 'The middle of the magnet'],
        correctIndex: 1,
        explanation: 'Outside the magnet, field lines go from North pole to South pole. Inside the magnet, they go from South to North, forming closed loops.',
      },
      {
        question: 'Which of the following is true about magnetic poles?',
        questionHi: 'चुम्बकीय ध्रुवों के बारे में कौन सा कथन सत्य है?',
        options: ['Like poles attract', 'Unlike poles repel', 'Like poles repel and unlike poles attract', 'Magnets have only one pole'],
        correctIndex: 2,
        explanation: 'Like poles (N-N or S-S) repel each other, while unlike poles (N-S) attract. Every magnet always has two poles.',
      },
    ],
  },

  /* ──────────── 10. Pizza Fraction Lab ──────────── */
  {
    id: 'exp-fractions',
    simulationId: 'builtin-fractions',
    title: 'Fractions: Parts of a Whole',
    titleHi: 'भिन्न: एक पूरे के भाग',
    chapterRef: 'Class 6 Math Ch 7 — Fractions',
    grades: ['6', '7', '8'],
    subject: 'math',
    difficulty: 1,
    bloomLevel: 'apply',
    estimatedMinutes: 10,
    objective:
      'Understand proper and improper fractions using pizza slices. Compare fractions and find equivalent fractions visually.',
    objectiveHi:
      'पिज़्ज़ा स्लाइस का उपयोग करके उचित और अनुचित भिन्नों को समझें। भिन्नों की तुलना करें और दृश्य रूप से समतुल्य भिन्न खोजें।',
    observations: [
      {
        prompt: 'If a pizza is cut into 8 equal slices and you eat 3, what fraction did you eat?',
        promptHi: 'यदि एक पिज़्ज़ा को 8 बराबर टुकड़ों में काटा जाए और आप 3 खाएँ, तो आपने कितना भाग खाया?',
        type: 'text',
        expectedHint: 'You ate 3/8 (three-eighths) of the pizza. The denominator (8) is total parts, numerator (3) is parts taken.',
      },
      {
        prompt: 'Which is larger: 1/2 or 1/4? How can you tell from the visualization?',
        promptHi: '1/2 और 1/4 में कौन बड़ा है? चित्र से आप कैसे बता सकते हैं?',
        type: 'text',
        expectedHint: '1/2 is larger. In the visualization, half the pizza (1/2) covers more area than a quarter (1/4). When denominators differ, larger denominator means smaller pieces.',
      },
      {
        prompt: 'Find a fraction equivalent to 2/4. What do you notice?',
        promptHi: '2/4 के समतुल्य एक भिन्न खोजें। आपने क्या देखा?',
        type: 'text',
        expectedHint: '2/4 = 1/2. Both cover the same amount of the pizza. Equivalent fractions represent the same value.',
      },
      {
        prompt: 'Is 5/3 a proper or improper fraction? What does it mean visually?',
        promptHi: '5/3 उचित भिन्न है या अनुचित? इसका दृश्य अर्थ क्या है?',
        type: 'select',
        options: ['Proper (less than 1)', 'Improper (more than 1)', 'Neither', 'Cannot tell'],
        expectedHint: '5/3 is improper (numerator > denominator). Visually it means more than one whole pizza — 1 full pizza + 2/3 of another.',
      },
    ],
    conclusionPrompt:
      'Explain the difference between proper and improper fractions. How do you find equivalent fractions?',
    conclusionPromptHi:
      'उचित और अनुचित भिन्नों के बीच अंतर समझाएँ। समतुल्य भिन्न कैसे खोजते हैं?',
    quizQuestions: [
      {
        question: 'Which of these is an improper fraction?',
        questionHi: 'इनमें से कौन अनुचित भिन्न है?',
        options: ['2/5', '3/7', '7/4', '1/3'],
        correctIndex: 2,
        explanation: '7/4 is improper because the numerator (7) is greater than the denominator (4). This means the value is more than 1 whole.',
      },
      {
        question: 'Which fraction is equivalent to 3/6?',
        questionHi: '3/6 के समतुल्य भिन्न कौन सी है?',
        options: ['2/3', '1/2', '3/4', '2/6'],
        correctIndex: 1,
        explanation: '3/6 = 1/2 (divide both numerator and denominator by 3). Both represent exactly half.',
      },
      {
        question: 'Arrange in ascending order: 1/4, 1/2, 3/4',
        questionHi: 'आरोही क्रम में लिखें: 1/4, 1/2, 3/4',
        options: ['3/4, 1/2, 1/4', '1/4, 1/2, 3/4', '1/2, 1/4, 3/4', '1/4, 3/4, 1/2'],
        correctIndex: 1,
        explanation: '1/4 (0.25) < 1/2 (0.5) < 3/4 (0.75). Same denominator family — more parts taken means larger fraction.',
      },
    ],
  },

  /* ──────────── 11. Angle Explorer ──────────── */
  {
    id: 'exp-angle-explorer',
    simulationId: 'builtin-angle-explorer',
    title: 'Angles: Types & Measurement',
    titleHi: 'कोण: प्रकार और मापन',
    chapterRef: 'Class 6 Math Ch 5 — Understanding Elementary Shapes',
    grades: ['6', '7'],
    subject: 'math',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Identify and classify angles as acute, right, obtuse, straight, and reflex. Measure angles using a protractor and understand their properties.',
    objectiveHi:
      'कोणों को न्यूनकोण, समकोण, अधिककोण, ऋजुकोण और प्रतिवर्ती कोण के रूप में पहचानें और वर्गीकृत करें। चाँदे से कोण मापना सीखें।',
    observations: [
      {
        prompt: 'Set the angle to exactly 90\u00b0. What type of angle is this?',
        promptHi: 'कोण को ठीक 90\u00b0 पर सेट करें। यह कौन सा कोण है?',
        type: 'select',
        options: ['Acute angle', 'Right angle', 'Obtuse angle', 'Straight angle'],
        expectedHint: 'A 90\u00b0 angle is a right angle. It looks like the corner of a book or a door frame.',
      },
      {
        prompt: 'What is the range of an acute angle?',
        promptHi: 'न्यूनकोण की सीमा क्या है?',
        type: 'select',
        options: ['0\u00b0 to 90\u00b0', '90\u00b0 to 180\u00b0', '180\u00b0 to 360\u00b0', 'Exactly 180\u00b0'],
        expectedHint: 'An acute angle is greater than 0\u00b0 and less than 90\u00b0.',
      },
      {
        prompt: 'Set an angle greater than 180\u00b0. What is this type of angle called?',
        promptHi: '180\u00b0 से अधिक का कोण सेट करें। इस प्रकार के कोण को क्या कहते हैं?',
        type: 'text',
        expectedHint: 'An angle greater than 180\u00b0 but less than 360\u00b0 is called a reflex angle.',
      },
    ],
    conclusionPrompt:
      'List all five types of angles with their degree ranges. Give one real-life example of each type.',
    conclusionPromptHi:
      'सभी पाँच प्रकार के कोणों को उनकी डिग्री सीमा के साथ लिखें। प्रत्येक प्रकार का एक वास्तविक जीवन का उदाहरण दें।',
    quizQuestions: [
      {
        question: 'An angle of 135\u00b0 is classified as:',
        questionHi: '135\u00b0 का कोण वर्गीकृत होता है:',
        options: ['Acute', 'Right', 'Obtuse', 'Reflex'],
        correctIndex: 2,
        explanation: '135\u00b0 is between 90\u00b0 and 180\u00b0, so it is an obtuse angle.',
      },
      {
        question: 'A straight angle measures:',
        questionHi: 'ऋजुकोण (straight angle) का माप होता है:',
        options: ['90\u00b0', '180\u00b0', '270\u00b0', '360\u00b0'],
        correctIndex: 1,
        explanation: 'A straight angle is exactly 180\u00b0 — it looks like a straight line.',
      },
      {
        question: 'How many right angles make a complete turn (360\u00b0)?',
        questionHi: 'एक पूर्ण चक्कर (360\u00b0) में कितने समकोण होते हैं?',
        options: ['2', '3', '4', '6'],
        correctIndex: 2,
        explanation: '360\u00b0 \u00f7 90\u00b0 = 4. So four right angles make a complete turn.',
      },
    ],
  },

  /* ──────────── 12. Symmetry Explorer ──────────── */
  {
    id: 'exp-symmetry-explorer',
    simulationId: 'builtin-symmetry-explorer',
    title: 'Symmetry: Lines & Rotational',
    titleHi: 'सममिति: रेखा और घूर्णी',
    chapterRef: 'Class 6 Math Ch 13 — Symmetry',
    grades: ['6', '7'],
    subject: 'math',
    difficulty: 1,
    bloomLevel: 'understand',
    estimatedMinutes: 10,
    objective:
      'Identify lines of symmetry in shapes and letters. Understand the difference between line symmetry and rotational symmetry.',
    objectiveHi:
      'आकृतियों और अक्षरों में सममिति रेखाएँ पहचानें। रेखा सममिति और घूर्णी सममिति के बीच अंतर समझें।',
    observations: [
      {
        prompt: 'How many lines of symmetry does a square have?',
        promptHi: 'एक वर्ग में कितनी सममिति रेखाएँ होती हैं?',
        type: 'number',
        expectedHint: 'A square has 4 lines of symmetry: 2 through opposite sides and 2 through opposite corners (diagonals).',
      },
      {
        prompt: 'Does the letter "A" have a line of symmetry? If yes, is it horizontal or vertical?',
        promptHi: 'क्या अक्षर "A" में सममिति रेखा है? यदि हाँ, तो क्षैतिज या ऊर्ध्वाधर?',
        type: 'select',
        options: ['No line of symmetry', 'Vertical line of symmetry', 'Horizontal line of symmetry', 'Both vertical and horizontal'],
        expectedHint: 'The letter A has one vertical line of symmetry — the left and right halves are mirror images.',
      },
      {
        prompt: 'How many lines of symmetry does a circle have?',
        promptHi: 'एक वृत्त में कितनी सममिति रेखाएँ होती हैं?',
        type: 'select',
        options: ['0', '1', '4', 'Infinite'],
        expectedHint: 'A circle has infinite lines of symmetry — any diameter divides it into two equal halves.',
      },
    ],
    conclusionPrompt:
      'Explain what a line of symmetry is. Why does a rectangle have 2 lines of symmetry but a square has 4?',
    conclusionPromptHi:
      'समझाएँ कि सममिति रेखा क्या होती है। एक आयत में 2 सममिति रेखाएँ क्यों होती हैं जबकि वर्ग में 4?',
    quizQuestions: [
      {
        question: 'How many lines of symmetry does an equilateral triangle have?',
        questionHi: 'एक समबाहु त्रिभुज में कितनी सममिति रेखाएँ होती हैं?',
        options: ['1', '2', '3', '6'],
        correctIndex: 2,
        explanation: 'An equilateral triangle has 3 lines of symmetry — one from each vertex to the midpoint of the opposite side.',
      },
      {
        question: 'Which of these letters has NO line of symmetry?',
        questionHi: 'इनमें से किस अक्षर में कोई सममिति रेखा नहीं है?',
        options: ['A', 'O', 'F', 'H'],
        correctIndex: 2,
        explanation: 'The letter F has no line of symmetry. A has vertical symmetry, O has infinite, and H has both vertical and horizontal.',
      },
    ],
  },
  /* ──────────── 13. Newton's Laws ──────────── */
  {
    id: 'exp-newton-laws',
    simulationId: 'builtin-newton-laws',
    title: "Newton's Laws: Force & Motion",
    titleHi: 'न्यूटन के नियम: बल और गति',
    chapterRef: 'Class 9 Science Ch 9 — Force and Laws of Motion',
    grades: ['9', '10', '11'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective: "Explore Newton's three laws of motion using force and mass simulations. Understand inertia, F=ma, and action-reaction pairs.",
    objectiveHi: 'बल और द्रव्यमान सिमुलेशन से न्यूटन के तीन गति नियमों को जानें। जड़त्व, F=ma और क्रिया-प्रतिक्रिया को समझें।',
    materials: ['Spring balance', 'Trolley', 'Weights', 'Smooth surface'],
    observations: [
      { prompt: 'What happens to a stationary object when no net force acts on it?', promptHi: 'जब किसी स्थिर वस्तु पर कोई परिणामी बल नहीं लगता तो क्या होता है?', type: 'select' as const, options: ['Stays at rest', 'Moves forward', 'Spins', 'Disappears'], expectedHint: "Newton's first law (law of inertia): an object at rest stays at rest unless acted upon by an external force." },
      { prompt: 'If force is constant and mass is doubled, what happens to acceleration?', promptHi: 'यदि बल स्थिर हो और द्रव्यमान दोगुना कर दें तो त्वरण पर क्या प्रभाव होगा?', type: 'text' as const, expectedHint: 'Acceleration halves. From F = ma, a = F/m. If m doubles, a becomes half.' },
      { prompt: 'Give a daily-life example of Newton\'s third law.', promptHi: 'न्यूटन के तीसरे नियम का एक दैनिक जीवन का उदाहरण दें।', type: 'text' as const, expectedHint: 'Walking: your foot pushes the ground backward (action), the ground pushes your foot forward (reaction).' },
    ],
    conclusionPrompt: "State all three of Newton's laws in your own words with one example each.",
    conclusionPromptHi: 'न्यूटन के तीनों नियम अपने शब्दों में एक-एक उदाहरण सहित लिखें।',
    quizQuestions: [
      { question: 'A force of 20 N acts on a 5 kg object. What is the acceleration?', questionHi: '5 kg की वस्तु पर 20 N का बल लगता है। त्वरण कितना होगा?', options: ['2 m/s\u00b2', '4 m/s\u00b2', '10 m/s\u00b2', '100 m/s\u00b2'], correctIndex: 1, explanation: 'Using F = ma: a = F/m = 20/5 = 4 m/s\u00b2.' },
      { question: 'Passengers fall forward when a bus stops suddenly. Which law explains this?', questionHi: 'बस अचानक रुकने पर यात्री आगे गिर जाते हैं। कौन सा नियम यह समझाता है?', options: ["Newton's first law (inertia)", "Newton's second law", "Newton's third law", 'Law of gravity'], correctIndex: 0, explanation: "Newton's first law: the passengers' body tends to continue in motion (inertia) when the bus stops." },
      { question: 'A rocket moves forward by pushing gas backward. This is an example of:', questionHi: 'रॉकेट गैस को पीछे धकेलकर आगे बढ़ता है। यह किसका उदाहरण है?', options: ["Newton's first law", "Newton's second law", "Newton's third law", 'Law of conservation of energy'], correctIndex: 2, explanation: "Newton's third law: the rocket pushes gas backward (action), the gas pushes the rocket forward (reaction)." },
    ],
  },

  /* ──────────── 14. Pendulum Lab ──────────── */
  {
    id: 'exp-pendulum',
    simulationId: 'builtin-pendulum',
    title: 'Simple Pendulum: Time Period & Length',
    titleHi: 'सरल लोलक: आवर्तकाल और लम्बाई',
    chapterRef: 'Class 9 Science — Motion / Class 11 Physics Ch 14',
    grades: ['9', '10', '11'],
    subject: 'physics',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 15,
    objective: 'Investigate how the length of a simple pendulum affects its time period. Verify that mass does not affect the time period.',
    objectiveHi: 'जानें कि सरल लोलक की लम्बाई उसके आवर्तकाल को कैसे प्रभावित करती है। सत्यापित करें कि द्रव्यमान आवर्तकाल को प्रभावित नहीं करता।',
    materials: ['String', 'Bob (different masses)', 'Ruler', 'Stopwatch', 'Stand with clamp'],
    observations: [
      { prompt: 'Does changing the mass of the bob affect the time period?', promptHi: 'क्या गोलक का द्रव्यमान बदलने से आवर्तकाल प्रभावित होता है?', type: 'select' as const, options: ['Yes, it increases', 'Yes, it decreases', 'No, it does not change', 'Sometimes'], expectedHint: 'The time period of a simple pendulum depends only on its length and g, NOT on the mass of the bob.' },
      { prompt: 'If the length of the pendulum is quadrupled, what happens to the time period?', promptHi: 'यदि लोलक की लम्बाई चार गुना कर दें तो आवर्तकाल पर क्या प्रभाव होगा?', type: 'select' as const, options: ['Stays the same', 'Doubles', 'Quadruples', 'Halves'], expectedHint: 'T is proportional to \u221aL. If L becomes 4L, T becomes 2T (doubles).' },
      { prompt: 'What is the relationship between time period T and length L?', promptHi: 'आवर्तकाल T और लम्बाई L के बीच क्या सम्बन्ध है?', type: 'text' as const, expectedHint: 'T = 2\u03c0\u221a(L/g). Time period is proportional to the square root of length.' },
    ],
    dataTable: { columns: ['S.No.', 'Length (cm)', 'Time for 10 oscillations (s)', 'Time period T (s)', 'T\u00b2 (s\u00b2)'], rows: 5 },
    conclusionPrompt: 'Explain how length affects the time period of a pendulum. Why does mass not matter?',
    conclusionPromptHi: 'लम्बाई लोलक के आवर्तकाल को कैसे प्रभावित करती है? द्रव्यमान क्यों मायने नहीं रखता? समझाएँ।',
    quizQuestions: [
      { question: 'The time period of a simple pendulum depends on:', questionHi: 'सरल लोलक का आवर्तकाल निर्भर करता है:', options: ['Mass and length', 'Length and g', 'Mass and g', 'Only mass'], correctIndex: 1, explanation: 'T = 2\u03c0\u221a(L/g). The time period depends only on the length of the string and the acceleration due to gravity.' },
      { question: 'If the length of a pendulum is quadrupled, the time period:', questionHi: 'यदि लोलक की लम्बाई चार गुना कर दी जाए तो आवर्तकाल:', options: ['Quadruples', 'Doubles', 'Halves', 'Stays the same'], correctIndex: 1, explanation: 'T \u221d \u221aL. If L becomes 4L, T = 2\u03c0\u221a(4L/g) = 2 \u00d7 2\u03c0\u221a(L/g) = 2T.' },
      { question: 'One complete oscillation of a pendulum means the bob moves:', questionHi: 'लोलक का एक पूर्ण दोलन का अर्थ है कि गोलक चलता है:', options: ['From centre to one extreme', 'From one extreme to the other', 'From one extreme to the other and back', 'Two full rounds'], correctIndex: 2, explanation: 'One complete oscillation: the bob moves from one extreme position to the other extreme and back to the starting position.' },
    ],
  },

  /* ──────────── 15. Bohr Atomic Model ──────────── */
  {
    id: 'exp-bohr-model',
    simulationId: 'builtin-bohr-model',
    title: "Bohr's Atomic Model: Shells & Electrons",
    titleHi: 'बोर का परमाणु मॉडल: कोश और इलेक्ट्रॉन',
    chapterRef: 'Class 9 Science Ch 4 — Structure of the Atom',
    grades: ['9', '10', '11'],
    subject: 'chemistry',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective: "Explore Bohr's model of the atom — electron shells, their capacity (2n\u00b2), and how valence electrons determine chemical properties.",
    objectiveHi: 'बोर के परमाणु मॉडल को जानें — इलेक्ट्रॉन कोश, उनकी क्षमता (2n\u00b2), और संयोजकता इलेक्ट्रॉन रासायनिक गुण कैसे निर्धारित करते हैं।',
    observations: [
      { prompt: 'What is the maximum number of electrons in the K shell (n=1)?', promptHi: 'K कोश (n=1) में अधिकतम कितने इलेक्ट्रॉन हो सकते हैं?', type: 'number' as const, expectedHint: 'Using 2n\u00b2: 2(1)\u00b2 = 2 electrons.' },
      { prompt: 'What is the maximum number of electrons in the L shell (n=2)?', promptHi: 'L कोश (n=2) में अधिकतम कितने इलेक्ट्रॉन हो सकते हैं?', type: 'number' as const, expectedHint: 'Using 2n\u00b2: 2(2)\u00b2 = 8 electrons.' },
      { prompt: 'What determines the chemical reactivity of an element?', promptHi: 'किसी तत्व की रासायनिक अभिक्रियाशीलता किससे निर्धारित होती है?', type: 'select' as const, options: ['Total electrons', 'Neutrons', 'Valence electrons', 'Protons'], expectedHint: 'Valence electrons (electrons in the outermost shell) determine chemical reactivity and bonding.' },
    ],
    conclusionPrompt: 'Explain the 2n\u00b2 rule for electron capacity. Why are noble gases chemically stable?',
    conclusionPromptHi: 'इलेक्ट्रॉन क्षमता के लिए 2n\u00b2 नियम समझाएँ। उत्कृष्ट गैसें रासायनिक रूप से स्थिर क्यों हैं?',
    quizQuestions: [
      { question: 'Maximum electrons in the M shell (n=3) is:', questionHi: 'M कोश (n=3) में अधिकतम इलेक्ट्रॉन हैं:', options: ['6', '8', '18', '32'], correctIndex: 2, explanation: 'Using 2n\u00b2: 2(3)\u00b2 = 2 \u00d7 9 = 18 electrons.' },
      { question: 'Electronic configuration of Sodium (Na, Z=11) is:', questionHi: 'सोडियम (Na, Z=11) का इलेक्ट्रॉनिक विन्यास है:', options: ['2, 8, 1', '2, 8, 2', '2, 1, 8', '8, 2, 1'], correctIndex: 0, explanation: 'Na has 11 electrons: K=2, L=8, M=1. The single valence electron makes it highly reactive.' },
      { question: 'Number of valence electrons in Chlorine (Z=17) is:', questionHi: 'क्लोरीन (Z=17) में संयोजकता इलेक्ट्रॉन की संख्या है:', options: ['1', '2', '5', '7'], correctIndex: 3, explanation: 'Cl has 17 electrons: 2, 8, 7. The 7 electrons in the outermost shell are valence electrons.' },
    ],
  },

  /* ──────────── 16. Chemical Equation Balancer ──────────── */
  {
    id: 'exp-chemical-balancer',
    simulationId: 'builtin-chemical-balancer',
    title: 'Chemical Equations: Balancing & Types',
    titleHi: 'रासायनिक समीकरण: संतुलन और प्रकार',
    chapterRef: 'Class 10 Science Ch 1 — Chemical Reactions and Equations',
    grades: ['10'],
    subject: 'chemistry',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective: 'Learn to balance chemical equations using the law of conservation of mass. Identify types of chemical reactions.',
    objectiveHi: 'द्रव्यमान संरक्षण के नियम का उपयोग करके रासायनिक समीकरणों को संतुलित करना सीखें। रासायनिक अभिक्रियाओं के प्रकार पहचानें।',
    materials: ['Periodic table', 'Pencil', 'Paper'],
    observations: [
      { prompt: 'Why must chemical equations be balanced?', promptHi: 'रासायनिक समीकरणों को संतुलित क्यों करना आवश्यक है?', type: 'text' as const, expectedHint: 'Law of conservation of mass: atoms are neither created nor destroyed in a chemical reaction. The number of each type of atom must be equal on both sides.' },
      { prompt: 'Balance the equation: Fe + O\u2082 \u2192 Fe\u2082O\u2083', promptHi: 'समीकरण संतुलित करें: Fe + O\u2082 \u2192 Fe\u2082O\u2083', type: 'text' as const, expectedHint: '4Fe + 3O\u2082 \u2192 2Fe\u2082O\u2083 (4 Fe atoms and 6 O atoms on each side).' },
      { prompt: 'What type of reaction is: 2H\u2082 + O\u2082 \u2192 2H\u2082O?', promptHi: '2H\u2082 + O\u2082 \u2192 2H\u2082O किस प्रकार की अभिक्रिया है?', type: 'select' as const, options: ['Combination', 'Decomposition', 'Displacement', 'Double displacement'], expectedHint: 'This is a combination (synthesis) reaction — two or more substances combine to form a single product.' },
    ],
    conclusionPrompt: 'Explain why balancing equations is necessary. Name and give an example of four types of chemical reactions.',
    conclusionPromptHi: 'समझाएँ कि समीकरण संतुलित करना क्यों आवश्यक है। चार प्रकार की रासायनिक अभिक्रियाओं के नाम और उदाहरण दें।',
    quizQuestions: [
      { question: 'The balanced equation for Zn + HCl \u2192 ZnCl\u2082 + H\u2082 is:', questionHi: 'Zn + HCl \u2192 ZnCl\u2082 + H\u2082 का संतुलित समीकरण है:', options: ['Zn + HCl \u2192 ZnCl\u2082 + H\u2082', 'Zn + 2HCl \u2192 ZnCl\u2082 + H\u2082', '2Zn + HCl \u2192 ZnCl\u2082 + H\u2082', 'Zn + 3HCl \u2192 ZnCl\u2082 + H\u2082'], correctIndex: 1, explanation: 'Zn + 2HCl \u2192 ZnCl\u2082 + H\u2082. We need 2 HCl to provide 2 Cl atoms for ZnCl\u2082 and 2 H atoms for H\u2082.' },
      { question: 'In a balanced equation, the total mass of reactants is:', questionHi: 'संतुलित समीकरण में अभिकारकों का कुल द्रव्यमान होता है:', options: ['Equal to total mass of products', 'Half of products', 'Double of products', 'Zero'], correctIndex: 0, explanation: 'Law of conservation of mass: mass is neither created nor destroyed. Total mass of reactants = total mass of products.' },
      { question: 'CaCO\u2083 \u2192 CaO + CO\u2082 is a:', questionHi: 'CaCO\u2083 \u2192 CaO + CO\u2082 है एक:', options: ['Combination reaction', 'Decomposition reaction', 'Displacement reaction', 'Neutralisation reaction'], correctIndex: 1, explanation: 'A single reactant (CaCO\u2083) breaks down into two products (CaO and CO\u2082). This is a decomposition reaction.' },
    ],
  },

  /* ──────────── 17. Respiration Lab ──────────── */
  {
    id: 'exp-respiration',
    simulationId: 'builtin-respiration-lab',
    title: 'Respiration: Aerobic vs Anaerobic',
    titleHi: 'श्वसन: वायवीय बनाम अवायवीय',
    chapterRef: 'Class 10 Science Ch 6 — Life Processes',
    grades: ['9', '10'],
    subject: 'biology',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective: 'Compare aerobic and anaerobic respiration. Understand how glucose is broken down to release energy (ATP).',
    objectiveHi: 'वायवीय और अवायवीय श्वसन की तुलना करें। ग्लूकोज़ कैसे टूटकर ऊर्जा (ATP) देता है, समझें।',
    observations: [
      { prompt: 'What are the end products of aerobic respiration?', promptHi: 'वायवीय श्वसन के अंतिम उत्पाद क्या हैं?', type: 'text' as const, expectedHint: 'CO\u2082 + H\u2082O + Energy (38 ATP). Glucose is completely broken down in the presence of oxygen.' },
      { prompt: 'Where does aerobic respiration occur in the cell?', promptHi: 'कोशिका में वायवीय श्वसन कहाँ होता है?', type: 'select' as const, options: ['Nucleus', 'Chloroplast', 'Mitochondria', 'Ribosome'], expectedHint: 'Aerobic respiration occurs in the mitochondria, which is why mitochondria are called the powerhouse of the cell.' },
      { prompt: 'Why do muscles cramp during heavy exercise?', promptHi: 'भारी व्यायाम के दौरान मांसपेशियों में ऐंठन क्यों होती है?', type: 'text' as const, expectedHint: 'During heavy exercise, oxygen supply is insufficient. Muscles switch to anaerobic respiration, producing lactic acid which causes cramps.' },
    ],
    conclusionPrompt: 'Compare aerobic and anaerobic respiration. Which produces more energy and why?',
    conclusionPromptHi: 'वायवीय और अवायवीय श्वसन की तुलना करें। किसमें अधिक ऊर्जा उत्पन्न होती है और क्यों?',
    quizQuestions: [
      { question: 'Aerobic respiration requires:', questionHi: 'वायवीय श्वसन के लिए आवश्यक है:', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 0, explanation: 'Aerobic means "with oxygen". Aerobic respiration requires oxygen to completely break down glucose into CO\u2082, H\u2082O, and energy.' },
      { question: 'The end product of anaerobic respiration in yeast is:', questionHi: 'यीस्ट में अवायवीय श्वसन का अंतिम उत्पाद है:', options: ['Lactic acid + CO\u2082', 'Ethanol + CO\u2082', 'Water + CO\u2082', 'Glucose + O\u2082'], correctIndex: 1, explanation: 'In yeast (fermentation), anaerobic respiration produces ethanol (alcohol) and CO\u2082. In human muscles, it produces lactic acid.' },
      { question: 'Which process produces more ATP?', questionHi: 'किस प्रक्रिया में अधिक ATP उत्पन्न होती है?', options: ['Aerobic respiration', 'Anaerobic respiration', 'Both produce equal ATP', 'Neither produces ATP'], correctIndex: 0, explanation: 'Aerobic respiration produces 38 ATP per glucose molecule, while anaerobic produces only 2 ATP. Complete breakdown releases more energy.' },
    ],
  },

  /* ──────────── 18. Pythagoras Theorem ──────────── */
  {
    id: 'exp-pythagoras',
    simulationId: 'builtin-pythagoras',
    title: 'Pythagoras Theorem: a\u00b2 + b\u00b2 = c\u00b2',
    titleHi: 'पाइथागोरस प्रमेय: a\u00b2 + b\u00b2 = c\u00b2',
    chapterRef: 'Class 10 Math Ch 6 — Triangles',
    grades: ['8', '9', '10'],
    subject: 'math',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective: 'Verify the Pythagorean theorem a\u00b2 + b\u00b2 = c\u00b2 using interactive right triangles. Identify right triangles and find missing sides.',
    objectiveHi: 'इंटरैक्टिव समकोण त्रिभुजों से पाइथागोरस प्रमेय a\u00b2 + b\u00b2 = c\u00b2 सत्यापित करें। समकोण त्रिभुज पहचानें और लुप्त भुजा ज्ञात करें।',
    observations: [
      { prompt: 'Verify: does 3\u00b2 + 4\u00b2 = 5\u00b2?', promptHi: 'सत्यापित करें: क्या 3\u00b2 + 4\u00b2 = 5\u00b2?', type: 'text' as const, expectedHint: '9 + 16 = 25, and 5\u00b2 = 25. Yes, 3-4-5 is a Pythagorean triplet.' },
      { prompt: 'If a = 6 and b = 8, find the hypotenuse c.', promptHi: 'यदि a = 6 और b = 8, तो कर्ण c ज्ञात करें।', type: 'number' as const, expectedHint: 'c\u00b2 = 6\u00b2 + 8\u00b2 = 36 + 64 = 100. So c = \u221a100 = 10.' },
      { prompt: 'Is 5, 12, 13 a right triangle? Verify using the theorem.', promptHi: 'क्या 5, 12, 13 एक समकोण त्रिभुज है? प्रमेय से सत्यापित करें।', type: 'select' as const, options: ['Yes', 'No', 'Cannot tell', 'Only if acute'], expectedHint: '5\u00b2 + 12\u00b2 = 25 + 144 = 169 = 13\u00b2. Yes, it is a right triangle.' },
    ],
    dataTable: { columns: ['S.No.', 'Side a', 'Side b', 'Hypotenuse c', 'a\u00b2 + b\u00b2', 'c\u00b2', 'Right triangle?'], rows: 4 },
    conclusionPrompt: 'State the Pythagorean theorem. Can it be applied to non-right triangles?',
    conclusionPromptHi: 'पाइथागोरस प्रमेय लिखें। क्या इसे गैर-समकोण त्रिभुजों पर लागू किया जा सकता है?',
    quizQuestions: [
      { question: 'In a right triangle with legs 5 and 12, the hypotenuse is:', questionHi: 'भुजाओं 5 और 12 वाले समकोण त्रिभुज का कर्ण है:', options: ['7', '10', '13', '17'], correctIndex: 2, explanation: 'c\u00b2 = 5\u00b2 + 12\u00b2 = 25 + 144 = 169. c = \u221a169 = 13.' },
      { question: 'Which set of numbers forms a right triangle?', questionHi: 'कौन सा संख्या समूह समकोण त्रिभुज बनाता है?', options: ['3, 4, 6', '8, 15, 17', '5, 7, 9', '2, 3, 4'], correctIndex: 1, explanation: '8\u00b2 + 15\u00b2 = 64 + 225 = 289 = 17\u00b2. So 8, 15, 17 is a Pythagorean triplet.' },
      { question: 'The Pythagorean theorem applies to:', questionHi: 'पाइथागोरस प्रमेय लागू होती है:', options: ['All triangles', 'Only right-angled triangles', 'Only isosceles triangles', 'Only equilateral triangles'], correctIndex: 1, explanation: 'The Pythagorean theorem (a\u00b2 + b\u00b2 = c\u00b2) applies ONLY to right-angled triangles, where c is the hypotenuse.' },
    ],
  },

  /* ──────────── 19. Punnett Square ──────────── */
  {
    id: 'exp-punnett-square',
    simulationId: 'builtin-punnett-square',
    title: 'Punnett Square: Mendelian Genetics',
    titleHi: 'पनेट वर्ग: मेंडल का आनुवंशिकी',
    chapterRef: 'Class 10 Science Ch 9 — Heredity and Evolution',
    grades: ['10', '12'],
    subject: 'biology',
    difficulty: 2,
    bloomLevel: 'apply',
    estimatedMinutes: 12,
    objective: 'Use Punnett squares to predict outcomes of monohybrid crosses. Understand dominant vs recessive traits and the 3:1 phenotypic ratio.',
    objectiveHi: 'पनेट वर्ग का उपयोग करके एकसंकर संकरण के परिणामों की भविष्यवाणी करें। प्रभावी व अप्रभावी लक्षणों और 3:1 अनुपात को समझें।',
    observations: [
      { prompt: 'Cross Tt \u00d7 Tt. What genotypes appear and in what ratio?', promptHi: 'Tt \u00d7 Tt का संकरण करें। कौन से जीनोटाइप किस अनुपात में प्राप्त होते हैं?', type: 'text' as const, expectedHint: 'TT : Tt : tt = 1 : 2 : 1. One homozygous dominant, two heterozygous, one homozygous recessive.' },
      { prompt: 'What is the phenotypic ratio of a Tt \u00d7 Tt cross?', promptHi: 'Tt \u00d7 Tt संकरण का लक्षणप्ररूपी (phenotypic) अनुपात क्या है?', type: 'select' as const, options: ['1:1', '1:2:1', '3:1', '4:0'], expectedHint: '3:1 — three show the dominant trait (TT + Tt + Tt) and one shows the recessive trait (tt).' },
      { prompt: 'What is the difference between genotype and phenotype?', promptHi: 'जीनोटाइप और फीनोटाइप में क्या अंतर है?', type: 'text' as const, expectedHint: 'Genotype is the genetic makeup (the letters, e.g., Tt). Phenotype is the physical trait expressed (e.g., tall or short).' },
    ],
    conclusionPrompt: "Explain Mendel's law of dominance using the Punnett square. Why does the recessive trait reappear in F2?",
    conclusionPromptHi: 'पनेट वर्ग का उपयोग करके मेंडल का प्रभाविता नियम समझाएँ। F2 पीढ़ी में अप्रभावी लक्षण फिर क्यों दिखता है?',
    quizQuestions: [
      { question: 'In a Tt \u00d7 Tt cross, the probability of homozygous recessive (tt) is:', questionHi: 'Tt \u00d7 Tt संकरण में समयुग्मजी अप्रभावी (tt) की प्रायिकता है:', options: ['1/2', '1/4', '3/4', '1'], correctIndex: 1, explanation: 'From the Punnett square: TT, Tt, Tt, tt. Only 1 out of 4 is tt. Probability = 1/4 or 25%.' },
      { question: "Mendel's law of dominance states:", questionHi: 'मेंडल का प्रभाविता नियम कहता है:', options: ['One allele dominates the other in heterozygous condition', 'Both alleles express equally', 'Neither allele expresses', 'Alleles are selected randomly'], correctIndex: 0, explanation: 'In a heterozygous organism (Tt), the dominant allele (T) masks the effect of the recessive allele (t), so only the dominant trait is visible.' },
      { question: 'The genotype Tt is called:', questionHi: 'Tt जीनोटाइप कहलाता है:', options: ['Homozygous dominant', 'Homozygous recessive', 'Heterozygous', 'Pure'], correctIndex: 2, explanation: 'Tt has two different alleles (one dominant T, one recessive t), making it heterozygous. TT would be homozygous dominant, tt homozygous recessive.' },
    ],
  },

  /* ──────────── 20. Quadratic Equation Grapher ──────────── */
  {
    id: 'exp-quadratic-graph',
    simulationId: 'builtin-quadratic-graph',
    title: 'Quadratic Equations: Parabola & Roots',
    titleHi: 'द्विघात समीकरण: परवलय और मूल',
    chapterRef: 'Class 10 Math Ch 4 — Quadratic Equations',
    grades: ['9', '10', '11'],
    subject: 'math',
    difficulty: 2,
    bloomLevel: 'understand',
    estimatedMinutes: 12,
    objective: 'Explore the graph of y = ax\u00b2 + bx + c. Understand how the coefficients a, b, c affect the shape, position, and roots of the parabola.',
    objectiveHi: 'y = ax\u00b2 + bx + c के ग्राफ़ को जानें। गुणांक a, b, c परवलय की आकृति, स्थिति और मूलों को कैसे प्रभावित करते हैं, समझें।',
    observations: [
      { prompt: 'What shape does the graph of y = x\u00b2 make?', promptHi: 'y = x\u00b2 का ग्राफ़ कैसी आकृति बनाता है?', type: 'select' as const, options: ['Straight line', 'Parabola opening upward', 'Parabola opening downward', 'Circle'], expectedHint: 'y = x\u00b2 creates a U-shaped curve called a parabola that opens upward (since a = 1 > 0).' },
      { prompt: 'What happens to the parabola when the value of a is negative?', promptHi: 'जब a का मान ऋणात्मक हो तो परवलय पर क्या प्रभाव पड़ता है?', type: 'select' as const, options: ['Opens upward', 'Opens downward', 'Becomes a straight line', 'No change'], expectedHint: 'When a < 0, the parabola opens downward (\u2229 shape). When a > 0, it opens upward (\u222a shape).' },
      { prompt: 'How many times does y = x\u00b2 \u2212 4 cross the x-axis, and at what points?', promptHi: 'y = x\u00b2 \u2212 4 x-अक्ष को कितनी बार काटता है और किन बिंदुओं पर?', type: 'text' as const, expectedHint: 'Twice, at x = \u22122 and x = 2. Setting y = 0: x\u00b2 \u2212 4 = 0, x\u00b2 = 4, x = \u00b12.' },
    ],
    conclusionPrompt: 'Explain how the coefficient a controls the direction of the parabola. How do the roots of a quadratic equation relate to where the graph crosses the x-axis?',
    conclusionPromptHi: 'गुणांक a परवलय की दिशा कैसे नियंत्रित करता है, समझाएँ। द्विघात समीकरण के मूल x-अक्ष से ग्राफ़ के कटान बिंदुओं से कैसे जुड़े हैं?',
    quizQuestions: [
      { question: 'The graph of y = x\u00b2 is called a:', questionHi: 'y = x\u00b2 का ग्राफ़ कहलाता है:', options: ['Parabola', 'Circle', 'Straight line', 'Hyperbola'], correctIndex: 0, explanation: 'The graph of any quadratic function y = ax\u00b2 + bx + c is a parabola \u2014 a U-shaped or inverted-U curve.' },
      { question: 'The roots of x\u00b2 \u2212 5x + 6 = 0 are:', questionHi: 'x\u00b2 \u2212 5x + 6 = 0 के मूल हैं:', options: ['1 and 6', '2 and 3', '\u22122 and \u22123', '5 and 6'], correctIndex: 1, explanation: 'Factoring: (x \u2212 2)(x \u2212 3) = 0, so x = 2 or x = 3. Verify: 2\u00b2 \u2212 5(2) + 6 = 0 \u2713' },
      { question: 'If the discriminant b\u00b2 \u2212 4ac < 0, the quadratic equation has:', questionHi: 'यदि विविक्तकर b\u00b2 \u2212 4ac < 0 हो तो द्विघात समीकरण के:', options: ['Two real roots', 'One real root', 'No real roots', 'Infinite roots'], correctIndex: 2, explanation: 'When b\u00b2 \u2212 4ac < 0, the parabola does not cross the x-axis, meaning the equation has no real roots (roots are complex/imaginary).' },
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
