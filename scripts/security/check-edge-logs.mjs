import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchor the scan to the REPO ROOT, never to process.cwd().
// This file lives at <root>/scripts/security/check-edge-logs.mjs, so the repo
// root is two directories up. npm runs a script with cwd = the directory of the
// package.json that declares it (apps/host for `check:edge-logs`), and a
// cwd-relative glob there matches nothing — which used to make this P13 guard
// report a green "0 files scanned" pass. Absolute anchoring makes the result
// identical from every cwd.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EDGE_FUNCTION_GLOB = 'supabase/functions/*/index.ts'

// Paths stay repo-relative (cwd option) so violation messages remain readable
// and stable across machines; readFileSync below re-joins against REPO_ROOT.
const files = globSync(EDGE_FUNCTION_GLOB, { cwd: REPO_ROOT, nodir: true })

// FAIL-LOUD FLOOR: a PII guard that inspects zero files has FAILED TO RUN.
// It has not passed. Never let an empty match set exit 0 — that is a silent
// false-green on a P13 (data privacy) gate, which is strictly worse than a
// crash. Any future refactor that breaks path resolution dies here, loudly.
if (files.length === 0) {
  console.error(
    'Edge log PII guard FAILED TO RUN: matched 0 files.\n' +
      `  glob:      ${EDGE_FUNCTION_GLOB}\n` +
      `  repo root: ${REPO_ROOT}\n` +
      `  cwd:       ${process.cwd()}\n` +
      'Expected at least one Supabase Edge Function index.ts. A P13 privacy ' +
      'guard that scans nothing has not passed — it has not run. Fix the path ' +
      'resolution (or the repo layout assumption above) before shipping.'
  )
  process.exit(1)
}
const piiIdentifiers = [
  'email', 'recipient_email', 'phone', 'recipient_phone', 'parent_phone',
  'full_name', 'first_name', 'last_name', 'student_name', 'prompt',
  'student_content', 'student_answer', 'submission', 'ocr_text', 'transcript',
]
const rawPayloadIdentifiers = ['payload', 'body', 'validated', 'params']
const violations = []

function hasIdentifier(line, identifier) {
  return new RegExp(`(\\$\\{\\s*${identifier}(?![A-Za-z0-9_])|[,:(]\\s*${identifier}(?![A-Za-z0-9_]))`, 'i').test(line)
}

for (const file of files) {
  const text = readFileSync(join(REPO_ROOT, file), 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!/console\.(log|info|warn|error)\(/.test(line) || line.includes('PII_LOG_ALLOW')) return
    const loggedPii = piiIdentifiers.filter((id) => hasIdentifier(line, id))
    const rawPayload = /JSON\.stringify\(/.test(line) ? rawPayloadIdentifiers.filter((id) => hasIdentifier(line, id)) : []
    if (loggedPii.length || rawPayload.length) {
      violations.push(`${file}:${index + 1}: unsafe=${[...loggedPii, ...rawPayload].join(',')} :: ${line.trim()}`)
    }
  })
}
if (violations.length) {
  console.error('Unsafe Edge Function logging detected:\n' + violations.join('\n'))
  process.exit(1)
}
console.log(`Edge log PII guard passed (${files.length} index.ts files scanned).`)
