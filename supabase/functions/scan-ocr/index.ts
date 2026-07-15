import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getCorsHeaders } from '../_shared/cors.ts'
import { fetchWithTimeout } from '../_shared/reliability.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile, fetchWithProviderTimeout } from '../_shared/security/ai-admission.ts'
import { securityCorsHeaders } from '../_shared/security/cors.ts'
import { getRequestOrigin } from '../_shared/security/attribution.ts'

/**
 * Scan OCR Pipeline
 *
 * Actions:
 *   upload_and_process — Upload file metadata, trigger OCR
 *   get_scans          — List student's scans
 *   get_scan           — Get single scan with text
 *   retry_ocr          — Retry failed OCR
 *   ask_foxy           — Ask Foxy about scanned content
 */

// ── Platform Security Layer — Phase 3 integration ──
const ROUTE_NAME = 'scan-ocr'

const SCAN_OCR_PROFILE = createStaticAiRouteProfile({
  route: ROUTE_NAME,
  callerTypes: ['student', 'internal_service'],
  modelProvider: 'google',
  modelName: 'vision-v1',
  inputTokenFloor: 512,
  outputTokens: 256,
})

// ── Supabase service-role connection ──
// Hotfix redeploy 2026-07-13: forces the production function-deploy pipeline to
// re-detect and ship scan-ocr (prod was pinned at the broken v29 that 500'd on
// every request). See the declaration note below.
// These were referenced at the top of the request handler (createClient(...)
// BEFORE admitAiRoute) but never declared — a ReferenceError that threw on
// EVERY request, before any auth guard, surfacing as a bare HTTP 500 (caught
// by the edge-auth sweep, 2026-07-13). The sibling ncert-solver declares them
// identically. Without this, the admission layer never ran, so an
// unauthenticated request 500'd instead of getting the structured 401 the
// admission layer returns.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// ── OCR via Tesseract.js WASM (runs in Edge Function) ──
// For MVP: use Google Vision API or Tesseract
// Practical choice: Use built-in fetch to a free OCR API
// or process text extraction from the image directly

