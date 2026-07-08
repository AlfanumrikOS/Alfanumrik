/**
 * Tests for the custom ESLint rule `no-direct-ai-calls` (Task 3.18).
 *
 * Uses ESLint's built-in RuleTester to exercise valid and invalid code
 * against the rule. Because RuleTester runs ESLint's own parser, we have to
 * preprocess the rule to satisfy its `context.getFilename()` API for the
 * allowlist check.
 */

import { RuleTester } from 'eslint';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rule = require(path.resolve(process.cwd(), 'eslint-rules/no-direct-ai-calls.js'));

// ESLint v8 RuleTester constructor accepts `parserOptions` at top level;
// the v9 types (shipped with @types) are stricter — cast the options object
// to bypass the TS mismatch. Runtime behaviour matches ESLint v8 docs.
const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
} as ConstructorParameters<typeof RuleTester>[0]);

// RuleTester.run() calls describe()/it() internally, so it must be invoked at
// the module top level — not inside a describe/it itself.
ruleTester.run('no-direct-ai-calls', rule, {
      valid: [
        // 1. Import allowed inside the grounded-answer service
        {
          code: "import Anthropic from '@anthropic-ai/sdk';",
          filename: path.resolve(process.cwd(), 'supabase/functions/grounded-answer/claude.ts'),
        },
        // 2. Voyage URL allowed inside _shared/embeddings.ts
        {
          code: "const url = 'https://api.voyageai.com/v1/embeddings';",
          filename: path.resolve(process.cwd(), 'supabase/functions/_shared/embeddings.ts'),
        },
        // 3. Unrelated imports are not flagged
        {
          code: "import React from 'react';",
          filename: path.resolve(process.cwd(), 'src/app/page.tsx'),
        },
        // 4. Unrelated URLs are not flagged
        {
          code: "fetch('https://api.example.com/health');",
          filename: path.resolve(process.cwd(), 'src/app/page.tsx'),
        },
      ],
      invalid: [
        // 1. Anthropic SDK import in a disallowed file
        {
          code: "import Anthropic from '@anthropic-ai/sdk';",
          filename: path.resolve(process.cwd(), 'src/lib/ai/bad.ts'),
          errors: [{ messageId: 'forbiddenImport' }],
        },
        // 2. Voyage SDK import in a disallowed file
        {
          code: "import { embed } from 'voyageai';",
          filename: path.resolve(process.cwd(), 'src/app/foo/route.ts'),
          errors: [{ messageId: 'forbiddenImport' }],
        },
        // 3. Direct Claude URL in a disallowed file
        {
          code: "const url = 'https://api.anthropic.com/v1/messages';",
          filename: path.resolve(process.cwd(), 'src/lib/ai/direct.ts'),
          errors: [{ messageId: 'forbiddenUrl' }],
        },
        // 4. Direct Voyage URL in a disallowed file
        {
          code: "fetch('https://api.voyageai.com/v1/embeddings');",
          filename: path.resolve(process.cwd(), 'src/app/api/concept-engine/route.ts'),
          errors: [{ messageId: 'forbiddenUrl' }],
        },
        // 5. Template literal URL
        {
          code: 'fetch(`https://api.anthropic.com/v1/messages`);',
          filename: path.resolve(process.cwd(), 'src/lib/ai/retriever.ts'),
          errors: [{ messageId: 'forbiddenUrl' }],
        },
      ],
});
