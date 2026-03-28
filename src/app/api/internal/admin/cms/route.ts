import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl, type AdminAuth } from '../../../../../lib/admin-auth';

/**
 * CMS API — Full content management for Super Admin
 *
 * GET    ?action=topics|questions|subjects|hierarchy|versions|stats
 * POST   ?action=create_topic|create_question|transition|create_version|rollback
 * PATCH  ?action=update_topic|update_question
 *
 * All actions require admin session via authorizeAdmin().
 * All mutations are audit-logged with real user identity.
 */

async function supabaseGet(table: string, params: string) {
  const res = await fetch(supabaseAdminUrl(table, params), {
    headers: supabaseAdminHeaders('count=exact'),
  });
  const data = await res.json();
  const range = res.headers.get('content-range');
  const total = range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0;
  return { data, total, ok: res.ok };
}

async function supabasePost(table: string, body: Record<string, unknown>) {
  const res = await fetch(supabaseAdminUrl(table), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=representation'),
    body: JSON.stringify(body),
  });
  return { data: await res.json(), ok: res.ok, status: res.status };
}

async function supabasePatch(table: string, filter: string, body: Record<string, unknown>) {
  const res = await fetch(supabaseAdminUrl(table, filter), {
    method: 'PATCH',
    headers: supabaseAdminHeaders('return=representation'),
    body: JSON.stringify(body),
  });
  return { data: await res.json(), ok: res.ok };
}

