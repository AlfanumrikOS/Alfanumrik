/**
 * Study-artifact client layer for the two GenAI student-facing generation
 * agents surfaced inside the /foxy workspace.
 *
 *   Diagram      →  POST /api/content/diagram   (JSON body)   → DiagramSpec
 *   Lesson notes →  GET  /api/lesson?…          (query params) → LessonNotes
 *
 * This module owns ONLY transport + state-shape normalization. It defines no
 * pedagogy, computes no score/XP/mastery, and never re-derives anything the
 * server returned — it renders whatever the sanctioned orchestrators produced.
 *
 * ── THE FOUR STATES ──────────────────────────────────────────────────────────
 * Both routes are 200-with-`abstained:true` when the AI cannot ground an answer.
 * That is a NORMAL outcome, not an error, so it gets its own state:
 *
 *   loading     — request in flight
 *   ready       — 200 + abstained:false  → render the artifact
 *   abstained   — 200 + abstained:true   → friendly bilingual "couldn't build
 *                 this from NCERT for this chapter" copy + the server's own
 *                 bilingual message + suggested alternatives
 *   error       — transport / 4xx / 5xx  → bilingual copy by reason
 *
 * `error.reason` is deliberately coarse and student-readable:
 *   'unsupported'  — 400 from the route (subject not offered for this grade,
 *                    bad chapter shape, …). Never shown as a crash.
 *   'unavailable'  — 404 (flag OFF server-side / no grade / no profile) or 401.
 *                    The affordance is client-flag-gated, so a 404 here means
 *                    the DB flag flipped off underneath us — degrade quietly.
 *   'network'      — fetch threw, non-JSON body, or 5xx.
 *
 * Every network call is injectable (`ArtifactFetchDeps`) so this module is
 * unit-testable without a browser, a Supabase session, or MSW.
 */

import { supabase } from '@alfanumrik/lib/supabase';
import type { DiagramSpec, DiagramKind } from '@alfanumrik/lib/diagram/types';
import type { LessonNotes } from '@alfanumrik/lib/lesson/types';
import type { SuggestedAlternative } from '@alfanumrik/lib/ai/grounded-client';

// ── Public types ─────────────────────────────────────────────────────────────

/** Which artifact an affordance produces. */
export type ArtifactKind = 'diagram' | 'lesson';

/** Both routes accept exactly these two language codes. */
export type ArtifactLanguage = 'en' | 'hi';

export type ArtifactErrorReason = 'unsupported' | 'unavailable' | 'network';

export type ArtifactState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | {
      status: 'abstained';
      /** Server-authored bilingual copy; may be empty → the sheet uses house copy. */
      messageEn: string;
      messageHi: string;
      suggestedAlternatives: SuggestedAlternative[];
    }
  | { status: 'error'; reason: ArtifactErrorReason };

/** The WHAT — always the student's CURRENT Foxy subject + chapter selection. */
export interface ArtifactContext {
  /** CBSE subject CODE as used everywhere else in Foxy (e.g. 'science'). */
  subject: string;
  /** P5-adjacent: chapter numbers ARE integers (grades are the strings). */
  chapterNumber: number;
  chapterTitle: string;
  language: ArtifactLanguage;
  /** Optional caller hint honored by the diagram route when in the v1 set. */
  diagramType?: DiagramKind;
}

