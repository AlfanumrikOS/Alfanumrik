/**
 * Content Generation Agent — PURE diagram planner conformance
 * (GenAI Phase 5c, REG-314).
 *
 * `planDiagram(request, memory)` is the assessment-owned pure core that maps the
 * chapter content + the platform's EXISTING unified-memory adaptation signals onto
 * a `DiagramPlan` (the pre-generation blueprint). It decides only HOW to VISUALIZE
 * (diagram TYPE / node budget / complexity) — never WHICH chapter — and writes
 * NOTHING. It re-derives NO mastery and holds NO numeric mastery threshold: the
 * mastery decision is `memory.masteryLevel` VERBATIM; the node-budget numbers are
 * PRESENTATION parameters. This suite pins:
 *
 *   1. Diagram-type selection: caller override honored (in v1 set) / ignored (out
 *      of set → heuristic); content heuristic timeline/flowchart/mindmap + priority;
 *      subject fallback (history_sr → timeline, social_studies NOT); default mindmap.
 *   2. Node budget per band (6/9/12) + visual bonus (+3) + clamp (15) + branch
 *      depth + detail level.
 *   3. Purity — deterministic, does not mutate inputs, never throws.
 *
 * The planner runs REAL (no mocks); a drift in the band anchors or keyword lists
 * surfaces here.
 */
import { describe, it, expect } from 'vitest';
import { planDiagram } from '@alfanumrik/lib/diagram/diagram-plan';
import type {
  DiagramRequest,
  DiagramMemoryInput,
  DiagramKind,
  MasteryBand,
} from '@alfanumrik/lib/diagram/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function req(over: Partial<DiagramRequest> = {}): DiagramRequest {
  return {
    studentId: 'stu-1',
    subject: 'science',
    grade: '8', // P5: STRING
    chapter: { chapterNumber: 3, chapterTitle: 'Cell Structure' },
    artifactType: 'diagram',
    language: 'en',
    ...over,
  };
}

function memory(
  band: MasteryBand = 'medium',
  learningStyle: string | null = null,
): DiagramMemoryInput {
  return {
    masteryLevel: band,
    preferences: { learningStyle },
  };
}

/** Build a request whose chapterTitle contains no heuristic keyword. */
function neutralTitle(over: Partial<DiagramRequest> = {}): DiagramRequest {
  return req({ chapter: { chapterNumber: 1, chapterTitle: 'Akbar' }, ...over });
}

// ════════════════════════════════════════════════════════════════════════════
// (1) Diagram-type selection — HOW-only
// ════════════════════════════════════════════════════════════════════════════

describe('planDiagram — caller override', () => {
  it('honors a valid v1 override even when the title would heuristic to something else', () => {
    // Title "The French Revolution" would heuristic to timeline; the override wins.
    const plan = planDiagram(
      req({ diagramType: 'flowchart', chapter: { chapterNumber: 2, chapterTitle: 'The French Revolution' } }),
      memory(),
    );
    expect(plan.diagramKind).toBe('flowchart');
    expect(plan.diagramKindSource).toBe('caller_override');
  });

  it('IGNORES an out-of-v1-set override and falls through to the content heuristic', () => {
    // 'sequenceDiagram' is an allowlisted Mermaid header but NOT in the v1 set.
    const plan = planDiagram(
      req({
        diagramType: 'sequenceDiagram' as unknown as DiagramKind,
        chapter: { chapterNumber: 2, chapterTitle: 'The French Revolution' },
      }),
      memory(),
    );
    // Heuristic picks timeline from 'revolution'; the override did not stick.
    expect(plan.diagramKind).toBe('timeline');
    expect(plan.diagramKindSource).toBe('content_heuristic');
  });
});

describe('planDiagram — content heuristic', () => {
  it('a chronological keyword → timeline', () => {
    const plan = planDiagram(
      req({ chapter: { chapterNumber: 2, chapterTitle: 'The French Revolution' } }),
      memory(),
    );
    expect(plan.diagramKind).toBe('timeline');
    expect(plan.diagramKindSource).toBe('content_heuristic');
  });

  it('a process keyword → flowchart', () => {
    const plan = planDiagram(
      req({ subject: 'science', chapter: { chapterNumber: 5, chapterTitle: 'The Process of Digestion' } }),
      memory(),
    );
    expect(plan.diagramKind).toBe('flowchart');
    expect(plan.diagramKindSource).toBe('content_heuristic');
  });

  it('a taxonomy keyword → mindmap', () => {
    const plan = planDiagram(
      req({ chapter: { chapterNumber: 4, chapterTitle: 'Types of Triangles' } }),
      memory(),
    );
    expect(plan.diagramKind).toBe('mindmap');
    expect(plan.diagramKindSource).toBe('content_heuristic');
  });

  it('priority: a title with BOTH a timeline and a flowchart keyword picks timeline', () => {
    // 'war' (timeline) + 'cycle' (flowchart) → timeline wins by KIND_PRIORITY.
    const plan = planDiagram(
      req({ chapter: { chapterNumber: 6, chapterTitle: 'The War Cycle' } }),
      memory(),
    );
    expect(plan.diagramKind).toBe('timeline');
  });
});

