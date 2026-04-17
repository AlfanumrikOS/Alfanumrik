# Supabase Dashboard Configuration for alfanumrik.com

## 1. URL Configuration
Go to: **Supabase Dashboard → Authentication → URL Configuration**
URL: https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/auth/url-configuration

### Site URL
```
https://alfanumrik.com
```

### Redirect URLs (add all of these)
```
https://alfanumrik.com/auth/callback
https://alfanumrik.com/auth/confirm
https://www.alfanumrik.com/auth/callback
https://www.alfanumrik.com/auth/confirm
https://alfanumrik.vercel.app/auth/callback
https://alfanumrik-ten.vercel.app/auth/callback
https://alfanumrik-eight.vercel.app/auth/callback
http://localhost:3000/auth/callback
http://localhost:3000/auth/confirm
```

---

## 2. Email Templates
Go to: **Supabase Dashboard → Authentication → Email Templates**
URL: https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/auth/templates

### Confirm Signup Template
Subject: `Confirm your Alfanumrik account`

Body (paste this HTML):
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:'Inter',-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">India's Adaptive Learning OS</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#9993;&#65039;</div></div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Verify Your Email</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You're almost there! Click the button below to confirm your email and start your learning journey.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0;">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Confirm Email &#8594;</a>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This link expires in 24 hours. If you didn't sign up for Alfanumrik, ignore this email.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">&copy; 2026 Alfanumrik EdTech &middot; <a href="https://alfanumrik.com/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &middot; <a href="https://alfanumrik.com/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
```

### Reset Password Template
Subject: `Reset your Alfanumrik password`

Body (paste this HTML):
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:'Inter',-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">India's Adaptive Learning OS</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#128274;</div></div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Reset Your Password</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">We received a request to reset your password. Click below to choose a new one.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0;">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#EF4444,#DC2626);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Reset Password &#8594;</a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td style="padding:14px;background:#FEF2F2;border-radius:10px;border-left:4px solid #EF4444;">
        <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.5;">&#9888;&#65039; <strong>Security:</strong> This link expires in 1 hour. If you didn't request this, your password is safe — just ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">&copy; 2026 Alfanumrik EdTech &middot; <a href="https://alfanumrik.com/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &middot; <a href="https://alfanumrik.com/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
```

### Magic Link Template
Subject: `Your Alfanumrik login link`

Body (paste this HTML):
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:'Inter',-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">India's Adaptive Learning OS</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#10024;</div></div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Magic Login Link</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">Click below to log in to Alfanumrik instantly. No password needed!</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0;">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#10B981,#059669);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Log In &#8594;</a>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This link expires in 24 hours and can only be used once.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">&copy; 2026 Alfanumrik EdTech &middot; <a href="https://alfanumrik.com/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &middot; <a href="https://alfanumrik.com/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
```

### Invite User Template
Subject: `You've been invited to Alfanumrik`

Body (paste this HTML):
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:'Inter',-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">India's Adaptive Learning OS</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#127881;</div></div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">You're Invited!</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You've been invited to join Alfanumrik. Click below to accept the invitation and set up your account.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0;">
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Accept Invitation &#8594;</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">&copy; 2026 Alfanumrik EdTech &middot; <a href="https://alfanumrik.com/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &middot; <a href="https://alfanumrik.com/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
```

---

## 3. Deploy Edge Functions
Run these commands from the project root (requires Supabase CLI):
```bash
supabase functions deploy send-auth-email --no-verify-jwt
supabase functions deploy send-welcome-email --no-verify-jwt
```

Then set secrets in **Supabase Dashboard → Edge Functions → Secrets**:
- `MAILGUN_API_KEY` = your Mailgun API key (starts with `re_`)

---

## 4. Mailgun Setup (for custom email sending)
1. Go to https://mailgun.com and create an account
2. Get API key from https://mailgun.com/api-keys
3. Add to Supabase Edge Functions Secrets as `MAILGUN_API_KEY`

**Emails will work immediately** using Mailgun's test sender (`onboarding@mailgun.org`).

To send from `@alfanumrik.com` (recommended for production):
4. In Mailgun → Domains → Add domain: `alfanumrik.com`
5. Add these DNS records to your domain registrar (GoDaddy/Cloudflare):
   - **DKIM**: 3 CNAME records Mailgun gives you
   - **SPF**: TXT record `v=spf1 include:mailgun.org ~all`
   - **DMARC**: TXT record `v=DMARC1; p=quarantine; rua=mailto:dmarc@alfanumrik.com; pct=100; adkim=s; aspf=s`
   - See `EMAIL_DELIVERABILITY.md` for full details and warm-up strategy
6. Wait for verification (can take 5-60 minutes)
7. Until verified, emails will still send via `onboarding@mailgun.org`

---

## 5. Auth Hooks (Optional - branded auth emails via Mailgun)
**IMPORTANT:** Only enable this AFTER Step 3 and 4 are done and working.
If this hook is enabled but the edge function fails, auth emails won't be sent.

Go to: **Supabase Dashboard → Authentication → Hooks**
URL: https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/auth/hooks

Enable "Send Email" hook → select "HTTPS" → paste:
```
https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/send-auth-email
```

Copy the generated hook secret and set it as `SEND_EMAIL_HOOK_SECRET` in Edge Functions → Secrets.

**If emails stop working:** Disable this hook first. Supabase will fall back to its built-in email templates (Step 2).
