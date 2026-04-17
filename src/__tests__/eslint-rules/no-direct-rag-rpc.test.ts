/**
 * Tests for the custom ESLint rule `no-direct-rag-rpc` (Task 3.19).
 *
 * Uses ESLint's built-in RuleTester. See no-direct-ai-calls.test.ts for the
 * same rationale regarding top-level invocation.
 */

import { RuleTester } from 'eslint';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rule = require(path.resolve(process.cwd(), 'eslint-rules/no-direct-rag-rpc.js'));

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
} as ConstructorParameters<typeof RuleTester>[0]);

ruleTester.run('no-direct-rag-rpc', rule, {
  valid: [
    // 1. Same RPC is allowed inside grounded-answer
    {
      code: "supabase.rpc('match_rag_chunks', { query: 'x' });",
      filename: path.resolve(process.cwd(), 'supabase/functions/grounded-answer/retrieval.ts'),
    },
    // 2. Same RPC is allowed inside _shared
    {
      code: "supabase.rpc('match_rag_chunks_ncert', {});",
      filename: path.resolve(process.cwd(), 'supabase/functions/_shared/retrieval.ts'),
    },
    // 3. Other RPC names are not flagged
    {
      code: "supabase.rpc('get_available_subjects', {});",
      filename: path.resolve(process.cwd(), 'src/lib/subjects.ts'),
    },
    // 4. Non-rpc method calls are not flagged
    {
      code: "supabase.from('foo').select('*');",
      filename: path.resolve(process.cwd(), 'src/lib/any.ts'),
    },
    // 5. Similar-looking method name on a different object still must be 'rpc'
    {
      code: "metrics.match_rag_chunks('something');",
      filename: path.resolve(process.cwd(), 'src/lib/any.ts'),
    },
  ],
  invalid: [
    // 1. match_rag_chunks in a Next API route
    {
      code: "supabaseAdmin.rpc('match_rag_chunks', { q: 'x' });",
      filename: path.resolve(process.cwd(), 'src/app/api/concept-engine/route.ts'),
      errors: [{ messageId: 'forbidden' }],
    },
    // 2. match_rag_chunks_ncert in lib/
    {
      code: "supabaseAdmin.rpc('match_rag_chunks_ncert', {});",
      filename: path.resolve(process.cwd(), 'src/lib/ai/retrieval/ncert-retriever.ts'),
      errors: [{ messageId: 'forbidden' }],
    },
    // 3. Legacy Edge Function outside grounded-answer
    {
      code: "client.rpc('match_rag_chunks', {});",
      filename: path.resolve(process.cwd(), 'supabase/functions/foxy-tutor/index.ts'),
      errors: [{ messageId: 'forbidden' }],
    },
    // 4. Template literal RPC name still caught
    {
      code: 'supabase.rpc(`match_rag_chunks_ncert`, {});',
      filename: path.resolve(process.cwd(), 'src/lib/x.ts'),
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
