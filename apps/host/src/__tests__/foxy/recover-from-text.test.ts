/**
 * Locks in the regression fix for the May-2026 prod incident where Foxy
 * leaked raw ```json {...}``` into the chat bubble. The screenshot showed
 * the model's structured-output JSON wrapped in a markdown fence, which
 * fell through `extractValidatedStructured` (because `structured` was
 * absent from the upstream envelope) and then through the markdown
 * renderer (which displayed the fence verbatim).
 */
import { describe, it, expect } from 'vitest';
import { recoverFoxyResponseFromText } from '@alfanumrik/lib/foxy/recover-from-text';

const validResponse = {
  title: 'Exam Prep: Onion as Olfactory Indicator',
  subject: 'science',
  blocks: [
    { type: 'paragraph', text: 'An olfactory indicator changes smell with acid/base.' },
    { type: 'step', label: 'Step 1: Setup', text: 'Take a fresh onion bulb.' },
  ],
};

describe('recoverFoxyResponseFromText', () => {
  it('returns null for non-string input', () => {
    expect(recoverFoxyResponseFromText(null)).toBeNull();
    expect(recoverFoxyResponseFromText(undefined)).toBeNull();
    expect(recoverFoxyResponseFromText(42)).toBeNull();
    expect(recoverFoxyResponseFromText({})).toBeNull();
  });

  it('returns null for empty / non-JSON-looking input', () => {
    expect(recoverFoxyResponseFromText('')).toBeNull();
    expect(recoverFoxyResponseFromText('Hello, how can I help?')).toBeNull();
    expect(recoverFoxyResponseFromText('Not JSON at all.')).toBeNull();
  });

  it('recovers from a ```json fenced block (the prod regression)', () => {
    const fenced = '```json\n' + JSON.stringify(validResponse) + '\n```';
    const recovered = recoverFoxyResponseFromText(fenced);
    expect(recovered).not.toBeNull();
    expect(recovered?.title).toBe(validResponse.title);
    expect(recovered?.blocks).toHaveLength(2);
  });

  it('recovers from a bare ``` fenced block (no language tag)', () => {
    const fenced = '```\n' + JSON.stringify(validResponse) + '\n```';
    expect(recoverFoxyResponseFromText(fenced)).not.toBeNull();
  });

  it('recovers from a ```JSON fenced block (case-insensitive)', () => {
    const fenced = '```JSON\n' + JSON.stringify(validResponse) + '\n```';
    expect(recoverFoxyResponseFromText(fenced)).not.toBeNull();
  });

  it('recovers from bare JSON with surrounding chatter', () => {
    const wrapped = `Sure! Here's your answer: ${JSON.stringify(validResponse)} Hope this helps!`;
    expect(recoverFoxyResponseFromText(wrapped)).not.toBeNull();
  });

  it('recovers from bare JSON with no surrounding text', () => {
    expect(recoverFoxyResponseFromText(JSON.stringify(validResponse))).not.toBeNull();
  });

  it('returns null for malformed JSON inside a fence', () => {
    const fenced = '```json\n{ "title": "Broken", "blocks": [\n```';
    expect(recoverFoxyResponseFromText(fenced)).toBeNull();
  });

  it('returns null for valid JSON that fails FoxyResponseSchema', () => {
    // Missing `blocks`, wrong subject enum value.
    const bad = JSON.stringify({ title: 'x', subject: 'physics', blocks: [] });
    // Cheap gate skips this (no "blocks" content) — still returns null.
    expect(recoverFoxyResponseFromText(bad)).toBeNull();
  });

  it('returns null when title or blocks key is missing entirely', () => {
    // Cheap structural gate must short-circuit on plausible-but-incomplete JSON
    // so we don't waste a JSON.parse on every legacy markdown message.
    expect(recoverFoxyResponseFromText('```json\n{"foo": "bar"}\n```')).toBeNull();
  });

  it('rejects schema-invalid block types', () => {
    const bad = {
      title: 'x',
      subject: 'science',
      blocks: [{ type: 'unknown_type', text: 'hi' }],
    };
    const fenced = '```json\n' + JSON.stringify(bad) + '\n```';
    expect(recoverFoxyResponseFromText(fenced)).toBeNull();
  });

  it('does not corrupt a valid response (round-trip)', () => {
    const recovered = recoverFoxyResponseFromText(JSON.stringify(validResponse));
    expect(recovered?.title).toBe(validResponse.title);
    expect(recovered?.subject).toBe(validResponse.subject);
    expect(recovered?.blocks[0].type).toBe('paragraph');
    expect(recovered?.blocks[1].type).toBe('step');
    expect(recovered?.blocks[1].label).toBe('Step 1: Setup');
  });
});
