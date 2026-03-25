# Email Deliverability Guide for alfanumrik.com

Production-grade setup to ensure all transactional emails land in inbox (Gmail, Outlook, Yahoo).

---

## 1. DNS Records (CRITICAL — do this first)

Add these records at your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.) for `alfanumrik.com`:

### SPF Record
Authorizes Resend's servers to send email on behalf of alfanumrik.com.

| Type | Host/Name | Value | TTL |
|------|-----------|-------|-----|
| TXT | `@` | `v=spf1 include:resend.dev include:secureserver.net ~all` | 3600 |

> **IMPORTANT:** Only ONE SPF TXT record allowed per domain — multiple SPF records will FAIL validation.
> The `include:secureserver.net` authorizes GoDaddy's mail servers (MX). The `include:resend.dev` authorizes Resend.
> If you switch mail providers, merge their SPF include into this single record.

### DKIM Records
Resend provides 3 CNAME records when you add your domain. They look like this:

| Type | Host/Name | Value | TTL |
|------|-----------|-------|-----|
| CNAME | `resend._domainkey` | `resend._domainkey.alfanumrik.com.xxxxx.dkim.resend.dev` | 3600 |
| CNAME | `resend2._domainkey` | *(provided by Resend)* | 3600 |
| CNAME | `resend3._domainkey` | *(provided by Resend)* | 3600 |

> Get the exact values from: Resend Dashboard → Domains → alfanumrik.com → DNS Records

### DMARC Record
Tells email providers how to handle messages that fail SPF/DKIM checks.

| Type | Host/Name | Value | TTL |
|------|-----------|-------|-----|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@alfanumrik.com; ruf=mailto:dmarc@alfanumrik.com; pct=100; adkim=s; aspf=s` | 3600 |

**DMARC Policy Progression (warm-up strategy):**
1. **Week 1-2:** `p=none` (monitor only, collect reports)
2. **Week 3-4:** `p=quarantine; pct=25` (quarantine 25% of failures)
3. **Week 5-6:** `p=quarantine; pct=100` (quarantine all failures)
4. **Week 7+:** `p=reject` (reject all failures — full protection)

### MX Record (if not already set)
Required if you want to receive email at alfanumrik.com (for support@, dmarc@, etc.):

| Type | Host/Name | Priority | Value | TTL |
|------|-----------|----------|-------|-----|
| MX | `@` | 10 | *(your email provider, e.g., Google Workspace)* | 3600 |

### Return-Path / Bounce Domain (optional, recommended)
Set in Resend Dashboard → Domains → alfanumrik.com → Custom Return-Path:

| Type | Host/Name | Value | TTL |
|------|-----------|-------|-----|
| CNAME | `bounce` | `feedback-smtp.us-east-1.amazonses.com` | 3600 |

This aligns the Return-Path with your domain for better SPF alignment.

---

## 2. Resend Dashboard Setup

### Step 1: Add Domain
1. Go to https://resend.com/domains
2. Click "Add Domain" → enter `alfanumrik.com`
3. Copy the DNS records shown and add them (see section 1 above)
4. Click "Verify" — takes 5-60 minutes

### Step 2: API Key
1. Go to https://resend.com/api-keys
2. Create key with "Sending access" for domain `alfanumrik.com` only
3. Set in Supabase: Edge Functions → Secrets → `RESEND_API_KEY`

### Step 3: Verify Sender Addresses
Both addresses must work (Resend auto-verifies after domain verification):
- `noreply@alfanumrik.com` — auth emails
- `welcome@alfanumrik.com` — welcome emails
- `support@alfanumrik.com` — Reply-To address (must receive mail)

---

## 3. Domain Warm-Up Strategy

New domains start with zero reputation. Sending too many emails too fast = instant spam.

### Week 1: Soft Launch (0-50 emails/day)
- Only send to your own test accounts (Gmail, Outlook, Yahoo)
- Verify emails land in inbox, not spam
- Fix any DNS issues found

### Week 2: Gradual Ramp (50-200 emails/day)
- Enable for real signups
- Monitor bounce rate (must stay < 2%)
- Monitor spam complaint rate (must stay < 0.1%)

### Week 3: Normal Volume (200-1000 emails/day)
- Full production traffic
- Set up Resend webhooks for bounce/complaint monitoring

### Week 4+: Scale
- Domain reputation is established
- Monitor via Google Postmaster Tools

### Monitoring Tools
1. **Google Postmaster Tools** — https://postmaster.google.com
   - Add alfanumrik.com, verify via DNS TXT record
   - Monitor: spam rate, domain reputation, authentication success
2. **Resend Dashboard** — https://resend.com/emails
   - Monitor: delivery rate, bounces, complaints
3. **MXToolbox** — https://mxtoolbox.com/emailhealth
   - Check DNS records, blacklists, email health

---

## 4. Verification Checklist

Run these checks after DNS setup:

### DNS Verification
```bash
# Check SPF record
dig TXT alfanumrik.com +short
# Should include: "v=spf1 include:resend.dev include:secureserver.net ~all"

