# Email Delivery Contract

Last updated: 2026-04-02

## Overview

Alfanumrik uses Supabase Auth with a custom email delivery pipeline. Supabase Auth triggers a webhook to our `send-auth-email` Edge Function, which formats and sends emails via Mailgun. This document defines the contract for all auth-related email delivery.

## Email Types

| Email Type | Trigger | Contains | User Action Required |
|---|---|---|---|
| Signup confirmation | User registers with email/password | Confirmation link with token | Click link to verify email |
| Password recovery | User clicks "Forgot Password" | Password reset link with token | Click link, set new password |
| Magic link | User requests passwordless login | One-time login link | Click link to authenticate |
| Email change | User updates email in settings | Confirmation link to new email | Click link to confirm new email |

All emails include the Alfanumrik branding and are formatted as HTML with plain-text fallback.

## Delivery Pipeline

```
User action (signup, password reset, etc.)
    |
    v
Supabase Auth (generates token, constructs payload)
    |
    v
Webhook POST to send-auth-email Edge Function
    |
    v
Edge Function:
  1. Verifies webhook signature (standardwebhooks)
  2. Extracts email type, recipient, token/link
  3. Renders HTML template
  4. Calls Mailgun API to send
    |
    v
Mailgun:
  1. Accepts message via API
  2. Performs DKIM signing
  3. Delivers to recipient MX server
    |
    v
Recipient inbox (or spam folder if DNS misconfigured)
```

### Key Details

- **Webhook signature**: Verified using the `standardwebhooks` library with `SEND_EMAIL_HOOK_SECRET`.
- **SITE_URL**: Currently hardcoded as `https://alfanumrik.com` in the Edge Function. All confirmation/reset links point to this domain regardless of which deployment triggered the email. This is tracked as active risk R13.
- **Template ownership**: HTML email templates are defined inline in `supabase/functions/send-auth-email/index.ts`. There is no external template system.

## Configuration Requirements

### Mailgun

| Config | Location | Purpose |
|---|---|---|
| `MAILGUN_API_KEY` | Supabase Edge Function secrets | Authenticates API calls to Mailgun |
| `MAILGUN_DOMAIN` | Supabase Edge Function secrets | Sending domain (e.g., `mail.alfanumrik.com`) |

### DNS Records

All DNS records must be configured on the Mailgun sending domain.

| Record Type | Name | Purpose | Impact if Missing |
|---|---|---|---|
| TXT (SPF) | `@` or sending subdomain | Authorizes Mailgun IPs to send on behalf of domain | Emails rejected or marked as spam |
| TXT (DKIM) | Per Mailgun setup instructions | Cryptographic signature proving email authenticity | Emails marked as spam |
| TXT (DMARC) | `_dmarc` | Policy for handling SPF/DKIM failures | No enforcement; reduced trust score |
| MX | Sending subdomain (if using for receiving) | Required if Mailgun needs to receive bounces on subdomain | Bounce tracking may not work |

### Supabase Dashboard

| Setting | Value | Purpose |
|---|---|---|
| Auth Hook: Send Email | Enabled, pointing to `send-auth-email` function | Routes all auth emails through our function |
| Hook Secret | Matches `SEND_EMAIL_HOOK_SECRET` in Edge Function | Webhook signature verification |

## Failure Modes and Mitigations

### 1. Mailgun API Down or Unreachable

- **Behavior**: Edge Function catches the error, logs a warning, and returns HTTP 200 to Supabase Auth.
- **Impact**: Auth flow proceeds (user gets success message) but email never arrives. User cannot complete confirmation or reset.
- **Mitigation**: User retries the action (resend confirmation, re-request password reset). Monitor Mailgun status at `status.mailgun.com`.
- **Detection**: Edge Function logs show Mailgun API errors. No delivery events in Mailgun dashboard.

### 2. Invalid Webhook Secret

- **Behavior**: Edge Function rejects the request with HTTP 401. Supabase Auth receives the error.
- **Impact**: No auth emails are sent. All signup confirmations and password resets fail silently from the user's perspective.
- **Mitigation**: Verify `SEND_EMAIL_HOOK_SECRET` matches between Supabase Auth dashboard and Edge Function secrets. Redeploy Edge Function after secret rotation.
- **Detection**: Edge Function logs show 401 responses. Users report not receiving any auth emails.

### 3. Missing Mailgun Configuration

- **Behavior**: Edge Function logs a warning about missing config and returns HTTP 200.
- **Impact**: Same as Mailgun down -- auth flow succeeds but no email delivered.
- **Mitigation**: Ensure `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` are set in Supabase Edge Function secrets.
- **Detection**: Edge Function logs show config warnings.

### 4. DNS Misconfigured

- **Behavior**: Emails are sent by Mailgun but land in recipient's spam folder or are rejected by the receiving mail server.
- **Impact**: Users report not receiving emails. Checking spam folder may reveal the emails.
- **Mitigation**: Verify all DNS records (SPF, DKIM, DMARC) in Mailgun dashboard. Mailgun provides a verification tool for domain status.
- **Detection**: Mailgun dashboard shows high bounce/complaint rates. Mailgun domain verification shows warnings.

### 5. SITE_URL Hardcoded (Risk R13)

- **Behavior**: All email links (confirmation, reset) point to `https://alfanumrik.com` regardless of which deployment (preview, staging) triggered the auth action.
- **Impact**: Users testing on preview deployments are redirected to production when clicking email links. This can cause confusion and auth state mismatches during development.
- **Mitigation**: Developers must be aware of this limitation when testing auth flows on non-production deployments.
- **Detection**: Preview deploy testing reveals production URLs in emails.

## Monitoring

### Mailgun Dashboard
- Delivery rate, bounce rate, complaint rate
- Per-message delivery status and logs
- Domain verification status

### Edge Function Logs
- Available in Supabase dashboard under Edge Functions > send-auth-email > Logs
- Log entries for: webhook received, signature verified/rejected, email sent/failed, config warnings

### auth_audit_log Table
- Records auth events (signup, login, password reset request) with timestamps
- Does not record email delivery status (only that the auth event occurred)
- Useful for correlating "user requested reset at time X" with Mailgun delivery logs

## Improvement Roadmap

### Short Term
1. **Dynamic SITE_URL** (resolves R13): Read `SITE_URL` from environment variable instead of hardcoding. Pass the originating domain through the webhook payload or configure per-environment.
2. **Delivery tracking webhooks** (resolves R12): Implement Mailgun webhook endpoint to receive delivery/bounce/complaint events. Store in a `email_delivery_log` table for admin visibility.

### Medium Term
3. **Bounce handling**: Automatically flag users whose emails bounce repeatedly. Surface in super admin panel for manual intervention.
4. **Email template externalization**: Move HTML templates to a separate module or CMS-managed system for easier updates without redeploying the Edge Function.

### Long Term
5. **Delivery SLA monitoring**: Track time-to-inbox metrics. Alert when delivery latency exceeds thresholds.
6. **Fallback sender**: If Mailgun is down, queue emails for retry or fall back to a secondary provider.
