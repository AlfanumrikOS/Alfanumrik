/**
 * WhatsApp inbound intent classifier — unit tests.
 *
 * Covers `packages/lib/src/whatsapp/intent.ts`: parseInbound(),
 * classifyControlKeyword(), and the 4-tier classifyIntent() resolution order
 * (ButtonPayload opcodes → keyword table → message type → state fallback),
 * including precedence conflicts between tiers.
 *
 * PINNED-ACTUAL notes (gaps flagged in the test report, not silently ignored):
 *   - LINK accepts 4–8 digits (plan text said "6 digits"; impl is wider).
 *
 * RESOLVED (2026-07-29): Devanagari control aliases (रोको/बंद/बंद करो → stop,
 * शुरू/शुरू करो/चालू → start, मदद/सहायता → help) are now implemented with
 * NFC normalization before matching; the former PINNED GAP tests below were
 * flipped to assert the correct behavior.
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  parseInbound,
  classifyIntent,
  classifyControlKeyword,
  type NormalizedInbound,
  type WaSessionState,
} from '@alfanumrik/lib/whatsapp/intent';

function msg(overrides: Partial<NormalizedInbound> = {}): NormalizedInbound {
  return {
    messageSid: 'SM_test_1',
    phoneE164: '+919876543210',
    waId: '919876543210',
    body: '',
    numMedia: 0,
    ...overrides,
  };
}

const classify = (m: NormalizedInbound, state: WaSessionState = 'idle') =>
  classifyIntent(m, state);

describe('parseInbound', () => {
  const BASE_PARAMS = {
    MessageSid: 'SMabc123',
    From: 'whatsapp:+919876543210',
    Body: 'hello',
    WaId: '919876543210',
    NumMedia: '0',
  };

  it('normalizes a standard Twilio text message', () => {
    const m = parseInbound(BASE_PARAMS);
    expect(m).not.toBeNull();
    expect(m!.messageSid).toBe('SMabc123');
    expect(m!.phoneE164).toBe('+919876543210');
    expect(m!.waId).toBe('919876543210');
    expect(m!.body).toBe('hello');
    expect(m!.numMedia).toBe(0);
    expect(m!.buttonPayload).toBeUndefined();
  });

  it('returns null when MessageSid is missing', () => {
    const { MessageSid: _omit, ...rest } = BASE_PARAMS;
    expect(parseInbound(rest)).toBeNull();
  });

  it('falls back to SmsMessageSid when MessageSid is absent', () => {
    const { MessageSid: _omit, ...rest } = BASE_PARAMS;
    const m = parseInbound({ ...rest, SmsMessageSid: 'SMS_fallback' });
    expect(m).not.toBeNull();
    expect(m!.messageSid).toBe('SMS_fallback');
  });

  it('returns null when From is missing or not a valid phone', () => {
    const { From: _omit, ...rest } = BASE_PARAMS;
    expect(parseInbound(rest)).toBeNull();
    expect(parseInbound({ ...BASE_PARAMS, From: 'whatsapp:banana' })).toBeNull();
  });

  it('derives waId from the phone when the WaId param is absent or malformed', () => {
    const { WaId: _omit, ...rest } = BASE_PARAMS;
    expect(parseInbound(rest)!.waId).toBe('919876543210');
    expect(parseInbound({ ...BASE_PARAMS, WaId: '0garbage' })!.waId).toBe('919876543210');
  });

  it('parses NumMedia defensively (non-numeric / negative → 0)', () => {
    expect(parseInbound({ ...BASE_PARAMS, NumMedia: '2' })!.numMedia).toBe(2);
    expect(parseInbound({ ...BASE_PARAMS, NumMedia: 'abc' })!.numMedia).toBe(0);
    expect(parseInbound({ ...BASE_PARAMS, NumMedia: '-1' })!.numMedia).toBe(0);
    const { NumMedia: _omit, ...rest } = BASE_PARAMS;
    expect(parseInbound(rest)!.numMedia).toBe(0);
  });

  it('treats empty-string optional params as absent', () => {
    const m = parseInbound({ ...BASE_PARAMS, ButtonPayload: '', MediaUrl0: '', ProfileName: '' });
    expect(m!.buttonPayload).toBeUndefined();
    expect(m!.mediaUrl0).toBeUndefined();
    expect(m!.profileName).toBeUndefined();
  });

  it('carries ReferralSourceId through (the free_entry 72h window signal)', () => {
    const m = parseInbound({ ...BASE_PARAMS, ReferralSourceId: 'wa_me_link_1' });
    expect(m!.referralSourceId).toBe('wa_me_link_1');
  });
});

describe('classifyControlKeyword — regulatory tier', () => {
  it.each([
    ['STOP', 'stop'],
    ['stop', 'stop'],
    ['  Stop  ', 'stop'],
    ['STOP ', 'stop'],
    ['BAND', 'stop'],
    ['band', 'stop'],
    ['ROKO', 'stop'],
    ['roko', 'stop'],
    ['UNSUBSCRIBE', 'stop'],
    ['START', 'start'],
    ['start', 'start'],
    ['SHURU', 'start'],
    ['shuru', 'start'],
    ['HELP', 'help'],
    ['MADAD', 'help'],
    ['madad', 'help'],
  ] as const)('"%s" → %s', (body, expected) => {
    expect(classifyControlKeyword(body)).toBe(expected);
  });

  it('requires an exact keyword — embedded words do not match', () => {
    expect(classifyControlKeyword('stop it')).toBeNull();
    expect(classifyControlKeyword('please STOP')).toBeNull();
    expect(classifyControlKeyword('restart')).toBeNull();
  });

  describe('Devanagari aliases (formerly PINNED GAP — implemented 2026-07-29)', () => {
    it.each([
      ['रोको', 'stop'],
      ['बंद', 'stop'],
      ['बंद करो', 'stop'],
      ['  बंद   करो  ', 'stop'], // trim + internal-whitespace collapse
      ['शुरू', 'start'],
      ['शुरू करो', 'start'],
      ['चालू', 'start'],
      ['मदद', 'help'],
      ['सहायता', 'help'],
    ] as const)('"%s" → %s', (body, expected) => {
      expect(classifyControlKeyword(body)).toBe(expected);
    });

    it('matches decomposed (NFD) input — NFC normalization happens before matching', () => {
      // .toUpperCase() is a no-op for Devanagari, so the match path must rely
      // on NFC canonicalization + exact-string comparison, not case folding.
      expect(classifyControlKeyword('रोको'.normalize('NFD'))).toBe('stop');
      expect(classifyControlKeyword('बंद'.normalize('NFD'))).toBe('stop');
      expect(classifyControlKeyword('शुरू'.normalize('NFD'))).toBe('start');
      expect(classifyControlKeyword('मदद'.normalize('NFD'))).toBe('help');
    });

    it('embedded Devanagari keywords do not match (exact keyword only)', () => {
      expect(classifyControlKeyword('कृपया बंद')).toBeNull();
      expect(classifyControlKeyword('मदद चाहिए')).toBeNull();
    });
  });
});

describe('classifyIntent — tier 1: ButtonPayload opcodes', () => {
  it('d6:a:<n> → d6_answer with the answer index arg', () => {
    expect(classify(msg({ buttonPayload: 'd6:a:2' }))).toEqual({
      intent: 'd6_answer',
      args: { answer: '2' },
    });
  });

  it('OPCODE TIER WINS over a STOP body inside classifyIntent (pinned actual)', () => {
    // Resolution order: ButtonPayload first. Note the ROUTE separately runs
    // classifyControlKeyword(body) BEFORE classifyIntent, so at the webhook
    // level a STOP body still wins — this pins the classifier's own order.
    expect(classify(msg({ buttonPayload: 'd6:a:2', body: 'STOP' }))).toEqual({
      intent: 'd6_answer',
      args: { answer: '2' },
    });
  });

  it.each([
    ['d6:q', 'd6_quit'],
    ['db:next', 'db_next'],
    ['db:stuck', 'db_stuck'],
    ['db:got', 'db_got'],
    ['menu', 'menu'],
  ] as const)('opcode %s → %s', (payload, intent) => {
    expect(classify(msg({ buttonPayload: payload })).intent).toBe(intent);
  });

  it('nb:rt:<id> and sw:<student_id> extract their args', () => {
    expect(classify(msg({ buttonPayload: 'nb:rt:misc-42' }))).toEqual({
      intent: 'nb_retest',
      args: { id: 'misc-42' },
    });
    expect(classify(msg({ buttonPayload: 'sw:stu-uuid-1' }))).toEqual({
      intent: 'switch_student',
      args: { student_id: 'stu-uuid-1' },
    });
  });

  it('unknown opcode falls through to the keyword tier (Twilio copies ButtonText into Body)', () => {
    expect(classify(msg({ buttonPayload: 'xx:unknown', body: 'MENU' })).intent).toBe('menu');
  });

  it('unknown opcode with free-text body falls through to the state tier', () => {
    expect(classify(msg({ buttonPayload: 'xx:unknown', body: 'what is osmosis' }), 'idle').intent).toBe(
      'doubt_text',
    );
  });
});

describe('classifyIntent — tier 2: keyword table', () => {
  it('LINK <otp> extracts the code (4–8 digits, pinned actual — plan said 6)', () => {
    expect(classify(msg({ body: 'LINK 481920' }))).toEqual({
      intent: 'link',
      args: { otp: '481920' },
    });
    expect(classify(msg({ body: 'link 4819' })).intent).toBe('link');
    expect(classify(msg({ body: 'LINK 12345678' })).intent).toBe('link');
  });

  it('LINK with out-of-range digit counts is NOT a link (falls to doubt_text)', () => {
    expect(classify(msg({ body: 'LINK 123' }), 'idle').intent).toBe('doubt_text');
    expect(classify(msg({ body: 'LINK 123456789' }), 'idle').intent).toBe('doubt_text');
  });

  it('LINK tolerates repeated internal whitespace (canonicalization)', () => {
    expect(classify(msg({ body: 'LINK   481920' }))).toEqual({
      intent: 'link',
      args: { otp: '481920' },
    });
  });

  it('bare START is opt-in (start), NOT the menu', () => {
    expect(classify(msg({ body: 'START' })).intent).toBe('start');
    expect(classify(msg({ body: 'start' })).intent).toBe('start');
  });

  it('STOP body with no ButtonPayload classifies as stop regardless of state', () => {
    expect(classify(msg({ body: 'STOP' }), 'daily6_active').intent).toBe('stop');
    expect(classify(msg({ body: 'roko' }), 'doubt_ladder_active').intent).toBe('stop');
    expect(classify(msg({ body: 'बंद' }), 'daily6_active').intent).toBe('stop');
  });

  it.each([
    ['MENU', 'menu'],
    ['HI', 'menu'],
    ['hello', 'menu'],
    ['NAMASTE', 'menu'],
    ['UNLINK', 'unlink'],
  ] as const)('"%s" → %s', (body, intent) => {
    expect(classify(msg({ body })).intent).toBe(intent);
  });

  it('HINDI / ENGLISH set the language with a locale arg', () => {
    expect(classify(msg({ body: 'HINDI' }))).toEqual({
      intent: 'set_language',
      args: { locale: 'hi' },
    });
    expect(classify(msg({ body: 'english' }))).toEqual({
      intent: 'set_language',
      args: { locale: 'en' },
    });
  });
});

describe('classifyIntent — tier 3: message type', () => {
  it('image media → doubt_image, whatever the (non-keyword) caption says', () => {
    const m = msg({ numMedia: 1, mediaContentType0: 'image/jpeg', body: 'solve this please' });
    expect(classify(m).intent).toBe('doubt_image');
  });

  it('content-type match is case-insensitive', () => {
    const m = msg({ numMedia: 1, mediaContentType0: 'IMAGE/PNG' });
    expect(classify(m).intent).toBe('doubt_image');
  });

  it('PINNED ACTUAL: an image whose caption is exactly STOP classifies as stop (keyword tier precedes media)', () => {
    const m = msg({ numMedia: 1, mediaContentType0: 'image/jpeg', body: 'STOP' });
    expect(classify(m).intent).toBe('stop');
  });

  it('audio / video / document / unknown media → unsupported (never an LLM call)', () => {
    expect(classify(msg({ numMedia: 1, mediaContentType0: 'audio/ogg' })).intent).toBe('unsupported');
    expect(classify(msg({ numMedia: 1, mediaContentType0: 'video/mp4' })).intent).toBe('unsupported');
    expect(classify(msg({ numMedia: 1, mediaContentType0: 'application/pdf' })).intent).toBe('unsupported');
    expect(classify(msg({ numMedia: 1 })).intent).toBe('unsupported'); // no content type at all
  });

  it('media wins over the state fallback even mid-Daily-6', () => {
    const m = msg({ numMedia: 1, mediaContentType0: 'image/jpeg', body: 'q3 doubt' });
    expect(classify(m, 'daily6_active').intent).toBe('doubt_image');
  });

  it('empty / whitespace-only non-media message → unsupported', () => {
    expect(classify(msg({ body: '' })).intent).toBe('unsupported');
    expect(classify(msg({ body: '   ' })).intent).toBe('unsupported');
  });
});

describe('classifyIntent — tier 4: state-directed fallback', () => {
  const FREE_TEXT = 'why does the moon have phases';

  it('free text while idle → doubt_text', () => {
    expect(classify(msg({ body: FREE_TEXT }), 'idle').intent).toBe('doubt_text');
  });

  it('free text while awaiting_doubt → doubt_text', () => {
    expect(classify(msg({ body: FREE_TEXT }), 'awaiting_doubt').intent).toBe('doubt_text');
  });

  it('free text mid-Daily-6 → d6_nudge, NOT doubt_text', () => {
    expect(classify(msg({ body: FREE_TEXT }), 'daily6_active')).toEqual({
      intent: 'd6_nudge',
      args: {},
    });
  });

  it('PINNED ACTUAL: free text during doubt_ladder_active → doubt_text (only daily6_active nudges)', () => {
    expect(classify(msg({ body: FREE_TEXT }), 'doubt_ladder_active').intent).toBe('doubt_text');
  });
});
