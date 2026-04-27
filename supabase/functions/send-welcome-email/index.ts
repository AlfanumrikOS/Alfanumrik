/**
 * send-welcome-email – Alfanumrik Edge Function
 *
 * Sends beautifully designed welcome emails to new users based on their role:
 *   - Student: Learning features, pro tips, dashboard CTA
 *   - Teacher: Classroom tools, quick setup guide, dashboard CTA
 *   - Parent:  Tracking features, child linking guide, parent portal CTA
 *
 * Supports Mailgun API as primary provider with notification fallback.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Inline CORS ──────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
  'https://alfanumrik-ten.vercel.app',
  'http://localhost:3000',
]

function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin = requestOrigin && ALLOWED_ORIGINS.some((o) => requestOrigin === o || requestOrigin.endsWith('.vercel.app'))
    ? requestOrigin
    : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}, requestOrigin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(requestOrigin), 'Content-Type': 'application/json', ...extra },
  })
}

function errorResponse(message: string, status = 400, requestOrigin?: string | null): Response {
  return jsonResponse({ error: message }, status, {}, requestOrigin)
}

// ─── Config ───────────────────────────────────────────────────────────────────
const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY') ?? ''
const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') ?? ''
const FROM_EMAIL = 'Alfanumrik <welcome@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
// SITE_URL must come from env per P15 #6. See audit 2026-04-27 F4.
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'

async function sendMailgunEmail(params: {
  to: string; subject: string; html: string; text: string;
  from?: string; replyTo?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const form = new FormData()
  form.append('from', params.from || FROM_EMAIL)
  form.append('to', params.to)
  form.append('subject', params.subject)
  form.append('html', params.html)
  form.append('text', params.text)
  if (params.replyTo) form.append('h:Reply-To', params.replyTo)
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) form.append(`h:${k}`, v)
  }
  if (params.tags) {
    for (const t of params.tags) form.append('o:tag', `${t.name}:${t.value}`)
  }
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}` },
    body: form,
  })
  if (!res.ok) return { success: false, error: await res.text() }
  const result = await res.json()
  return { success: true, id: result.id }
}

interface WelcomeRequest {
  role: 'student' | 'teacher' | 'parent'
  name: string
  email: string
  grade?: string
  board?: string
  school_name?: string
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function baseWrapper(content: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Alfanumrik</title>
  <style>
    body { margin: 0; padding: 0; background: #F0F2F5; font-family: 'Inter', -apple-system, sans-serif; }
    .preheader { display: none !important; max-height: 0; overflow: hidden; }
  </style>
</head>
<body style="margin:0;padding:0;background:#F0F2F5;">
  <span class="preheader">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);font-weight:500;">India's Adaptive Learning OS</p>
        </td></tr>
        <tr><td style="padding:32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
          <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">
            &copy; 2026 Alfanumrik EdTech. Made with &#10084;&#65039; in India.<br>
            <a href="${SITE_URL}/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy Policy</a> &nbsp;|&nbsp;
            <a href="${SITE_URL}/terms" style="color:#6C5CE7;text-decoration:none;">Terms of Service</a> &nbsp;|&nbsp;
            <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;text-decoration:none;">Contact Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function studentEmail(name: string, grade?: string, board?: string): { subject: string; html: string; text: string } {
  const firstName = name.split(' ')[0]
  const gradeText = grade ? ` (Grade ${grade}${board ? `, ${board}` : ''})` : ''
  const subject = `Welcome to Alfanumrik, ${firstName}! Your learning adventure begins`
  const html = baseWrapper(`
      <div style="text-align:center;margin-bottom:24px;"><div style="font-size:56px;line-height:1;">&#127775;</div></div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1F2937;text-align:center;">Welcome aboard, ${firstName}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You're now part of Alfanumrik${gradeText}. Let's make learning fun and effective!</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#F5F3FF;border-radius:12px;border-left:4px solid #6C5CE7;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#6C5CE7;">&#127919; What's waiting for you</p>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#4B5563;line-height:2;">
            <li><strong>Foxy AI Tutor</strong> &#8212; Your personal study buddy that explains concepts in your language</li>
            <li><strong>Adaptive Quizzes</strong> &#8212; Smart questions that match your level and help you grow</li>
            <li><strong>XP &amp; Streaks</strong> &#8212; Earn points, maintain streaks, and climb the leaderboard</li>
            <li><strong>Spaced Repetition</strong> &#8212; Never forget what you learn with scientifically-timed reviews</li>
          </ul>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#FEF3C7;border-radius:12px;border-left:4px solid #F59E0B;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#D97706;">&#128161; Pro Tip for Day 1</p>
          <p style="margin:4px 0 0;font-size:13px;color:#92400E;line-height:1.6;">Start with a 5-question quiz in your favourite subject. It takes just 3 minutes and helps Alfanumrik understand your level!</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${SITE_URL}/dashboard" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Start Learning Now &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">Questions? Just ask Foxy inside the app or email <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a></p>
    `, `Welcome to Alfanumrik, ${firstName}! Your AI-powered learning journey starts now.`)
  const text = `Welcome to Alfanumrik, ${firstName}!${gradeText}\n\nYou're now part of Alfanumrik. Here's what's waiting for you:\n\n- Foxy AI Tutor: Your personal study buddy\n- Adaptive Quizzes: Smart questions that match your level\n- XP & Streaks: Earn points and climb the leaderboard\n- Spaced Repetition: Never forget what you learn\n\nPro Tip: Start with a 5-question quiz in your favourite subject!\n\nStart learning: ${SITE_URL}/dashboard\n\nQuestions? Email support@alfanumrik.com\n\n(c) 2026 Alfanumrik EdTech\n${SITE_URL}/privacy | ${SITE_URL}/terms`
  return { subject, html, text }
}


function teacherEmail(name: string, schoolName?: string): { subject: string; html: string; text: string } {
  const firstName = name.split(' ')[0]
  const schoolText = schoolName ? ` at ${schoolName}` : ''
  const subject = `Welcome to Alfanumrik, ${firstName}! Your classroom just got smarter`
  const html = baseWrapper(`
      <div style="text-align:center;margin-bottom:24px;"><div style="font-size:56px;line-height:1;">&#127912;</div></div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1F2937;text-align:center;">Welcome, ${firstName}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">Thank you for joining Alfanumrik${schoolText}. You now have access to India's most adaptive classroom tools.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#EFF6FF;border-radius:12px;border-left:4px solid #3B82F6;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#2563EB;">&#128218; Your Teaching Superpowers</p>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#4B5563;line-height:2;">
            <li><strong>Create Classes</strong> &#8212; Set up classrooms and invite students with a code</li>
            <li><strong>Assign Smart Quizzes</strong> &#8212; AI-generated questions aligned to CBSE/ICSE syllabus</li>
            <li><strong>Live Performance Dashboard</strong> &#8212; See exactly where each student excels or struggles</li>
            <li><strong>Export Reports</strong> &#8212; Download class performance reports as CSV or PDF</li>
            <li><strong>Concept Mastery Tracker</strong> &#8212; Topic-by-topic mastery view across your class</li>
          </ul>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#ECFDF5;border-radius:12px;border-left:4px solid #10B981;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#059669;">&#128640; Quick Setup (3 Steps)</p>
          <ol style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#065F46;line-height:2;">
            <li>Go to <strong>Dashboard &#8594; Classes</strong> and create your first class</li>
            <li>Share the <strong>class invite code</strong> with your students</li>
            <li>Assign a quiz and watch real-time results roll in!</li>
          </ol>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${SITE_URL}/dashboard" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Open Your Dashboard &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">Need help onboarding your school? Write to <a href="mailto:support@alfanumrik.com" style="color:#3B82F6;">support@alfanumrik.com</a></p>
    `, `Welcome to Alfanumrik, ${firstName}! Your AI-powered classroom tools are ready.`)
  const text = `Welcome to Alfanumrik, ${firstName}!${schoolText}\n\nYour Teaching Superpowers:\n- Create Classes and invite students with a code\n- Assign Smart Quizzes aligned to CBSE/ICSE syllabus\n- Live Performance Dashboard for each student\n- Export Reports as CSV or PDF\n\nQuick Setup:\n1. Go to Dashboard > Classes and create your first class\n2. Share the class invite code with your students\n3. Assign a quiz and watch real-time results!\n\nOpen your dashboard: ${SITE_URL}/dashboard\n\nNeed help? Email support@alfanumrik.com\n\n(c) 2026 Alfanumrik EdTech\n${SITE_URL}/privacy | ${SITE_URL}/terms`
  return { subject, html, text }
}

function parentEmail(name: string): { subject: string; html: string; text: string } {
  const firstName = name.split(' ')[0]
  const subject = `Welcome to Alfanumrik, ${firstName}! Stay connected to your child's learning`
  const html = baseWrapper(`
      <div style="text-align:center;margin-bottom:24px;"><div style="font-size:56px;line-height:1;">&#128104;&#8205;&#128105;&#8205;&#128103;</div></div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1F2937;text-align:center;">Welcome, ${firstName}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">Thank you for joining Alfanumrik. You'll now receive insights on your child's learning progress.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#FFF7ED;border-radius:12px;border-left:4px solid #F97316;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#EA580C;">&#128202; What You Can Track</p>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#9A3412;line-height:2;">
            <li><strong>Daily Digest</strong> &#8212; Receive a daily summary of quizzes taken, topics studied, and XP earned</li>
            <li><strong>Subject Mastery</strong> &#8212; See your child's progress in each subject, topic by topic</li>
            <li><strong>Study Streaks</strong> &#8212; Know if your child is maintaining consistent study habits</li>
            <li><strong>Weekly Reports</strong> &#8212; Detailed weekly performance summaries delivered to your inbox</li>
            <li><strong>Teacher Updates</strong> &#8212; View assignments and class performance from teachers</li>
          </ul>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:16px;background:#FDF2F8;border-radius:12px;border-left:4px solid #EC4899;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#DB2777;">&#128279; Link Your Child's Account</p>
          <p style="margin:4px 0 0;font-size:13px;color:#9D174D;line-height:1.6;">If you haven't linked your child's account yet, ask them to share their <strong>Parent Link Code</strong> from their profile page. Enter it in <strong>Dashboard &#8594; Link Child</strong> to start tracking their progress.</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${SITE_URL}/parent" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#F97316,#EA580C);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Open Parent Portal &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">Questions? Email us at <a href="mailto:support@alfanumrik.com" style="color:#F97316;">support@alfanumrik.com</a></p>
    `, `Welcome to Alfanumrik, ${firstName}! Your parent portal is ready.`)
  const text = `Welcome to Alfanumrik, ${firstName}!\n\nWhat You Can Track:\n- Daily Digest of quizzes, topics, and XP\n- Subject Mastery progress for each subject\n- Study Streaks and consistency\n- Weekly Reports delivered to your inbox\n- Teacher Updates on assignments\n\nLink Your Child's Account:\nAsk your child to share their Parent Link Code from their profile page.\nEnter it in Dashboard > Link Child.\n\nOpen parent portal: ${SITE_URL}/parent\n\nQuestions? Email support@alfanumrik.com\n\n(c) 2026 Alfanumrik EdTech\n${SITE_URL}/privacy | ${SITE_URL}/terms`
  return { subject, html, text }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing authorization header', 401, origin)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return errorResponse('Unauthorized', 401, origin)

    const body: WelcomeRequest = await req.json()
    const { role, name, email, grade, board, school_name } = body

    if (!role || !name || !email) return errorResponse('Missing required fields: role, name, email', 400, origin)

    let emailContent: { subject: string; html: string; text: string }
    switch (role) {
      case 'student': emailContent = studentEmail(name, grade, board); break
      case 'teacher': emailContent = teacherEmail(name, school_name); break
      case 'parent': emailContent = parentEmail(name); break
      default: return errorResponse('Invalid role', 400, origin)
    }

    // Send via Mailgun API if configured
    if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
      try {
        const result = await sendMailgunEmail({
          to: email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          from: FROM_EMAIL,
          replyTo: REPLY_TO,
          headers: {
            'X-Entity-Ref-ID': `welcome-${role}-${Date.now()}`,
            'List-Unsubscribe': `<mailto:unsubscribe@alfanumrik.com?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          tags: [
            { name: 'category', value: 'welcome' },
            { name: 'role', value: role },
          ],
        })

        if (result.success) {
          console.log(`[Welcome Email] Sent to ${email}, id: ${result.id}`)
          return jsonResponse({ sent: true, provider: 'mailgun', id: result.id }, 200, {}, origin)
        }
        console.error('[Welcome Email] Mailgun error:', result.error)
      } catch (fetchErr) {
        console.error('[Welcome Email] Fetch error:', fetchErr)
      }
    }

    // Fallback: store as notification
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    await supabaseAdmin.from('notifications').insert({
      recipient_id: user.id,
      recipient_type: role === 'parent' ? 'guardian' : role,
      type: 'welcome_email',
      title: emailContent.subject,
      body: `Welcome to Alfanumrik, ${name.split(' ')[0]}! Your ${role} account is ready.`,
      is_read: false,
    })

    return jsonResponse({ sent: true, provider: 'notification_fallback' }, 200, {}, origin)
  } catch (err) {
    console.error('[Welcome Email] Error:', err)
    return errorResponse('Internal server error', 500, origin)
  }
})
