/**
 * Safeguarding Screen — Tier-1 HIGH-RECALL disclosure detector for the STUDENT
 * MESSAGE, run before prompt assembly (Foxy North-Star Phase 1, S5.6/U6;
 * pattern-clone of input-guard.ts: pure, synchronous, never throws).
 *
 * WHY THIS EXISTS
 * ---------------
 * S1.7 (Foxy Guardian) audit: the safety chain had injection, scope, quota and
 * output screening — but ZERO detection of self-harm / abuse / violence /
 * acute-distress disclosures (verified zero hits for safeguard/crisis/helpline
 * in the spec's gap table). This is the first stage of the two-tier flow:
 *
 *   Tier 1 (this file)  — cheap regex families, HIGH RECALL, EN + Hindi
 *                          (Devanagari) + Hinglish transliterations (P7).
 *   Tier 2              — LLM confirmation (safeguarding-classify.ts),
 *                          conservative threshold, FAIL-CLOSED after a Tier-1
 *                          hit. Precision is Tier 2's job; recall is ours.
 *
 * PRECISION GUARDS (documented per family below): academic/clinical mentions
 * must NOT hit — "suicide rates chapter in sociology", "violence in history",
 * "the cell dies without water" are curriculum questions. Wherever feasible the
 * patterns require FIRST-PERSON / DISCLOSURE framing ("I want to…", "…hits ME",
 * "mujhe…", "मुझे…"). A few deliberately looser families (e.g. खुदकुशी) trade
 * precision for recall because Tier 2 confirms before any escalation.
 *
 * P13: pure string scan; callers log the category BOOLEANS only, never the
 * message text. The result feeds the Tier-2 classifier and the safeguarding
 * escalation row (categories, not content).
 *
 * Owner: ai-engineer. Pattern-family changes reviewed by assessment
 * (age-appropriateness + Hindi correctness — P7/P12).
 */

export type SafeguardingCategory = 'self_harm' | 'abuse' | 'violence' | 'acute_distress';

export interface SafeguardingScreenResult {
  /** True when at least one category family fired. */
  hit: boolean;
  /** Matched categories in fixed severity order (self_harm first). */
  categories: SafeguardingCategory[];
}

// ─── Pattern families ────────────────────────────────────────────────────────
//
// Each category is a list of independent regexes; ONE match flags the
// category. All case-insensitive. Hinglish spellings are deliberately loose
// (nahi/nahin, marna/mar na) because transliteration is unstandardized.

/**
 * SELF-HARM IDEATION — first-person intent to die / hurt oneself.
 * Precision guards:
 *  - "die"/"kill" require the first person ("I want to die", "kill myself") so
 *    "the cell dies", "plants die without water", "killing of Gandhi" never hit.
 *  - "suicide" requires committing/attempting framing or first-person state
 *    ("commit suicide", "suicide kar lunga", "I feel suicidal") so "suicide
 *    rates chapter" / "essay on suicide prevention" never hit.
 */
