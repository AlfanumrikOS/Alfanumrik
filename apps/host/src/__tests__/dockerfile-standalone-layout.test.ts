import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

describe('AWS Docker standalone runtime layout', () => {
  it('starts the Next standalone server from the copied root layout', () => {
    const dockerfile = readFileSync(repoPath('Dockerfile'), 'utf8');
    const nextConfig = readFileSync(repoPath('apps/host/next.config.js'), 'utf8');
    const deployAwsWorkflow = readFileSync(repoPath('.github/workflows/deploy-aws.yml'), 'utf8');
    const healthRoute = readFileSync(repoPath('apps/host/src/app/api/v1/health/route.ts'), 'utf8');

    expect(dockerfile).toContain('COPY --from=builder /app/apps/host/public ./apps/host/public');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/apps/host/.next/standalone ./');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/apps/host/.next/static ./apps/host/.next/static');
    expect(dockerfile).toContain('CMD ["node", "apps/host/server.js"]');
    expect(dockerfile).not.toContain('CMD ["node", "server.js"]');
    expect(dockerfile).toContain('ARG DEPLOY_GIT_SHA');
    expect(dockerfile).toContain('ENV DEPLOY_GIT_SHA=$DEPLOY_GIT_SHA');
    expect(nextConfig).toContain("const path = require('path')");
    expect(nextConfig).toContain("const repoRoot = path.join(__dirname, '../..')");
    expect(nextConfig).toContain('outputFileTracingRoot: repoRoot');
    expect(nextConfig).toContain('root: repoRoot');
    expect(healthRoute).toContain('process.env.DEPLOY_GIT_SHA');
    expect(deployAwsWorkflow).toContain('--build-arg DEPLOY_GIT_SHA="${GITHUB_SHA}"');
    expect(deployAwsWorkflow).toContain('BODY_OK=$(echo "$BODY" | jq -r');
    expect(deployAwsWorkflow).toContain('if [ "$BODY_OK" = "true" ] && [ "$BODY_STATUS" = "healthy" ]; then');
  });
});
