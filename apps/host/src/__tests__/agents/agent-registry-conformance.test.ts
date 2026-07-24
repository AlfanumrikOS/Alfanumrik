import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';
import {
  AGENT_REGISTRY,
  FORBIDDEN_MASTERY_WRITE_TABLES,
  findMasteryWrites,
  getAgent,
  listAgents,
  liveAgents,
  type AgentDescriptor,
  type AgentId,
} from '@alfanumrik/lib/agents/registry';

/**
 * GenAI Phase 3 conformance — Agent Registry + WHAT/HOW boundary (spec §3, a–f).
 *
 * The adaptive engine decides WHAT the student learns; GenAI agents decide only
 * HOW and MAY NOT write mastery/progression. This suite pins that contract at
 * runtime, and — invariant (e), "the teeth" — statically proves that NO live
 * agent surface (entry point + any co-located `_lib/`) directly writes any of
 * the 9 forbidden mastery tables.
 *
 * Additive-only: reads source + metadata; touches no flag, migration, or runtime.
 */

// cwd-resilient repo-root resolver (mirrors feature-flag-matrix.test.ts): vitest
// runs from apps/host, but entryPoints include repo-root `supabase/functions/**`
// paths OUTSIDE apps/host, so resolve from the repo root (two levels up) first.
function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

const STABLE_AGENT_IDS: readonly AgentId[] = [
  'tutor',
  'assessment',
  'teacher_copilot',
  'parent_intelligence',
  'lesson',
  'outcome_prediction',
  'content_generation',
];

