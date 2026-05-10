import type {
  ToolDefinition,
  ToolSchema,
  AgentContext,
  DispatchResult,
} from './types';

const CIRCUIT_FAILURE_THRESHOLD = 3;

export interface Registry {
  schemas(): ToolSchema[];
  dispatch(name: string, input: unknown, ctx: AgentContext): Promise<DispatchResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRedactor(name: string): ToolDefinition<any, any>['redactInTrace'];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRegistry(tools: ReadonlyArray<ToolDefinition<any, any>>): Registry {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      throw new Error(`Registry: duplicate tool name "${t.name}"`);
    }
    seen.add(t.name);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byName = new Map<string, ToolDefinition<any, any>>(tools.map((t) => [t.name, t]));
  const failureCount = new Map<string, number>();

  return {
    schemas(): ToolSchema[] {
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    },

    getRedactor(name: string) {
      return byName.get(name)?.redactInTrace;
    },

    async dispatch(name, input, ctx): Promise<DispatchResult> {
      const start = Date.now();
      const tool = byName.get(name);

      if (!tool) {
        return {
          ok: false,
          error: `Unknown tool "${name}"`,
          durationMs: Date.now() - start,
        };
      }

      const failures = failureCount.get(name) ?? 0;
      if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
        return {
          ok: false,
          error: `Tool "${name}" circuit open (${failures} consecutive failures); not retried this run.`,
          durationMs: Date.now() - start,
        };
      }

      try {
        const output = await tool.handler(input as never, ctx);
        failureCount.set(name, 0);
        return { ok: true, output, durationMs: Date.now() - start };
      } catch (err) {
        failureCount.set(name, failures + 1);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    },
  };
}