export interface ArtifactFetchDeps {
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to the Supabase session access token. */
  getAccessToken?: () => Promise<string | null>;
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Mirrors the Bearer-plus-cookie posture of `callFoxyTutor` in useFoxyChat —
 * the access token is sent as a header when available, and `credentials:
 * 'include'` keeps the cookie fallback path in `authorizeRequest` working.
 */
async function defaultAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function authHeaders(
  deps: ArtifactFetchDeps | undefined,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const token = await (deps?.getAccessToken ?? defaultAccessToken)();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** Map an HTTP status onto the coarse, student-readable error reason. */
export function reasonForStatus(status: number): ArtifactErrorReason {
  if (status === 400) return 'unsupported';
  if (status === 401 || status === 403 || status === 404) return 'unavailable';
  return 'network';
}

/**
 * Normalize a /v2 envelope (`{ success, data }` / `{ success, error, code }`)
 * plus the artifact's own abstain field into one `ArtifactState`.
 *
 * Exported so tests can pin the state machine without any transport.
 */
export function toArtifactState<T extends { abstained: boolean; abstain?: unknown }>(
  res: { ok: boolean; status: number },
  body: unknown,
): ArtifactState<T> {
  if (!res.ok) {
    return { status: 'error', reason: reasonForStatus(res.status) };
  }

  const envelope = body as { success?: boolean; data?: unknown } | null;
  if (!envelope || envelope.success !== true || !envelope.data) {
    return { status: 'error', reason: 'network' };
  }

  const data = envelope.data as T;
  if (data.abstained === true) {
    const abstain = (data.abstain ?? {}) as {
      messageEn?: string;
      messageHi?: string;
      suggestedAlternatives?: SuggestedAlternative[];
    };
    return {
      status: 'abstained',
      messageEn: typeof abstain.messageEn === 'string' ? abstain.messageEn : '',
      messageHi: typeof abstain.messageHi === 'string' ? abstain.messageHi : '',
      suggestedAlternatives: Array.isArray(abstain.suggestedAlternatives)
        ? abstain.suggestedAlternatives
        : [],
    };
  }

  return { status: 'ready', data };
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/content/diagram.
 *
 * NOTE (contract): `grade` is resolved SERVER-side from the caller's own
 * enrolled row — it is deliberately NOT sent. `chapter` is a nested object.
 * Never throws; a transport failure resolves to `{ status:'error' }`.
 */
export async function fetchDiagramSpec(
  ctx: ArtifactContext,
  deps?: ArtifactFetchDeps,
): Promise<ArtifactState<DiagramSpec>> {
  const doFetch = deps?.fetchImpl ?? fetch;
  try {
    const headers = await authHeaders(deps, { 'Content-Type': 'application/json' });
    const res = await doFetch('/api/content/diagram', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        subject: ctx.subject,
        chapter: {
          chapterNumber: ctx.chapterNumber,
          chapterTitle: ctx.chapterTitle,
        },
        ...(ctx.diagramType ? { diagramType: ctx.diagramType } : {}),
        language: ctx.language,
      }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body → handled as 'network' below */
    }
    return toArtifactState<DiagramSpec>(res, body);
  } catch {
    return { status: 'error', reason: 'network' };
  }
}

/**
 * GET /api/lesson?subject=…&chapterNumber=…&chapterTitle=…&language=…
 *
 * NOTE (contract asymmetry): this sibling route is a GET with FLAT query
 * params, while the diagram route is a POST with a NESTED chapter object.
 * Both are honored verbatim here rather than papered over.
 * Never throws.
 */
export async function fetchLessonNotes(
  ctx: ArtifactContext,
  deps?: ArtifactFetchDeps,
): Promise<ArtifactState<LessonNotes>> {
  const doFetch = deps?.fetchImpl ?? fetch;
  try {
    const headers = await authHeaders(deps);
    const params = new URLSearchParams({
      subject: ctx.subject,
      chapterNumber: String(ctx.chapterNumber),
      chapterTitle: ctx.chapterTitle,
      language: ctx.language,
    });
    const res = await doFetch(`/api/lesson?${params.toString()}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body → handled as 'network' below */
    }
    return toArtifactState<LessonNotes>(res, body);
  } catch {
    return { status: 'error', reason: 'network' };
  }
}

// ── Bilingual chrome (P7) ────────────────────────────────────────────────────
//
// Centralised so the bilingual contract for the new surface is auditable in one
// spot. Technical terms (CBSE, NCERT, Bloom's) are NOT translated.

export interface ArtifactChrome {
  diagramLabel: string;
  lessonLabel: string;
  diagramTitle: string;
  lessonTitle: string;
  pickChapter: string;
  building: string;
  buildingLesson: string;
  abstainHeading: string;
  abstainBody: string;
  abstainAlternatives: string;
  errUnsupportedHeading: string;
  errUnsupportedBody: string;
  errUnavailableHeading: string;
  errUnavailableBody: string;
  errNetworkHeading: string;
  errNetworkBody: string;
  retry: string;
  close: string;
  sources: string;
  regenerate: string;
  page: string;
  chapter: string;
}

export const ARTIFACT_CHROME: { en: ArtifactChrome; hi: ArtifactChrome } = {
  en: {
    diagramLabel: 'Diagram',
    lessonLabel: 'Lesson notes',
    diagramTitle: 'Chapter diagram',
    lessonTitle: 'Lesson notes',
    pickChapter: 'Pick a chapter first',
    building: 'Drawing your diagram from NCERT…',
    buildingLesson: 'Writing your notes from NCERT…',
    abstainHeading: "Couldn't build this from NCERT yet",
    abstainBody:
      "Foxy only uses your NCERT book, and this chapter doesn't have enough source text yet. Try another chapter — or just ask Foxy in the chat below.",
    abstainAlternatives: 'Chapters that are ready',
    errUnsupportedHeading: 'Not available for this chapter',
    errUnsupportedBody:
      "This subject or chapter isn't set up for this yet. Try a different chapter.",
    errUnavailableHeading: 'Not available right now',
    errUnavailableBody: 'This is turned off for now. Foxy in the chat still works.',
    errNetworkHeading: "Couldn't reach Foxy",
    errNetworkBody: 'Check your connection and try again.',
    retry: 'Try again',
    close: 'Close',
    sources: 'From your NCERT book',
    regenerate: 'Regenerate',
    page: 'p.',
    chapter: 'Ch',
  },
  hi: {
    diagramLabel: 'आरेख',
    lessonLabel: 'पाठ नोट्स',
    diagramTitle: 'अध्याय का आरेख',
    lessonTitle: 'पाठ नोट्स',
    pickChapter: 'पहले एक अध्याय चुनो',
    building: 'NCERT से तुम्हारा आरेख बना रहे हैं…',
    buildingLesson: 'NCERT से तुम्हारे नोट्स लिख रहे हैं…',
    abstainHeading: 'अभी NCERT से यह नहीं बन पाया',
    abstainBody:
      'Foxy सिर्फ़ तुम्हारी NCERT किताब से बनाता है, और इस अध्याय का पर्याप्त पाठ अभी उपलब्ध नहीं है। कोई दूसरा अध्याय चुनो — या नीचे चैट में Foxy से पूछो।',
    abstainAlternatives: 'ये अध्याय तैयार हैं',
    errUnsupportedHeading: 'इस अध्याय के लिए उपलब्ध नहीं',
    errUnsupportedBody:
      'यह विषय या अध्याय अभी इसके लिए तैयार नहीं है। कोई दूसरा अध्याय चुनो।',
    errUnavailableHeading: 'अभी उपलब्ध नहीं',
    errUnavailableBody: 'यह अभी बंद है। चैट में Foxy अब भी काम कर रहा है।',
    errNetworkHeading: 'Foxy तक नहीं पहुँच पाए',
    errNetworkBody: 'अपना कनेक्शन जाँचो और फिर कोशिश करो।',
    retry: 'फिर कोशिश करो',
    close: 'बंद करो',
    sources: 'तुम्हारी NCERT किताब से',
    regenerate: 'दोबारा बनाओ',
    page: 'पृष्ठ',
    chapter: 'अध्याय',
  },
};
