import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadWorkflowCognitiveContext } from '@/lib/ai/workflows/context-loader';
import { runExplainWorkflow } from '@/lib/ai/workflows/explain';
import { runDoubtWorkflow } from '@/lib/ai/workflows/doubt-solve';
import { runRevisionWorkflow } from '@/lib/ai/workflows/revision';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Mock retrieval
vi.mock('@/lib/ai/retrieval/ncert-retriever', () => ({
  retrieveNcertChunks: vi.fn().mockResolvedValue({
    chunks: [],
    contextText: 'NCERT CHUNKS TEXT',
    error: null,
  }),
}));

// Mock Claude
const mockCallClaude = vi.fn();
vi.mock('@/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}));

// Mock Trace Logger
vi.mock('@/lib/ai/tracing/trace-logger', () => {
  class TraceLogger {
    constructor() {}
    startStep() {}
    endStep() {}
    finish() {
      return { traceId: 'trace-id-123' };
    }
  }
  return {
    TraceLogger,
    logTrace: vi.fn(),
  };
});

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCallClaude.mockResolvedValue({
    content: 'CLAUDE_RESPONSE',
    model: 'claude-haiku-test',
    tokensUsed: 100,
    latencyMs: 15,
  });
});

// Helper for Supabase mock setup
function setupSupabaseMock(args: {
  subjectId?: string;
  chapterId?: string;
  loSkills?: any[];
  quizResponses?: any[];
  remediationText?: string;
}) {
  mockFrom.mockImplementation((table: string) => {
    return {
      select: vi.fn().mockImplementation((selectString: string) => {
        return {
          ilike: vi.fn().mockImplementation((col: string, val: string) => {
            return {
              maybeSingle: vi.fn().mockResolvedValue({
                data: args.subjectId ? { id: args.subjectId } : null,
              }),
            };
          }),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            if (table === 'chapters') {
              return {
                limit: vi.fn().mockImplementation(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: args.chapterId ? { id: args.chapterId } : null,
                  }),
                })),
              };
            }
            if (table === 'student_skill_state') {
              return {
                order: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => {
                    return {
                      eq: vi.fn().mockImplementation((joinedCol: string, joinedVal: any) => {
                        return Promise.resolve({ data: args.loSkills ?? [] });
                      }),
                    };
                  }),
                })),
              };
            }
            if (table === 'quiz_responses') {
              return {
                eq: vi.fn().mockImplementation((c: string, v: any) => ({
                  gte: vi.fn().mockImplementation((c2: string, v2: any) => ({
                    limit: vi.fn().mockResolvedValue({ data: args.quizResponses ?? [] }),
                  })),
                })),
              };
            }
            return {
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            };
          }),
          in: vi.fn().mockImplementation((col: string, vals: any[]) => {
            return {
              limit: vi.fn().mockResolvedValue({
                data: args.remediationText ? [{ remediation_text: args.remediationText }] : [],
              }),
            };
          }),
        };
      }),
    };
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Workflow Cognitive Context Integration', () => {
  it('returns empty context when studentId is missing', async () => {
    const ctx = await loadWorkflowCognitiveContext(undefined, 'mathematics', '8');
    expect(ctx.loSkills).toEqual([]);
    expect(ctx.misconceptions).toEqual([]);
  });

  it('correctly fetches and processes BKT and misconceptions', async () => {
    setupSupabaseMock({
      subjectId: 'subj-123',
      chapterId: 'chap-456',
      loSkills: [
        {
          p_know: 0.35,
          p_slip: 0.1,
          theta: -0.5,
          learning_objectives: {
            code: 'LO-1',
            statement: 'Understand fractions',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
        {
          p_know: 0.65,
          p_slip: 0.1,
          theta: 0.1,
          learning_objectives: {
            code: 'LO-2',
            statement: 'Add fractions',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
        {
          p_know: 0.85,
          p_slip: 0.05,
          theta: 1.2,
          learning_objectives: {
            code: 'LO-3',
            statement: 'Multiply fractions',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
      ],
      quizResponses: [
        {
          question_id: 'q-99',
          selected_option: 2,
          is_correct: false,
          question_misconceptions: {
            misconception_code: 'MC-ERR',
            misconception_label: 'Added denominators directly',
            distractor_index: 2,
            remediation_chunk_id: 'rem-chunk-1',
          },
        },
        {
          question_id: 'q-99',
          selected_option: 2,
          is_correct: false,
          question_misconceptions: {
            misconception_code: 'MC-ERR',
            misconception_label: 'Added denominators directly',
            distractor_index: 2,
            remediation_chunk_id: 'rem-chunk-1',
          },
        },
      ],
      remediationText: 'Remediate by finding common denominator first.',
    });

    const ctx = await loadWorkflowCognitiveContext('student-uuid', 'mathematics', '8', '1');

    // Verify BKT LOs
    expect(ctx.loSkills.length).toBe(3);
    expect(ctx.loSkills[0]).toEqual({
      loCode: 'LO-1',
      loStatement: 'Understand fractions',
      pKnow: 0.35,
      pSlip: 0.1,
      theta: -0.5,
    });

    // Verify Misconceptions
    expect(ctx.misconceptions.length).toBe(1);
    expect(ctx.misconceptions[0]).toEqual({
      code: 'MC-ERR',
      label: 'Added denominators directly',
      count: 2,
      remediationText: 'Remediate by finding common denominator first.',
    });
  });

  it('injects BKT skills and misconceptions into explain system prompt', async () => {
    setupSupabaseMock({
      subjectId: 'subj-123',
      chapterId: 'chap-456',
      loSkills: [
        {
          p_know: 0.42,
          p_slip: 0.1,
          theta: -0.2,
          learning_objectives: {
            code: 'LO-42',
            statement: 'Test statement 42',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
      ],
      quizResponses: [
        {
          question_id: 'q-mc',
          selected_option: 1,
          is_correct: false,
          question_misconceptions: {
            misconception_code: 'MC-TEST',
            misconception_label: 'Some test misconception',
            distractor_index: 1,
            remediation_chunk_id: 'rem-1',
          },
        },
        {
          question_id: 'q-mc',
          selected_option: 1,
          is_correct: false,
          question_misconceptions: {
            misconception_code: 'MC-TEST',
            misconception_label: 'Some test misconception',
            distractor_index: 1,
            remediation_chunk_id: 'rem-1',
          },
        },
      ],
      remediationText: 'Remediate this test mistake.',
    });

    await runExplainWorkflow('Please explain gravity.', {
      subject: 'physics',
      grade: '9',
      board: 'CBSE',
      chapter: '1',
      mode: 'explain',
      history: [],
      studentId: 'student-uuid',
    });

    expect(mockCallClaude).toHaveBeenCalled();
    const systemPromptArgs = mockCallClaude.mock.calls[0][0].systemPrompt;

    expect(systemPromptArgs).toContain('## Learning Objective Mastery');
    expect(systemPromptArgs).toContain('[LO-42] Test statement 42 is weak (mastery 42%)');
    expect(systemPromptArgs).toContain('## Known Misconceptions');
    expect(systemPromptArgs).toContain('[MC-TEST] Some test misconception (seen 2x in last 30 days)');
    expect(systemPromptArgs).toContain('fix: Remediate this test mistake.');
  });

  it('injects BKT skills and misconceptions into doubt-solve system prompt', async () => {
    setupSupabaseMock({
      subjectId: 'subj-123',
      chapterId: 'chap-456',
      loSkills: [
        {
          p_know: 0.65,
          p_slip: 0.1,
          theta: 0.1,
          learning_objectives: {
            code: 'LO-DOUBT',
            statement: 'Test doubt statement',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
      ],
    });

    await runDoubtWorkflow('I have a doubt about fractions.', {
      subject: 'mathematics',
      grade: '8',
      board: 'CBSE',
      chapter: '1',
      mode: 'doubt',
      history: [],
      studentId: 'student-uuid',
    });

    expect(mockCallClaude).toHaveBeenCalled();
    const systemPromptArgs = mockCallClaude.mock.calls[0][0].systemPrompt;

    expect(systemPromptArgs).toContain('## Learning Objective Mastery');
    expect(systemPromptArgs).toContain('[LO-DOUBT] Test doubt statement is partial (mastery 65%)');
  });

  it('injects BKT skills and misconceptions into revision system prompt', async () => {
    setupSupabaseMock({
      subjectId: 'subj-123',
      chapterId: 'chap-456',
      loSkills: [
        {
          p_know: 0.85,
          p_slip: 0.05,
          theta: 1.0,
          learning_objectives: {
            code: 'LO-REV',
            statement: 'Test revision statement',
            chapter_id: 'chap-456',
            chapters: { subject_id: 'subj-123' },
          },
        },
      ],
    });

    await runRevisionWorkflow('Let us revise cell biology.', {
      subject: 'biology',
      grade: '8',
      board: 'CBSE',
      chapter: '1',
      mode: 'revision',
      history: [],
      studentId: 'student-uuid',
    });

    expect(mockCallClaude).toHaveBeenCalled();
    const systemPromptArgs = mockCallClaude.mock.calls[0][0].systemPrompt;

    expect(systemPromptArgs).toContain('## Learning Objective Mastery');
    expect(systemPromptArgs).toContain('[LO-REV] Test revision statement is strong (mastery 85%)');
  });
});
