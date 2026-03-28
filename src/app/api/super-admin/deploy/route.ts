import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '../../../../lib/admin-auth';

/**
 * Deployment visibility API
 *
 * Returns build metadata, environment info, and rollback instructions.
 * Build-time values injected via Next.js env / Vercel system env vars.
 */

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Vercel injects these at build time
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'unknown';
    const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || 'unknown';
    const commitAuthor = process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || 'unknown';
    const gitBranch = process.env.VERCEL_GIT_COMMIT_REF || 'unknown';
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || 'unknown';
    const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';
    const vercelUrl = process.env.VERCEL_URL || 'unknown';
    const region = process.env.VERCEL_REGION || 'unknown';

    // App version from package.json (available at build time)
    const appVersion = '2.0.0'; // Matches package.json

    // Build timestamp (Vercel sets this)
    const buildTime = process.env.VERCEL_GIT_COMMIT_SHA
      ? new Date().toISOString() // Approximation — Vercel doesn't expose exact build time
      : 'unknown';

    return NextResponse.json({
      app_version: appVersion,
      environment: vercelEnv,
      region,
      deployment: {
        id: deploymentId,
        url: vercelUrl,
        branch: gitBranch,
        commit_sha: commitSha,
        commit_message: commitMessage.slice(0, 200),
        commit_author: commitAuthor,
      },
      server_time: new Date().toISOString(),
      node_version: process.version,
      rollback_instructions: [
        '1. Go to Vercel Dashboard → Alfanumrik → Deployments',
        '2. Find the last known-good deployment',
        '3. Click "..." → "Promote to Production"',
        '4. Deployment rolls back instantly (< 30 seconds)',
        '5. Verify via /api/v1/health endpoint',
      ],
      backup_info: {
        provider: 'Supabase',
        plan_feature: 'Daily automatic backups (Pro plan)',
        pitr: 'Point-in-Time Recovery available on Pro plan',
        manual: 'pg_dump via connection string',
        docs: 'docs/BACKUP_RESTORE.md',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
