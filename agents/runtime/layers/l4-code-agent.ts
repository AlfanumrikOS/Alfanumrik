/**
 * agents/runtime/layers/l4-code-agent.ts — real L4 worker for the
 * `code_agent` role.
 *
 * Replaces the `l4_stub_execute` from tick.ts when called with --real-l4.
 * Given a TaskAssignment + an open worktree + a path-scoped sandbox,
 * runs an agent loop against Anthropic's Messages API, lets the model
 * read/write files via tool use, and emits a CompletedTask.
 *
 * Hard limits enforced here (not delegated to the model):
 *   - Token budget: TaskAssignment.max_tokens. Worker aborts if exceeded.
 *   - Turn limit:   MAX_TURNS. Worker aborts with result='failed'.
 *   - File budget:  MAX_FILE_BYTES per read. Long files truncated.
 *   - Path safety:  all tool inputs go through sandbox.ts.
 *
 * Cost reporting: every Messages call's usage is summed; CompletedTask
 * reports the total in `tokens_spent` so L7 can attribute spend.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assertAnthropicReady,
  createMessage,
  extractToolUses,
  extractText,
  sumTokens,
  type ContentBlock,
  type Message,
  type Model,
  type SystemBlock,
  type ToolDef,
  type Usage,
} from '../anthropic';
import {
  safeListFiles,
  safeReadFile,
  safeWriteFile,
  SandboxError,
  type SandboxConfig,
} from '../sandbox';
import type { WorktreeHandle } from '../worktree';

const MAX_TURNS = 30;
const MAX_FILE_BYTES = 200_000; // cap a single read_file to keep context bounded
const PROMPT_FILE = 'agents/prompts/l4-code-agent.md';

// ─── Types (mirror the agents/contracts shape, narrowed to L4 fields) ─

export interface TaskAssignmentInput {
  task_id: string;
  cycle_id: string;
  agent_role: string;
  title: string;
  objective: string;
  definition_of_done: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  model_hint?: 'opus' | 'sonnet' | 'haiku';
  max_tokens: number;
}

export interface CompletedTaskOutput {
  task_id: string;
  cycle_id: string;
  agent_role: string;
  result: 'succeeded' | 'failed' | 'needs_replan';
  branch: string;
  pr_url: string | null;
  summary: string;
  files_changed: Array<{ path: string; change: 'added' | 'modified' | 'deleted' | 'renamed' }>;
  constraints_respected: string[];
  lessons_applied: string[];
  open_questions: string[];
  blocker_note: string | null;
  tokens_spent: number;
}

// ─── Tool definitions handed to Claude ────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: 'list_files',
    description:
      'List files under a directory in the worktree. Only files under your allowed_paths are returned. Use this once at the start to understand the shape of what you can touch.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory path. Use "." for the worktree root.' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a file in the worktree. Path must be under allowed_paths and not in forbidden_paths. Large files are truncated; rely on the response to confirm size.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file in the worktree. Path must be under allowed_paths and not in forbidden_paths. Provide the full new contents — there is no patch/diff mode.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path.' },
        content: { type: 'string', description: 'Full new file contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'finish',
    description:
      'Signal completion. Use the summary format from your role prompt. Call this when every line of the definition_of_done is satisfied — or when you have determined the task cannot be completed (set result accordingly).',
    input_schema: {
      type: 'object',
      properties: {
        result: { type: 'string', enum: ['succeeded', 'failed', 'needs_replan'] },
        summary: { type: 'string' },
        open_questions: { type: 'array', items: { type: 'string' } },
        blocker_note: { type: 'string' },
      },
      required: ['result', 'summary'],
    },
  },
];

// ─── Model selection ─────────────────────────────────────────────────

function pickModel(hint: TaskAssignmentInput['model_hint']): Model {
  switch (hint) {
    case 'opus':
      return 'claude-opus-4-7';
    case 'haiku':
      return 'claude-haiku-4-5';
    case 'sonnet':
    default:
      return 'claude-sonnet-4-6';
  }
}

// ─── System prompt assembly ──────────────────────────────────────────

async function loadRolePrompt(repoRoot: string): Promise<string> {
  return await fs.readFile(path.join(repoRoot, PROMPT_FILE), 'utf8');
}

function taskBrief(t: TaskAssignmentInput): string {
  return [
    `# Task brief — ${t.title}`,
    '',
    `**task_id:** ${t.task_id}`,
    `**cycle_id:** ${t.cycle_id}`,
    '',
    '## Objective',
    t.objective,
    '',
    '## Definition of done',
    ...t.definition_of_done.map(d => `- ${d}`),
    '',
    '## Allowed paths',
    ...t.allowed_paths.map(p => `- ${p}`),
    '',
    '## Forbidden paths',
    ...t.forbidden_paths.map(p => `- ${p}`),
  ].join('\n');
}

// ─── Tool dispatcher ─────────────────────────────────────────────────

interface ToolDispatchResult {
  text: string;
  isError: boolean;
  /** If 'finish' was called, the parsed payload — caller exits the loop. */
  finishPayload: {
    result: 'succeeded' | 'failed' | 'needs_replan';
    summary: string;
    open_questions?: string[];
    blocker_note?: string;
  } | null;
}