describe('planDiagram — subject fallback + default', () => {
  it('history_sr with a keyword-free title → timeline (chronological subject fallback)', () => {
    const plan = planDiagram(neutralTitle({ subject: 'history_sr' }), memory());
    expect(plan.diagramKind).toBe('timeline');
    expect(plan.diagramKindSource).toBe('content_heuristic');
  });

  it('social_studies is NOT chronological → default mindmap for a keyword-free title', () => {
    const plan = planDiagram(neutralTitle({ subject: 'social_studies' }), memory());
    expect(plan.diagramKind).toBe('mindmap');
  });

  it('a keyword-free title on a non-chronological subject → default mindmap', () => {
    const plan = planDiagram(neutralTitle({ subject: 'science' }), memory());
    expect(plan.diagramKind).toBe('mindmap');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) Node budget / branch depth / detail level per band
// ════════════════════════════════════════════════════════════════════════════

describe('planDiagram — node budget by mastery band', () => {
  it('non-visual bands map to 6 / 9 / 12 nodes', () => {
    expect(planDiagram(req(), memory('low')).maxNodes).toBe(6);
    expect(planDiagram(req(), memory('medium')).maxNodes).toBe(9);
    expect(planDiagram(req(), memory('high')).maxNodes).toBe(12);
  });

  it('a visual learner adds +3 to the band base', () => {
    expect(planDiagram(req(), memory('low', 'visual')).maxNodes).toBe(9); // 6 + 3
    expect(planDiagram(req(), memory('medium', 'visual')).maxNodes).toBe(12); // 9 + 3
    expect(planDiagram(req(), memory('low', 'visual')).richLabels).toBe(true);
  });

  it('the node budget is clamped at 15 (high + visual = 12 + 3 = 15, the cap)', () => {
    const plan = planDiagram(req(), memory('high', 'visual'));
    expect(plan.maxNodes).toBe(15);
    // Never exceeds the legibility cap even at the richest band + bonus.
    expect(plan.maxNodes).toBeLessThanOrEqual(15);
  });

  it('a non-visual learning style earns no bonus (richLabels false)', () => {
    const plan = planDiagram(req(), memory('high', 'kinesthetic'));
    expect(plan.maxNodes).toBe(12);
    expect(plan.richLabels).toBe(false);
  });

  it('branch depth + detail level are band-derived', () => {
    expect(planDiagram(req(), memory('low')).maxBranchDepth).toBe(1);
    expect(planDiagram(req(), memory('medium')).maxBranchDepth).toBe(2);
    expect(planDiagram(req(), memory('high')).maxBranchDepth).toBe(2);

    expect(planDiagram(req(), memory('low')).detailLevel).toBe('core');
    expect(planDiagram(req(), memory('medium')).detailLevel).toBe('standard');
    expect(planDiagram(req(), memory('high')).detailLevel).toBe('rich');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (3) Purity
// ════════════════════════════════════════════════════════════════════════════

describe('planDiagram — purity', () => {
  it('identical inputs produce deeply-equal plans (deterministic)', () => {
    const r = req({ chapter: { chapterNumber: 2, chapterTitle: 'The French Revolution' } });
    const m = memory('high', 'visual');
    expect(planDiagram(r, m)).toEqual(planDiagram(r, m));
  });

  it('does not mutate its inputs', () => {
    const r = req();
    const m = memory('medium', 'visual');
    const rSnap = JSON.parse(JSON.stringify(r));
    const mSnap = JSON.parse(JSON.stringify(m));
    planDiagram(r, m);
    expect(r).toEqual(rSnap);
    expect(m).toEqual(mSnap);
  });

  it('never throws on minimal well-formed input across all bands', () => {
    for (const band of ['low', 'medium', 'high'] as MasteryBand[]) {
      expect(() => planDiagram(req(), memory(band))).not.toThrow();
      expect(() => planDiagram(neutralTitle(), memory(band, 'visual'))).not.toThrow();
    }
  });
});
