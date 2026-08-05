/**
 * Tier-1 safeguarding screen (Foxy North-Star Phase 1, S5.6/U6).
 *
 * Pins:
 *   1. HIGH RECALL — genuine first-person disclosures hit, per category, in
 *      English + Hindi (Devanagari) + Hinglish (P7).
 *   2. PRECISION GUARDS — academic/curriculum phrasings ("suicide rates
 *      chapter", "violence in history") do NOT hit.
 *   3. Never throws; empty/garbage input → { hit: false, categories: [] }.
 *   4. Category order is fixed (self_harm first — Tier-2 fail-closed uses
 *      categories[0] as the escalation category).
 */
import { describe, expect, it } from 'vitest';
import {
  screenForSafeguarding,
  type SafeguardingCategory,
} from '@alfanumrik/lib/ai/validation/safeguarding-screen';

const expectHit = (message: string, category: SafeguardingCategory) => {
  const result = screenForSafeguarding(message);
  expect(result.hit, `expected HIT for: ${message}`).toBe(true);
  expect(result.categories, `expected category ${category} for: ${message}`).toContain(category);
};

const expectClean = (message: string) => {
  const result = screenForSafeguarding(message);
  expect(result.hit, `expected NO hit for: ${message}`).toBe(false);
  expect(result.categories).toEqual([]);
};

describe('screenForSafeguarding — self_harm (EN / Hindi / Hinglish)', () => {
  it.each([
    'I want to die',
    "honestly i don't want to live anymore",
    'I am going to kill myself',
    'i keep cutting myself at night',
    'sometimes I think about hurting myself',
    'I want to end my life',
    'everyone would be better off dead without me... I mean me',
    'I am going to commit suicide',
    'I feel suicidal these days',
    "i'm suicidal", // contraction form (regression: \s* not \s+ before 'm)
    // Method-specific phrasing (assessment-mandated 2026-08-05) — pills.
    'I took all the pills last night',
    'i want to swallow all the sleeping pills',
    'maybe I should just take tablets and sleep forever',
  ])('EN hit: %s', (msg) => expectHit(msg, 'self_harm'));

  it.each([
    'ab jeena nahi chahta yaar',
    'mujhe marna chahta hai wala feeling aati hai', // marna chahta
    'main mar jaunga ek din, sach mein',
    'khudkushi karne ka mann karta hai',
    'suicide kar lunga main',
    'apne aap ko khatam kar dunga',
    // Method-specific phrasing (assessment-mandated 2026-08-05).
    'phansi laga lunga main, sach bol raha hoon',
    'phaansi lagane ka sochta hoon roz', // loose transliteration (pha+nsi)
    'zeher kha lunga agar fail hua',
  ])('Hinglish hit: %s', (msg) => expectHit(msg, 'self_harm'));

  it.each([
    'मैं मरना चाहता हूँ',
    'मैं मरना चाहती हूँ',
    'अब जीना नहीं चाहता',
    'खुदकुशी का ख्याल आता है',
    'मैं खुद को चोट पहुंचाना चाहता हूं',
    // Method-specific phrasing (assessment-mandated 2026-08-05).
    'फांसी लगा लूंगा मैं',
    'फाँसी लगाने का सोचती हूँ', // chandrabindu spelling
    'ज़हर खा लूंगी मैं', // with nukta
    'जहर खा लूंगा एक दिन', // without nukta
  ])('Hindi hit: %s', (msg) => expectHit(msg, 'self_harm'));
});

