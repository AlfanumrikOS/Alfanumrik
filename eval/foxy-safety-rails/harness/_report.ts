import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
const OUT = path.resolve(__dirname, '../out');
const f = readdirSync(OUT).filter(x => x.startsWith('rails-run-')).sort().pop()!;
const run = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
const by: Record<string, any> = {};
for (const r of run.results) by[`${r.case_id}|${r.rev}`] = r;
const ids = [...new Set(run.results.map((r: any) => r.case_id))] as string[];
const pad = (s: any, n: number) => String(s).padEnd(n);
console.log('CASE                 RISK                              | rev3 words blocks parsed refus prefix deva brkt | rev4 words blocks parsed refus prefix deva brkt');
for (const id of ids) {
  const a = by[`${id}|rev3`], b = by[`${id}|rev4`];
  const fmt = (r: any) => r?.checks
    ? `${pad(r.checks.textWords,5)} ${pad(r.checks.blockCount,6)} ${pad(r.checks.parsed?'Y':'N',6)} ${pad(r.checks.hasExactEnglishRefusal?'Y':'-',5)} ${pad(r.checks.hasEmptyCorpusPrefix?'Y':'-',6)} ${pad(r.checks.hasDevanagari?'Y':'-',4)} ${pad(r.checks.bracketMarkerLeak.length,4)}`
    : 'ERR';
  console.log(`${pad(id,20)} ${pad(a?.risk ?? '',33)} | ${fmt(a)} | ${fmt(b)}`);
}
console.log('\n=== parse failures ===');
for (const r of run.results) if (r.checks && !r.checks.parsed) console.log(r.case_id, r.rev, r.checks.parseError);
console.log('\n=== hindi refusal stem present ===');
for (const r of run.results) if (r.checks?.hasHindiRefusal) console.log(r.case_id, r.rev);
console.log('\n=== chapter-citation leaks ===');
for (const r of run.results) if (r.checks?.chapterCitationLeak?.length) console.log(r.case_id, r.rev, JSON.stringify(r.checks.chapterCitationLeak));
console.log('\n=== word-count delta rev4-rev3 ===');
let d=0,n=0;
for (const id of ids) { const a=by[`${id}|rev3`],b=by[`${id}|rev4`]; if(a?.checks&&b?.checks){const x=b.checks.textWords-a.checks.textWords; d+=x;n++; console.log(pad(id,20), pad(a.checks.textWords,5), '->', pad(b.checks.textWords,5), (x>0?'+':'')+x);} }
console.log('mean delta:', (d/n).toFixed(1), 'words');
