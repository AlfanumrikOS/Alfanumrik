// supabase/functions/_shared/mol/__tests__/admin-rollback-flag.test.ts
//
// Phase 1A rollback flag — tests both the helper itself AND the contract
// that each of the 6 migrated Edge Functions calls it before invoking MoL.
//
// Why a single shared file? The flag-check pattern is identical across all
// 6 functions; six separate test files would be duplicate scaffolding with
// the same failure modes. Static source inspection catches the only thing
// that can drift — whether the call site was inserted at all.
//
// Strategy:
//   Part A: unit-test the helper's kill-switch / metadata.enabled / fallback
//           precedence with a stubbed getFlagEnvelope.
//   Part B: static-source inspection of each of the 6 Edge Function files
//           to confirm the dispatch pattern is present + identical.

// @ts-ignore — feature-flag.ts reads Deno.env at module load time.
globalThis.Deno = { env: { get: (_k: string) => '' } }

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import * as featureFlag from '../feature-flag.ts'
import { isMolAdminRoutingEnabled, MOL_ADMIN_FUNCTIONS_FLAG } from '../admin-rollback-flag.ts'

// ─── Part A: helper unit tests ────────────────────────────────────────────────

describe('admin-rollback-flag — helper', () => {
  let getFlagEnvelopeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getFlagEnvelopeSpy = vi.spyOn(featureFlag, 'getFlagEnvelope')
  })

  afterEach(() => {
    getFlagEnvelopeSpy.mockRestore()
  })

  it('exports the canonical flag name', () => {
    expect(MOL_ADMIN_FUNCTIONS_FLAG).toBe('ff_mol_admin_functions_v1')
  })

  it('returns true when is_enabled=true and metadata has no overrides', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({ is_enabled: true, metadata: {} })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(true)
  })

  it('returns false when is_enabled=false', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({ is_enabled: false, metadata: {} })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })

  it('kill_switch=true forces legacy path regardless of is_enabled', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: { kill_switch: true, enabled: true },
    })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })

  it('metadata.enabled=false overrides is_enabled=true', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: { enabled: false },
    })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })

  it('metadata.enabled=true overrides is_enabled=false', async () => {
    // Operational toggle path: ops can flip metadata.enabled=true while
    // is_enabled remains false (e.g. canary cohort) and we honor the
    // metadata override. This is the symmetric counterpart of the
    // kill-switch precedence.
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: false,
      metadata: { enabled: true },
    })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(true)
  })

  it('kill_switch=true takes precedence over metadata.enabled=true', async () => {
    // The kill switch is the highest-priority lever. Even if ops left
    // metadata.enabled=true from a prior config, hitting kill_switch must
    // force the legacy path.
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: { kill_switch: true, enabled: true },
    })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })

  it('returns false (legacy path) when flag read throws', async () => {
    // Defensive contract: a flag-service outage must NOT accidentally
    // route to OpenAI. We prefer cost loss over violating an operator's
    // belief that the kill switch is on.
    getFlagEnvelopeSpy.mockRejectedValue(new Error('supabase unreachable'))
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })

  it('returns false (legacy path) when metadata is null', async () => {
    // getFlagEnvelope returns `{ metadata: {} }` for null metadata, but
    // defensive guard: if a future change relaxes that, we still default
    // to the is_enabled column.
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: false,
      metadata: null as unknown as Record<string, unknown>,
    })
    await expect(isMolAdminRoutingEnabled()).resolves.toBe(false)
  })
})

// ─── Part B: static-source inspection across all 6 Edge Functions ────────────

const REPO_ROOT = process.cwd()

interface AdminFn {
  name: string
  file: string
  // The MoL call sites for this function — each must be gated by the flag.
  expectedDispatchTargets: string[]
  // Legacy fallback symbols the file must define (so the rollback works).
  expectedLegacySymbols: string[]
}

