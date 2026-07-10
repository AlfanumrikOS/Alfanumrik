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

    expect(dockerfile).toContain('COPY --from=builder /app/apps/host/public ./public');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/apps/host/.next/standalone ./');
    expect(dockerfile).toContain('COPY --from=builder --chown=nextjs:nodejs /app/apps/host/.next/static ./.next/static');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
    expect(dockerfile).not.toContain('CMD ["node", "apps/host/server.js"]');
  });
});
