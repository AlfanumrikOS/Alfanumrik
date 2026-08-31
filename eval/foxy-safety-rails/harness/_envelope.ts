import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
const OUT = path.resolve(__dirname, '../out');
const f = readdirSync(OUT).filter(x => x.startsWith('rails-run-')).sort().pop()!;
const run = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
const pad=(s:any,n:number)=>String(s).padEnd(n);
console.log('CASE                 rev  starts_with_{  has_fence  prose_before_json_chars  strict_JSON.parse_ok');
let s3=0,s4=0,p3=0,p4=0;
for (const r of run.results) {
  const raw: string = r.raw_response ?? '';
  const startsBrace = raw.trimStart().startsWith('{');
  const fenceIdx = raw.indexOf('```');
  const hasFence = fenceIdx >= 0;
  const proseBefore = hasFence ? raw.slice(0, fenceIdx).trim().length : (startsBrace ? 0 : raw.trim().length);
  let strictOk = true; try { JSON.parse(raw.trim()); } catch { strictOk = false; }
  if (r.rev==='rev3'){ if(strictOk) s3++; if(proseBefore>0) p3++; } else { if(strictOk) s4++; if(proseBefore>0) p4++; }
  console.log(`${pad(r.case_id,20)} ${pad(r.rev,4)} ${pad(startsBrace?'Y':'N',14)} ${pad(hasFence?'Y':'N',10)} ${pad(proseBefore,24)} ${strictOk?'Y':'N'}`);
}
console.log(`\nstrict JSON.parse OK: rev3=${s3}/15  rev4=${s4}/15`);
console.log(`prose before JSON:    rev3=${p3}/15  rev4=${p4}/15`);
