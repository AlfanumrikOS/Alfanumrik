import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

// ── OCR via Tesseract.js WASM (runs in Edge Function) ──
// For MVP: use Google Vision API or Tesseract
// Practical choice: Use built-in fetch to a free OCR API
// or process text extraction from the image directly

async function extractTextFromImage(imageUrl: string, supabase: any): Promise<{ text: string; confidence: number }> {
  try {
    // Download the image from storage
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error('Failed to download image')
    const imageBuffer = await response.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))

    // Try Google Cloud Vision API if key is available
    const visionKey = Deno.env.get('GOOGLE_VISION_API_KEY')
    if (visionKey) {
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
        {
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

    const ocrRes = await fetch('https://api.ocr.space/parse/image', {
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: student } = await supabase
      .from('students').select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
    if (!student) {
      return new Response(JSON.stringify({ error: 'Student not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json()
    const action = body.action

    // ── UPLOAD AND PROCESS ──
    if (action === 'upload_and_process') {
      const { file_name, file_type, storage_path } = body
      if (!file_name || !storage_path) {
        return new Response(JSON.stringify({ error: 'file_name and storage_path required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
        return new Response(JSON.stringify({ error: 'Failed to create scan record' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Get signed URL for the file
      const { data: signedUrl } = await supabase.storage
        .from('student-scans')
        .createSignedUrl(storage_path, 300) // 5 min

      if (!signedUrl?.signedUrl) {
        await supabase.from('student_scans').update({ status: 'failed', error_message: 'Could not access file' }).eq('id', scan.id)
        return new Response(JSON.stringify({ error: 'File not accessible', scan_id: scan.id }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Run OCR
      const { text, confidence } = await extractTextFromImage(signedUrl.signedUrl, supabase)

      if (!text) {
        await supabase.from('student_scans').update({
          status: 'failed',
          error_message: 'OCR could not extract text from this image',
          updated_at: new Date().toISOString(),
        }).eq('id', scan.id)

        return new Response(JSON.stringify({
          scan_id: scan.id,
          status: 'failed',
          message: 'Could not extract text. Try a clearer image.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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

      return new Response(JSON.stringify({
        scan_id: scan.id,
        status: 'completed',
        text_preview: normalized.slice(0, 500),
        confidence,
        char_count: normalized.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── GET SCANS ──
    if (action === 'get_scans') {
      const page = body.page || 1
      const limit = 10
      const offset = (page - 1) * limit

      const { data: scans, count } = await supabase
        .from('student_scans')
        .select('id, file_name, file_type, status, ocr_confidence, created_at, updated_at', { count: 'exact' })
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      return new Response(JSON.stringify({ data: scans || [], total: count || 0, page }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── GET SINGLE SCAN ──
    if (action === 'get_scan') {
      const { scan_id } = body
      if (!scan_id) {
        return new Response(JSON.stringify({ error: 'scan_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: scan } = await supabase
        .from('student_scans')
        .select('*')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan) {
        return new Response(JSON.stringify({ error: 'Scan not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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

      return new Response(JSON.stringify({ ...scan, image_url: imageUrl, queries: queries || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── RETRY OCR ──
    if (action === 'retry_ocr') {
      const { scan_id } = body
      const { data: scan } = await supabase
        .from('student_scans')
        .select('id, storage_path, status')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan) {
        return new Response(JSON.stringify({ error: 'Scan not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      await supabase.from('student_scans').update({ status: 'processing', error_message: null }).eq('id', scan.id)

      const { data: signedUrl } = await supabase.storage.from('student-scans').createSignedUrl(scan.storage_path, 300)
      if (!signedUrl?.signedUrl) {
        await supabase.from('student_scans').update({ status: 'failed', error_message: 'File not accessible' }).eq('id', scan.id)
        return new Response(JSON.stringify({ error: 'File not accessible' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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

      return new Response(JSON.stringify({
        scan_id: scan.id,
        status: text ? 'completed' : 'failed',
        text_preview: normalized ? normalized.slice(0, 500) : null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── ASK FOXY ──
    if (action === 'ask_foxy') {
      const { scan_id, question } = body
      if (!scan_id || !question) {
        return new Response(JSON.stringify({ error: 'scan_id and question required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Get scan text
      const { data: scan } = await supabase
        .from('student_scans')
        .select('normalized_text, file_name')
        .eq('id', scan_id)
        .eq('student_id', student.id)
        .single()

      if (!scan || !scan.normalized_text) {
        return new Response(JSON.stringify({ error: 'Scan text not available' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Call Foxy with scan context
      const claudeKey = Deno.env.get('ANTHROPIC_API_KEY')
      if (!claudeKey) {
        return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const systemPrompt = `You are Foxy, a friendly AI study buddy for Indian CBSE students. A student has scanned a document and wants your help understanding it.

SCANNED DOCUMENT: "${scan.file_name}"

EXTRACTED TEXT FROM SCAN:
---
${scan.normalized_text.slice(0, 4000)}
---

Based on this scanned document, help the student with their question. Be clear, educational, and encouraging. If the text seems like exam questions, help solve them step by step. If it's textbook content, explain it simply.`

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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

      return new Response(JSON.stringify({
        question,
        response: foxyResponse,
        scan_id,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
