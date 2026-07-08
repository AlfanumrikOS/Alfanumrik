/**
 * School-branded email templates for B2B communications.
 *
 * All HTML is inline-styled (no <style> blocks) for email client compatibility.
 * 600px max width, single-column layout, system fonts.
 * "Powered by Alfanumrik" footer on all school-branded emails.
 *
 * P13: No student PII is embedded in templates -- callers pass only
 * non-identifying data (codes, amounts, dates).
 * P7: Bilingual support -- Hindi text included where user-facing.
 */

/* ─── Types ─── */

export interface SchoolEmailContext {
  schoolName: string;
  schoolLogoUrl?: string;
  primaryColor: string;
  tagline?: string;
}

interface InviteData {
  code: string;
  role: string;
  signupUrl: string;
}

interface AnnouncementData {
  title: string;
  body: string;
  appUrl: string;
}

interface InvoiceData {
  period: string;
  seatsUsed: number;
  amount: number;
  paymentUrl?: string;
}

interface RenewalReminderData {
  daysUntilRenewal: number;
  plan: string;
  seats: number;
}

interface SubdomainData {
  subdomain: string;
}

interface EmailResult {
  subject: string;
  html: string;
}

/* ─── Shared Layout Helpers ─── */

const SUPPORT_EMAIL = 'support@alfanumrik.com';
const SITE_URL = 'https://alfanumrik.com';

/** Escape HTML special characters to prevent injection */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format INR amount with comma separators */
function formatINR(amount: number): string {
  // Indian numbering: 1,00,000 style
  const str = amount.toFixed(0);
  const lastThree = str.slice(-3);
  const rest = str.slice(0, -3);
  const formatted = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree
    : lastThree;
  return `\u20B9${formatted}`;
}

/** School header: colored bar with logo or school name */
function schoolHeader(ctx: SchoolEmailContext): string {
  const name = escapeHtml(ctx.schoolName);
  const color = escapeHtml(ctx.primaryColor);

  const logoBlock = ctx.schoolLogoUrl
    ? `<img src="${escapeHtml(ctx.schoolLogoUrl)}" alt="${name}" width="48" height="48" style="display:block;margin:0 auto 8px;border-radius:8px;" />`
    : '';

  return `
        <tr>
          <td style="background-color:${color};padding:24px 32px;text-align:center;border-radius:4px 4px 0 0;">
            ${logoBlock}
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">${name}</p>
            ${ctx.tagline ? `<p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.85);font-family:Arial,Helvetica,sans-serif;">${escapeHtml(ctx.tagline)}</p>` : ''}
          </td>
        </tr>`;
}

/** Powered by Alfanumrik footer */
function poweredByFooter(): string {
  return `
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e4e4e7;text-align:center;">
            <p style="margin:0;font-size:11px;color:#a1a1aa;font-family:Arial,Helvetica,sans-serif;">
              Powered by <a href="${SITE_URL}" style="color:#a1a1aa;text-decoration:underline;">Alfanumrik</a> &mdash; AI-powered adaptive learning for CBSE
            </p>
            <p style="margin:4px 0 0;font-size:11px;color:#a1a1aa;font-family:Arial,Helvetica,sans-serif;">
              <a href="${SITE_URL}/privacy" style="color:#a1a1aa;">Privacy</a> &nbsp;|&nbsp;
              <a href="${SITE_URL}/terms" style="color:#a1a1aa;">Terms</a> &nbsp;|&nbsp;
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#a1a1aa;">Support</a>
            </p>
          </td>
        </tr>`;
}

/** CTA button */
function ctaButton(text: string, url: string, color: string): string {
  return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td align="center">
                  <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 32px;background-color:${escapeHtml(color)};color:#ffffff;font-size:16px;font-weight:600;font-family:Arial,Helvetica,sans-serif;text-decoration:none;border-radius:8px;mso-padding-alt:0;">
                    <!--[if mso]><i style="letter-spacing:32px;mso-font-width:-100%;mso-text-raise:24pt">&nbsp;</i><![endif]-->
                    <span style="mso-text-raise:12pt;">${escapeHtml(text)}</span>
                    <!--[if mso]><i style="letter-spacing:32px;mso-font-width:-100%">&nbsp;</i><![endif]-->
                  </a>
                </td>
              </tr>
            </table>`;
}

