/**
 * Twilio webhook signature verification — unit tests.
 *
 * Covers `packages/lib/src/whatsapp/twilio-signature.ts`:
 *   - validateTwilioSignature(): HMAC-SHA1 over URL + alphabetically-sorted
 *     params (key+value appended), base64, timing-safe compare.
 *   - validateTwilioJsonSignature(): signature over URL only + bodySHA256
 *     query-param body-integrity check.
 *
 * Signatures are constructed independently in this file with node:crypto —
 * NO network, no Twilio SDK. Part of the WhatsApp bot Phase 1 slice
 * (plan-alfanumrik-whatsapp-bot-mighty-frost.md, Verification section).
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  validateTwilioSignature,
  validateTwilioJsonSignature,
} from '@alfanumrik/lib/whatsapp/twilio-signature';

const AUTH_TOKEN = 'test_twilio_auth_token_12345';
const URL_PLAIN = 'https://alfanumrik.com/api/whatsapp/webhook';

/** Reference implementation of Twilio's documented signing algorithm. */
function twilioSign(url: string, params: Record<string, string>, token: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

const SAMPLE_PARAMS: Record<string, string> = {
  MessageSid: 'SM1234567890abcdef1234567890abcdef',
  From: 'whatsapp:+919876543210',
  To: 'whatsapp:+911234567890',
  Body: 'Hello, I have a doubt about trigonometry',
  NumMedia: '0',
  WaId: '919876543210',
};

describe('validateTwilioSignature', () => {
  it('accepts a valid signature over URL + sorted params', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });

  it('is independent of param insertion order (impl must sort keys)', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    // Same params, deliberately reversed/random insertion order.
    const shuffled: Record<string, string> = {
      WaId: SAMPLE_PARAMS.WaId,
      Body: SAMPLE_PARAMS.Body,
      To: SAMPLE_PARAMS.To,
      NumMedia: SAMPLE_PARAMS.NumMedia,
      MessageSid: SAMPLE_PARAMS.MessageSid,
      From: SAMPLE_PARAMS.From,
    };
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: shuffled, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });

  it('rejects when a param value is tampered', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    const tampered = { ...SAMPLE_PARAMS, Body: 'Hello, I have a doubt about calculus' };
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: tampered, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when a param is added after signing', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    const extended = { ...SAMPLE_PARAMS, ButtonPayload: 'd6:a:2' };
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: extended, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects a signature made with the wrong auth token', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, 'some_other_token');
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when the signature header is missing (null)', () => {
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature: null, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when the signature is an empty string', () => {
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature: '', authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when the auth token is empty', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature, authToken: '' }),
    ).toBe(false);
  });

  it('rejects when the URL is empty', () => {
    const signature = twilioSign(URL_PLAIN, SAMPLE_PARAMS, AUTH_TOKEN);
    expect(
      validateTwilioSignature({ url: '', params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects garbage / non-base64 signature values without throwing', () => {
    for (const garbage of ['not-base64!!!', 'AAAA', 'zzzz====', '%%%']) {
      expect(
        validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature: garbage, authToken: AUTH_TOKEN }),
      ).toBe(false);
    }
  });

  it('binds the signature to the exact URL including its query string', () => {
    const urlWithQuery = `${URL_PLAIN}?foo=bar&baz=1`;
    const signature = twilioSign(urlWithQuery, SAMPLE_PARAMS, AUTH_TOKEN);

    expect(
      validateTwilioSignature({ url: urlWithQuery, params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
    // Same signature against the bare URL (query stripped) must fail.
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
    // And against a modified query string.
    expect(
      validateTwilioSignature({ url: `${URL_PLAIN}?foo=bar&baz=2`, params: SAMPLE_PARAMS, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('handles unicode (Hindi) and special-character param values', () => {
    const params = { ...SAMPLE_PARAMS, Body: 'त्रिकोणमिति में 9 + 10 = ? समझाइए & help' };
    const signature = twilioSign(URL_PLAIN, params, AUTH_TOKEN);
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });

  it('validates with an empty params object (signature over URL alone)', () => {
    const signature = twilioSign(URL_PLAIN, {}, AUTH_TOKEN);
    expect(
      validateTwilioSignature({ url: URL_PLAIN, params: {}, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });
});

describe('validateTwilioJsonSignature (bodySHA256 variant)', () => {
  const rawBody = JSON.stringify({ MessageStatus: 'delivered', MessageSid: 'SMabc' });
  const bodyHex = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const jsonUrl = `${URL_PLAIN}?bodySHA256=${bodyHex}`;

  it('accepts a valid URL-only signature + matching bodySHA256', () => {
    const signature = twilioSign(jsonUrl, {}, AUTH_TOKEN);
    expect(
      validateTwilioJsonSignature({ url: jsonUrl, rawBody, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });

  it('accepts uppercase-hex bodySHA256 (impl lowercases before compare)', () => {
    const upperUrl = `${URL_PLAIN}?bodySHA256=${bodyHex.toUpperCase()}`;
    const signature = twilioSign(upperUrl, {}, AUTH_TOKEN);
    expect(
      validateTwilioJsonSignature({ url: upperUrl, rawBody, signature, authToken: AUTH_TOKEN }),
    ).toBe(true);
  });

  it('rejects when the raw body was tampered (hash mismatch)', () => {
    const signature = twilioSign(jsonUrl, {}, AUTH_TOKEN);
    expect(
      validateTwilioJsonSignature({
        url: jsonUrl,
        rawBody: rawBody + ' ',
        signature,
        authToken: AUTH_TOKEN,
      }),
    ).toBe(false);
  });

  it('rejects when the URL signature itself is invalid', () => {
    const signature = twilioSign(jsonUrl, {}, 'wrong_token');
    expect(
      validateTwilioJsonSignature({ url: jsonUrl, rawBody, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when the bodySHA256 query param is absent', () => {
    // Signature is VALID for the bare URL — but without bodySHA256 there is no
    // body integrity, so the JSON variant must fail closed.
    const signature = twilioSign(URL_PLAIN, {}, AUTH_TOKEN);
    expect(
      validateTwilioJsonSignature({ url: URL_PLAIN, rawBody, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    expect(
      validateTwilioJsonSignature({ url: jsonUrl, rawBody, signature: null, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });

  it('rejects an unparseable URL without throwing', () => {
    const signature = twilioSign('::not a url::', {}, AUTH_TOKEN);
    expect(
      validateTwilioJsonSignature({ url: '::not a url::', rawBody, signature, authToken: AUTH_TOKEN }),
    ).toBe(false);
  });
});
