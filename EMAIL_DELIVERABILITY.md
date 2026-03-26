# Email Deliverability Guide for alfanumrik.com

Production-grade setup using Mailgun to ensure all transactional emails land in inbox.

---

## Email Provider: Mailgun

- **Provider**: Mailgun (Sinch)
- **Domain**: alfanumrik.com
- **API**: REST API via Edge Functions (no SMTP)
- **Region**: US

## DNS Records (GoDaddy)

### SPF
| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | `@` | `v=spf1 include:mailgun.org include:secureserver.net ~all` | 3600 |

### DKIM
| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | `k1._domainkey` | *(from Mailgun Dashboard → Domains → DNS Records)* | 3600 |

### DMARC
| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | `_dmarc` | `v=DMARC1; p=none; pct=100; fo=1; ri=3600; rua=mailto:...@dmarc.mailgun.org` | 3600 |

### CNAME (Tracking)
| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `email` | `mailgun.org` | 3600 |

### MX (Mailgun bounce handling)
| Type | Name | Value | Priority | TTL |
|------|------|-------|----------|-----|
| MX | `@` | `mxa.mailgun.org` | 10 | 3600 |
| MX | `@` | `mxb.mailgun.org` | 10 | 3600 |

## Supabase Edge Function Secrets

| Secret Name | Value |
|-------------|-------|
| `MAILGUN_API_KEY` | Domain sending key from Mailgun |
| `MAILGUN_DOMAIN` | `alfanumrik.com` |
| `SEND_EMAIL_HOOK_SECRET` | From Supabase Auth Hook configuration |

## Email Addresses

| Purpose | Address |
|---------|---------|
| Auth emails (signup, reset) | `noreply@alfanumrik.com` |
| Welcome emails | `welcome@alfanumrik.com` |
| Reply-to | `support@alfanumrik.com` |
| Unsubscribe | `unsubscribe@alfanumrik.com` |

## Verification

1. Mailgun Dashboard → Domains → alfanumrik.com → all records green
2. Test signup → check inbox for "Verify your Alfanumrik account"
3. Gmail → Show Original → verify SPF PASS, DKIM PASS, DMARC PASS