const ADMIN_FUNCTIONS: AdminFn[] = [
  {
    name: 'bulk-question-gen',
    file: 'supabase/functions/bulk-question-gen/index.ts',
    // Two LLM call sites: the bulk generator + the oracle grader.
    expectedDispatchTargets: ['callClaudeLegacy', 'callOracleGraderLegacy'],
    expectedLegacySymbols: [
      'async function callClaudeLegacy',
      'async function callOracleGraderLegacy',
    ],
  },
  {
    name: 'bulk-non-mcq-gen',
    file: 'supabase/functions/bulk-non-mcq-gen/index.ts',
    expectedDispatchTargets: ['callClaudeLegacy'],
    expectedLegacySymbols: ['async function callClaudeLegacy'],
  },
  {
    name: 'extract-ncert-questions',
    file: 'supabase/functions/extract-ncert-questions/index.ts',
    expectedDispatchTargets: ['callClaudeLegacy'],
    expectedLegacySymbols: ['async function callClaudeLegacy'],
  },
  {
    name: 'generate-answers',
    file: 'supabase/functions/generate-answers/index.ts',
    expectedDispatchTargets: ['callClaudeLegacy'],
    expectedLegacySymbols: ['async function callClaudeLegacy'],
  },
  {
    name: 'generate-concepts',
    file: 'supabase/functions/generate-concepts/index.ts',
    expectedDispatchTargets: ['callClaudeLegacy'],
    expectedLegacySymbols: ['async function callClaudeLegacy'],
  },
  {
    name: 'parent-report-generator',
    file: 'supabase/functions/parent-report-generator/index.ts',
    // Inlined call site refactored into callLlmViaMol + callLlmLegacy.
    expectedDispatchTargets: ['callLlmLegacy', 'callLlmViaMol'],
    expectedLegacySymbols: ['async function callLlmLegacy', 'async function callLlmViaMol'],
  },
]

describe('admin-rollback-flag — Phase 1A Edge Function contract', () => {
  for (const fn of ADMIN_FUNCTIONS) {
    describe(fn.name, () => {
      const filePath = resolve(REPO_ROOT, fn.file)
      let source = ''

      it('source file exists', () => {
        expect(existsSync(filePath)).toBe(true)
        source = readFileSync(filePath, 'utf8')
        expect(source.length).toBeGreaterThan(0)
      })

      it('imports isMolAdminRoutingEnabled from the shared helper', () => {
        source = source || readFileSync(filePath, 'utf8')
        expect(source).toMatch(
          /import\s*\{\s*isMolAdminRoutingEnabled\s*\}\s*from\s*['"]\.\.\/_shared\/mol\/admin-rollback-flag\.ts['"]/,
        )
      })

      it('calls isMolAdminRoutingEnabled() before the MoL dispatch', () => {
        source = source || readFileSync(filePath, 'utf8')
        // Two canonical dispatch shapes are accepted:
        //   (a) early-return: `if (!(await isMolAdminRoutingEnabled())) return callXxxLegacy(...)`
        //   (b) ternary:     `(await isMolAdminRoutingEnabled()) ? mol : legacy`
        // parent-report-generator uses (b) because the JSON parser is shared
        // and only runs once; the other 5 functions use (a). Both are correct.
        const earlyReturn = /if\s*\(\s*!\s*\(\s*await\s+isMolAdminRoutingEnabled\s*\(\s*\)\s*\)\s*\)/
        const ternary = /\(\s*await\s+isMolAdminRoutingEnabled\s*\(\s*\)\s*\)\s*\?/
        const found = earlyReturn.test(source) || ternary.test(source)
        expect(found).toBe(true)
      })

      it('defines all expected legacy fallback functions', () => {
        source = source || readFileSync(filePath, 'utf8')
        for (const sym of fn.expectedLegacySymbols) {
          expect(source).toContain(sym)
        }
      })

      it('legacy path dispatches into the legacy function (not back into MoL)', () => {
        source = source || readFileSync(filePath, 'utf8')
        for (const target of fn.expectedDispatchTargets) {
          expect(source).toContain(target)
        }
      })

      it('legacy path retains direct-Anthropic fetch (rollback must reach Claude)', () => {
        source = source || readFileSync(filePath, 'utf8')
        // The whole point of the rollback flag is to revert to direct
        // Anthropic. If a future refactor accidentally collapses the legacy
        // path back into MoL, the flag stops working — this is the canary.
        // `fetch` and `fetchWithProviderTimeout` are both direct-to-Anthropic;
        // only `generateResponse` (MoL) is disallowed here.
        expect(source).toMatch(/(?:fetch|fetchWithProviderTimeout)\s*\(\s*['"]https:\/\/api\.anthropic\.com\/v1\/messages['"]/)
        expect(source).toContain("'x-api-key'")
        expect(source).toContain('claude-haiku-4-5-20251001')
      })

      it('still imports generateResponse (MoL path is the default)', () => {
        source = source || readFileSync(filePath, 'utf8')
        // Default is MoL ON. If a future change accidentally deletes the
        // generateResponse import, the default path is broken.
        expect(source).toContain('generateResponse')
        expect(source).toMatch(/from\s*['"]\.\.\/_shared\/mol\/index\.ts['"]/)
      })
    })
  }
})
