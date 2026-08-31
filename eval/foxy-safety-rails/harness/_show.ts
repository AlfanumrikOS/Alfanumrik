import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
const OUT = path.resolve(__dirname, '../out');
const f = readdirSync(OUT).filter(x => x.startsWith('rails-run-')).sort().pop()!;
const run = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'));
const ids = process.argv.slice(2);
function flatten(raw: string): string {
  let o: any; try { o = JSON.parse(raw.replace(/```(?:json)?/g,'').trim()); } catch { return raw; }
  const parts: string[] = [];
  if (o.title) parts.push(`[title] ${o.title}`);
  for (const b of (o.blocks ?? [])) parts.push(`[${b.type}] ${b.text ?? JSON.stringify(b)}`);
  return parts.join('\n');
}
for (const id of ids) {
  for (const rev of ['rev3','rev4']) {
    const r = run.results.find((x: any) => x.case_id === id && x.rev === rev);
    console.log(`\n${'='.repeat(78)}\n${id}  ::  ${rev}\n${'='.repeat(78)}`);
    console.log(r?.raw_response ? flatten(r.raw_response) : `TRANSPORT ERROR: ${r?.transport_error}`);
  }
}
