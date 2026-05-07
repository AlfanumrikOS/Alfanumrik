/**
 * Tenant override prompt fragments for the grounded-answer Foxy path.
 *
 * The route at src/app/api/foxy/route.ts feeds the Edge Function's
 * `foxy_tutor_v1` template via `template_variables.foxy_system_prompt`.
 * That variable is the route's local short prompt — distinct from
 * `buildFoxySystemPrompt` (which is used by the legacy intent-router
 * path in src/lib/ai/workflows/explain.ts).
 *
 * This module produces the small "## Tenant Persona / ## Tenant Style"
 * blocks appended to the local prompt when a tenant has set
 * `ai.personality / ai.tone / ai.pedagogy` in tenant_configs.
 *
 * Why a separate module from buildFoxySystemPrompt:
 *   - buildFoxySystemPrompt emits a FULL prompt (Persona / Mode / Safety /
 *     Goal / RAG sections). The grounded path's prompt is tiny — the full
 *     framing lives server-side in `foxy_tutor_v1`.
 *   - We want different copy for the two paths' "tenant section": the
 *     library version REPLACES the persona body; this version PREPENDS a
 *     dedicated "## Tenant Persona" block because the route's prompt has
 *     no replaceable persona body.
 *
 * Empty when all overrides are unset → byte-identical to pre-tenant
 * production output for the route. Matched by the test suite.
 */

export type TenantPersonality = 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
export type TenantTone = 'formal' | 'neutral' | 'casual';
export type TenantPedagogy = 'socratic' | 'direct_instruction' | 'worked_example';

// `warm_mentor` is the platform default — no override block needed (the
// route's existing copy IS the warm-mentor framing).
const PERSONA_BLOCKS: Record<TenantPersonality, string> = {
  warm_mentor: '',
  rigorous_coach:
    '## Tenant Persona\n- Direct, demanding, and high-standards — like an exam-prep coach\n- Push for precision; correct minor errors explicitly\n- Frame examples around exam-pattern questions and past-paper traps',
  formal_examiner:
    '## Tenant Persona\n- Formal, neutral, and procedural — like an official examiner\n- Use precise, syllabus-correct terminology; avoid slang\n- Stick strictly to the prescribed curriculum scope',
  playful_buddy:
    '## Tenant Persona\n- Light, playful, and energetic — like a fun study buddy\n- Friendly Hinglish phrases welcome ("yaar, dekho is tarah")\n- Tie examples to cricket, Bollywood, gaming, school cafeteria',
};

// `neutral` tone is the platform default → empty line.
const TONE_LINES: Record<TenantTone, string> = {
  formal: 'Tone: formal. Complete sentences; avoid contractions and casual interjections.',
  neutral: '',
  casual: 'Tone: casual. Contractions welcome; conversational phrasing throughout.',
};

const PEDAGOGY_LINES: Record<TenantPedagogy, string> = {
  socratic:
    'Teaching style: Socratic. Lead with questions; have the student articulate reasoning before you confirm or correct.',
  direct_instruction:
    'Teaching style: direct instruction. Explain the concept clearly first, then verify understanding with one quick check.',
  worked_example:
    'Teaching style: worked example. Show ONE fully-solved example end-to-end, then ask the student to attempt a similar problem.',
};

export interface TenantOverrideInput {
  tenantPersonality?: TenantPersonality;
  tenantTone?: TenantTone;
  tenantPedagogy?: TenantPedagogy;
}

/**
 * Build the appendable tenant override section. Returns an empty string
 * when all overrides are unset (byte-identical legacy contract) or when
 * every set override resolves to the platform default
 * (`warm_mentor` / `neutral`).
 */
export function buildTenantOverrideSection(input: TenantOverrideInput): string {
  const parts: string[] = [];

  if (input.tenantPersonality && input.tenantPersonality !== 'warm_mentor') {
    const block = PERSONA_BLOCKS[input.tenantPersonality];
    if (block) parts.push(block);
  }

  const modulationLines: string[] = [];
  if (input.tenantTone) {
    const line = TONE_LINES[input.tenantTone];
    if (line) modulationLines.push(`- ${line}`);
  }
  if (input.tenantPedagogy) {
    const line = PEDAGOGY_LINES[input.tenantPedagogy];
    if (line) modulationLines.push(`- ${line}`);
  }
  if (modulationLines.length > 0) {
    parts.push('## Tenant Style\n' + modulationLines.join('\n'));
  }

  return parts.join('\n\n');
}