describe('screenForSafeguarding — abuse (EN / Hindi / Hinglish)', () => {
  it.each([
    'my father hits me every day',
    'he beats me when he is drunk',
    'I am being abused at home',
    "i'm being abused at home", // contraction form
    'i was molested last year and never told anyone',
    'my uncle touches me badly',
    'someone touches me in a wrong way',
    'my cousin touched me and told me not to tell',
    // Sexual-assault disclosure (assessment-mandated 2026-08-05).
    'he raped me and said nobody will believe me',
    'i was raped last year and never told anyone',
    // Sextortion / photo blackmail (assessment-mandated 2026-08-05).
    'a senior is blackmailing me online',
    'he blackmailed me with screenshots',
    'he says he will make my photos viral if i tell anyone',
    'someone said my photo leak kar dega',
  ])('EN hit: %s', (msg) => expectHit(msg, 'abuse'));

  it.each([
    'ghar par mujhe roz maarte hain',
    'mujhe maarta hai woh bahut',
    'mujhe peette hain agar marks kam aaye',
    'woh galat tarike se chhuta hai mujhe',
    // Sexual-assault disclosure (assessment-mandated 2026-08-05).
    'balatkar hua mere saath, kisi ko mat batana',
    // Sextortion / photo blackmail (assessment-mandated 2026-08-05).
    'woh mujhe blackmail kar raha hai photos se',
    'meri photos viral kar dega bol raha hai',
    'meri photo bhej dunga sabko, aisa bolta hai',
  ])('Hinglish hit: %s', (msg) => expectHit(msg, 'abuse'));

  it.each([
    'मुझे मारते हैं घर पर',
    'घर पर मारते हैं मुझे रोज़',
    'मुझे पीटते हैं',
    'वह गलत तरीके से छूता है',
    // Sexual-assault disclosure (assessment-mandated 2026-08-05).
    'मेरे साथ बलात्कार हुआ था',
    // Sextortion / photo blackmail (assessment-mandated 2026-08-05).
    'वह धमकी देता है फोटो वायरल करने की',
    'मेरी फोटो वायरल कर देगा बोलता है',
  ])('Hindi hit: %s', (msg) => expectHit(msg, 'abuse'));
});

describe('screenForSafeguarding — violence (EN / Hindi / Hinglish)', () => {
  it.each([
    'I am going to kill him tomorrow',
    "i'll beat up that boy after school",
    'I will hurt them if they laugh again',
    'a senior is bringing a knife to school',
    'he threatened to kill me',
    'someone is going to hurt me after class',
  ])('EN hit: %s', (msg) => expectHit(msg, 'violence'));

  it.each([
    'usko jaan se maar dunga',
    'mujhe jaan se maarne ki dhamki di hai usne',
  ])('Hinglish hit: %s', (msg) => expectHit(msg, 'violence'));

  it.each([
    'वो मुझे जान से मारने की धमकी देता है',
    'मैं उसे मार डालूंगा',
  ])('Hindi hit: %s', (msg) => expectHit(msg, 'violence'));
});

describe('screenForSafeguarding — acute_distress (EN / Hindi / Hinglish)', () => {
  it.each([
    "I can't take it anymore",
    "i cant handle this anymore",
    'I hate my life',
    "i'm done with my life", // contraction form
    'I feel hopeless about everything',
    'everything is pointless now',
    'there is no point in trying anymore',
    'nobody cares about me',
    'I want to give up on everything',
  ])('EN hit: %s', (msg) => expectHit(msg, 'acute_distress'));

  it.each([
    'sab khatam ho gaya mere liye',
    'ab aur nahi seh sakta main',
    'koi meri parwah nahi karta',
    'main haar gaya hoon zindagi se',
  ])('Hinglish hit: %s', (msg) => expectHit(msg, 'acute_distress'));

  it.each([
    'सब खत्म हो गया',
    'अब और नहीं सह सकती',
    'कोई मेरी परवाह नहीं करता',
    'जीने का मन नहीं करता',
  ])('Hindi hit: %s', (msg) => expectHit(msg, 'acute_distress'));
});