# Check DKIM
dig CNAME resend._domainkey.alfanumrik.com +short
# Should return a resend.dev CNAME

# Check DMARC
dig TXT _dmarc.alfanumrik.com +short
# Should return: "v=DMARC1; p=quarantine; ..."
```

### Email Test
1. Send a test email to https://www.mail-tester.com (gives 1-10 score)
   - Target: 9/10 or higher
2. Send test to personal Gmail → check headers:
   - Click "Show Original" in Gmail
   - Verify: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`
3. Send test to Outlook/Hotmail → verify inbox delivery
4. Check https://www.learndmarc.com for visual DMARC analysis

### Resend Dashboard Checks
- Domain status: "Verified" (green)
- DKIM status: "Verified"
- SPF status: "Verified"
- No bounces or complaints in last 24h

---

## 5. Supabase Configuration

### Edge Function Secrets (required)
Set in: Supabase Dashboard → Edge Functions → Secrets

| Secret | Value | Notes |
|--------|-------|-------|
| `RESEND_API_KEY` | `re_xxxxxxxxx` | From Resend dashboard |
| `SEND_EMAIL_HOOK_SECRET` | `whsec_xxxxxxxxx` | From Supabase Auth Hooks |

### Auth Hook Setup
1. Supabase Dashboard → Authentication → Hooks
2. Enable "Send Email" hook → HTTPS
3. URL: `https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/send-auth-email`
4. Copy the generated secret → set as `SEND_EMAIL_HOOK_SECRET`

### Email Rate Limits (Supabase Auth)
Supabase Dashboard → Authentication → Rate Limits:
- Email signups: 5 per hour per IP (prevents abuse)
- Password recovery: 5 per hour per email
- Email OTP: 5 per hour per email

---

## 6. What We Fixed (Code Changes)

### Problem → Fix mapping:

| Problem | Fix | File |
|---------|-----|------|
| HTML-only emails (no text/plain) | Added plain-text version to all emails | `send-auth-email/index.ts`, `send-welcome-email/index.ts` |
| Fallback to `onboarding@resend.dev` | Removed entirely — custom domain only | Both edge functions |
| No Reply-To header | Added `reply_to: support@alfanumrik.com` | Both edge functions |
| No List-Unsubscribe | Added for welcome emails (Gmail 2024 requirement) | `send-welcome-email/index.ts` |
| No email tags | Added category/type tags for Resend analytics | Both edge functions |
| Wrong SPF record (`amazonses.com`) | Corrected to `include:resend.dev` | This guide |
| Weak DMARC (`p=none`) | Upgraded to `p=quarantine` with reporting | This guide |

---

## 7. Troubleshooting

### "Emails still going to spam"
1. Check DNS propagation: https://dnschecker.org
2. Check if domain is blacklisted: https://mxtoolbox.com/blacklists.aspx
3. Verify Resend domain status is "Verified"
4. Check email content at https://www.mail-tester.com
5. Look at Gmail headers — which check is failing? (SPF/DKIM/DMARC)

### "Emails not sending at all"
1. Check Supabase Edge Function logs: Dashboard → Edge Functions → Logs
2. Look for `[Auth Email]` or `[Welcome Email]` log entries
3. Verify `RESEND_API_KEY` is set correctly
4. Verify Auth Hook is enabled and URL is correct

### "Resend returns 403 / domain not verified"
1. DNS records may not have propagated (wait up to 72 hours)
2. Check Resend Dashboard → Domains → DNS status
3. Ensure API key has sending access for alfanumrik.com

### "High bounce rate"
1. Implement email verification on signup form (regex + MX check)
2. Remove hard bounces from any mailing lists
3. Never send to purchased/scraped email lists

---

## 8. Gmail & Outlook Specific Tips

### Gmail Requirements (2024+)
- SPF + DKIM + DMARC must all pass
- List-Unsubscribe header required for bulk senders (>5000/day)
- Spam complaint rate must be < 0.1%
- One-click unsubscribe support for marketing emails

### Outlook/Hotmail
- Register at https://sendersupport.olc.protection.outlook.com/snds/
- Submit form at https://sender.office.com/ if blocked
- Ensure reverse DNS (PTR record) matches sending domain

### Yahoo
- Follow same SPF/DKIM/DMARC as Gmail
- Monitor via https://senders.yahooinc.com/

---

## 9. Security: JWT Email Links

Current implementation is secure:
- Token hash in URL (not raw JWT) — prevents token leakage in server logs
- 24-hour expiry for signup confirmations
- 1-hour expiry for password resets
- Single-use tokens (Supabase enforces)
- PKCE flow for code exchange
- Rate limiting on auth endpoints (5/min for parent login, 60/min general)

Additional hardening already in place:
- HTTPS-only (HSTS with preload)
- CSP headers prevent link injection
- No token in URL query params for GET requests (uses POST redirect)
