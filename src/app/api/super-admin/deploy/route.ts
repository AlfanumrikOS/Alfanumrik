import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

/**
 * Deployment visibility API
 *
 * Returns build metadata and auto-records the current deployment
 * to deployment_history if not already recorded.
 */

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'unknown';
    const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || 'unknown';
    const commitAuthor = process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || 'unknown';
    const gitBranch = process.env.VERCEL_GIT_COMMIT_REF || 'unknown';
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || 'unknown';
    const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';
    const region = process.env.VERCEL_REGION || 'unknown';
    const appVersion = '2.0.0';

    // Auto-record this deployment if commit SHA is known and not already recorded
    if (commitSha !== 'unknown') {
      try {
        const checkRes = await fetch(
          supabaseAdminUrl('deployment_history', `select=id&commit_sha=eq.${commitSha}&limit=1`),
          { headers: supabaseAdminHeaders() }
        );
        const existing = checkRes.ok ? await checkRes.json() : [];
        if (Array.isArray(existing) && existing.length === 0) {
          await fetch(supabaseAdminUrl('deployment_history'), {
            method: 'POST',
            headers: supabaseAdminHeaders('return=minimal'),
            body: JSON.stringify({
              app_version: appVersion,
              commit_sha: commitSha,
              commit_message: commitMessage.slice(0, 500),
              commit_author: commitAuthor,
              branch: gitBranch,
              environment: vercelEnv,
              deployment_id: deploymentId,
              region,
              triggered_by: auth.userId,
              status: 'success',
            }),
          });
        }
      } catch { /* best effort */ }
    }

    return NextResponse.json({
      app_version: appVersion,
      environment: vercelEnv,
      region,
      deployment: {
        id: deploymentId,
        branch: gitBranch,
        commit_sha: commitSha,
        commit_message: commitMessage.slice(0, 200),
        commit_author: commitAuthor,
      },
      server_time: new Date().toISOString(),
      node_version: process.version,
      rollback_instructions: [
        '1. Go to Vercel Dashboard → Deployments',
        '2. Find the last known-good deployment',
        '3. Click "..." → "Promote to Production"',
        '4. Rolls back instantly (< 30 seconds)',
        '5. Verify via /api/v1/health',
      ],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