describe('precision guards — academic / clinical / curriculum phrasings do NOT hit', () => {
  it.each([
    // Suicide as a curriculum/statistics topic, not a disclosure.
    'What does the chapter say about suicide rates in India?',
    'I have to write an essay on suicide prevention awareness',
    // Violence as history/civics content.
    'Describe the violence in history during the partition of India',
    'Why was there so much violence in the French Revolution?',
    // "die"/"kill" in science and general knowledge.
    'Why do plants die without water?',
    'The cell dies when the membrane breaks — explain',
    'Who killed Mahatma Gandhi?',
    'How do antibiotics kill the bacteria?',
    'My phone battery dies quickly during online class',
    // Word-boundary check: "die" must not match inside "diet".
    'I want to diet before sports day, what should I eat?',
    // Abuse as a civics definition / third-person story content.
    'What is domestic abuse? Explain for my civics project',
    'In the story the landlord beat the farmer — what does this show?',
    // Ordinary tutoring traffic.
    'Explain photosynthesis for class 7',
    'aaj kya padhu science mein?',
    'प्रकाश संश्लेषण क्या है?',
    'I got hurt in the football match, missed class — can you explain the chapter?',
    // Pharmacology / chemistry mentions of pills-tablets must NOT hit the
    // method-specific pills pattern (it requires a take/took/swallow verb
    // immediately before pills/tablets — verified, no tightening needed).
    'What is the paracetamol tablets dosage for fever in adults?',
    'How do iodine tablets purify water? Chemistry question',
    // Bare बलात्कार in civics/legal content (no first-person anchor) must NOT hit.
    'बलात्कार के विरुद्ध कानून पर नागरिक शास्त्र में क्या लिखा है?',
    'What does the law say about balatkar cases? Civics chapter question',
    // Ordinary photo/homework traffic must NOT hit the sextortion family.
    'photo homework bhej do',
    'meri photo gallery full ho gayi, notes kaise save karu?',
    // "हर खा…" (every meal) must NOT hit the ज़हर pattern (nukta-optional, not
    // letter-optional — encoding pinned here).
    'हर खाने से पहले हाथ धोना चाहिए — सही या नहीं?',
  ])('clean: %s', (msg) => expectClean(msg));

  // Hindi academic mention: आत्महत्या as a noun/statistic (no "कर" doing-frame).
  it('clean: आत्महत्या के आंकड़ों पर निबंध लिखना है', () => {
    expectClean('आत्महत्या के आंकड़ों पर निबंध लिखना है');
  });
});

describe('multi-category + ordering', () => {
  it('reports every matched category, self_harm first (Tier-2 uses categories[0])', () => {
    const result = screenForSafeguarding(
      "I can't take it anymore, I want to die",
    );
    expect(result.hit).toBe(true);
    expect(result.categories[0]).toBe('self_harm');
    expect(result.categories).toContain('acute_distress');
  });

  it('never duplicates a category even when several patterns of one family match', () => {
    const result = screenForSafeguarding('I want to die. I will kill myself.');
    expect(result.categories.filter((c) => c === 'self_harm')).toHaveLength(1);
  });
});

describe('robustness — never throws, fail-open contract', () => {
  it('empty string → no hit', () => {
    expectClean('');
  });

  it.each([
    [null],
    [undefined],
    [12345],
    [{ text: 'I want to die' }],
    [['I want to die']],
  ])('non-string input %s → no hit, no throw', (bad) => {
    // Runtime-hostile input (route bugs, mobile clients) must not crash the turn.
    const result = screenForSafeguarding(bad as unknown as string);
    expect(result).toEqual({ hit: false, categories: [] });
  });

  it('very long garbage input → no throw', () => {
    const garbage = '🦊'.repeat(20_000) + ' ￿' + 'x'.repeat(50_000);
    expect(() => screenForSafeguarding(garbage)).not.toThrow();
    expect(screenForSafeguarding(garbage).hit).toBe(false);
  });

  it('long input WITH a real disclosure buried inside still hits', () => {
    const msg = 'homework question about triangles… '.repeat(500) + ' ghar par mujhe maarte hain';
    expectHit(msg, 'abuse');
  });
});
