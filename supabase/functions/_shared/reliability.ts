export type ProviderName = 'openai' | 'anthropic' | 'gmail' | 'mailgun' | 'resend' | 'whatsapp' | 'google_vision' | 'ocr_space' | 'voyage' | 'posthog' | 'internal' | 'unknown'

export type ProviderErrorKind = 'timeout' | 'rate_limit' | 'server_error' | 'auth' | 'bad_request' | 'network' | 'unknown'

export interface ClassifiedProviderError {
  provider: ProviderName
  kind: ProviderErrorKind
  retryable: boolean
  status?: number
  message: string
}

export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface FetchWithTimeoutOptions extends RequestInit {
  provider?: ProviderName
  operation?: string
  timeoutMs?: number
  retry?: RetryPolicy
  idempotencyKey?: string
  idempotent?: boolean
  metricTags?: Record<string, string | number | boolean | null | undefined>
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_BASE_DELAY_MS = 150
const DEFAULT_MAX_DELAY_MS = 2_000

export class ProviderFetchError extends Error {
  readonly classification: ClassifiedProviderError
  readonly response?: Response

  constructor(classification: ClassifiedProviderError, response?: Response) {
    super(classification.message)
    this.name = 'ProviderFetchError'
    this.classification = classification
    this.response = response
  }
}

export function createEmailIdempotencyKey(args: { template: string; recipient: string; subject?: string; correlationId?: string }): string {
  return stableKey('email', args.template, normalizeRecipient(args.recipient), args.subject ?? '', args.correlationId ?? '')
}

export function createWhatsAppIdempotencyKey(args: { template: string; recipientPhone: string; language?: string; correlationId?: string }): string {
  return stableKey('whatsapp', args.template, normalizeRecipient(args.recipientPhone), args.language ?? '', args.correlationId ?? '')
}

export function createCronIdempotencyKey(args: { jobName: string; scheduledFor: string; shard?: string | number }): string {
  return stableKey('cron', args.jobName, args.scheduledFor, args.shard ?? '')
}

export function createQueueTaskIdempotencyKey(args: { queueName: string; taskId: string; attemptGroup?: string }): string {
  return stableKey('queue', args.queueName, args.taskId, args.attemptGroup ?? '')
}

export async function fetchWithTimeout(input: string | URL | Request, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const {
    provider = inferProvider(input),
    operation = 'fetch',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retry,
    idempotencyKey,
    idempotent = false,
    metricTags,
    fetcher = fetch,
    sleep = defaultSleep,
    ...init
  } = options
  const safeToRetry = Boolean(idempotencyKey || idempotent || isSafeMethod(init.method))
  const maxAttempts = safeToRetry ? Math.max(1, retry?.maxAttempts ?? 1) : 1
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now()
    const controller = new AbortController()
    const upstreamSignal = init.signal
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abortUpstream = () => controller.abort(upstreamSignal?.reason)
    if (upstreamSignal) upstreamSignal.addEventListener('abort', abortUpstream, { once: true })

    try {
      const headers = new Headers(init.headers)
      if (idempotencyKey && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', idempotencyKey)
      const response = await fetcher(input, { ...init, headers, signal: controller.signal })
      emitProviderMetric('provider_latency', { provider, operation, attempt, latency_ms: Date.now() - startedAt, status: response.status, ...metricTags })
      const classification = classifyProviderResponse(provider, response)
      if (!classification || !classification.retryable || attempt >= maxAttempts) {
        if (classification && !classification.retryable) emitProviderMetric('provider_failure', { provider, operation, attempt, kind: classification.kind, status: response.status, retryable: false, ...metricTags })
        if (classification?.retryable && attempt >= maxAttempts) emitProviderMetric('provider_retry_exhausted', { provider, operation, attempts: attempt, kind: classification.kind, status: response.status, ...metricTags })
        return response
      }
      emitProviderMetric('provider_retry', { provider, operation, attempt, kind: classification.kind, status: response.status, ...metricTags })
      await sleep(backoffDelay(attempt, retry))
    } catch (error) {
      lastError = error
      const timedOut = controller.signal.aborted && !(upstreamSignal?.aborted)
      const classification = classifyProviderError(provider, error, timedOut)
      emitProviderMetric(timedOut ? 'provider_timeout' : 'provider_failure', { provider, operation, attempt, kind: classification.kind, retryable: classification.retryable, ...metricTags })
      if (!classification.retryable || attempt >= maxAttempts) {
        if (classification.retryable && attempt >= maxAttempts) emitProviderMetric('provider_retry_exhausted', { provider, operation, attempts: attempt, kind: classification.kind, ...metricTags })
        throw new ProviderFetchError(classification)
      }
      emitProviderMetric('provider_retry', { provider, operation, attempt, kind: classification.kind, ...metricTags })
      await sleep(backoffDelay(attempt, retry))
    } finally {
      clearTimeout(timeout)
      if (upstreamSignal) upstreamSignal.removeEventListener('abort', abortUpstream)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export function classifyProviderResponse(provider: ProviderName, response: Response): ClassifiedProviderError | null {
  if (response.ok) return null
  const kind: ProviderErrorKind = response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'server_error' : response.status === 401 || response.status === 403 ? 'auth' : response.status >= 400 ? 'bad_request' : 'unknown'
  return { provider, kind, status: response.status, retryable: kind === 'rate_limit' || kind === 'server_error', message: `${provider} HTTP ${response.status}` }
}

export function classifyProviderError(provider: ProviderName, error: unknown, timedOut = false): ClassifiedProviderError {
  if (timedOut || (error instanceof DOMException && error.name === 'AbortError')) return { provider, kind: 'timeout', retryable: true, message: `${provider} request timed out` }
  return { provider, kind: 'network', retryable: true, message: error instanceof Error ? error.message : String(error) }
}

function inferProvider(input: string | URL | Request): ProviderName {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('mailgun.net')) return 'mailgun'
  // Gmail API relay (relay-mailer.ts). Covers both the Gmail send endpoint and
  // the Google OAuth2 token endpoint used to mint its access token.
  if (url.includes('gmail.googleapis.com') || url.includes('oauth2.googleapis.com')) return 'gmail'
  // Resend relay (relay-mailer.ts). Matches both api.resend.com and resend.com.
  if (url.includes('resend.com')) return 'resend'
  if (url.includes('graph.facebook.com')) return 'whatsapp'
  if (url.includes('vision.googleapis.com')) return 'google_vision'
  if (url.includes('ocr.space')) return 'ocr_space'
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('anthropic.com')) return 'anthropic'
  if (url.includes('voyageai.com')) return 'voyage'
  if (url.includes('posthog.com')) return 'posthog'
  return 'unknown'
}

function isSafeMethod(method?: string): boolean {
  return !method || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function backoffDelay(attempt: number, retry?: RetryPolicy): number {
  const base = retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const max = retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  return Math.min(max, base * 2 ** (attempt - 1))
}

function emitProviderMetric(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ metric: event, ts: new Date().toISOString(), ...fields }))
}

function stableKey(prefix: string, ...parts: Array<string | number>): string {
  return [prefix, ...parts.map((part) => encodeURIComponent(String(part).trim().toLowerCase()))].join(':')
}

function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
