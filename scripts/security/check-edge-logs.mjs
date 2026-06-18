import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const files = globSync('supabase/functions/*/index.ts', { nodir: true })
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
  const text = readFileSync(file, 'utf8')
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
