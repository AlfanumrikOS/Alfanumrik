/**
 * study-artifacts — the transport + 4-state normalizer behind the two GenAI
 * student-facing affordances in /foxy.
 *
 *   Diagram      → POST /api/content/diagram (JSON body, NESTED chapter object)
 *   Lesson notes → GET  /api/lesson?…        (FLAT query params)
 *
 * The route asymmetry above is REAL and deliberate. It is pinned here so a
 * future "let's unify these" refactor cannot silently break one of the two
 * endpoints without a red test.
 *
 * The 4-state normalizer is the other half. The critical assertion is that an
 * ABSTAIN (HTTP 200 + `abstained:true`) is a NORMAL outcome and maps to the
 * calm `abstained` state — never to `error`. Everything else maps to a coarse,
 * student-readable reason:
 *   400            → 'unsupported'
 *   401 / 403 / 404 → 'unavailable'
 *   fetch throw / non-JSON / 5xx → 'network'  (the only retry-offered reason)
 *
 * Every call is exercised through the injectable `fetchImpl` / `getAccessToken`
 * seams — no MSW, no Supabase session, no browser.
 *
 * Owning agent: testing. Under test: frontend (client layer).
 * Invariants: P7 (bilingual chrome), P13 (no PII on the wire).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// The module imports the browser Supabase client for its DEFAULT token getter.
// Every test injects `getAccessToken`, so this stub only has to exist.
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
    },
  },
}));

import {
  toArtifactState,
  reasonForStatus,
  fetchDiagramSpec,
  fetchLessonNotes,
  ARTIFACT_CHROME,
  type ArtifactContext,
  type ArtifactChrome,
} from '@/app/foxy/_lib/study-artifacts';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';

const CTX: ArtifactContext = {
  subject: 'science',
  chapterNumber: 3,
  chapterTitle: 'Atoms and Molecules',
  language: 'en',
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function okData(data: unknown) {
  return jsonResponse(200, { success: true, data });
}

const READY_DIAGRAM = {
  abstained: false,
  mermaidCode: 'flowchart TD\n  A[Atom] --> B[Molecule]',
  diagramKind: 'flowchart',
  titleEn: 'From atoms to molecules',
  titleHi: 'परमाणु से अणु तक',
  captionEn: 'How atoms combine.',
  captionHi: 'परमाणु कैसे जुड़ते हैं।',
  citations: [],
  meta: {},
};

const ABSTAINED_DIAGRAM = {
  abstained: true,
  mermaidCode: '',
  diagramKind: 'flowchart',
  titleEn: '',
  titleHi: '',
  captionEn: '',
  captionHi: '',
  citations: [],
  meta: {},
  abstain: {
    reason: 'insufficient_grounding',
    messageEn: 'Not enough NCERT text for this chapter yet.',
    messageHi: 'इस अध्याय का पर्याप्त NCERT पाठ अभी नहीं है।',
    suggestedAlternatives: [
      {
        grade: '9',
        subject_code: 'science',
        chapter_number: 4,
        chapter_title: 'Structure of the Atom',
        rag_status: 'ready',
      },
    ],
  },
};

// ── 1. reasonForStatus ───────────────────────────────────────────────────────

describe('Foxy study artifacts — reasonForStatus', () => {
  it('maps 400 to "unsupported"', () => {
    expect(reasonForStatus(400)).toBe('unsupported');
  });

  it('maps 401 / 403 / 404 to "unavailable"', () => {
    expect(reasonForStatus(401)).toBe('unavailable');
    expect(reasonForStatus(403)).toBe('unavailable');
    expect(reasonForStatus(404)).toBe('unavailable');
  });

  it('maps 5xx to "network"', () => {
    expect(reasonForStatus(500)).toBe('network');
    expect(reasonForStatus(502)).toBe('network');
    expect(reasonForStatus(503)).toBe('network');
  });

  it('maps an unclassified status (429) to "network" (the retryable bucket)', () => {
    expect(reasonForStatus(429)).toBe('network');
  });
});

// ── 2. toArtifactState — all four states ─────────────────────────────────────

describe('Foxy study artifacts — toArtifactState: ready', () => {
  it('maps 200 + abstained:false to { status: "ready" } carrying the server data verbatim', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      { success: true, data: READY_DIAGRAM },
    );
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    // Verbatim — the client re-derives nothing.
    expect(state.data).toEqual(READY_DIAGRAM);
  });
});

describe('Foxy study artifacts — toArtifactState: ABSTAIN is not an error', () => {
  it('maps HTTP 200 + abstained:true to the calm "abstained" state, NOT "error"', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      { success: true, data: ABSTAINED_DIAGRAM },
    );
    expect(state.status).toBe('abstained');
    expect(state.status).not.toBe('error');
  });

  it('carries the server-authored bilingual abstain copy through', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      { success: true, data: ABSTAINED_DIAGRAM },
    );
    if (state.status !== 'abstained') throw new Error('expected abstained');
    expect(state.messageEn).toBe('Not enough NCERT text for this chapter yet.');
    expect(state.messageHi).toBe('इस अध्याय का पर्याप्त NCERT पाठ अभी नहीं है।');
    expect(state.suggestedAlternatives).toHaveLength(1);
    expect(state.suggestedAlternatives[0].chapter_number).toBe(4);
  });

  it('tolerates an abstain envelope with NO abstain object (empty copy, no crash)', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      { success: true, data: { abstained: true } },
    );
    expect(state.status).toBe('abstained');
    if (state.status !== 'abstained') throw new Error('unreachable');
    expect(state.messageEn).toBe('');
    expect(state.messageHi).toBe('');
    expect(state.suggestedAlternatives).toEqual([]);
  });

  it('coerces a non-array suggestedAlternatives to []', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      {
        success: true,
        data: {
          abstained: true,
          abstain: { messageEn: 'x', messageHi: 'y', suggestedAlternatives: 'nope' },
        },
      },
    );
    if (state.status !== 'abstained') throw new Error('expected abstained');
    expect(state.suggestedAlternatives).toEqual([]);
  });

  it('coerces non-string abstain messages to empty strings', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      {
        success: true,
        data: { abstained: true, abstain: { messageEn: 42, messageHi: null } },
      },
    );
    if (state.status !== 'abstained') throw new Error('expected abstained');
    expect(state.messageEn).toBe('');
    expect(state.messageHi).toBe('');
  });

  it('an abstain is NEVER classified as any error reason', () => {
    const state = toArtifactState<DiagramSpec>(
      { ok: true, status: 200 },
      { success: true, data: ABSTAINED_DIAGRAM },
    );
    expect((state as { reason?: string }).reason).toBeUndefined();
  });
});

describe('Foxy study artifacts — toArtifactState: error variants', () => {
  it('400 → error/unsupported', () => {
    const state = toArtifactState<DiagramSpec>({ ok: false, status: 400 }, null);
    expect(state).toEqual({ status: 'error', reason: 'unsupported' });
  });

  it('401 → error/unavailable', () => {
    expect(toArtifactState<DiagramSpec>({ ok: false, status: 401 }, null)).toEqual({
      status: 'error',
      reason: 'unavailable',
    });
  });

  it('403 → error/unavailable', () => {
    expect(toArtifactState<DiagramSpec>({ ok: false, status: 403 }, null)).toEqual({
      status: 'error',
      reason: 'unavailable',
    });
  });

  it('404 (flag flipped off server-side) → error/unavailable, degrade quietly', () => {
    expect(toArtifactState<DiagramSpec>({ ok: false, status: 404 }, null)).toEqual({
      status: 'error',
      reason: 'unavailable',
    });
  });

  it('500 → error/network', () => {
    expect(toArtifactState<DiagramSpec>({ ok: false, status: 500 }, null)).toEqual({
      status: 'error',
      reason: 'network',
    });
  });

  it('200 with a malformed envelope (success:false) → error/network', () => {
    expect(
      toArtifactState<DiagramSpec>({ ok: true, status: 200 }, { success: false }),
    ).toEqual({ status: 'error', reason: 'network' });
  });

  it('200 with a null body (non-JSON) → error/network', () => {
    expect(toArtifactState<DiagramSpec>({ ok: true, status: 200 }, null)).toEqual({
      status: 'error',
      reason: 'network',
    });
  });

  it('200 with success:true but no data → error/network', () => {
    expect(
      toArtifactState<DiagramSpec>({ ok: true, status: 200 }, { success: true }),
    ).toEqual({ status: 'error', reason: 'network' });
  });
});

// ── 3. Transport — the POST/GET asymmetry ────────────────────────────────────

describe('Foxy study artifacts — diagram transport is POST + nested chapter', () => {
  it('POSTs to /api/content/diagram with a JSON body', async () => {
    const fetchImpl = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/content/diagram');
    expect(init.method).toBe('POST');
    expect(typeof init.body).toBe('string');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(init.credentials).toBe('include');
  });

  it('nests chapter as { chapterNumber, chapterTitle } — NOT flat', async () => {
    const fetchImpl = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.chapter).toEqual({ chapterNumber: 3, chapterTitle: 'Atoms and Molecules' });
    expect(body.chapterNumber).toBeUndefined();
    expect(body.chapterTitle).toBeUndefined();
    expect(body.subject).toBe('science');
    expect(body.language).toBe('en');
  });

  it('does NOT send grade — it is resolved server-side from the enrolled row', async () => {
    const fetchImpl = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.grade).toBeUndefined();
  });

  it('includes diagramType only when the caller supplied one', async () => {
    const withHint = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(
      { ...CTX, diagramType: 'mindmap' },
      { fetchImpl: withHint as unknown as typeof fetch, getAccessToken: async () => null },
    );
    expect(
      JSON.parse(
        (withHint.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      ).diagramType,
    ).toBe('mindmap');

    const without = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: without as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(
      'diagramType' in
        JSON.parse(
          (without.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
        ),
    ).toBe(false);
  });

  it('sends the Bearer header when a token exists, and omits it when null', async () => {
    const withTok = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: withTok as unknown as typeof fetch,
      getAccessToken: async () => 'abc123',
    });
    expect(
      ((withTok.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
        string,
        string
      >)['Authorization'],
    ).toBe('Bearer abc123');

    const noTok = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(CTX, {
      fetchImpl: noTok as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(
      'Authorization' in
        ((noTok.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
          string,
          string
        >),
    ).toBe(false);
  });
});

describe('Foxy study artifacts — lesson transport is GET + flat query params', () => {
  it('GETs /api/lesson with flat params and NO body', async () => {
    const fetchImpl = vi.fn(async () => okData({ abstained: false, sections: [] }));
    await fetchLessonNotes(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('/api/lesson?')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('include');
  });

  it('serialises chapterNumber / chapterTitle FLAT (no nested chapter object)', async () => {
    const fetchImpl = vi.fn(async () => okData({ abstained: false, sections: [] }));
    await fetchLessonNotes(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('subject')).toBe('science');
    expect(params.get('chapterNumber')).toBe('3');
    expect(params.get('chapterTitle')).toBe('Atoms and Molecules');
    expect(params.get('language')).toBe('en');
    expect(params.get('chapter')).toBeNull();
  });

  it('does NOT send grade in the query string', async () => {
    const fetchImpl = vi.fn(async () => okData({ abstained: false, sections: [] }));
    await fetchLessonNotes(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(new URLSearchParams(url.split('?')[1]).get('grade')).toBeNull();
  });

  it('the two routes do NOT share a method/shape (asymmetry pin)', async () => {
    const diagramFetch = vi.fn(async () => okData(READY_DIAGRAM));
    const lessonFetch = vi.fn(async () => okData({ abstained: false, sections: [] }));
    await fetchDiagramSpec(CTX, {
      fetchImpl: diagramFetch as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    await fetchLessonNotes(CTX, {
      fetchImpl: lessonFetch as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    const dInit = (diagramFetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    const lInit = (lessonFetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(dInit.method).toBe('POST');
    expect(lInit.method).toBe('GET');
    expect(Boolean(dInit.body)).toBe(true);
    expect(Boolean(lInit.body)).toBe(false);
  });
});

// ── 3b. Static contract canary: the client shape matches the ROUTE it calls ──
//
// The unit tests above pin what the CLIENT sends. On their own they would still
// pass if a route renamed its params. This read-only source canary closes that
// half: it asserts the two routes still expose the method + parameter shape the
// client speaks. It never imports the routes (they pull server-only modules) —
// it reads their source.

describe('Foxy study artifacts — client/route contract canary', () => {
  const diagramRoute = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/content/diagram/route.ts'),
    'utf8',
  );
  const lessonRoute = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/lesson/route.ts'),
    'utf8',
  );

  it('the diagram route exports POST (and NOT GET)', () => {
    expect(diagramRoute).toMatch(/export\s+async\s+function\s+POST\s*\(/);
    expect(diagramRoute).not.toMatch(/export\s+async\s+function\s+GET\s*\(/);
  });

  it('the diagram route reads the NESTED chapter object the client sends', () => {
    expect(diagramRoute).toContain('body.chapter');
    expect(diagramRoute).toContain('chapter.chapterNumber');
    expect(diagramRoute).toContain('chapter.chapterTitle');
  });

  it('the lesson route exports GET (and NOT POST)', () => {
    expect(lessonRoute).toMatch(/export\s+async\s+function\s+GET\s*\(/);
    expect(lessonRoute).not.toMatch(/export\s+async\s+function\s+POST\s*\(/);
  });

  it('the lesson route reads the FLAT query params the client sends', () => {
    for (const name of ['subject', 'chapterNumber', 'chapterTitle', 'language']) {
      expect(lessonRoute).toContain(`searchParams.get('${name}')`);
    }
  });

  it('the lesson route does NOT parse a JSON body (it is a GET)', () => {
    expect(lessonRoute).not.toContain('request.json()');
  });
});

// ── 4. Transport failure paths never throw ───────────────────────────────────

describe('Foxy study artifacts — transport failures degrade, never throw', () => {
  it('a thrown fetch resolves to error/network (diagram)', async () => {
    const state = await fetchDiagramSpec(CTX, {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(state).toEqual({ status: 'error', reason: 'network' });
  });

  it('a thrown fetch resolves to error/network (lesson)', async () => {
    const state = await fetchLessonNotes(CTX, {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(state).toEqual({ status: 'error', reason: 'network' });
  });

  it('a 200 with a non-JSON body resolves to error/network', async () => {
    const state = await fetchDiagramSpec(CTX, {
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        }) as unknown as Response) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(state).toEqual({ status: 'error', reason: 'network' });
  });

  it('a 400 resolves to error/unsupported end-to-end', async () => {
    const state = await fetchLessonNotes(CTX, {
      fetchImpl: (async () =>
        jsonResponse(400, { success: false, error: 'bad subject' })) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(state).toEqual({ status: 'error', reason: 'unsupported' });
  });

  it('a 200 abstain resolves end-to-end to the calm abstained state', async () => {
    const state = await fetchDiagramSpec(CTX, {
      fetchImpl: (async () => okData(ABSTAINED_DIAGRAM)) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    expect(state.status).toBe('abstained');
  });
});

// ── 5. P13 — nothing student-identifying goes on the wire or into logs ───────

describe('Foxy study artifacts — P13 no PII', () => {
  const consoleKeys = ['log', 'warn', 'error', 'info', 'debug'] as const;
  let spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    spies = consoleKeys.map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
  });

  it('the diagram request body carries ONLY whitelisted, non-identifying keys', async () => {
    const fetchImpl = vi.fn(async () => okData(READY_DIAGRAM));
    await fetchDiagramSpec(
      { ...CTX, diagramType: 'flowchart' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getAccessToken: async () => 'tok' },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(
      ['chapter', 'diagramType', 'language', 'subject'].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(
      /studentId|student_id|userId|user_id|email|phone/i,
    );
  });

  it('the lesson query string carries ONLY whitelisted, non-identifying params', async () => {
    const fetchImpl = vi.fn(async () => okData({ abstained: false, sections: [] }));
    await fetchLessonNotes(CTX, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'tok',
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    const names = Array.from(new URLSearchParams(url.split('?')[1]).keys()).sort();
    expect(names).toEqual(['chapterNumber', 'chapterTitle', 'language', 'subject']);
    expect(url).not.toMatch(/studentId|student_id|userId|email|phone/i);
  });

  it('emits NOTHING to the console on any failure path', async () => {
    await fetchDiagramSpec(CTX, {
      fetchImpl: (async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    await fetchLessonNotes(CTX, {
      fetchImpl: (async () => jsonResponse(500, {})) as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it('never echoes the access token into the returned state', async () => {
    const state = await fetchDiagramSpec(CTX, {
      fetchImpl: (async () => okData(READY_DIAGRAM)) as unknown as typeof fetch,
      getAccessToken: async () => 'super-secret-token',
    });
    expect(JSON.stringify(state)).not.toContain('super-secret-token');
  });
});

// ── 6. P7 — bilingual chrome parity ──────────────────────────────────────────

describe('Foxy study artifacts — P7 bilingual chrome parity', () => {
  const enKeys = Object.keys(ARTIFACT_CHROME.en).sort();
  const hiKeys = Object.keys(ARTIFACT_CHROME.hi).sort();

  it('EN and HI declare the SAME key set (every string has a pair)', () => {
    expect(hiKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it.each(enKeys)('"%s" is a non-empty string in BOTH languages', (key) => {
    const en = ARTIFACT_CHROME.en[key as keyof ArtifactChrome];
    const hi = ARTIFACT_CHROME.hi[key as keyof ArtifactChrome];
    expect(typeof en).toBe('string');
    expect(typeof hi).toBe('string');
    expect(en.trim().length).toBeGreaterThan(0);
    expect(hi.trim().length).toBeGreaterThan(0);
  });

  it.each(enKeys)('"%s" is actually translated (EN !== HI)', (key) => {
    expect(ARTIFACT_CHROME.hi[key as keyof ArtifactChrome]).not.toBe(
      ARTIFACT_CHROME.en[key as keyof ArtifactChrome],
    );
  });

  it.each(enKeys)('"%s" HI copy contains Devanagari', (key) => {
    expect(ARTIFACT_CHROME.hi[key as keyof ArtifactChrome]).toMatch(/[ऀ-ॿ]/);
  });

  it.each(enKeys)('"%s" EN copy contains NO Devanagari', (key) => {
    expect(ARTIFACT_CHROME.en[key as keyof ArtifactChrome]).not.toMatch(
      /[ऀ-ॿ]/,
    );
  });

  it('keeps technical terms (NCERT, CBSE, Bloom, Foxy) UNTRANSLATED in Hindi copy', () => {
    const hiValues = Object.values(ARTIFACT_CHROME.hi).join(' ');
    // The acronyms appear verbatim…
    expect(hiValues).toContain('NCERT');
    expect(hiValues).toContain('Foxy');
    // …and are never transliterated into Devanagari.
    expect(hiValues).not.toContain('एनसीईआरटी');
    expect(hiValues).not.toContain('सीबीएसई');
    expect(hiValues).not.toContain('ब्लूम');
    expect(hiValues).not.toContain('फॉक्सी');
  });

  it('carries no PII-shaped placeholders in either language', () => {
    const all = [
      ...Object.values(ARTIFACT_CHROME.en),
      ...Object.values(ARTIFACT_CHROME.hi),
    ].join(' ');
    expect(all).not.toMatch(/studentId|student_id|email|phone|@/i);
  });
});