// ─── GET ─────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'topics';

  try {
    // ── CMS Stats ──
    if (action === 'stats') {
      const [topics, questions, published, draft, review, archived] = await Promise.all([
        supabaseGet('curriculum_topics', 'select=id&limit=0&deleted_at=is.null'),
        supabaseGet('question_bank', 'select=id&limit=0&deleted_at=is.null'),
        supabaseGet('curriculum_topics', 'select=id&limit=0&content_status=eq.published&deleted_at=is.null'),
        supabaseGet('curriculum_topics', 'select=id&limit=0&content_status=eq.draft&deleted_at=is.null'),
        supabaseGet('curriculum_topics', 'select=id&limit=0&content_status=eq.review&deleted_at=is.null'),
        supabaseGet('curriculum_topics', 'select=id&limit=0&content_status=eq.archived&deleted_at=is.null'),
      ]);
      return NextResponse.json({
        topics: topics.total,
        questions: questions.total,
        workflow: { published: published.total, draft: draft.total, review: review.total, archived: archived.total },
      });
    }

    // ── Subjects list ──
    if (action === 'subjects') {
      const r = await supabaseGet('subjects', 'select=id,code,name,icon,color,is_active,display_order&order=display_order.asc');
      return NextResponse.json({ data: r.data, total: r.total });
    }

    // ── Hierarchy: topics for a grade+subject ──
    if (action === 'hierarchy') {
      const grade = params.get('grade') || '10';
      const subjectId = params.get('subject_id');
      if (!subjectId) return NextResponse.json({ error: 'subject_id required' }, { status: 400 });

      const fields = 'id,title,title_hi,parent_topic_id,chapter_number,display_order,topic_type,content_status,is_active,difficulty_level,bloom_focus,tags,created_at,updated_at';
      const r = await supabaseGet('curriculum_topics',
        `select=${fields}&subject_id=eq.${subjectId}&grade=eq.${encodeURIComponent(grade)}&deleted_at=is.null&order=chapter_number.asc.nullslast,display_order.asc`
      );
      return NextResponse.json({ data: r.data, total: r.total });
    }

    // ── Topics list with filters ──
    if (action === 'topics') {
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      const limit = Math.min(100, parseInt(params.get('limit') || '25'));
      const offset = (page - 1) * limit;
      const grade = params.get('grade');
      const subjectId = params.get('subject_id');
      const status = params.get('status');
      const search = params.get('search');

      const fields = 'id,title,title_hi,grade,subject_id,parent_topic_id,chapter_number,display_order,topic_type,content_status,is_active,difficulty_level,bloom_focus,tags,description,created_at,updated_at,created_by,updated_by,reviewed_by,published_by,published_at';
      const filters = ['deleted_at=is.null'];
      if (grade) filters.push(`grade=eq.${encodeURIComponent(grade)}`);
      if (subjectId) filters.push(`subject_id=eq.${subjectId}`);
      if (status) filters.push(`content_status=eq.${status}`);
      if (search) filters.push(`title=ilike.*${encodeURIComponent(search)}*`);

      const r = await supabaseGet('curriculum_topics',
        `select=${fields}&${filters.join('&')}&order=grade.asc,chapter_number.asc.nullslast,display_order.asc&offset=${offset}&limit=${limit}`
      );
      return NextResponse.json({ data: r.data, total: r.total, page, limit });
    }

    // ── Questions list with filters ──
    if (action === 'questions') {
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      const limit = Math.min(100, parseInt(params.get('limit') || '25'));
      const offset = (page - 1) * limit;
      const grade = params.get('grade');
      const subject = params.get('subject');
      const status = params.get('status');
      const difficulty = params.get('difficulty');
      const questionType = params.get('question_type');
      const search = params.get('search');

      const fields = 'id,question_text,question_hi,question_type,options,correct_answer_index,correct_answer_text,explanation,hint,difficulty,bloom_level,grade,subject,tags,marks,content_status,is_active,is_verified,created_at,updated_at,created_by,reviewed_by';
      const filters = ['deleted_at=is.null'];
      if (grade) filters.push(`grade=eq.${encodeURIComponent(grade)}`);
      if (subject) filters.push(`subject=eq.${encodeURIComponent(subject)}`);
      if (status) filters.push(`content_status=eq.${status}`);
      if (difficulty) filters.push(`difficulty=eq.${difficulty}`);
      if (questionType) filters.push(`question_type=eq.${encodeURIComponent(questionType)}`);
      if (search) filters.push(`question_text=ilike.*${encodeURIComponent(search)}*`);

      const r = await supabaseGet('question_bank',
        `select=${fields}&${filters.join('&')}&order=created_at.desc&offset=${offset}&limit=${limit}`
      );
      return NextResponse.json({ data: r.data, total: r.total, page, limit });
    }

    // ── Version history for an entity ──
    if (action === 'versions') {
      const entityType = params.get('entity_type');
      const entityId = params.get('entity_id');
      if (!entityType || !entityId) return NextResponse.json({ error: 'entity_type and entity_id required' }, { status: 400 });

      const r = await supabaseGet('cms_item_versions',
        `select=id,version_number,status,change_summary,created_by,reviewed_by,published_by,created_at,reviewed_at,published_at&entity_type=eq.${entityType}&entity_id=eq.${entityId}&order=version_number.desc`
      );
      return NextResponse.json({ data: r.data, total: r.total });
    }

    // ── Single version snapshot (for diff/rollback) ──
    if (action === 'version_detail') {
      const versionId = params.get('version_id');
      if (!versionId) return NextResponse.json({ error: 'version_id required' }, { status: 400 });

      const r = await supabaseGet('cms_item_versions',
        `select=*&id=eq.${versionId}&limit=1`
      );
      return NextResponse.json({ data: Array.isArray(r.data) ? r.data[0] : null });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action');

  try {
    const body = await request.json();

    // ── Create topic ──
    if (action === 'create_topic') {
      const ALLOWED = ['title', 'title_hi', 'description', 'grade', 'subject_id', 'parent_topic_id', 'chapter_number', 'display_order', 'topic_type', 'difficulty_level', 'bloom_focus', 'tags', 'board', 'estimated_minutes', 'learning_objectives', 'key_concepts', 'ncert_page_range'];
      const safe: Record<string, unknown> = {
        content_status: 'draft',
        created_by: auth.userId,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      };
      for (const [k, v] of Object.entries(body)) {
        if (ALLOWED.includes(k) && v !== undefined && v !== '') safe[k] = v;
      }
      if (!safe.title || !safe.grade || !safe.subject_id) {
        return NextResponse.json({ error: 'title, grade, and subject_id are required' }, { status: 400 });
      }

      const r = await supabasePost('curriculum_topics', safe);
      if (!r.ok) return NextResponse.json({ error: 'Create failed' }, { status: r.status });

      const created = Array.isArray(r.data) ? r.data[0] : r.data;
      // Create initial version snapshot
      await createVersionSnapshot(auth, 'topic', created.id, created, 'Initial creation');
      await logAdminAudit(auth, 'cms.topic.created', 'curriculum_topics', created.id, { title: safe.title, grade: safe.grade });
      return NextResponse.json({ data: created }, { status: 201 });
    }

    // ── Create question ──
    if (action === 'create_question') {
      const ALLOWED = ['question_text', 'question_hi', 'question_type', 'options', 'correct_answer_index', 'correct_answer_text', 'explanation', 'explanation_hi', 'hint', 'difficulty', 'bloom_level', 'grade', 'subject', 'topic_id', 'chapter_number', 'tags', 'marks', 'cbse_question_type', 'time_estimate_seconds', 'solution_steps', 'hint_level_1', 'hint_level_2', 'hint_level_3'];
      const safe: Record<string, unknown> = {
        content_status: 'draft',
        created_by: auth.userId,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
        is_active: true,
      };
      for (const [k, v] of Object.entries(body)) {
        if (ALLOWED.includes(k) && v !== undefined && v !== '') safe[k] = v;
      }
      if (!safe.question_text || !safe.grade || !safe.subject || !safe.options) {
        return NextResponse.json({ error: 'question_text, grade, subject, and options are required' }, { status: 400 });
      }

      const r = await supabasePost('question_bank', safe);
      if (!r.ok) return NextResponse.json({ error: 'Create failed' }, { status: r.status });

      const created = Array.isArray(r.data) ? r.data[0] : r.data;
      await createVersionSnapshot(auth, 'question', created.id, created, 'Initial creation');
      await logAdminAudit(auth, 'cms.question.created', 'question_bank', created.id, { grade: safe.grade, subject: safe.subject });
      return NextResponse.json({ data: created }, { status: 201 });
    }

    // ── Transition content status ──
    if (action === 'transition') {
      const { entity_type, entity_id, new_status, notes } = body;
      if (!entity_type || !entity_id || !new_status) {
        return NextResponse.json({ error: 'entity_type, entity_id, and new_status required' }, { status: 400 });
      }

      const table = entity_type === 'topic' ? 'curriculum_topics' : entity_type === 'question' ? 'question_bank' : null;
      if (!table) return NextResponse.json({ error: 'entity_type must be topic or question' }, { status: 400 });

      // Call the DB function for validated transition
      const res = await fetch(supabaseAdminUrl('rpc/transition_content_status'), {
        method: 'POST',
        headers: supabaseAdminHeaders('return=minimal'),
        body: JSON.stringify({
          p_table: table,
          p_id: entity_id,
          p_new_status: new_status,
          p_actor_id: auth.userId,
          p_notes: notes || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `Transition failed: ${text}` }, { status: 400 });
      }

      await logAdminAudit(auth, `cms.${entity_type}.${new_status}`, table, entity_id, { new_status, notes });
      return NextResponse.json({ success: true, new_status });
    }

    // ── Create version snapshot manually ──
    if (action === 'create_version') {
      const { entity_type, entity_id, change_summary } = body;
      if (!entity_type || !entity_id) {
        return NextResponse.json({ error: 'entity_type and entity_id required' }, { status: 400 });
      }

      // Fetch current state
      const table = entity_type === 'topic' ? 'curriculum_topics' : entity_type === 'question' ? 'question_bank' : null;
      if (!table) return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 });

      const current = await supabaseGet(table, `select=*&id=eq.${entity_id}&limit=1`);
      if (!Array.isArray(current.data) || current.data.length === 0) {
        return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      }

      const version = await createVersionSnapshot(auth, entity_type, entity_id, current.data[0], change_summary);
      await logAdminAudit(auth, 'cms.version.created', 'cms_item_versions', version?.id || entity_id, { entity_type, change_summary });
      return NextResponse.json({ data: version }, { status: 201 });
    }

    // ── Rollback to a previous version ──
    if (action === 'rollback') {
      const { version_id } = body;
      if (!version_id) return NextResponse.json({ error: 'version_id required' }, { status: 400 });

      // Get the version snapshot
      const vr = await supabaseGet('cms_item_versions', `select=*&id=eq.${version_id}&limit=1`);
      if (!Array.isArray(vr.data) || vr.data.length === 0) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }

      const version = vr.data[0];
      const table = version.entity_type === 'topic' ? 'curriculum_topics' : version.entity_type === 'question' ? 'question_bank' : null;
      if (!table) return NextResponse.json({ error: 'Invalid entity_type in version' }, { status: 400 });

      // Snapshot current state before rollback
      const currentData = await supabaseGet(table, `select=*&id=eq.${version.entity_id}&limit=1`);
      if (Array.isArray(currentData.data) && currentData.data.length > 0) {
        await createVersionSnapshot(auth, version.entity_type, version.entity_id, currentData.data[0], `Pre-rollback snapshot (rolling back to v${version.version_number})`);
      }

      // Apply the snapshot (excluding system fields)
      const snapshot = version.snapshot;
      const EXCLUDE = ['id', 'created_at', 'deleted_at', 'created_by'];
      const restore: Record<string, unknown> = {
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
        content_status: 'draft', // rollback always goes to draft for review
      };
      for (const [k, v] of Object.entries(snapshot)) {
        if (!EXCLUDE.includes(k)) restore[k] = v;
      }

      const result = await supabasePatch(table, `id=eq.${version.entity_id}`, restore);
      if (!result.ok) return NextResponse.json({ error: 'Rollback failed' }, { status: 500 });

      await logAdminAudit(auth, 'cms.rollback', table, version.entity_id, {
        rolled_back_to_version: version.version_number,
        version_id,
      });

      return NextResponse.json({ success: true, rolled_back_to: version.version_number });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ─── PATCH ───────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action');

  try {
    const body = await request.json();

    if (action === 'update_topic') {
      const { id, updates } = body;
      if (!id || !updates) return NextResponse.json({ error: 'id and updates required' }, { status: 400 });

      // Snapshot before update
      const before = await supabaseGet('curriculum_topics', `select=*&id=eq.${id}&limit=1`);
      if (Array.isArray(before.data) && before.data.length > 0) {
        await createVersionSnapshot(auth, 'topic', id, before.data[0], 'Auto-snapshot before edit');
      }

      const ALLOWED = ['title', 'title_hi', 'description', 'grade', 'subject_id', 'parent_topic_id', 'chapter_number', 'display_order', 'topic_type', 'difficulty_level', 'bloom_focus', 'tags', 'board', 'estimated_minutes', 'learning_objectives', 'key_concepts', 'ncert_page_range', 'is_active'];
      const safe: Record<string, unknown> = { updated_by: auth.userId, updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(updates)) {
        if (ALLOWED.includes(k)) safe[k] = v;
      }

      const r = await supabasePatch('curriculum_topics', `id=eq.${id}`, safe);
      if (!r.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

      await logAdminAudit(auth, 'cms.topic.updated', 'curriculum_topics', id, { fields_changed: Object.keys(safe) });
      return NextResponse.json({ data: Array.isArray(r.data) ? r.data[0] : r.data });
    }

    if (action === 'update_question') {
      const { id, updates } = body;
      if (!id || !updates) return NextResponse.json({ error: 'id and updates required' }, { status: 400 });

      // Snapshot before update
      const before = await supabaseGet('question_bank', `select=*&id=eq.${id}&limit=1`);
      if (Array.isArray(before.data) && before.data.length > 0) {
        await createVersionSnapshot(auth, 'question', id, before.data[0], 'Auto-snapshot before edit');
      }

      const ALLOWED = ['question_text', 'question_hi', 'question_type', 'options', 'correct_answer_index', 'correct_answer_text', 'explanation', 'explanation_hi', 'hint', 'difficulty', 'bloom_level', 'grade', 'subject', 'topic_id', 'chapter_number', 'tags', 'marks', 'cbse_question_type', 'time_estimate_seconds', 'solution_steps', 'is_active', 'is_verified'];
      const safe: Record<string, unknown> = { updated_by: auth.userId, updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(updates)) {
        if (ALLOWED.includes(k)) safe[k] = v;
      }

      const r = await supabasePatch('question_bank', `id=eq.${id}`, safe);
      if (!r.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

      await logAdminAudit(auth, 'cms.question.updated', 'question_bank', id, { fields_changed: Object.keys(safe) });
      return NextResponse.json({ data: Array.isArray(r.data) ? r.data[0] : r.data });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ─── Helper: Create version snapshot ─────────────────────────────────────────
async function createVersionSnapshot(
  admin: AdminAuth,
  entityType: string,
  entityId: string,
  snapshot: Record<string, unknown>,
  changeSummary?: string,
) {
  try {
    const res = await fetch(supabaseAdminUrl('rpc/create_cms_version'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_snapshot: snapshot,
        p_change_summary: changeSummary || null,
        p_created_by: admin.userId,
      }),
    });
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}