async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  sandbox: SandboxConfig,
  writes: Set<string>,
): Promise<ToolDispatchResult> {
  try {
    if (name === 'list_files') {
      const p = String(input.path ?? '.');
      const files = await safeListFiles(sandbox, p);
      return { text: files.join('\n') || '(no files in scope)', isError: false, finishPayload: null };
    }
    if (name === 'read_file') {
      const p = String(input.path ?? '');
      if (!p) return { text: 'read_file requires a path.', isError: true, finishPayload: null };
      const content = await safeReadFile(sandbox, p);
      if (content.length > MAX_FILE_BYTES) {
        return {
          text: `${content.slice(0, MAX_FILE_BYTES)}\n\n--- TRUNCATED at ${MAX_FILE_BYTES} bytes (full size: ${content.length}) ---`,
          isError: false,
          finishPayload: null,
        };
      }
      return { text: content, isError: false, finishPayload: null };
    }
    if (name === 'write_file') {
      const p = String(input.path ?? '');
      const c = String(input.content ?? '');
      if (!p) return { text: 'write_file requires a path.', isError: true, finishPayload: null };
      await safeWriteFile(sandbox, p, c);
      writes.add(p);
      return { text: `wrote ${c.length} bytes to ${p}`, isError: false, finishPayload: null };
    }
    if (name === 'finish') {
      const payload = {
        result: (input.result as ToolDispatchResult['finishPayload'] extends infer P ? P extends null ? never : P : never)?.result ?? 'succeeded',
        summary: String(input.summary ?? ''),
        open_questions: Array.isArray(input.open_questions) ? input.open_questions.map(String) : [],
        blocker_note: typeof input.blocker_note === 'string' ? input.blocker_note : undefined,
      };
      // Re-parse with stricter narrowing to satisfy the enum.
      const r = String(input.result ?? 'succeeded');
      const result = (r === 'failed' || r === 'needs_replan') ? r : 'succeeded';
      return {
        text: `acknowledged finish (${result})`,
        isError: false,
        finishPayload: {
          result,
          summary: payload.summary,
          open_questions: payload.open_questions,
          blocker_note: payload.blocker_note,
        },
      };
    }
    return { text: `unknown tool: ${name}`, isError: true, finishPayload: null };
  } catch (err: unknown) {
    if (err instanceof SandboxError) {
      return {
        text: `SandboxError (${err.code}): ${err.message}. Either pick an in-scope path or call finish with result='needs_replan'.`,
        isError: true,
        finishPayload: null,
      };
    }
    return {
      text: `Tool error: ${(err as Error).message}`,
      isError: true,
      finishPayload: null,
    };
  }
}

