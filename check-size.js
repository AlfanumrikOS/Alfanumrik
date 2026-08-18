const fs = require('fs');
const path = require('path');

// Exact .vercelignore patterns
const ignorePatterns = [
  'node_modules', 'flutter/', '.claude/', '.next/', 'apps/host/.next/',
  '.pnp*', '.pnpm-store', '*.tsbuildinfo',
  'coverage', '*.log', '.env*', '.DS_Store', 'Thumbs.db', '*.local',
  '.hermes/', 'fix-api-artifacts.py', 'scripts_*.js', 'scripts/*.js',
  '.git/', '.git', 'python/', 'tools/', 'graphify-out/', 'supabase/', 'e2e/',
  'engineering-audit/', 'artifacts/', 'AEOS/', 'openapi/', 'data/',
  'design-previews/', 'governance/', 'cbse_parser/',
  '.eslintrc.ai-boundary.json', '.eslintrc.json',
  'playwright.config.ts', 'vitest.config.ts', 'tsconfig.scripts.json',
  'next-env.d.ts', 'deno.lock', 'package-lock.json',
  'skills-lock.json', 'conftest.py', 'lefthook.yml', 'Dockerfile',
  'compose.debug.yaml', 'compose.yaml', 'deploy.ps1'
];

function matchesPattern(name, pattern) {
  if (pattern.endsWith('/')) {
    return name === pattern.slice(0, -1) || name.startsWith(pattern.slice(0, -1) + path.sep);
  }
  if (pattern.startsWith('.')) {
    return name === pattern || name.startsWith(pattern);
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return name.startsWith(prefix);
  }
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(name);
  }
  return name === pattern;
}

function isIgnored(relPath) {
  const parts = relPath.split(path.sep);
  // Check each path component against patterns
  for (let i = 0; i < parts.length; i++) {
    for (const p of ignorePatterns) {
      if (matchesPattern(parts[i], p)) return true;
    }
  }
  // Also check full relative path
  for (const p of ignorePatterns) {
    if (matchesPattern(relPath, p)) return true;
  }
  return false;
}

function calcSize(dir, depth) {
  let s = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const x of entries) {
      const f = path.join(dir, x.name);
      const rel = depth === 0 ? x.name : path.join(dir.substring(2), x.name);
      if (depth > 0 && isIgnored(rel)) continue;
      if (x.isDirectory()) {
        s += calcSize(f, depth + 1);
      } else {
        s += fs.statSync(f).size;
      }
    }
  } catch(e) {}
  return s;
}

const items = fs.readdirSync('.', { withFileTypes: true });
let total = 0;
const results = [];
for (const x of items) {
  if (isIgnored(x.name)) continue;
  const f = path.join('.', x.name);
  const s = x.isDirectory() ? calcSize(f, 1) : fs.statSync(f).size;
  total += s;
  results.push({ name: x.name, size: s, isDir: x.isDirectory() });
}
results.sort((a, b) => b.size - a.size);
for (const r of results) {
  const mb = (r.size / 1024 / 1024).toFixed(2);
  const flag = r.size > 10 * 1024 * 1024 ? ' <<< OVER 10MB' : '';
  console.log(mb + ' MB  ' + r.name + (r.isDir ? '/' : '') + flag);
}
console.log('');
console.log('TOTAL non-ignored: ' + (total / 1024 / 1024).toFixed(2) + ' MB');
console.log('LIMIT: 10 MB');
console.log('OVER: ' + (total > 10 * 1024 * 1024 ? 'YES by ' + ((total - 10*1024*1024)/1024/1024).toFixed(2) + ' MB' : 'NO'));