const SELF_HARM_PATTERNS: ReadonlyArray<RegExp> = [
  // EN — first-person death wish / self-injury.
  /\bi\s+(?:want|wanna|wanted|wish|really\s+want)\s+to\s+die\b/i,
  /\bi\s+(?:don'?t|dont|do\s+not|no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|exist)\b/i,
  /\bkill(?:ing)?\s+myself\b/i,
  /\b(?:hurt|hurting|harm|harming|cut|cutting)\s+myself\b/i,
  /\bend(?:ing)?\s+(?:my\s+life|it\s+all)\b/i,
  /\bbetter\s+off\s+dead\b/i,
  // EN — suicide with disclosure framing only (see precision guard above).
  /\b(?:commit|committing|attempt|attempting|do|doing)\s+suicide\b/i,
  // `\s*` (not `\s+`) before the alternation so contractions match ("i'm").
  /\bi\s*(?:am|'m|feel|have\s+been\s+feeling)\s+suicidal\b/i,
  // Hinglish — "jeena nahi chahta/chahti", "marna chahta hun", "mar jaunga".
  /\bjee?na\s+nahi+n?\s+(?:chah?t[aei]|hai)/i,
  /\bmar+\s*na\s+chah?t[aei]/i,
  /\bmar\s+jaa?[ou]n(?:ga|gi)?\b/i,
  /\bkhud\s*k[ou]shi\b/i, // khudkushi (suicide)
  /\bsuicide\s+kar/i, // "suicide kar lunga / karna chahta hoon"
  /\bapne\s*(?:aap|app)\s*ko\s+(?:khatam|hurt|chot|maar)/i,
  /\bzindagi\s+khatam\s+kar/i,
  // Hindi (Devanagari) — मरना चाहता/चाहती, जीना नहीं चाहत…, खुदकुशी, आत्महत्या
  // कर…, खुद को चोट/नुकसान पहुंचा…
  /मरना\s*चाहत[ाी]/,
  /जीना\s*नहीं\s*चाहत/,
  /खुदकुशी/,
  /आत्म\s*हत्या\s*कर/, // "…कर(ना चाहता/लूंगा)" — the doing framing, not the noun alone
  /खुद\s*को\s*(?:चोट|नुकसान)\s*पहुं?ँ?चा/,
  // Method-specific phrasing (assessment-mandated 2026-08-05). "phansi laga…"
  // / "फांसी लगा…" (hanging), "zeher kha…" / "ज़हर खा…" (poison), and the EN
  // pills family. Precision notes:
  //  - the pills pattern requires a take/took/swallow verb IMMEDIATELY before
  //    pills/tablets, so pharmacology traffic ("paracetamol tablets dosage")
  //    does not hit (verified in the test file);
  //  - ज़हर is matched with an OPTIONAL nukta (ज+◌़?) so both जहर and ज़हर hit
  //    while bare "हर खा…" ("हर खाने से पहले…") does not — pinned by tests.
  /\bpha+nsi\s+laga/i,
  /फा[ंँ]सी\s*लगा/, // anusvara + chandrabindu spellings (फांसी / फाँसी)
  /\bzeh?er\s+kha/i,
  /ज़?हर\s*खा/, // ज + optional nukta + हर — जहर / ज़हर, never bare हर
  /\b(?:take|took|swallow(?:ed)?)\s+(?:all\s+the\s+)?(?:pills|sleeping\s+pills|tablets)\b/i,
];

/**
 * ABUSE DISCLOSURE — someone hitting / beating / touching the student.
 * Precision guards: every pattern is anchored on the student as OBJECT
 * ("…hits ME", "mujhe maarte", "मुझे मारते") or first-person state ("I am
 * being abused"), so history/civics content about violence or a story
 * character being beaten does not hit.
 */
const ABUSE_PATTERNS: ReadonlyArray<RegExp> = [
  // EN — physical abuse of the student.
  /\b(?:hits?|hitting|beats?|beating|slaps?|slapping|hurts?|hurting|punches?)\s+me\b/i,
  // `\s*` so "i'm being abused" (contraction) matches too.
  /\bi\s*(?:am|'m|get|got|was|have\s+been)\s+(?:being\s+)?(?:abused|molested|beaten)\b/i,
  /\babus(?:es|ing)\s+me\b/i,
  // EN — inappropriate touching (disclosure framing: object is "me").
  /\btouch(?:es|ed|ing)?\s+me\s+(?:inappropriately|badly|there)\b/i,
  /\btouch(?:es|ed|ing)?\s+me\s+in\s+a\s+(?:bad|wrong)\s+(?:way|place)\b/i,
  /\b(?:someone|he|she|they|uncle|aunty|teacher|cousin)\s+touch(?:es|ed)\s+me\b/i,
  // Hinglish — "ghar par maarte hain", "mujhe maarta/peetta hai",
  // "galat tarike se chhuta hai".
  /\bghar\s+p[ae]r?\b[^.?!\n]{0,30}\bmaa?rte?\s+hai/i,
  /\bmujhe\s+(?:bahut\s+)?maa?r(?:t[aei]|te)\b/i,
  /\bmujhe\s+pee?t(?:t[aei]|te)\b/i,
  /\bgalat\s+(?:tarah|tari?ke)\s+se\s+(?:chh?oo?|chhu|touch)/i,
  // Hindi (Devanagari) — मुझे मारत…, घर पर मारते…, मुझे पीटत…,
  // गलत तरीके से छूत…
  /मुझे\s+मारत/,
  /घर\s+पर\s+मारते/,
  /मुझे\s+पीटत/,
  /गलत\s+तरीके?\s+से\s+छूत/,
  // Sexual-assault disclosure (assessment-mandated 2026-08-05). FIRST-PERSON
  // anchored: bare "बलात्कार" / "balatkar" appears in civics/legal curriculum
  // content ("बलात्कार के विरुद्ध कानून…") and must NOT hit — the Devanagari
  // form requires "मेरे साथ …", the Hinglish form requires mera/mere/mujh
  // within 20 chars after the word. Pinned by tests.
  /\brap(?:ed|es|ing)\s+me\b/i,
  /\bi\s+was\s+raped\b/i,
  /\bbala?tka+r\b[^.?!\n]{0,20}\b(?:mera|mere|mujh)/i,
  /मेरे?\s*साथ\s*बलात्कार/,
  // Sextortion / photo-blackmail (assessment-mandated 2026-08-05). The photo
  // pattern is anchored on possession ("meri/my photo …") so ordinary tutoring
  // traffic ("photo homework bhej do") does not hit — pinned by tests.
  /\bblackmail\s+kar/i,
  /\bblackmail(?:s|ing|ed)?\s+me\b/i,
  /\b(?:meri|my)\s+photo[s]?\b[^.?!\n]{0,30}\b(?:viral|leak|send|bhej)/i,
  /धमकी\s*दे[^।\n]{0,30}फोटो|फोटो[^।\n]{0,30}वायरल/,
];

/**
 * VIOLENCE THREAT — the student threatening others, or being threatened.
 * Precision guards: requires first-person actor ("I will kill/hurt …") or the
 * student as target ("threatened to kill ME", "mujhe jaan se maarne ki
 * dhamki"), so "violence in history", "the war killed millions", "describe
 * the violence during partition" never hit. `(?!myself)` keeps "kill myself"
 * in the self-harm family, not here.
 */
const VIOLENCE_PATTERNS: ReadonlyArray<RegExp> = [
  // EN — student as threat actor.
  // `\s*` so contractions match ("i'll beat up…", "i'm going to…").
  /\bi\s*(?:will|'ll|want\s+to|am\s+going\s+to|'m\s+going\s+to|plan\s+to)\s+(?:kill|stab|shoot|attack|beat\s+up)\s+(?!myself\b)/i,
  /\bi\s*(?:will|'ll|want\s+to|am\s+going\s+to|'m\s+going\s+to)\s+hurt\s+(?:him|her|them|someone|everyone|my\s+\w+)\b/i,
  /\bbring(?:ing)?\s+a\s+(?:knife|gun|weapon)\s+to\s+school\b/i,
  // EN — student as target of threats.
  /\bthreat(?:ens?|ened|ening)\s+(?:to\s+(?:kill|hurt|beat)\s+)?me\b/i,
  /\b(?:someone|he|she|they)\s+(?:will|wants?\s+to|is\s+going\s+to)\s+(?:kill|hurt|beat)\s+me\b/i,
  // Hinglish — "usko jaan se maar dunga", "mujhe jaan se maarne ki dhamki".
  /\bjaan\s+se\s+maar\s+d/i,
  /\bus(?:e|ko)\s+maar\s+d(?:oon|un)g[ai]\b/i,
  /\bmaarne\s+ki\s+dhamki/i,
  // Hindi (Devanagari) — जान से मार…, मार डालूंगा/डालूँगी, मारने की धमकी.
  /जान\s+से\s+मार/,
  /मार\s+डाल(?:ूंगा|ूँगा|ूंगी|ूँगी)/,
  /मारने\s+की\s+धमकी/,
];

/**
 * ACUTE DISTRESS — "can't take it anymore" / hopelessness / "sab khatam".
 * Deliberately the loosest family (no ideation yet, but a student who should
 * not get a plain tutoring answer). Precision guards: first-person framing
 * ("I can't take it", "I hate my life", "koi meri parwah nahi") so exam-prep
 * hyperbole about a CHAPTER ("this chapter is hopeless"?) mostly stays out —
 * "hopeless" alone never hits, it must be "I feel hopeless" / "everything is
 * hopeless".
 */
const ACUTE_DISTRESS_PATTERNS: ReadonlyArray<RegExp> = [
  // EN
  /\bi\s+can'?t\s+(?:take|handle|bear)\s+(?:it|this)\s+any\s*more\b/i,
  // `\s*` so contractions match ("i'm done with my life", "i'm hopeless").
  /\bi\s*(?:hate|'m\s+done\s+with)\s+my\s+life\b/i,
  /\bi\s*(?:feel|am|'m)\s+(?:hopeless|worthless|empty\s+inside)\b/i,
  /\b(?:everything|it\s+all)\s+(?:is|feels)\s+(?:over|hopeless|pointless)\b/i,
  /\bno\s+point\s+(?:in\s+)?(?:living|trying|anything)\s*(?:any\s*more)?\b/i,
  /\bnobody\s+(?:cares|loves|would\s+miss)\s+(?:about\s+)?me\b/i,
  /\bi\s+(?:want\s+to\s+)?give\s+up\s+on\s+(?:everything|life)\b/i,
  // Hinglish — "sab khatam (ho gaya)", "ab aur nahi seh/sah sakta",
  // "koi (meri) parwah nahi karta", "main haar gaya hoon".
  /\bsab\s+(?:kuchh?\s+)?khat+am\b/i,
  /\bab\s+(?:aur\s+)?nahi+n?\s+(?:seh|sah)/i,
  /\bkoi\s+(?:meri\s+)?parwah?\s+nahi/i,
  /\bmain?\s+haar\s+ga?y[ai]\b/i,
  // Hindi (Devanagari) — सब ख़त्म, अब और नहीं सह…, कोई परवाह नहीं,
  // जीने का मन नहीं.
  /सब\s+(?:कुछ\s+)?ख़?त्?म/,
  /अब\s+और\s+नहीं\s+सह/,
  /कोई\s+(?:मेरी\s+)?परवाह\s+नहीं/,
  /जीने\s+का\s+(?:कोई\s+)?मन\s+नहीं/,
];

/** Fixed severity order: self_harm outranks everything (Tier-2 fail-closed uses categories[0]). */
const FAMILIES: ReadonlyArray<[SafeguardingCategory, ReadonlyArray<RegExp>]> = [
  ['self_harm', SELF_HARM_PATTERNS],
  ['abuse', ABUSE_PATTERNS],
  ['violence', VIOLENCE_PATTERNS],
  ['acute_distress', ACUTE_DISTRESS_PATTERNS],
];

/**
 * Tier-1 safeguarding screen. Pure, synchronous, never throws.
 *
 * Returns every matched category (severity order) so Tier 2 can confirm and
 * the escalation row can record the full signal. The overwhelming common case
 * (a normal curriculum question) returns `{ hit: false, categories: [] }` and
 * costs a handful of regex tests.
 */
export function screenForSafeguarding(message: string): SafeguardingScreenResult {
  try {
    if (typeof message !== 'string' || message.length === 0) {
      return { hit: false, categories: [] };
    }
    const categories: SafeguardingCategory[] = [];
    for (const [category, patterns] of FAMILIES) {
      if (patterns.some((re) => re.test(message))) categories.push(category);
    }
    return { hit: categories.length > 0, categories };
  } catch {
    // Fail-open on the INPUT side (same rationale as input-guard.ts): a
    // heuristic failure must not break the student's turn. The prompt rails,
    // output screen, and Tier-2 classifier on OTHER turns remain the backstop;
    // a crash here would silently drop the tutoring response entirely.
    return { hit: false, categories: [] };
  }
}
