/**
 * POST /api/content/diagram — student-facing Content Generation Agent (GenAI Phase 5c, v1).
 *
 * On-demand, NCERT-grounded, bilingual Mermaid diagram for ONE chapter. This route
 * invents NO pedagogy and NO generation — it READS the caller's own grade +
 * learner-memory slice and hands them to the sanctioned grounded orchestrator
 * `generateDiagram` (packages/lib/src/diagram/generate-diagram.ts, ai-engineer-owned).
 * The orchestrator decides only HOW to VISUALIZE the chapter and fails soft to an
 * abstain envelope when grounding can't support it. Mirrors the Phase-5b lesson
 * route (`apps/host/src/app/api/lesson/route.ts`) posture EXACTLY.
 *
 * ── STRICTLY READ-ONLY ───────────────────────────────────────────────────────
 * No writes of any kind. In particular this route NEVER writes any mastery /
 * progression table — every DB call is a `.select(...)`. The only ledger touched
 * is `audit_logs` (metadata-only view audit, P13). This is a LIVE registry agent
 * scanned by the registry conformance invariant (writes none of the forbidden
 * mastery tables).
 *
 * ── FLAG GATE (default OFF) ──────────────────────────────────────────────────
 * `ff_content_generation_v1` (imported from the flags REGISTRY module, not the
 * barrel). When OFF the endpoint short-circuits with a 404-style disabled response
 * BEFORE touching any data source — a true no-op.
 *
 * ── AUTH + SCOPE (v1 = STUDENT-SELF ONLY) ────────────────────────────────────
 * `authorizeRequest(request, 'progress.view_own', { requireStudentId: true })`.
 * The route serves ONLY the caller's OWN diagram (`auth.studentId`); it does NOT
 * accept a studentId for another learner. There is therefore NO cross-student
 * path, NO `canAccessStudent`, and NO service-role/admin client here — every read
 * flows through the RLS-scoped server client (fenced to the caller's own row) or
 * `getStudentMemory` called with the caller's OWN id. This keeps the route off
 * the admin-client allowlist / cross-tenant ledgers.
 *
 * P5: grades are STRINGS (resolved from the caller's OWN enrolled grade, never
 * caller-supplied). P7: bilingual output (generator emits EN + Hindi title/caption
 * + bilingual abstain copy). P13: no PII in logs — audit metadata only. Fail-soft:
 * a learner-memory sub-read failure passes NEUTRAL memory to the generator (which
 * abstains if it must) rather than 500-ing the route.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { CONTENT_GENERATION_FLAGS } from '@alfanumrik/lib/flags/registries/foxy';
import { generateDiagram } from '@alfanumrik/lib/diagram/generate-diagram';
import type {
  DiagramRequest,
  DiagramMemoryInput,
  DiagramKind,
  DiagramLanguage,
} from '@alfanumrik/lib/diagram/types';
import { getStudentMemory, type StudentMemory } from '@/lib/memory/student-memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/content/diagram';

/** The v1 diagram-kind set (spec §2.1) — narrower than the Mermaid allow-list. */
const VALID_DIAGRAM_TYPES: ReadonlySet<DiagramKind> = new Set<DiagramKind>([
  'flowchart',
  'mindmap',
  'timeline',
]);
const VALID_LANGUAGES: ReadonlySet<DiagramLanguage> = new Set<DiagramLanguage>([
  'en',
  'hi',
]);

/**
 * Valid CBSE subject codes by grade band (source: cbse-learning-rules skill).
 * Grades 6–10 share the junior set; grades 11–12 share the senior set. Used to
 * reject an out-of-scope subject×grade pair with 400 INVALID_SUBJECT BEFORE the
 * grounded generateDiagram call (spec-conformance + cost/latency + clear error).
 * Grade stays a P5 STRING throughout; no map is duplicated from a canonical
 * server-side helper because none is grade-aware for this exact scope set.
 */
