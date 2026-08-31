import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { recoverFoxyResponseFromText } from '../../../packages/lib/src/foxy/recover-from-text';
const OUT = path.resolve(__dirname, '../out');
const files = readdirSync(OUT).filter(x => x.startsWith('rails-run-')).sort();
const pad=(s:any,n:number)=>String(s).padEnd(n);
console.log('RAIL-6 CASES ACROSS ' + files.length + ' RUNS');
console.log('run case                 rev   recovered  blocks  prose_before_fence  no_json_at_all');
const tally: Record<string, {n:number; prose:number; nojson:number; norecover:number}> = {};
files.forEach((f, ri) => {
  const run = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
  for (const r of run.results) {
    if (!r.case_id.startsWith('R6-')) continue;
    const raw: string = r.raw_response ?? '';
    const rec = recoverFoxyResponseFromText(raw);
    const fenceIdx = raw.indexOf('```');
    const noJson = !raw.includes('"blocks"');
    const prose = fenceIdx > 0 ? raw.slice(0, fenceIdx).trim().length : (noJson ? raw.trim().length : 0);
    const k = r.rev;
    tally[k] ??= {n:0,prose:0,nojson:0,norecover:0};
    tally[k].n++; if (prose>0) tally[k].prose++; if (noJson) tally[k].nojson++; if (!rec) tally[k].norecover++;
    console.log(`${ri+1}   ${pad(r.case_id,20)} ${pad(r.rev,5)} ${pad(rec?'Y':'N',10)} ${pad(rec?rec.blocks.length:'-',7)} ${pad(prose,19)} ${noJson?'Y':'-'}`);
  }
});
console.log('\nTALLY over rail-6 turns:');
for (const [k,v] of Object.entries(tally))
  console.log(`  ${k}: n=${v.n}  prose_before_json=${v.prose}  no_json_envelope=${v.nojson}  recovery_FAILED=${v.norecover}`);
