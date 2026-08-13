#!/usr/bin/env node
/**
 * ALFANUMRIK — one-time Twilio Content resource provisioning for the
 * WhatsApp study bot (fixes the launch blocker recorded in
 * whatsapp_message_log 2026-07-30: "Twilio interactive_* send requires a
 * pre-created content_sid").
 *
 * Creates GENERIC, shape-keyed Content resources whose variable layout
 * matches EXACTLY the positional convention in
 * supabase/functions/_shared/whatsapp/twilio-transport.ts
 * (buildContentVariables). Change the two together or substitution
 * silently misfires:
 *
 *   quick-reply qr<N>:  {{1}}=body, then per button k (1-based):
 *                       {{2k}}=id, {{2k+1}}=title
 *   list-picker list<N>: {{1}}=body, {{2}}=button label, then per item k:
 *                       {{3k}}=id, {{3k+1}}=title, {{3k+2}}=description
 *
 * Ids are templated (Twilio supports variables in the id field) so the
 * reply's ButtonPayload carries the bot's private opcode space
 * (d6:a:<q>:<opt>, subj:<code>, ...) that the webhook intent classifier
 * (packages/lib/src/whatsapp/intent.ts) depends on.
 *
 * Shapes provisioned (from actual daily6.ts senders):
 *   qr2          — menuMessage (Daily 6 / Help)
 *   qr3          — doubt-ladder buttons (db:next / db:stuck / db:got, later phase)
 *   list1..list10 — questionMessage (always 4 items) + subjectPickerMessage
 *                  (1..10 items, first row may carry a description)
 *
 * Usage (run locally; NEVER commit credentials):
 *   TWILIO_ACCOUNT_SID=ACxxx TWILIO_AUTH_TOKEN=xxx node scripts/whatsapp/provision-twilio-content.mjs
 *
 * Idempotent: existing resources are matched by friendly_name and reused,
 * never recreated. On completion prints the JSON value to store as the
 * TWILIO_CONTENT_SID_MAP secret on the whatsapp-send Supabase Edge Function:
 *   npx supabase secrets set TWILIO_CONTENT_SID_MAP='<printed JSON>'
 *
 * In-session interactive messages need NO WhatsApp template approval —
 * Content resources are usable immediately after creation (only
 * out-of-window template sends require Meta approval).
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in the environment.');
  process.exit(1);
}

const AUTH_HEADER = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
const CONTENT_API = 'https://content.twilio.com/v1/Content';
const NAME_PREFIX = 'alfanumrik_wa_';

/** Build the quick-reply definition for N buttons (2..3). */
function quickReplyDefinition(n) {
  const variables = { 1: 'What would you like to do?' };
  const actions = [];
  for (let k = 1; k <= n; k++) {
    variables[2 * k] = `sample_id_${k}`;
    variables[2 * k + 1] = `Option ${k}`;
    actions.push({ id: `{{${2 * k}}}`, title: `{{${2 * k + 1}}}` });
  }
  return {
    friendly_name: `${NAME_PREFIX}qr${n}`,
    language: 'en',
    variables: Object.fromEntries(Object.entries(variables).map(([k, v]) => [String(k), v])),
    types: { 'twilio/quick-reply': { body: '{{1}}', actions } },
  };
}

/** Build the list-picker definition for N items (1..10). */
function listPickerDefinition(n) {
  const variables = { 1: 'Which subject for today?', 2: 'Choose' };
  const items = [];
  for (let k = 1; k <= n; k++) {
    variables[3 * k] = `sample_id_${k}`;
    variables[3 * k + 1] = `Item ${k}`;
    variables[3 * k + 2] = `Description ${k}`;
    items.push({
      id: `{{${3 * k}}}`,
      item: `{{${3 * k + 1}}}`,
      description: `{{${3 * k + 2}}}`,
    });
  }
  return {
    friendly_name: `${NAME_PREFIX}list${n}`,
    language: 'en',
    variables: Object.fromEntries(Object.entries(variables).map(([k, v]) => [String(k), v])),
    types: { 'twilio/list-picker': { body: '{{1}}', button: '{{2}}', items } },
  };
}

/** Map friendly_name → sid for all existing resources (paged). */
async function fetchExisting() {
  const existing = new Map();
  let url = `${CONTENT_API}?PageSize=100`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: AUTH_HEADER } });
    if (!res.ok) throw new Error(`Content list failed: HTTP ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const c of json.contents ?? []) {
      if (c.friendly_name && c.sid) existing.set(c.friendly_name, c.sid);
    }
    url = json.meta?.next_page_url ?? null;
  }
  return existing;
}

async function createContent(definition) {
  const res = await fetch(CONTENT_API, {
    method: 'POST',
    headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });
  if (!res.ok) {
    throw new Error(`Create ${definition.friendly_name} failed: HTTP ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.sid;
}

async function main() {
  const definitions = [
    quickReplyDefinition(2),
    quickReplyDefinition(3),
    ...Array.from({ length: 10 }, (_, i) => listPickerDefinition(i + 1)),
  ];

  console.log('Checking existing Content resources…');
  const existing = await fetchExisting();

  const sidMap = {};
  for (const def of definitions) {
    const key = def.friendly_name.slice(NAME_PREFIX.length); // qr2 / list4 / …
    const found = existing.get(def.friendly_name);
    if (found) {
      console.log(`  reuse  ${def.friendly_name} → ${found}`);
      sidMap[key] = found;
      continue;
    }
    const sid = await createContent(def);
    console.log(`  create ${def.friendly_name} → ${sid}`);
    sidMap[key] = sid;
  }

  console.log('\nAll resources ready. Set this as the whatsapp-send Edge Function secret:\n');
  console.log(`TWILIO_CONTENT_SID_MAP='${JSON.stringify(sidMap)}'`);
  console.log('\ne.g.  npx supabase secrets set TWILIO_CONTENT_SID_MAP=\'…\'  (project shktyoxqhundlvkiwguu)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
