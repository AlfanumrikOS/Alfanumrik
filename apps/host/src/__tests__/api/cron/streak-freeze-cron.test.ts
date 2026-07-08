import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

const FN_PATH = resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'supabase/functions/daily-cron/index.ts',
);

// Helper to extract and transpile the resetMissedStreaks function from Deno index.ts
const getResetMissedStreaksFn = () => {
  if (!existsSync(FN_PATH)) {
    throw new Error(`File not found: ${FN_PATH}`);
  }
  const src = readFileSync(FN_PATH, 'utf8');
  const startIdx = src.indexOf('async function resetMissedStreaks');
  if (startIdx === -1) {
    throw new Error('Could not find resetMissedStreaks in daily-cron index.ts');
  }

  // Parse braces to get the complete function block
  let openBraces = 0;
  let pos = src.indexOf('{', startIdx);
  if (pos === -1) {
    throw new Error('Could not find starting brace of resetMissedStreaks');
  }
  openBraces = 1;
  pos++;

  while (openBraces > 0 && pos < src.length) {
    if (src[pos] === '{') openBraces++;
    else if (src[pos] === '}') openBraces--;
    pos++;
  }

  const funcStr = src.slice(startIdx, pos);

  // Transpile TypeScript syntax to vanilla JS so new Function() can evaluate it without syntax errors
  const transpiled = ts.transpileModule(funcStr, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;

  // Create a wrapper function that executes the transpiled code inside a controlled scope
  const wrapper = new Function('supabase', 'posthogCapture', `
    ${transpiled}
    return resetMissedStreaks(supabase);
  `);

  return wrapper;
};

// Simple Supabase client mock builder
const mockSupabase = () => {
  const calls: any[] = [];
  const responses: any[] = [];

  const addResponse = (table: string, method: string, data: any, error: any = null) => {
    responses.push({ table, method, data, error, used: false });
  };

  const createBuilder = (table: string) => {
    const call: any = { table, method: '', params: null, filters: [] };
    calls.push(call);

    const builder: any = {
      select: (val: any) => {
        if (!call.method) call.method = 'select';
        call.selectFields = val;
        return builder;
      },
      update: (val: any) => {
        call.method = 'update';
        call.params = val;
        return builder;
      },
      gt: (col: string, val: any) => {
        call.filters.push({ type: 'gt', col, val });
        return builder;
      },
      lt: (col: string, val: any) => {
        call.filters.push({ type: 'lt', col, val });
        return builder;
      },
      eq: (col: string, val: any) => {
        call.filters.push({ type: 'eq', col, val });
        return builder;
      },
      in: (col: string, val: any) => {
        call.filters.push({ type: 'in', col, val });
        return builder;
      },
      then: (resolveFn: any) => {
        // Find the first unused response matching table and method
        const matchIdx = responses.findIndex(r => !r.used && r.table === table && r.method === call.method);
        if (matchIdx !== -1) {
          responses[matchIdx].used = true;
          return Promise.resolve({ data: responses[matchIdx].data, error: responses[matchIdx].error }).then(resolveFn);
        }
        // Fallback: match table only
        const tableMatchIdx = responses.findIndex(r => !r.used && r.table === table);
        if (tableMatchIdx !== -1) {
          responses[tableMatchIdx].used = true;
          return Promise.resolve({ data: responses[tableMatchIdx].data, error: responses[tableMatchIdx].error }).then(resolveFn);
        }
        return Promise.resolve({ data: null, error: null }).then(resolveFn);
      }
    };
    return builder;
  };

  return {
    client: {
      from: (table: string) => createBuilder(table),
    } as any,
    calls,
    addResponse,
    clear: () => {
      calls.length = 0;
      responses.length = 0;
    }
  };
};

describe('daily-cron resetMissedStreaks logic', () => {
  let resetMissedStreaksFn: any;
  let supabaseMock: ReturnType<typeof mockSupabase>;
  const posthogCaptureMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    posthogCaptureMock.mockReset();
    supabaseMock = mockSupabase();
    if (!resetMissedStreaksFn) {
      resetMissedStreaksFn = getResetMissedStreaksFn();
    }
  });

  it('runs successfully when no students are at risk', async () => {
    supabaseMock.addResponse('student_learning_profiles', 'select', []);
    supabaseMock.addResponse('student_learning_profiles', 'update', []);

    const resetCount = await resetMissedStreaksFn(supabaseMock.client, posthogCaptureMock);
    expect(resetCount).toBe(0);

    // Verify initial query
    const firstCall = supabaseMock.calls[0];
    expect(firstCall.table).toBe('student_learning_profiles');
    expect(firstCall.method).toBe('select');
    expect(firstCall.filters).toContainEqual(expect.objectContaining({ type: 'gt', col: 'streak_days', val: 0 }));
  });

  it('correctly applies streak freeze for at-risk students who have freezes available', async () => {
    const atRiskProfiles = [
      { student_id: 'student-freeze-1' }
    ];
    const studentData = [
      { id: 'student-freeze-1', freezes_available: 2, freezes_used_total: 1 }
    ];

    // Mock responses:
    // 1. Fetch at risk profiles
    supabaseMock.addResponse('student_learning_profiles', 'select', atRiskProfiles);
    // 2. Fetch student freeze availability
    supabaseMock.addResponse('students', 'select', studentData);
    // 3. Update students (consume freeze)
    supabaseMock.addResponse('students', 'update', { success: true });
    // 4. Update student_learning_profiles (bump last_session_at)
    supabaseMock.addResponse('student_learning_profiles', 'update', { success: true });
    // 5. Bulk reset (should be empty for those saved)
    supabaseMock.addResponse('student_learning_profiles', 'update', []);

    const resetCount = await resetMissedStreaksFn(supabaseMock.client, posthogCaptureMock);
    expect(resetCount).toBe(0);

    // Verify freeze consumption was called
    const consumeCall = supabaseMock.calls.find(c => c.table === 'students' && c.method === 'update');
    expect(consumeCall).toBeDefined();
    expect(consumeCall.params).toMatchObject({
      freezes_available: 1,
      freezes_used_total: 2,
    });
    expect(consumeCall.params.last_freeze_used_at).toBeDefined();
    expect(consumeCall.params.last_active).toBeDefined();

    // Verify profile session bump call
    const bumpCall = supabaseMock.calls.find(c => c.table === 'student_learning_profiles' && c.method === 'update' && c.params.last_session_at !== undefined);
    expect(bumpCall).toBeDefined();
    expect(bumpCall.filters).toContainEqual(expect.objectContaining({ type: 'eq', col: 'student_id', val: 'student-freeze-1' }));

    // Verify telemetry
    expect(posthogCaptureMock).toHaveBeenCalledWith('streak_freeze_applied', 'student-freeze-1', {
      freezes_remaining: 1,
      freezes_used_total: 2,
    });
  });

  it('resets streak to 0 for at-risk students who have no freezes available', async () => {
    const atRiskProfiles = [
      { student_id: 'student-no-freeze-1' }
    ];
    const studentData: any[] = []; // no freezes available

    supabaseMock.addResponse('student_learning_profiles', 'select', atRiskProfiles);
    supabaseMock.addResponse('students', 'select', studentData);
    // Bulk reset mock response: returns the student whose streak was reset
    supabaseMock.addResponse('student_learning_profiles', 'update', [{ student_id: 'student-no-freeze-1' }]);

    const resetCount = await resetMissedStreaksFn(supabaseMock.client, posthogCaptureMock);
    expect(resetCount).toBe(1);

    // Verify students table was NOT updated (since no freeze was available)
    const updateStudentCalls = supabaseMock.calls.filter(c => c.table === 'students' && c.method === 'update');
    expect(updateStudentCalls).toHaveLength(0);

    // Verify bulk update was called
    const bulkResetCall = supabaseMock.calls.find(c => c.table === 'student_learning_profiles' && c.method === 'update' && c.params.streak_days === 0);
    expect(bulkResetCall).toBeDefined();

    // Verify no telemetry was sent
    expect(posthogCaptureMock).not.toHaveBeenCalled();
  });

  it('handles a mix of students with and without freezes', async () => {
    const atRiskProfiles = [
      { student_id: 'student-with-freeze' },
      { student_id: 'student-without-freeze' }
    ];
    const studentData = [
      { id: 'student-with-freeze', freezes_available: 1, freezes_used_total: 0 }
      // student-without-freeze is missing (no freezes available)
    ];

    supabaseMock.addResponse('student_learning_profiles', 'select', atRiskProfiles);
    supabaseMock.addResponse('students', 'select', studentData);
    supabaseMock.addResponse('students', 'update', { success: true });
    supabaseMock.addResponse('student_learning_profiles', 'update', { success: true }); // bump for with-freeze
    // Bulk reset resets student-without-freeze
    supabaseMock.addResponse('student_learning_profiles', 'update', [{ student_id: 'student-without-freeze' }]);

    const resetCount = await resetMissedStreaksFn(supabaseMock.client, posthogCaptureMock);
    expect(resetCount).toBe(1); // 1 student got their streak reset

    // Verify telemetry only sent for the saved student
    expect(posthogCaptureMock).toHaveBeenCalledTimes(1);
    expect(posthogCaptureMock).toHaveBeenCalledWith('streak_freeze_applied', 'student-with-freeze', {
      freezes_remaining: 0,
      freezes_used_total: 1,
    });
  });
});
