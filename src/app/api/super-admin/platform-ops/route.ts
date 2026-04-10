import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

/**
 * Platform Operations API — deployment history, backup status, CMS assets
 *
 * GET  ?action=deployments|backups|assets
 * POST ?action=record_deployment|update_backup|upload_asset
 */

async function supabaseGet(table: string, params: string) {
  const res = await fetch(supabaseAdminUrl(table, params), { headers: supabaseAdminHeaders('count=exact') });
  const data = await res.json();
  const range = res.headers.get('content-range');
  return { data, total: range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0, ok: res.ok };
}

// GET
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'deployments';

  try {
    if (action === 'deployments') {
      const limit = Math.min(20, parseInt(params.get('limit') || '10'));
      const r = await supabaseGet('deployment_history',
        `select=id,app_version,commit_sha,commit_message,commit_author,branch,environment,status,deployed_at,notes&order=deployed_at.desc&limit=${limit}`
      );
      return NextResponse.json({ data: r.data, total: r.total });
    }

    if (action === 'backups') {
      const r = await supabaseGet('backup_status',
        'select=id,backup_type,status,provider,coverage,size_bytes,started_at,completed_at,verified_at,verified_by,notes,created_at&order=completed_at.desc.nullslast,created_at.desc&limit=10'
      );
      return NextResponse.json({ data: r.data, total: r.total });
    }

    if (action === 'assets') {
      const entityType = params.get('entity_type');
      const entityId = params.get('entity_id');
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      const limit = 25;
      const offset = (page - 1) * limit;

      const filters = ['is_active=eq.true'];
      if (entityType) filters.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
      if (entityId) filters.push(`entity_id=eq.${entityId}`);

      const r = await supabaseGet('cms_assets',
        `select=id,entity_type,entity_id,file_name,file_type,file_size,storage_path,alt_text,caption,uploaded_by,created_at&${filters.join('&')}&order=created_at.desc&offset=${offset}&limit=${limit}`
      );
      return NextResponse.json({ data: r.data, total: r.total, page });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action');

  try {
    const body = await request.json();

    // Record a deployment (called from CI/CD or manually)
    if (action === 'record_deployment') {
      const payload = {
        app_version: body.app_version || '2.0.0',
        commit_sha: body.commit_sha || process.env.VERCEL_GIT_COMMIT_SHA || null,
        commit_message: body.commit_message || process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
        commit_author: body.commit_author || process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || null,
        branch: body.branch || process.env.VERCEL_GIT_COMMIT_REF || null,
        environment: body.environment || process.env.VERCEL_ENV || 'production',
        deployment_id: body.deployment_id || process.env.VERCEL_DEPLOYMENT_ID || null,
        region: body.region || process.env.VERCEL_REGION || null,
        triggered_by: auth.userId,
        status: body.status || 'success',
        notes: body.notes || null,
      };

      const res = await fetch(supabaseAdminUrl('deployment_history'), {
        method: 'POST',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(payload),
      });

      if (!res.ok) return NextResponse.json({ error: 'Record failed' }, { status: 500 });
      const created = await res.json();
      await logAdminAudit(auth, 'deployment.recorded', 'deployment_history', Array.isArray(created) ? created[0]?.id : '', { version: payload.app_version, env: payload.environment });
      return NextResponse.json({ success: true, data: created }, { status: 201 });
    }

    // Update backup status
    if (action === 'update_backup') {
      const { id, updates } = body;
      if (!id || !updates) return NextResponse.json({ error: 'id and updates required' }, { status: 400 });

      const ALLOWED = ['status', 'completed_at', 'verified_at', 'notes', 'size_bytes', 'coverage'];
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (ALLOWED.includes(k)) safe[k] = v;
      }
      if (updates.status === 'verified' || updates.verified_at) {
        safe.verified_by = auth.userId;
        safe.verified_at = safe.verified_at || new Date().toISOString();
      }

      const res = await fetch(supabaseAdminUrl('backup_status', `id=eq.${id}`), {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(safe),
      });

      if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      await logAdminAudit(auth, 'backup.status_updated', 'backup_status', id, { updates: safe });
      return NextResponse.json({ success: true });
    }

    // Register a CMS asset (metadata only — file upload via Supabase Storage)
    if (action === 'register_asset') {
      const { entity_type, entity_id, file_name, file_type, file_size, storage_path, alt_text, caption } = body;
      if (!entity_type || !file_name || !file_type || !storage_path) {
        return NextResponse.json({ error: 'entity_type, file_name, file_type, storage_path required' }, { status: 400 });
      }

      const payload = {
        entity_type, entity_id: entity_id || null, file_name, file_type,
        file_size: file_size || null, storage_path, alt_text: alt_text || null,
        caption: caption || null, uploaded_by: auth.userId,
      };

      const res = await fetch(supabaseAdminUrl('cms_assets'), {
        method: 'POST',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(payload),
      });

      if (!res.ok) return NextResponse.json({ error: 'Register failed' }, { status: 500 });
      const created = await res.json();
      const assetId = Array.isArray(created) ? created[0]?.id : created?.id;
      await logAdminAudit(auth, 'cms.asset.registered', 'cms_assets', assetId || '', { file_name, entity_type, entity_id });
      return NextResponse.json({ success: true, data: created }, { status: 201 });
    }

    // Soft-delete an asset
    if (action === 'delete_asset') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const res = await fetch(supabaseAdminUrl('cms_assets', `id=eq.${id}`), {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({ is_active: false }),
      });

      if (!res.ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
      await logAdminAudit(auth, 'cms.asset.deleted', 'cms_assets', id, {});
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