const JUNIOR_SUBJECTS: ReadonlySet<string> = new Set<string>([
  'math',
  'science',
  'english',
  'hindi',
  'social_studies',
]);
const SENIOR_SUBJECTS: ReadonlySet<string> = new Set<string>([
  'physics',
  'chemistry',
  'biology',
  'math',
  'english',
  'economics',
  'accountancy',
  'business_studies',
  'political_science',
  'history_sr',
  'geography',
  'computer_science',
  'coding',
]);

/** Resolve the valid CBSE subject set for a P5 grade STRING ("6"–"12"). */
function validSubjectsForGrade(grade: string): ReadonlySet<string> {
  return Number.parseInt(grade, 10) >= 11 ? SENIOR_SUBJECTS : JUNIOR_SUBJECTS;
}

/**
 * Neutral planner input used when the learner-memory read fails or is empty.
 * `masteryLevel: 'medium'` mirrors EMPTY_COGNITIVE_CONTEXT.masteryLevel — the
 * documented empty default, not a new threshold. With a null learning style the
 * generator still produces a grounded (unpersonalized) diagram, or abstains.
 */
const NEUTRAL_MEMORY_INPUT: DiagramMemoryInput = {
  masteryLevel: 'medium',
  preferences: { learningStyle: null },
};

/**
 * Adapt the app-layer unified `StudentMemory` → the narrow `DiagramMemoryInput`
 * the planner reads (the pass-through projection documented in diagram/types.ts).
 * No re-derivation of mastery — every field is copied verbatim from an existing
 * reader slice.
 */
