/**
 * XC-5 [mobile / P1+P2] — mobile↔web Performance-Score-config DRIFT guard.
 *
 * THEME: constants synced by COMMENT, not contract. `score_config.dart` header
 * line literally says "This file MUST stay in sync with web src/lib/score-config.ts"
 * — enforced today only by that comment + the P14 mobile review chain. A web
 * change to a Bloom ceiling, a retention floor, a behavior weight/window, or a
 * level threshold that is not hand-mirrored makes the mobile app show a
 * DIFFERENT score/level than web for the SAME student — a correctness/trust
 * defect (touches P1 score accuracy + P2 economy semantics) that no other test
 * would catch.
 *
 * WHAT THIS TEST ASSERTS: mobile constants == web constants. PURE PARITY. It
 * does NOT pin any value as "correct" (the model is assessment-owned); it only
 * fails CI when the two language copies diverge, in either direction.
 *
 * PARSE ANCHORS:
 *   Web   `src/lib/score-config.ts`:
 *     - scalars  `export const PERFORMANCE_WEIGHT = 0.80`, `... BEHAVIOR_WEIGHT = 0.20`
 *     - maps     `BLOOM_CEILING = { ... } as const`, `GRADE_RETENTION_FLOOR: Record<...> = { ... } as const`,
 *                `BEHAVIOR_WEIGHTS = { ... } as const`, `BEHAVIOR_WINDOWS = { ... } as const`
 *     - levels   `LEVEL_THRESHOLDS = [ { min, max, name }, ... ]`
 *   Mobile `mobile/lib/core/constants/score_config.dart`:
 *     - scalars  `const double performanceWeight = 0.80;`, `... behaviorWeight = 0.20;`
 *     - maps     `bloomCeiling = { ... }`, `gradeRetentionFloor = { ... }`,
 *                `behaviorWeights = { ... }`, `behaviorWindows = { ... }`
 *     - levels   `levelThresholds = [ LevelThreshold(min:, max:, name:), ... ]`
 *
 * Both sides are flattened into a single prefixed key→value map
 * (`scalar.*`, `bloom.*`, `retention.*`, `weight.*`, `window.*`, `level.*`)
 * and compared key-by-key.
 *
 * NON-VACUOUS: asserts the shared key set is large (>= 20 constants) before
 * comparing, so an empty/failed parse cannot pass green.
 *
 * TEST-ONLY: never edits score-config.ts or the Dart file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_PATH = resolve(process.cwd(), 'src/lib/score-config.ts');
const MOBILE_PATH = resolve(
  process.cwd(),
  'mobile/lib/core/constants/score_config.dart'
);

type FlatMap = Record<string, number | string>;

/** Slice the body of a `{ ... }` block that starts at the first `{` after `anchorRe`. */
function sliceBraceBlock(text: string, anchorRe: RegExp): string {
  const m = anchorRe.exec(text);
  if (!m) throw new Error(`parse anchor not found: ${anchorRe}`);
  const open = text.indexOf('{', m.index + m[0].length - 1);
  if (open === -1) throw new Error(`no '{' after anchor: ${anchorRe}`);
  const close = text.indexOf('}', open);
  if (close === -1) throw new Error(`no '}' closing block: ${anchorRe}`);
  return text.slice(open + 1, close);
}

/** Slice the body of a `[ ... ]` block that starts at the first `[` after `anchorRe`. */
function sliceBracketBlock(text: string, anchorRe: RegExp): string {
  const m = anchorRe.exec(text);
  if (!m) throw new Error(`parse anchor not found: ${anchorRe}`);
  const open = text.indexOf('[', m.index + m[0].length - 1);
  if (open === -1) throw new Error(`no '[' after anchor: ${anchorRe}`);
  const close = text.indexOf(']', open);
  if (close === -1) throw new Error(`no ']' closing block: ${anchorRe}`);
  return text.slice(open + 1, close);
}