async function extractTextFromImage(imageUrl: string, supabase: any): Promise<{ text: string; confidence: number }> {
  try {
    // Download the image from storage
    const response = await fetchWithTimeout(imageUrl, { provider: 'internal', operation: 'download_scan_image', timeoutMs: 10_000 })
    if (!response.ok) throw new Error('Failed to download image')
    const imageBuffer = await response.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))

    // Try Google Cloud Vision API if key is available
    const visionKey = Deno.env.get('GOOGLE_VISION_API_KEY')
    if (visionKey) {
      const visionRes = await fetchWithTimeout(
        `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
        {
          provider: 'google_vision',
          operation: 'scan_ocr_google_vision',
          timeoutMs: 15_000,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: base64 },
              features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
            }],
          }),
        }
      )
      if (visionRes.ok) {
        const visionData = await visionRes.json()
        const text = visionData.responses?.[0]?.fullTextAnnotation?.text || ''
        const confidence = visionData.responses?.[0]?.fullTextAnnotation?.pages?.[0]?.confidence || 0.8
        if (text) return { text, confidence }
      }
    }

    // Fallback: Use OCR.space free API
    const ocrSpaceKey = Deno.env.get('OCR_SPACE_API_KEY') || 'helloworld' // free tier key
    const formData = new FormData()
    formData.append('base64Image', `data:image/png;base64,${base64}`)
    formData.append('language', 'eng')
    formData.append('isOverlayRequired', 'false')
    formData.append('scale', 'true')
    formData.append('OCREngine', '2') // Engine 2 is better for mixed content

    const ocrRes = await fetchWithTimeout('https://api.ocr.space/parse/image', {
      provider: 'ocr_space',
      operation: 'scan_ocr_space',
      timeoutMs: 20_000,
      method: 'POST',
      headers: { 'apikey': ocrSpaceKey },
      body: formData,
    })

    if (ocrRes.ok) {
      const ocrData = await ocrRes.json()
      if (!ocrData.IsErroredOnProcessing) {
        const results = ocrData.ParsedResults || []
        const text = results.map((r: any) => r.ParsedText || '').join('\n\n')
        const confidence = results[0]?.TextOverlay?.Lines ? 0.7 : 0.5
        return { text: text.trim(), confidence }
      }
    }

    return { text: '', confidence: 0 }
  } catch (err) {
    console.error('[scan-ocr] OCR extraction failed:', err.message)
    return { text: '', confidence: 0 }
  }
}

// ── Text Normalization ──
function normalizeOcrText(raw: string): string {
  if (!raw) return ''

  let text = raw
    // Fix common OCR artifacts
    .replace(/\|/g, 'I')         // pipes often misread as I
    .replace(/\s{3,}/g, '\n\n')  // multiple spaces to paragraph break
    .replace(/([a-z])\n([a-z])/g, '$1 $2')  // merge broken lines mid-word
    .replace(/\n{3,}/g, '\n\n')  // collapse excessive newlines
    .replace(/^\s+$/gm, '')       // remove whitespace-only lines
    .trim()

  // Preserve numbered questions
  text = text.replace(/(\d+)\s*\.\s*/g, '\n$1. ')

  // Clean up
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return text
}

serve(async (req) => {
  // Per-request origin resolution for security CORS headers
  const origin = getRequestOrigin(req)

  // CORS preflight — must run before admission (no auth on OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: securityCorsHeaders(origin) })
  }

  // Read body as text first — admitAiRoute needs bodyText for request body hash
  let bodyText = ''
  try {
    bodyText = await req.text()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
    })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── Platform Security Layer admission ──
  const admitResult = await admitAiRoute({ req, sb, profile: SCAN_OCR_PROFILE, bodyText })
  if (!admitResult.ok) return admitResult.response
  const admission = admitResult.admission

  // Keep legacy corsHeaders for any sub-function calls that still need it,
  // but all HTTP responses from the main handler use securityCorsHeaders(origin).
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Auth — admission already validated the JWT; we still need the student row
    // for domain operations (OCR scan DB writes, RLS-scoped queries, etc.)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      await finalizeAiRoute({ sb, admission, statusCode: 401, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'unauthorized' })
      return new Response(JSON.stringify({ error: 'Auth required' }), {
        status: 401,
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      await finalizeAiRoute({ sb, admission, statusCode: 401, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'invalid_token' })
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    const { data: student } = await supabase
      .from('students').select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
    if (!student) {
      await finalizeAiRoute({ sb, admission, statusCode: 404, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'student_not_found' })
      return new Response(JSON.stringify({ error: 'Student not found' }), {
        status: 404,
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    // Parse body from the text already read above
    let body: Record<string, unknown>
    try {
      body = bodyText ? JSON.parse(bodyText) : {}
    } catch {
      await finalizeAiRoute({ sb, admission, statusCode: 400, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'invalid_json' })
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }
    const action = body.action

    // P12: enforce per-student daily quota on the cost-incurring actions
    // (upload_and_process / retry_ocr / ask_foxy all call Claude or Google
    // Vision). get_scans / get_scan are pure reads and skip the check.
    // Same atomic check_and_record_usage pattern as foxy-tutor + ncert-solver.
    const COST_INCURRING_ACTIONS = new Set(['upload_and_process', 'retry_ocr', 'ask_foxy'])
    if (COST_INCURRING_ACTIONS.has(action as string)) {
      const usageDate = new Date().toISOString().slice(0, 10)
      const { data: usageRows, error: usageErr } = await supabase.rpc('check_and_record_usage', {
        p_student_id: student.id,
        p_feature: 'scan_ocr',
        p_usage_date: usageDate,
      })
      if (usageErr) {
        console.error('scan-ocr check_and_record_usage failed:', usageErr.message)
        await finalizeAiRoute({ sb, admission, statusCode: 503, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'usage_tracking_unavailable' })
        return new Response(
          JSON.stringify({ error: 'Usage tracking unavailable, please try again' }),
          { status: 503, headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } },
        )
      }
      const usageRow = usageRows?.[0]
      if (!usageRow?.allowed) {
        await finalizeAiRoute({ sb, admission, statusCode: 429, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'daily_limit_reached' })
        return new Response(
          JSON.stringify({
            error: 'Daily scan-OCR limit reached',
            code: 'SCAN_OCR_LIMIT',
            used: usageRow?.used_count ?? null,
            message: "You've used all your scan-and-solve requests for today. Come back tomorrow! 🦊",
          }),
          { status: 429, headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } },
        )
      }
    }

    // ── UPLOAD AND PROCESS ──
    if (action === 'upload_and_process') {
      const { file_name, file_type, storage_path } = body as { file_name?: string; file_type?: string; storage_path?: string }
      if (!file_name || !storage_path) {
        await finalizeAiRoute({ sb, admission, statusCode: 400, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'missing_fields' })
        return new Response(JSON.stringify({ error: 'file_name and storage_path required' }), {
          status: 400,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Create scan record
      const { data: scan, error: insertErr } = await supabase
        .from('student_scans')
        .insert({
          student_id: student.id,
          file_name,
          file_type: file_type || 'image/jpeg',
          storage_path,
          status: 'processing',
        })
        .select('id')
        .single()

      if (insertErr || !scan) {
        await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'insert_failed' })
        return new Response(JSON.stringify({ error: 'Failed to create scan record' }), {
          status: 500,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Get signed URL for the file
      const { data: signedUrl } = await supabase.storage
        .from('student-scans')
        .createSignedUrl(storage_path, 300) // 5 min

      if (!signedUrl?.signedUrl) {
        await supabase.from('student_scans').update({ status: 'failed', error_message: 'Could not access file' }).eq('id', scan.id)
        await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'file_not_accessible' })
        return new Response(JSON.stringify({ error: 'File not accessible', scan_id: scan.id }), {
          status: 500,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Run OCR
      const { text, confidence } = await extractTextFromImage(signedUrl.signedUrl, supabase)

      if (!text) {
        await supabase.from('student_scans').update({
          status: 'failed',
          error_message: 'OCR could not extract text from this image',
          updated_at: new Date().toISOString(),
        }).eq('id', scan.id)

        await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
        return new Response(JSON.stringify({
          scan_id: scan.id,
          status: 'failed',
          message: 'Could not extract text. Try a clearer image.',
        }), { headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } })
      }

      // Normalize text
      const normalized = normalizeOcrText(text)

      // Update scan record
      await supabase.from('student_scans').update({
        status: 'completed',
        extracted_text: text,
        normalized_text: normalized,
        ocr_confidence: confidence,
        updated_at: new Date().toISOString(),
      }).eq('id', scan.id)

      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
      return new Response(JSON.stringify({
        scan_id: scan.id,
        status: 'completed',
        text_preview: normalized.slice(0, 500),
        confidence,
        char_count: normalized.length,
      }), { headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } })
    }

    // ── GET SCANS ──
    if (action === 'get_scans') {
      const page = (body.page as number) || 1
      const limit = 10
      const offset = (page - 1) * limit

      const { data: scans, count } = await supabase
        .from('student_scans')
        .select('id, file_name, file_type, status, ocr_confidence, created_at, updated_at', { count: 'exact' })
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
      return new Response(JSON.stringify({ data: scans || [], total: count || 0, page }), {
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    // ── GET SINGLE SCAN ──
    if (action === 'get_scan') {
      const { scan_id } = body as { scan_id?: string }
      if (!scan_id) {
        await finalizeAiRoute({ sb, admission, statusCode: 400, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'missing_scan_id' })
        return new Response(JSON.stringify({ error: 'scan_id required' }), {
          status: 400,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      const { data: scan } = await supabase
        .from('student_scans')
        .select('*')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan) {
        await finalizeAiRoute({ sb, admission, statusCode: 404, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'scan_not_found' })
        return new Response(JSON.stringify({ error: 'Scan not found' }), {
          status: 404,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Get signed URL for viewing
      let imageUrl = null
      if (scan.storage_path) {
        const { data } = await supabase.storage.from('student-scans').createSignedUrl(scan.storage_path, 3600)
        imageUrl = data?.signedUrl || null
      }

      // Get queries
      const { data: queries } = await supabase
        .from('foxy_scan_queries')
        .select('id, question, response, created_at')
        .eq('scan_id', scan_id)
        .order('created_at', { ascending: true })

      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
      return new Response(JSON.stringify({ ...scan, image_url: imageUrl, queries: queries || [] }), {
        headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
      })
    }

    // ── RETRY OCR ──
    if (action === 'retry_ocr') {
      const { scan_id } = body as { scan_id?: string }
      const { data: scan } = await supabase
        .from('student_scans')
        .select('id, storage_path, status')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan) {
        await finalizeAiRoute({ sb, admission, statusCode: 404, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'scan_not_found' })
        return new Response(JSON.stringify({ error: 'Scan not found' }), {
          status: 404,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      await supabase.from('student_scans').update({ status: 'processing', error_message: null }).eq('id', scan.id)

      const { data: signedUrl } = await supabase.storage.from('student-scans').createSignedUrl(scan.storage_path, 300)
      if (!signedUrl?.signedUrl) {
        await supabase.from('student_scans').update({ status: 'failed', error_message: 'File not accessible' }).eq('id', scan.id)
        await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'file_not_accessible' })
        return new Response(JSON.stringify({ error: 'File not accessible' }), {
          status: 500,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      const { text, confidence } = await extractTextFromImage(signedUrl.signedUrl, supabase)
      const normalized = normalizeOcrText(text)

      await supabase.from('student_scans').update({
        status: text ? 'completed' : 'failed',
        extracted_text: text || null,
        normalized_text: normalized || null,
        ocr_confidence: confidence,
        error_message: text ? null : 'OCR retry failed',
        updated_at: new Date().toISOString(),
      }).eq('id', scan.id)

      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
      return new Response(JSON.stringify({
        scan_id: scan.id,
        status: text ? 'completed' : 'failed',
        text_preview: normalized ? normalized.slice(0, 500) : null,
      }), { headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } })
    }

    // ── ASK FOXY ──
    if (action === 'ask_foxy') {
      const { scan_id, question } = body as { scan_id?: string; question?: string }
      if (!scan_id || !question) {
        await finalizeAiRoute({ sb, admission, statusCode: 400, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'missing_fields' })
        return new Response(JSON.stringify({ error: 'scan_id and question required' }), {
          status: 400,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Get scan text
      const { data: scan } = await supabase
        .from('student_scans')
        .select('normalized_text, file_name')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan || !scan.normalized_text) {
        await finalizeAiRoute({ sb, admission, statusCode: 404, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'scan_text_unavailable' })
        return new Response(JSON.stringify({ error: 'Scan text not available' }), {
          status: 404,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      // Call Foxy with scan context
      const claudeKey = Deno.env.get('ANTHROPIC_API_KEY')
      if (!claudeKey) {
        await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'ai_not_configured' })
        return new Response(JSON.stringify({ error: 'AI not configured' }), {
          status: 500,
          headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
        })
      }

      const systemPrompt = `You are Foxy, a friendly AI study buddy for Indian CBSE students. A student has scanned a document and wants your help understanding it.

SCANNED DOCUMENT: "${scan.file_name}"

EXTRACTED TEXT FROM SCAN:
---
${scan.normalized_text.slice(0, 4000)}
---

Based on this scanned document, help the student with their question. Be clear, educational, and encouraging. If the text seems like exam questions, help solve them step by step. If it's textbook content, explain it simply.`

      // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): scan-ocr answers questions from uploaded images; route through grounded-answer when a vision-input template is added.
      const aiRes = await fetchWithProviderTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: 'user', content: question }],
        }),
      })

      let foxyResponse = 'Sorry, I could not process your question right now.'
      if (aiRes.ok) {
        const aiData = await aiRes.json()
        foxyResponse = aiData.content?.[0]?.text || foxyResponse
      }

      // Save query
      await supabase.from('foxy_scan_queries').insert({
        student_id: student.id,
        scan_id,
        question,
        response: foxyResponse,
      })

      await finalizeAiRoute({ sb, admission, statusCode: 200, actualInputTokens: null, actualOutputTokens: null, actualCost: null })
      return new Response(JSON.stringify({
        question,
        response: foxyResponse,
        scan_id,
      }), { headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' } })
    }

    await finalizeAiRoute({ sb, admission, statusCode: 400, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'unknown_action' })
    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
    })

  } catch (err) {
    try {
      await finalizeAiRoute({ sb, admission, statusCode: 500, actualInputTokens: null, actualOutputTokens: null, actualCost: null, errorCode: 'internal_error' })
    } catch (finalizeErr) {
      console.error('[scan-ocr] finalize failed after error:', String(finalizeErr instanceof Error ? finalizeErr.message : finalizeErr))
    }
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...securityCorsHeaders(origin), 'Content-Type': 'application/json' },
    })
  }
})
