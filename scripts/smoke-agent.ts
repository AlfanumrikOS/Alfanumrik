/**
 * Smoke test for the LLM-as-planner loop via the chapter-explorer agent.
 *
 * Runs against the Supabase project pointed to by .env.local
 * (typically staging). Prints the agent's final text + step trace.
 *
 * Usage:
 *   npm run smoke:agent -- --subject science --grade 9 --chapter "Force and Laws of Motion"
 *
 * Implementation note: imports of agent code are dynamic (inside main) so that
 * `loadEnv` runs BEFORE any module that reads process.env at import time.
 * Static imports are hoisted by ESM and would fire before the body runs.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

interface Args {
  subject: string;
  grade: string;
  chapter: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--subject') out.subject = argv[++i];
    else if (a === '--grade') out.grade = argv[++i];
    else if (a === '--chapter') out.chapter = argv[++i];
  }
  if (!out.subject || !out.grade || !out.chapter) {
    console.error('Usage: npm run smoke:agent -- --subject <s> --grade <g> --chapter <c>');
    process.exit(2);
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n→ Running chapter-explorer for ${args.subject} grade ${args.grade}: "${args.chapter}"\n`);

  // Dynamic imports — see file header for why.
  const { runChapterExplorer } = await import('../src/lib/ai/agents/agents/chapter-explorer');
  const { supabaseAdmin } = await import('../src/lib/supabase-admin');

  const t0 = Date.now();
  const result = await runChapterExplorer(args);
  const elapsed = Date.now() - t0;

  console.log('─── Final Text ─────────────────────────────────────');
  console.log(result.finalText);
  console.log('────────────────────────────────────────────────────');
  console.log(`Steps: ${result.stepCount}`);
  console.log(`Tokens: ${result.tokensInput} in / ${result.tokensOutput} out`);
  console.log(`Wall time: ${elapsed}ms`);
  console.log(`Run ID: ${result.runId}`);

  const { data: steps } = await supabaseAdmin
    .from('agent_steps')
    .select('step_number, step_type, tool_name, tool_error, llm_stop_reason, duration_ms')
    .eq('run_id', result.runId)
    .order('step_number');

  console.log('\n─── Step Trace ─────────────────────────────────────');
  type StepRow = {
    step_number: number;
    step_type: string;
    tool_name: string | null;
    tool_error: string | null;
    llm_stop_reason: string | null;
    duration_ms: number;
  };
  for (const s of (steps as StepRow[] | null) ?? []) {
    const tag =
      s.step_type === 'llm_call'
        ? `LLM (${s.llm_stop_reason})`
        : `TOOL ${s.tool_name}${s.tool_error ? ' [ERR]' : ''}`;
    console.log(`#${s.step_number}  ${tag}  ${s.duration_ms}ms`);
  }
  console.log('────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
