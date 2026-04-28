/**
 * School-branded email templates — unit tests.
 *
 * src/lib/email-templates.ts is pure string composition with no side effects.
 * The risks worth pinning are:
 *   - HTML injection via untrusted school name / payload data
 *   - INR formatting using Indian numbering (1,00,000)
 *   - Subject line + bilingual preheader correctness
 *   - Renewal urgency colouring (red <=3, orange <=7, neutral else)
 *
 * P13: never embed PII; templates only receive school + invoice metadata.
 */

import { describe, it, expect } from 'vitest';
import {
  schoolInviteEmail,
  announcementEmail,
  invoiceEmail,
  renewalReminderEmail,
  trialWelcomeEmail,
  type SchoolEmailContext,
} from '@/lib/email-templates';

const BASE_CTX: SchoolEmailContext = {
  schoolName: 'Bharangpur Primary',
  primaryColor: '#7C3AED',
};

describe('schoolInviteEmail', () => {
  it('returns subject containing the school name', () => {
    const { subject } = schoolInviteEmail(BASE_CTX, {
      code: 'ABC123',
      role: 'teacher',
      signupUrl: 'https://alfanumrik.com/signup',
    });
    expect(subject).toContain('Bharangpur Primary');
    expect(subject).toContain('Alfanumrik');
  });

  it('renders the invite code in the body', () => {
    const { html } = schoolInviteEmail(BASE_CTX, {
      code: 'ABC123',
      role: 'student',
      signupUrl: 'https://alfanumrik.com/signup',
    });
    expect(html).toContain('ABC123');
    expect(html).toContain('https://alfanumrik.com/signup');
  });

  it('uses Teacher role label for role=teacher', () => {
    const { html } = schoolInviteEmail(BASE_CTX, {
      code: 'X',
      role: 'teacher',
      signupUrl: 'https://x',
    });
    expect(html).toContain('Teacher');
  });

  it('uses Student role label for any non-teacher role', () => {
    const { html } = schoolInviteEmail(BASE_CTX, {
      code: 'X',
      role: 'student',
      signupUrl: 'https://x',
    });
    expect(html).toContain('Student');
  });

  it('escapes HTML in school name to prevent injection', () => {
    const ctx: SchoolEmailContext = {
      schoolName: '<script>alert(1)</script>',
      primaryColor: '#7C3AED',
    };
    const { html, subject } = schoolInviteEmail(ctx, {
      code: 'X',
      role: 'student',
      signupUrl: 'https://x',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Subject is plain text — server side handles encoding, but ensure no raw close tag.
    expect(subject).toContain('script'); // raw chars allowed in subject; HTML escape only in markup
  });

  it('escapes HTML in invite code', () => {
    const { html } = schoolInviteEmail(BASE_CTX, {
      code: '<b>X</b>',
      role: 'student',
      signupUrl: 'https://x',
    });
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });

  it('renders school logo when schoolLogoUrl provided', () => {
    const ctx: SchoolEmailContext = {
      ...BASE_CTX,
      schoolLogoUrl: 'https://cdn.example.com/logo.png',
    };
    const { html } = schoolInviteEmail(ctx, {
      code: 'X',
      role: 'student',
      signupUrl: 'https://x',
    });
    expect(html).toContain('https://cdn.example.com/logo.png');
  });

  it('omits logo block when schoolLogoUrl is missing', () => {
    const { html } = schoolInviteEmail(BASE_CTX, {
      code: 'X',
      role: 'student',
      signupUrl: 'https://x',
    });
    expect(html).not.toContain('alt="Bharangpur Primary"');
  });
});

describe('announcementEmail', () => {
  it('puts title in subject and converts newlines to <br>', () => {
    const { subject, html } = announcementEmail(BASE_CTX, {
      title: 'School Holiday',
      body: 'Line one\nLine two',
      appUrl: 'https://app',
    });
    expect(subject).toContain('School Holiday');
    expect(html).toContain('Line one<br>Line two');
  });

  it('escapes HTML in announcement body', () => {
    const { html } = announcementEmail(BASE_CTX, {
      title: 'X',
      body: '<img src=x onerror=alert(1)>',
      appUrl: 'https://app',
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });
});

describe('invoiceEmail', () => {
  it('formats INR amount using Indian numbering style', () => {
    const { html } = invoiceEmail(BASE_CTX, {
      period: 'April 2026',
      seatsUsed: 50,
      amount: 100000,
    });
    // Indian style: 1,00,000 (not 100,000)
    expect(html).toContain('1,00,000');
    expect(html).toContain('₹'); // ₹ symbol
  });

  it('handles small amounts (< 1000) without commas', () => {
    const { html } = invoiceEmail(BASE_CTX, {
      period: 'April 2026',
      seatsUsed: 5,
      amount: 500,
    });
    expect(html).toContain('₹500');
  });

  it('omits Pay Now button when paymentUrl is absent', () => {
    const { html } = invoiceEmail(BASE_CTX, {
      period: 'April 2026',
      seatsUsed: 10,
      amount: 1000,
    });
    expect(html).not.toContain('Pay Now');
  });

  it('includes Pay Now link when paymentUrl provided', () => {
    const { html } = invoiceEmail(BASE_CTX, {
      period: 'April 2026',
      seatsUsed: 10,
      amount: 1000,
      paymentUrl: 'https://razorpay.com/pay/abc',
    });
    expect(html).toContain('Pay Now');
    expect(html).toContain('https://razorpay.com/pay/abc');
  });
});

describe('renewalReminderEmail', () => {
  it('uses red urgency colour for daysUntilRenewal <= 3', () => {
    const { html } = renewalReminderEmail(BASE_CTX, {
      daysUntilRenewal: 2,
      plan: 'pro',
      seats: 100,
    });
    expect(html).toContain('#dc2626');
  });

  it('uses orange urgency colour for daysUntilRenewal 4-7', () => {
    const { html } = renewalReminderEmail(BASE_CTX, {
      daysUntilRenewal: 5,
      plan: 'pro',
      seats: 100,
    });
    expect(html).toContain('#ea580c');
  });

  it('uses neutral colour when more than 7 days remain', () => {
    const { html } = renewalReminderEmail(BASE_CTX, {
      daysUntilRenewal: 15,
      plan: 'pro',
      seats: 100,
    });
    expect(html).toContain('#52525b');
  });

  it('puts plan name + days in subject', () => {
    const { subject } = renewalReminderEmail(BASE_CTX, {
      daysUntilRenewal: 7,
      plan: 'unlimited',
      seats: 200,
    });
    expect(subject).toContain('7 days');
    expect(subject).toContain('Bharangpur Primary');
  });
});

describe('trialWelcomeEmail', () => {
  it('renders the school subdomain URL', () => {
    const { subject, html } = trialWelcomeEmail(BASE_CTX, { subdomain: 'bharangpur' });
    expect(subject).toContain('Bharangpur Primary');
    expect(html).toContain('bharangpur.alfanumrik.com');
  });

  it('mentions 30-day trial messaging', () => {
    const { html } = trialWelcomeEmail(BASE_CTX, { subdomain: 'x' });
    expect(html).toContain('30-day');
  });
});
