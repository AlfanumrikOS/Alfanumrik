/**
 * bilingual-email – shared EN+HI (Devanagari) email rendering primitives.
 *
 * Single templating approach for all bilingual transactional email (P7).
 * Extracted verbatim from send-auth-email v49 (the P15 auth-email hook) so the
 * auth emails' rendered output is byte-identical to the pre-extraction version;
 * send-welcome-email builds its role-specific templates on these SAME
 * primitives instead of maintaining a parallel template stack.
 *
 * The house structure (established by send-auth-email v49):
 *   - one HTML body: English section first, then a thin divider, then the
 *     Hindi (Devanagari) section — never two separate emails or bodies;
 *   - one plain-text body mirroring the same stacked EN→HI content
 *     (via htmlToPlainText), so every send carries BOTH html and text parts;
 *   - dual-language subject ("English … | हिन्दी …") assembled by the caller;
 *   - technical terms (CBSE, XP, Bloom's, brand/product names, email
 *     addresses) are NOT translated (P7).
 *
 * These helpers are pure (no Deno.env reads, no I/O) so they are directly
 * unit-testable under `deno test --allow-read --allow-env` with no network.
 */

/**
 * Outer HTML shell: preheader, white card, brand header, content slot, footer
 * with Privacy/Terms/Support links. `siteUrl` is passed by the caller (the
 * Edge Functions resolve it from the SITE_URL secret per P15 rule 6).
 * Byte-identical to send-auth-email v49's baseWrapper.
 */
export function baseWrapper(content: string, preheader: string, siteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Alfanumrik</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e4e4e7;">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#18181b;">Alfanumrik</p>
        </td></tr>
        <tr><td style="padding:24px 32px 32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;text-align:center;">
            Alfanumrik EdTech Pvt. Ltd., India<br>
            <a href="${siteUrl}/privacy" style="color:#71717a;">Privacy</a> |
            <a href="${siteUrl}/terms" style="color:#71717a;">Terms</a> |
            <a href="mailto:support@alfanumrik.com" style="color:#71717a;">Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Strip HTML tags and decode entities for plain-text email version */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#169;/g, '(c)')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Primary action button. Byte-identical to send-auth-email v49's ctaButton. */
export function ctaButton(url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">${label}</a>
            </td></tr>
          </table>`
}

/** Copy-paste URL fallback under a CTA. Byte-identical to v49's urlFallback. */
export function urlFallback(url: string, label: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">${label}<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>`
}

/**
 * Thin horizontal rule separating the English section from the Hindi section
 * in the stacked bilingual body. Byte-identical to the divider markup that was
 * inline in send-auth-email v49's renderBilingualAuthEmail (the returned string
 * carries no leading indentation on its first line — the caller's template
 * interpolation site provides it, exactly as the inline version did).
 */
export function languageDivider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
            <tr><td style="border-top:1px solid #e4e4e7;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
          </table>`
}

/**
 * Finalize a stacked EN→HI content block into the html + text pair every
 * bilingual email sends: the shared wrapper around the content, and a
 * plain-text mirror of the SAME bilingual content with the house footer line.
 * Byte-identical to the html/text composition in v49's renderBilingualAuthEmail.
 */
export function renderBilingualEmail(
  content: string,
  preheader: string,
  siteUrl: string,
): { html: string; text: string } {
  const html = baseWrapper(content, preheader, siteUrl)
  const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { html, text }
}