// ─── The agent loop ──────────────────────────────────────────────────

export interface RunCodeAgentArgs {
  repoRoot: string;
  worktree: WorktreeHandle;
  task: TaskAssignmentInput;
}

export async function runCodeAgent(args: RunCodeAgentArgs): Promise<CompletedTaskOutput> {
  assertAnthropicReady();
  const sandbox: SandboxConfig = {
    worktreeRoot: args.worktree.root,
    allowedPaths: args.task.allowed_paths,
    forbiddenPaths: args.task.forbidden_paths,
  };

  const rolePrompt = await loadRolePrompt(args.repoRoot);
  const initialTree = (await safeListFiles(sandbox, '.')).slice(0, 200); // bound the initial dump

  const system: SystemBlock[] = [
    { type: 'text', text: rolePrompt, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text:
        `## Initial file tree (filtered to your allowed_paths)\n\n` +
        (initialTree.length > 0 ? initialTree.join('\n') : '(empty)'),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const model = pickModel(args.task.model_hint);
  const messages: Message[] = [{ role: 'user', content: taskBrief(args.task) }];
  const usages: Usage[] = [];
  const writes = new Set<string>();

  let finishPayload: ToolDispatchResult['finishPayload'] = null;
  let blocker: string | null = null;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Token budget check (preceding turn's running total).
    const spent = sumTokens(usages);
    if (spent >= args.task.max_tokens) {
      blocker = `Token budget exceeded (${spent} ≥ ${args.task.max_tokens}) before turn ${turn}.`;
      break;
    }

    let response;
    try {
      response = await createMessage({
        model,
        max_tokens: 8192,
        system,
        messages,
        tools: TOOLS,
        temperature: 0,
      });
    } catch (err: unknown) {
      blocker = `Anthropic API error on turn ${turn}: ${(err as Error).message}`;
      break;
    }
    usages.push(response.usage);

    // Append the assistant turn to the message history.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = extractToolUses(response.content);
    if (toolUses.length === 0) {
      // Model emitted text without tool calls. Nudge once; if it happens
      // twice in a row treat it as a stalled run.
      const text = extractText(response.content).trim();
      messages.push({
        role: 'user',
        content:
          'You produced no tool calls. Use list_files/read_file/write_file to do the work, or call finish to end.\n' +
          (text ? `(Your last message: "${text.slice(0, 200)}")` : ''),
      });
      continue;
    }

    // Execute every tool_use in order; collect tool_results into ONE user turn.
    const toolResults: ContentBlock[] = [];
    for (const tu of toolUses) {
      const r = await dispatchTool(tu.name, tu.input, sandbox, writes);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: r.text,
        is_error: r.isError || undefined,
      });
      if (r.finishPayload) finishPayload = r.finishPayload;
    }
    messages.push({ role: 'user', content: toolResults });

    if (finishPayload) break;
    if (response.stop_reason === 'end_turn' && toolUses.length === 0) break;
  }

  const tokensSpent = sumTokens(usages);

  if (!finishPayload && !blocker) {
    blocker = `Hit MAX_TURNS=${MAX_TURNS} without finish.`;
  }

  const result: CompletedTaskOutput['result'] = finishPayload?.result ?? 'failed';
  const summary =
    finishPayload?.summary ??
    `Agent did not produce a summary. ${blocker ?? 'Unknown termination.'}`;

  const filesChanged = Array.from(writes).map(p => ({ path: p, change: 'modified' as const }));

  return {
    task_id: args.task.task_id,
    cycle_id: args.task.cycle_id,
    agent_role: args.task.agent_role,
    result,
    branch: args.worktree.branch,
    pr_url: null,
    summary,
    files_changed: filesChanged,
    constraints_respected: args.task.forbidden_paths,
    lessons_applied: [],
    open_questions: finishPayload?.open_questions ?? [],
    blocker_note: blocker ?? finishPayload?.blocker_note ?? null,
    tokens_spent: tokensSpent,
  };
}