function toDiagramMemoryInput(memory: StudentMemory): DiagramMemoryInput {
  return {
    masteryLevel: memory.cognitive.masteryLevel,
    preferences: {
      learningStyle: memory.preferences.learningStyle,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    // ── 0. FLAG GATE (default OFF) — short-circuit before any auth/DB work ──
    const flagEnabled = await isFeatureEnabled(CONTENT_GENERATION_FLAGS.V1);
    if (!flagEnabled) {
      // 404-style disabled response — no diagram is ever generated or surfaced.
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 1. Authenticate + authorize (student-self read; resolve own studentId) ──
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;
    const callerId = auth.userId!;
    const studentId = auth.studentId;
    if (!studentId) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }

    // Re-evaluate the flag WITH role/user context (role/rollout scoping) now that
    // we know who the caller is. Still a no-op when globally OFF (handled above).
    const scopedEnabled = await isFeatureEnabled(CONTENT_GENERATION_FLAGS.V1, {
      role: auth.roles[0],
      userId: callerId,
    });
    if (!scopedEnabled) {
      return v2Error('Not found', 404, 'NOT_FOUND');
    }

    // ── 2. Parse + validate the WHAT (subject + chapter) and presentation hints ──
    let body: Record<string, unknown>;
    try {
      const raw = await request.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return v2Error('A JSON request body is required', 400, 'INVALID_BODY');
      }
      body = raw as Record<string, unknown>;
    } catch {
      return v2Error('A JSON request body is required', 400, 'INVALID_BODY');
    }

    const subject =
      typeof body.subject === 'string' ? body.subject.trim().toLowerCase() : '';
    if (!subject) {
      return v2Error('A subject field is required', 400, 'SUBJECT_REQUIRED');
    }

    // chapter{chapterNumber, chapterTitle} — accept a nested object.
    const chapter =
      body.chapter && typeof body.chapter === 'object' && !Array.isArray(body.chapter)
        ? (body.chapter as Record<string, unknown>)
        : null;
    if (!chapter) {
      return v2Error('A chapter object is required', 400, 'CHAPTER_REQUIRED');
    }

    const chapterNumber =
      typeof chapter.chapterNumber === 'number'
        ? chapter.chapterNumber
        : Number.parseInt(String(chapter.chapterNumber ?? ''), 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return v2Error(
        'A positive integer chapter.chapterNumber is required',
        400,
        'CHAPTER_NUMBER_REQUIRED',
      );
    }

    const chapterTitle =
      typeof chapter.chapterTitle === 'string' ? chapter.chapterTitle.trim() : '';
    if (!chapterTitle) {
      return v2Error('A chapter.chapterTitle is required', 400, 'CHAPTER_TITLE_REQUIRED');
    }

    // Optional diagramType hint — reject a clearly-invalid enum, else pass through.
    let diagramType: DiagramKind | undefined;
    if (body.diagramType !== undefined && body.diagramType !== null && body.diagramType !== '') {
      if (
        typeof body.diagramType !== 'string' ||
        !VALID_DIAGRAM_TYPES.has(body.diagramType as DiagramKind)
      ) {
        return v2Error(
          'diagramType must be one of: flowchart, mindmap, timeline',
          400,
          'INVALID_DIAGRAM_TYPE',
        );
      }
      diagramType = body.diagramType as DiagramKind;
    }

    // Optional language — default 'en'; both languages are always populated (P7).
    const languageRaw =
      typeof body.language === 'string' && body.language.trim() !== ''
        ? body.language.trim().toLowerCase()
        : 'en';
    if (!VALID_LANGUAGES.has(languageRaw as DiagramLanguage)) {
      return v2Error('language must be one of: en, hi', 400, 'INVALID_LANGUAGE');
    }
    const language = languageRaw as DiagramLanguage;

    // ── 3. Resolve the caller's OWN enrolled grade (P5 STRING) via RLS ──
    // The RLS-scoped server client fences this SELECT to the caller's own student
    // row, so no service role is needed for a self-only read.
    let grade: string | null = null;
    try {
      const db = await createSupabaseServerClient();
      const { data: studentRow } = await db
        .from('students')
        .select('grade')
        .eq('id', studentId)
        .maybeSingle();
      grade = (studentRow as { grade?: string | null } | null)?.grade ?? null;
    } catch {
      // fall through — a missing grade is a 404, never a 500.
    }
    if (!grade) {
      return v2Error('Could not resolve your enrolled grade', 404, 'NO_GRADE');
    }

    // ── 3b. Subject×grade scope guard (spec-conformance + cost/latency) ──
    // Reject a subject that is not offered for the resolved grade BEFORE any
    // grounded work — an out-of-scope pair (e.g. grade 7 requesting physics)
    // never reaches the learner-memory read or generateDiagram. Grade stays a
    // P5 STRING; the message carries the subject/grade codes only (no PII, P13).
    if (!validSubjectsForGrade(grade).has(subject)) {
      return v2Error(
        `subject "${subject}" is not offered for grade ${grade}`,
        400,
        'INVALID_SUBJECT',
      );
    }

    // ── 4. Read the caller's OWN learner-memory slice (self — RLS-safe) ──
    // getStudentMemory is itself fail-soft; wrap defensively and degrade to a
    // NEUTRAL memory input on any failure (the generator then abstains if it
    // cannot ground the chapter). Never 500 on a missing optional source.
    let memoryInput: DiagramMemoryInput = NEUTRAL_MEMORY_INPUT;
    try {
      const memory = await getStudentMemory(studentId, {
        subject,
        grade,
        chapter: chapterTitle,
      });
      memoryInput = toDiagramMemoryInput(memory);
    } catch {
      memoryInput = NEUTRAL_MEMORY_INPUT;
    }

    // ── 5. Build the DiagramRequest and generate (grounded, never throws) ──
    const diagramRequest: DiagramRequest = {
      studentId,
      subject,
      grade,
      chapter: { chapterNumber, chapterTitle },
      artifactType: 'diagram',
      ...(diagramType ? { diagramType } : {}),
      language,
    };

    const spec = await generateDiagram(diagramRequest, memoryInput);

    // Metadata-only view audit (fire-and-forget; no PII / P13). An abstain is a
    // normal 200, so both outcomes are audited identically.
    logAudit(callerId, {
      action: 'content.diagram.generated',
      resourceType: 'students',
      resourceId: studentId,
      status: 'success',
      details: { subject, chapterNumber, abstained: spec.abstained },
    });

    // Diagrams are per-student personalized + freshly generated — do not allow
    // shared/stale caching (mirrors the generator's cache_scope:'none').
    return v2Success(
      { schemaVersion: 1 as const, ...spec },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    logger.error('content_diagram_generation_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