/** Full wrapper: DOCTYPE + body + centered table + school header + content + footer */
function wrapEmail(ctx: SchoolEmailContext, preheader: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(ctx.schoolName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:none;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:4px;">
          ${schoolHeader(ctx)}
          <tr>
            <td style="padding:28px 32px 32px;">
              ${bodyContent}
            </td>
          </tr>
          ${poweredByFooter()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ─── Template Functions ─── */

/**
 * Invitation email sent when a school admin invites a teacher or student.
 * Contains an invite code and signup link.
 */
export function schoolInviteEmail(
  ctx: SchoolEmailContext,
  data: InviteData,
): EmailResult {
  const roleName = data.role === 'teacher' ? 'Teacher' : 'Student';
  const roleHi = data.role === 'teacher' ? '\u0936\u093F\u0915\u094D\u0937\u0915' : '\u0935\u093F\u0926\u094D\u092F\u093E\u0930\u094D\u0925\u0940';

  const subject = `You're invited to join ${ctx.schoolName} on Alfanumrik`;

  const bodyContent = `
              <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                You're invited! / \u0906\u092A\u0915\u094B \u0928\u093F\u092E\u0902\u0924\u094D\u0930\u0923 \u092E\u093F\u0932\u093E \u0939\u0948!
              </h2>
              <p style="margin:0 0 16px;font-size:15px;color:#52525b;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(ctx.schoolName)} has invited you to join as a <strong>${roleName}</strong> on their AI-powered learning platform.
              </p>
              <p style="margin:0 0 8px;font-size:13px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(ctx.schoolName)} \u0928\u0947 \u0906\u092A\u0915\u094B ${roleHi} \u0915\u0947 \u0930\u0942\u092A \u092E\u0947\u0902 \u0905\u092A\u0928\u0947 AI \u0932\u0930\u094D\u0928\u093F\u0902\u0917 \u092A\u094D\u0932\u0947\u091F\u092B\u0949\u0930\u094D\u092E \u092A\u0930 \u091C\u0941\u0921\u093C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0906\u092E\u0902\u0924\u094D\u0930\u093F\u0924 \u0915\u093F\u092F\u093E \u0939\u0948\u0964
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background-color:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:16px 24px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:1px;">Your Invite Code / \u0906\u092A\u0915\u093E \u0915\u094B\u0921</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#18181b;font-family:'Courier New',Courier,monospace;letter-spacing:4px;">${escapeHtml(data.code)}</p>
                  </td>
                </tr>
              </table>
              ${ctaButton('Get Started / \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902', data.signupUrl, ctx.primaryColor)}
              <p style="margin:0;font-size:12px;color:#a1a1aa;font-family:Arial,Helvetica,sans-serif;">
                If the button doesn't work, copy this link:<br>
                <a href="${escapeHtml(data.signupUrl)}" style="color:#7C3AED;word-break:break-all;">${escapeHtml(data.signupUrl)}</a>
              </p>`;

  const html = wrapEmail(
    ctx,
    `${ctx.schoolName} has invited you to their learning platform`,
    bodyContent,
  );

  return { subject, html };
}

/**
 * Announcement email sent when a school publishes a notice.
 */
export function announcementEmail(
  ctx: SchoolEmailContext,
  data: AnnouncementData,
): EmailResult {
  const subject = `${ctx.schoolName}: ${data.title}`;

  const bodyContent = `
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(data.title)}
              </h2>
              <div style="margin:0 0 24px;font-size:15px;color:#3f3f46;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(data.body).replace(/\n/g, '<br>')}
              </div>
              ${ctaButton('Open in App / \u0910\u092A \u092E\u0947\u0902 \u0916\u094B\u0932\u0947\u0902', data.appUrl, ctx.primaryColor)}`;

  const html = wrapEmail(
    ctx,
    `New announcement from ${ctx.schoolName}: ${data.title}`,
    bodyContent,
  );

  return { subject, html };
}

/**
 * Invoice email sent when a billing invoice is generated for a school.
 */
export function invoiceEmail(
  ctx: SchoolEmailContext,
  data: InvoiceData,
): EmailResult {
  const subject = `${ctx.schoolName} \u2014 Invoice for ${data.period}`;

  const bodyContent = `
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                Invoice / \u091A\u093E\u0932\u093E\u0928
              </h2>
              <p style="margin:0 0 20px;font-size:15px;color:#52525b;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                Here is the invoice summary for <strong>${escapeHtml(ctx.schoolName)}</strong>.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Period / \u0905\u0935\u0927\u093F</td>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;font-weight:600;text-align:right;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(data.period)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Seats Used / \u0938\u0940\u091F\u0947\u0902</td>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;font-weight:600;text-align:right;font-family:Arial,Helvetica,sans-serif;">${data.seatsUsed}</td>
                </tr>
                <tr>
                  <td style="padding:12px 20px;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Amount / \u0930\u093E\u0936\u093F</td>
                  <td style="padding:12px 20px;font-size:18px;color:#18181b;font-weight:700;text-align:right;font-family:Arial,Helvetica,sans-serif;">${formatINR(data.amount)}</td>
                </tr>
              </table>
              ${data.paymentUrl ? ctaButton('Pay Now / \u0905\u092D\u0940 \u092D\u0941\u0917\u0924\u093E\u0928 \u0915\u0930\u0947\u0902', data.paymentUrl, ctx.primaryColor) : ''}
              <p style="margin:0;font-size:13px;color:#71717a;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                For payment queries, contact us at
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#7C3AED;">${SUPPORT_EMAIL}</a>.
              </p>`;

  const html = wrapEmail(
    ctx,
    `Invoice for ${ctx.schoolName}: ${formatINR(data.amount)} for ${data.period}`,
    bodyContent,
  );

  return { subject, html };
}

/**
 * Renewal reminder email sent before a school subscription expires.
 */
export function renewalReminderEmail(
  ctx: SchoolEmailContext,
  data: RenewalReminderData,
): EmailResult {
  const subject = `${ctx.schoolName} subscription renewing in ${data.daysUntilRenewal} days`;

  const urgencyColor = data.daysUntilRenewal <= 3 ? '#dc2626' : data.daysUntilRenewal <= 7 ? '#ea580c' : '#52525b';

  const bodyContent = `
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                Subscription Renewal Reminder
              </h2>
              <p style="margin:0 0 8px;font-size:15px;color:#52525b;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                \u0906\u092A\u0915\u0940 \u0938\u0926\u0938\u094D\u092F\u0924\u093E \u0928\u0935\u0940\u0928\u0940\u0915\u0930\u0923 \u0915\u0940 \u092F\u093E\u0926 \u0926\u093F\u0932\u093E\u0928\u093E / Your subscription renewal reminder:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">School</td>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;font-weight:600;text-align:right;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(ctx.schoolName)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Plan</td>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;font-weight:600;text-align:right;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(data.plan)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Active Seats / \u0938\u0915\u094D\u0930\u093F\u092F \u0938\u0940\u091F\u0947\u0902</td>
                  <td style="padding:12px 20px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;font-weight:600;text-align:right;font-family:Arial,Helvetica,sans-serif;">${data.seats}</td>
                </tr>
                <tr>
                  <td style="padding:12px 20px;font-size:14px;color:#71717a;font-family:Arial,Helvetica,sans-serif;">Renews In</td>
                  <td style="padding:12px 20px;font-size:16px;color:${urgencyColor};font-weight:700;text-align:right;font-family:Arial,Helvetica,sans-serif;">${data.daysUntilRenewal} days</td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:15px;color:#52525b;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                Need to adjust your seat count or plan before renewal? Contact us and we'll help.
              </p>
              ${ctaButton('Contact Us / \u0938\u0902\u092A\u0930\u094D\u0915 \u0915\u0930\u0947\u0902', `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${ctx.schoolName} - Subscription Adjustment`)}`, ctx.primaryColor)}`;

  const html = wrapEmail(
    ctx,
    `Your ${ctx.schoolName} subscription renews in ${data.daysUntilRenewal} days`,
    bodyContent,
  );

  return { subject, html };
}

/**
 * Trial welcome email sent when a school first signs up for their 30-day trial.
 */
export function trialWelcomeEmail(
  ctx: SchoolEmailContext,
  data: SubdomainData,
): EmailResult {
  const subject = `Welcome to Alfanumrik, ${ctx.schoolName}!`;

  const subdomainUrl = `https://${escapeHtml(data.subdomain)}.alfanumrik.com`;

  const bodyContent = `
              <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                Welcome! / \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948!
              </h2>
              <p style="margin:0 0 20px;font-size:15px;color:#52525b;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                ${escapeHtml(ctx.schoolName)} is now set up on Alfanumrik's AI-powered adaptive learning platform. Your 30-day free trial has started!
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:16px 24px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:#71717a;font-family:Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:1px;">Your School URL</p>
                    <a href="${subdomainUrl}" style="font-size:16px;font-weight:600;color:#7C3AED;font-family:Arial,Helvetica,sans-serif;text-decoration:none;">${escapeHtml(data.subdomain)}.alfanumrik.com</a>
                  </td>
                </tr>
              </table>
              <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#18181b;font-family:Arial,Helvetica,sans-serif;">
                Quick Start / \u0924\u094D\u0935\u0930\u093F\u0924 \u0936\u0941\u0930\u0941\u0906\u0924
              </h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="padding:10px 0;font-size:15px;color:#3f3f46;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                    <strong style="display:inline-block;width:24px;height:24px;background-color:${escapeHtml(ctx.primaryColor)};color:#ffffff;border-radius:50%;text-align:center;line-height:24px;font-size:13px;margin-right:10px;">1</strong>
                    Set up your school branding (logo, colors)
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;font-size:15px;color:#3f3f46;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                    <strong style="display:inline-block;width:24px;height:24px;background-color:${escapeHtml(ctx.primaryColor)};color:#ffffff;border-radius:50%;text-align:center;line-height:24px;font-size:13px;margin-right:10px;">2</strong>
                    Invite your teachers with invite codes
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;font-size:15px;color:#3f3f46;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                    <strong style="display:inline-block;width:24px;height:24px;background-color:${escapeHtml(ctx.primaryColor)};color:#ffffff;border-radius:50%;text-align:center;line-height:24px;font-size:13px;margin-right:10px;">3</strong>
                    Add students to classes and start learning!
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
                <tr>
                  <td style="padding:14px 20px;font-size:14px;color:#92400e;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
                    <strong>30-day trial</strong> \u2014 Full access to all features including Foxy AI Tutor, adaptive quizzes, progress tracking, and parent reports. No credit card required.
                  </td>
                </tr>
              </table>
              ${ctaButton('Go to Dashboard / \u0921\u0948\u0936\u092C\u094B\u0930\u094D\u0921 \u092A\u0930 \u091C\u093E\u090F\u0902', subdomainUrl, ctx.primaryColor)}
              <p style="margin:0;font-size:13px;color:#71717a;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                Need help getting started? Email us at
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#7C3AED;">${SUPPORT_EMAIL}</a>
                and we'll set up a walkthrough.
              </p>`;

  const html = wrapEmail(
    ctx,
    `Welcome to Alfanumrik! Your 30-day trial for ${ctx.schoolName} is active`,
    bodyContent,
  );

  return { subject, html };
}