/** Parse `key: number` pairs (key may be quoted or bare). */
function parseNumberPairs(block: string): Record<string, number> {
  const re = /['"]?([A-Za-z0-9_]+)['"]?\s*:\s*(-?\d+(?:\.\d+)?)/g;
  const out: Record<string, number> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out[m[1]] = Number(m[2]);
  return out;
}

/** Extract `const NAME = <number>` (Dart `const double name = 0.80;`). */
function parseScalar(text: string, nameRe: RegExp): number {
  const m = nameRe.exec(text);
  if (!m) throw new Error(`scalar not found: ${nameRe}`);
  return Number(m[1]);
}

function addPairs(flat: FlatMap, prefix: string, pairs: Record<string, number>) {
  for (const [k, v] of Object.entries(pairs)) flat[`${prefix}.${k}`] = v;
}

/** Parse level triples `(min, max, name)` and flatten to `level.<name>.{min,max}`. */
function addLevels(flat: FlatMap, block: string) {
  const re = /min\s*:\s*(\d+)\s*,\s*max\s*:\s*(\d+)\s*,\s*name\s*:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = m[3].trim();
    flat[`level.${name}.min`] = Number(m[1]);
    flat[`level.${name}.max`] = Number(m[2]);
  }
}

function buildWebMap(): FlatMap {
  const text = readFileSync(WEB_PATH, 'utf8');
  const flat: FlatMap = {};
  flat['scalar.performance_weight'] = parseScalar(
    text,
    /PERFORMANCE_WEIGHT\s*=\s*(-?\d+(?:\.\d+)?)/
  );
  flat['scalar.behavior_weight'] = parseScalar(
    text,
    /BEHAVIOR_WEIGHT\s*=\s*(-?\d+(?:\.\d+)?)/
  );
  addPairs(flat, 'bloom', parseNumberPairs(sliceBraceBlock(text, /BLOOM_CEILING\s*=/)));
  addPairs(
    flat,
    'retention',
    parseNumberPairs(sliceBraceBlock(text, /GRADE_RETENTION_FLOOR[^=]*=/))
  );
  addPairs(
    flat,
    'weight',
    parseNumberPairs(sliceBraceBlock(text, /BEHAVIOR_WEIGHTS\s*=/))
  );
  addPairs(
    flat,
    'window',
    parseNumberPairs(sliceBraceBlock(text, /BEHAVIOR_WINDOWS\s*=/))
  );
  addLevels(flat, sliceBracketBlock(text, /LEVEL_THRESHOLDS[^=]*=/));
  return flat;
}

function buildMobileMap(): FlatMap {
  const text = readFileSync(MOBILE_PATH, 'utf8');
  const flat: FlatMap = {};
  flat['scalar.performance_weight'] = parseScalar(
    text,
    /performanceWeight\s*=\s*(-?\d+(?:\.\d+)?)/
  );
  flat['scalar.behavior_weight'] = parseScalar(
    text,
    /behaviorWeight\s*=\s*(-?\d+(?:\.\d+)?)/
  );
  addPairs(flat, 'bloom', parseNumberPairs(sliceBraceBlock(text, /bloomCeiling\s*=/)));
  addPairs(
    flat,
    'retention',
    parseNumberPairs(sliceBraceBlock(text, /gradeRetentionFloor\s*=/))
  );
  addPairs(
    flat,
    'weight',
    parseNumberPairs(sliceBraceBlock(text, /behaviorWeights\s*=/))
  );
  addPairs(
    flat,
    'window',
    parseNumberPairs(sliceBraceBlock(text, /behaviorWindows\s*=/))
  );
  addLevels(flat, sliceBracketBlock(text, /levelThresholds\s*=/));
  return flat;
}

describe('XC-5: mobile↔web score-config parity (drift guard)', () => {
  const web = buildWebMap();
  const mobile = buildMobileMap();

  it('extracted a large shared constant set from both sides (non-vacuous)', () => {
    expect(Object.keys(web).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(mobile).length).toBeGreaterThanOrEqual(20);
  });

  it('web and mobile declare the SAME set of score-config keys', () => {
    const webKeys = Object.keys(web).sort();
    const mobileKeys = Object.keys(mobile).sort();
    const onlyWeb = webKeys.filter((k) => !(k in mobile));
    const onlyMobile = mobileKeys.filter((k) => !(k in web));
    expect(onlyWeb, `keys present on web but missing on mobile: ${onlyWeb.join(', ')}`).toEqual(
      []
    );
    expect(
      onlyMobile,
      `keys present on mobile but missing on web: ${onlyMobile.join(', ')}`
    ).toEqual([]);
  });

  it('every shared score-config constant has an EQUAL value on both sides', () => {
    for (const key of Object.keys(web)) {
      if (!(key in mobile)) continue;
      expect(
        mobile[key],
        `score-config drift on "${key}": web=${web[key]} mobile=${mobile[key]}`
      ).toBe(web[key]);
    }
  });
});
