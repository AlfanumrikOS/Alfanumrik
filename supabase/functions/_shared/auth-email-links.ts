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
