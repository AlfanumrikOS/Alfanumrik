import { redactPII, redactPIIInText } from './redact-pii.ts'

export type EdgeLogStatus = 'ok' | 'error' | 'warn' | 'denied'
export type EdgeLogRole = 'anonymous' | 'authenticated' | 'service_role' | 'system' | 'unknown' | string

export interface EdgeLogShape {
  request_id: string
  route: string
  actor: string | null
  role: EdgeLogRole
  school_id: string | null
  action: string
  status: EdgeLogStatus
  latency_ms: number
}

export interface EdgeLogContext {
  requestId: string
  route: string
  actor?: string | null
  role?: EdgeLogRole | null
  schoolId?: string | null
  startedAt?: number
}

export const REDACTED_NAME = '[REDACTED_NAME]'
export const REDACTED_PROMPT = '[REDACTED_PROMPT]'
export const REDACTED_STUDENT_CONTENT = '[REDACTED_STUDENT_CONTENT]'

const NAME_KEYS = new Set(['name', 'full_name', 'first_name', 'last_name', 'student_name', 'parent_name', 'teacher_name'])
const PROMPT_KEYS = new Set(['prompt', 'prompts', 'question', 'answer', 'messages', 'input', 'output'])
const STUDENT_CONTENT_KEYS = new Set(['student_content', 'student_answer', 'submission', 'essay', 'ocr_text', 'transcript'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id') || crypto.randomUUID()
}

export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!local || !domain) return '[REDACTED_EMAIL]'
  return `${local.slice(0, 2)}***@${domain}`
}

export function redactPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  return phone.length >= 8 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '[REDACTED_PHONE]'
}

export function redactName(name: string | null | undefined): string | null {
  return name ? REDACTED_NAME : null
}

export function redactPrompt(prompt: string | null | undefined): string | null {
  return prompt ? REDACTED_PROMPT : null
}

export function redactStudentContent(content: string | null | undefined): string | null {
  return content ? REDACTED_STUDENT_CONTENT : null
}

export function redactForEdgeLog(value: unknown): unknown {
  function walk(v: unknown, key?: string): unknown {
    const normalizedKey = key?.toLowerCase()
    if (typeof v === 'string') {
      if (normalizedKey && NAME_KEYS.has(normalizedKey)) return redactName(v)
      if (normalizedKey && PROMPT_KEYS.has(normalizedKey)) return redactPrompt(v)
      if (normalizedKey && STUDENT_CONTENT_KEYS.has(normalizedKey)) return redactStudentContent(v)
      return redactPIIInText(v).text
    }
    if (Array.isArray(v)) return v.map((item) => walk(item, key))
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {}
      for (const [childKey, childValue] of Object.entries(v)) out[childKey] = walk(childValue, childKey)
      return redactPII(out)
    }
    return v
  }
  return walk(value)
}

export function edgeLog(
  level: 'info' | 'warn' | 'error',
  context: EdgeLogContext,
  fields: Pick<EdgeLogShape, 'action' | 'status'> & Record<string, unknown>,
): void {
  const { action, status, ...extra } = fields
  const payload: EdgeLogShape & Record<string, unknown> = {
    request_id: context.requestId,
    route: context.route,
    actor: context.actor ?? null,
    role: context.role ?? 'unknown',
    school_id: context.schoolId ?? null,
    action,
    status,
    latency_ms: Math.max(0, Date.now() - (context.startedAt ?? Date.now())),
    ...redactForEdgeLog(extra) as Record<string, unknown>,
  }
  console[level](JSON.stringify(payload))
}

export async function writeBusinessAudit(args: {
  supabase: { from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }> } }
  context: EdgeLogContext
  action: string
  status: EdgeLogStatus
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await args.supabase.from('audit_logs').insert({
    actor_auth_user_id: args.context.actor ?? null,
    school_id: args.context.schoolId ?? null,
    action: args.action,
    entity_type: args.context.route,
    entity_id: args.context.requestId,
    metadata: redactForEdgeLog({
      request_id: args.context.requestId,
      role: args.context.role ?? 'unknown',
      status: args.status,
      latency_ms: Math.max(0, Date.now() - (args.context.startedAt ?? Date.now())),
      ...args.metadata,
    }),
  })
  if (error) edgeLog('error', args.context, { action: 'audit.write_failed', status: 'error', reason: error.message })
}
