import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'packages/ui/src/v3/index.ts',
  'packages/ui/src/v3/foundations/tokens.css',
  'packages/ui/src/v3/shells/RoleShell.tsx',
  'packages/lib/src/experience-v3/index.ts',
  'packages/lib/src/use-experience-v3.ts',
  'apps/host/src/app/api/experience-v3/route.ts',
  'apps/host/src/app/dev/experience-v3/page.tsx',
];

const failures = [];
for (const file of required) if (!existsSync(resolve(root, file))) failures.push(`missing ${file}`);

const css = readFileSync(resolve(root, 'packages/ui/src/v3/foundations/tokens.css'), 'utf8');
if (!css.includes('@layer alfanumrik-v3')) failures.push('V3 cascade layer is missing');
if (!css.includes('[data-experience="v3"]')) failures.push('V3 root scope is missing');
if (/(^|\n)\s*(:root|html|body\s*\{)/m.test(css)) failures.push('V3 stylesheet contains an unscoped root selector');
if (!/\.v3-button\s*\{[^}]*min-height:\s*3rem/s.test(css)) failures.push('base V3 button does not guarantee a 48px touch target');
for (const utility of ['text-secondary-ink', 'text-deep-ink', 'text-action-orange', 'border-border']) {
  if (!css.includes(`.${utility}`)) failures.push(`missing scoped semantic utility ${utility}`);
}

const hook = readFileSync(resolve(root, 'packages/lib/src/use-experience-v3.ts'), 'utf8');
if (!hook.includes('/api/experience-v3')) failures.push('client gate bypasses server rollout resolver');
if (hook.includes('getFeatureFlags(')) failures.push('client gate directly evaluates simple feature flags');
if (!hook.includes('usePathname()') || !hook.includes('requestCache')) failures.push('client gate lacks route-aware request deduplication');

const preview = readFileSync(resolve(root, 'apps/host/src/app/dev/experience-v3/page.tsx'), 'utf8');
if (!preview.includes("process.env.NODE_ENV === 'production'") || !preview.includes('notFound()')) failures.push('preview route is not production denied');
if (!preview.includes('timingSafeEqual')) failures.push('preview code is not exact/timing-safe');
const proxy = readFileSync(resolve(root, 'apps/host/src/proxy.ts'), 'utf8');
if (!proxy.includes("pathname === '/dev/experience-v3'") || !proxy.includes('status: 404')) failures.push('proxy does not deny the V3 preview with a production HTTP 404');

const rootLayout = readFileSync(resolve(root, 'apps/host/src/app/layout.tsx'), 'utf8');
if (/id="main-content"/.test(rootLayout)) failures.push('root layout owns main-content and can duplicate the V3 main landmark');

const uiFiles = required.filter((file) => file.startsWith('packages/ui/'));
for (const file of uiFiles) {
  const source = readFileSync(resolve(root, file), 'utf8');
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/.test(source)) failures.push(`${file} references a privileged Supabase credential`);
}

if (failures.length) {
  console.error(`V3 frontend contract check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`V3 frontend contract check passed (${required.length} required files).`);
