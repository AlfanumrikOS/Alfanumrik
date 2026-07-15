export type AuthEmailActionType = 'signup' | 'recovery' | 'magic_link' | 'email_change_new' | 'email_change_current' | string

export function buildAuthActionUrl(params: {
  baseSiteUrl: string
  emailActionType: AuthEmailActionType
  token?: string
  tokenHash?: string
  redirectTo?: string
  email?: string
}): string {
  const { baseSiteUrl, emailActionType, token, tokenHash, redirectTo, email } = params

  const appendNext = (url: string): string => {
    if (!redirectTo) return url

    let nextPath = redirectTo
    try {
      const parsed = new URL(redirectTo)
      nextPath = parsed.pathname + parsed.search
    } catch {
      // Already a relative path — use as-is.
    }

    const joiner = url.includes('?') ? '&' : '?'
    return `${url}${joiner}next=${encodeURIComponent(nextPath)}`
  }

  if (tokenHash) {
    return appendNext(`${baseSiteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(emailActionType)}`)
  }

  if (token) {
    const query = new URLSearchParams({
      token,
      type: emailActionType,
    })
    if (email) query.set('email', email)
    return appendNext(`${baseSiteUrl}/auth/confirm?${query.toString()}`)
  }

  return `${baseSiteUrl}/dashboard`
}

/**
 * Derive a per-auth-token dimension used ONLY as an idempotency-key input
 * (never rendered, never a URL). Preference order: `tokenHash` → `token`.
 * For email-change flows the "new" token (`tokenHashNew` → `tokenNew`) is
 * folded in so that a re-issued change confirmation gets a distinct key.
 *
 * Rationale (P15): under Resend the Idempotency-Key is honoured for 24h. If the
 * key ignored the token, a legitimately re-requested confirmation/reset within
 * that window would be silently deduped and never delivered. Keying on the token
 * means: same token twice → same key (genuine retries dedupe); distinct tokens
 * → distinct keys (re-requested links actually send). Returns '' when no token
 * material is present (caller falls back to template+recipient+subject).
 */
export function authEmailTokenDimension(params: {
  token?: string
  tokenHash?: string
  tokenNew?: string
  tokenHashNew?: string
}): string {
  const { token, tokenHash, tokenNew, tokenHashNew } = params
  const primary = tokenHash || token || ''
  const secondary = tokenHashNew || tokenNew || ''
  return secondary ? `${primary}:${secondary}` : primary
}