/** Recursively collect every file path under a directory. */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('GenAI Phase 3 — Agent Registry conformance (spec §3 a–f)', () => {
  // (a) exactly 7 agents; ids equal the stable set.
  it('(a) AGENT_REGISTRY has exactly 7 agents with the stable id set', () => {
    const keys = Object.keys(AGENT_REGISTRY);
    expect(keys).toHaveLength(7);
    expect(new Set(keys)).toEqual(new Set(STABLE_AGENT_IDS));
    expect(listAgents()).toHaveLength(7);
    // The stable ids are a fixed, ordered contract (immutable once shipped).
    expect(keys.sort()).toEqual([...STABLE_AGENT_IDS].sort());
  });

  // (b) EVERY agent decides HOW and mayWriteMastery === false.
  it('(b) every agent decides HOW and may NOT write mastery', () => {
    for (const agent of listAgents()) {
      expect(agent.decides, `${agent.id} must decide HOW`).toBe('HOW');
      expect(
        agent.mayWriteMastery,
        `${agent.id} must not be permitted to write mastery`,
      ).toBe(false);
    }
  });

  // (c) ids unique AND each descriptor.id matches its record key.
  it('(c) agent ids are unique and each descriptor.id matches its record key', () => {
    const ids = listAgents().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, descriptor] of Object.entries(AGENT_REGISTRY)) {
      expect(descriptor.id, `descriptor under key '${key}' must have id === key`).toBe(key);
      // getAgent round-trips by id.
      expect(getAgent(descriptor.id)).toBe(descriptor);
    }
  });

  // (d) every LIVE agent's entryPoint is a real file; every PLANNED agent is null.
  it('(d) live agents have a real on-disk entryPoint; planned agents have null', () => {
    for (const agent of listAgents()) {
      if (agent.status === 'live') {
        expect(agent.entryPoint, `${agent.id} is live and must name an entryPoint`).not.toBeNull();
        const abs = repoPath(agent.entryPoint as string);
        expect(
          existsSync(abs),
          `${agent.id} entryPoint does not exist on disk: ${agent.entryPoint}`,
        ).toBe(true);
        expect(statSync(abs).isFile(), `${agent.id} entryPoint is not a file`).toBe(true);
      } else {
        expect(agent.status).toBe('planned');
        expect(agent.entryPoint, `planned agent ${agent.id} must have null entryPoint`).toBeNull();
      }
    }
    // Sanity: the 5 known live agents are exactly the live set. `outcome_prediction`
    // went live 2026-07-24 (GenAI Phase 5a — apps/host/src/app/api/predict/outcome/route.ts).
    expect(liveAgents().map((a) => a.id).sort()).toEqual(
      ['assessment', 'outcome_prediction', 'parent_intelligence', 'teacher_copilot', 'tutor'].sort(),
    );
  });

  // (e) THE TEETH: no live agent surface writes any forbidden mastery table.
  it('(e) no LIVE agent surface directly writes any forbidden mastery table', () => {
    const violations: string[] = [];

    for (const agent of liveAgents()) {
      const entryAbs = repoPath(agent.entryPoint as string);

      // Scan the entry point plus every file under a co-located `_lib/` dir
      // (e.g. Foxy's apps/host/src/app/api/foxy/_lib/), which is where the
      // route delegates most of its logic.
      const filesToScan = new Set<string>([entryAbs]);
      const libDir = join(dirname(entryAbs), '_lib');
      if (existsSync(libDir) && statSync(libDir).isDirectory()) {
        for (const f of collectFiles(libDir)) filesToScan.add(f);
      }

      for (const file of filesToScan) {
        const source = readFileSync(file, 'utf8');
        const written = findMasteryWrites(source);
        for (const table of written) {
          violations.push(`${agent.id}: writes '${table}' in ${file}`);
        }
      }
    }

    // Clear, actionable failure listing offending agent + table + file.
    expect(
      violations,
      violations.length
        ? `Forbidden mastery writes found in live agent surfaces (WHAT/HOW boundary breach):\n  ${violations.join('\n  ')}`
        : undefined,
    ).toEqual([]);
  });

  // (f) every non-null gatingFlag exists in FLAG_DEFAULTS; no agent uses ff_orchestrator_v1.
  it('(f) gatingFlags are real flags and no agent references ff_orchestrator_v1', () => {
    const flagNames = new Set(Object.keys(FLAG_DEFAULTS));
    for (const agent of listAgents()) {
      expect(
        agent.gatingFlag,
        `${agent.id} must not gate on the dormant orchestrator flag`,
      ).not.toBe('ff_orchestrator_v1');
      if (agent.gatingFlag !== null) {
        expect(
          flagNames.has(agent.gatingFlag),
          `${agent.id} gatingFlag '${agent.gatingFlag}' is not in FLAG_DEFAULTS`,
        ).toBe(true);
      }
    }
  });

  // Structural pin: the forbidden set is the 9 canonical mastery/progression tables.
  it('FORBIDDEN_MASTERY_WRITE_TABLES is the 9 canonical mastery/progression tables', () => {
    expect([...FORBIDDEN_MASTERY_WRITE_TABLES].sort()).toEqual(
      [
        'adaptive_mastery',
        'bloom_progression',
        'cme_concept_state',
        'cme_error_log',
        'concept_mastery',
        'knowledge_gaps',
        'learner_mastery',
        'student_learning_profiles',
        'student_skill_state',
      ].sort(),
    );
  });

  // Type-level guard reflected at runtime: descriptors carry the expected shape.
  it('every descriptor carries the expected HOW-only descriptor shape', () => {
    for (const agent of listAgents()) {
      const a: AgentDescriptor = agent;
      expect(typeof a.displayName).toBe('string');
      expect(a.displayName.length).toBeGreaterThan(0);
      expect(['student', 'teacher', 'parent', 'admin']).toContain(a.audience);
      expect(['live', 'planned']).toContain(a.status);
      expect(Array.isArray(a.capabilities)).toBe(true);
      expect(a.capabilities.length).toBeGreaterThan(0);
      expect(typeof a.consumes.modelGateway).toBe('boolean');
      expect(typeof a.consumes.studentMemory).toBe('boolean');
    }
  });
});
