import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { recoverFoxyResponseFromText } from '../../../packages/lib/src/foxy/recover-from-text';
const OUT = path.resolve(__dirname, '../out');
const f = readdirSync(OUT).filter(x => x.startsWith('rails-run-')).sort().pop()!;
const run = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
const pad=(s:any,n:number)=>String(s).padEnd(n);
console.log('CASE                 rev  recovered  blocks  discarded_prose_chars  discarded_prose_first_90');
for (const r of run.results) {
  const raw: string = r.raw_response ?? '';
  const rec = recoverFoxyResponseFromText(raw);
  const fenceIdx = raw.indexOf('```');
  const prose = fenceIdx > 0 ? raw.slice(0, fenceIdx).trim() : '';
  console.log(`${pad(r.case_id,20)} ${pad(r.rev,4)} ${pad(rec?'Y':'N',10)} ${pad(rec?rec.blocks.length:'-',7)} ${pad(prose.length,22)} ${JSON.stringify(prose.replace(/\s+/g,' ').slice(0,90))}`);
}
