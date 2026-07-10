#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const registryPath = resolve(process.cwd(), 'scripts/job-registry.json');
const summaryPath = resolve(process.cwd(), 'artifacts/production-cron-runner-summary.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const jobs = Array.isArray(registry.jobs) ? registry.jobs : [];
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const eventName = process.env.GITHUB_EVENT_NAME || 'local';
const eventSchedule = process.env.EVENT_SCHEDULE || '';
const requestedJobPath = process.env.JOB_PATH || '';
const targetUrl = trimTrailingSlash(process.env.TARGET_URL || 'https://alfanumrik.com');
const cronSecret = process.env.CRON_SECRET || '';
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const timeoutMs = Number(process.env.CRON_TIMEOUT_MS || 360_000);
const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;

validateRegistry(jobs);

const { selector, selectedJobs } = selectJobs(jobs, {
  eventName,
  eventSchedule,
  requestedJobPath,
});

if (selectedJobs.length === 0) {
  fail(`No production cron jobs matched selector ${selector}.`);
}

if (!dryRun && !cronSecret) {
  fail('CRON_SECRET is required for live production cron execution.');
}

console.log(`Production cron runner selector: ${selector}`);
console.log(`Target: ${targetUrl}`);
console.log(`Selected jobs: ${selectedJobs.map((job) => job.path).join(', ')}`);
console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`);

const startedAt = new Date().toISOString();
const results = [];

for (const [index, job] of selectedJobs.entries()) {
  const requestId = `github-cron-${runId}-${index + 1}-${slugify(job.path)}`;
  const result = await runJob(job, { index, requestId });
  results.push(result);

  const status = result.ok ? 'PASS' : 'FAIL';
  const httpStatus = result.http_status ?? 'n/a';
  console.log(`[${status}] ${job.path} http=${httpStatus} duration_ms=${result.duration_ms}`);
}

const failed = results.filter((result) => !result.ok);
const summary = {
  ok: failed.length === 0,
  dry_run: dryRun,
  selector,
  target_url: targetUrl,
  event_name: eventName,
  event_schedule: eventSchedule || null,
  requested_job_path: requestedJobPath || null,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  total_jobs: results.length,
  failed_jobs: failed.length,
  results,
};

mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
writeStepSummary(summary);

if (failed.length > 0) {
  process.exitCode = 1;
}

async function runJob(job, { index, requestId }) {
  if (dryRun) {
    return {
      path: job.path,
      schedule: job.schedule,
      owner: job.owner,
      ok: true,
      dry_run: true,
      request_id: requestId,
      http_status: null,
      duration_ms: 0,
      response_summary: { mode: 'dry_run' },
    };
  }

  const url = `${targetUrl}${job.path}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${cronSecret}`,
      'User-Agent': 'Alfanumrik-GitHubProductionCronRunner/1.0 (+https://github.com/AlfanumrikOS/Alfanumrik)',
      'x-cron-secret': cronSecret,
      'x-request-id': requestId,
    };

    if (bypassSecret) {
      headers['x-vercel-protection-bypass'] = bypassSecret;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const body = await response.text();
    const parsed = parseJson(body);
    const responseSummary = summarizeResponse(parsed, body);
    const explicitFailure = parsed && typeof parsed === 'object' && (
      parsed.ok === false ||
      parsed.success === false ||
      (typeof parsed.error === 'string' && !response.ok)
    );

    return {
      path: job.path,
      schedule: job.schedule,
      owner: job.owner,
      ok: response.ok && !explicitFailure,
      dry_run: false,
      request_id: requestId,
      http_status: response.status,
      duration_ms: Date.now() - started,
      response_summary: responseSummary,
    };
  } catch (error) {
    return {
      path: job.path,
      schedule: job.schedule,
      owner: job.owner,
      ok: false,
      dry_run: false,
      request_id: requestId,
      http_status: null,
      duration_ms: Date.now() - started,
      response_summary: {
        error_name: error?.name || 'Error',
        error_message: sanitizeErrorMessage(error?.message || String(error)),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function selectJobs(allJobs, { eventName, eventSchedule, requestedJobPath }) {
  if (eventName === 'schedule') {
    if (!eventSchedule) {
      fail('EVENT_SCHEDULE is required when GITHUB_EVENT_NAME=schedule.');
    }
    return {
      selector: `schedule:${eventSchedule}`,
      selectedJobs: allJobs.filter((job) => job.schedule === eventSchedule),
    };
  }

  if (requestedJobPath && requestedJobPath !== 'all') {
    return {
      selector: `path:${requestedJobPath}`,
      selectedJobs: allJobs.filter((job) => job.path === requestedJobPath),
    };
  }

  return {
    selector: 'all',
    selectedJobs: allJobs,
  };
}

function validateRegistry(allJobs) {
  if (allJobs.length === 0) {
    fail('scripts/job-registry.json does not contain any jobs.');
  }

  for (const job of allJobs) {
    for (const field of ['path', 'schedule', 'owner', 'lastSuccessMetric']) {
      if (!job[field] || typeof job[field] !== 'string') {
        fail(`Invalid job registry entry: ${JSON.stringify(job)}`);
      }
    }

    if (!job.path.startsWith('/')) {
      fail(`Job path must be absolute: ${job.path}`);
    }
  }
}

function summarizeResponse(parsed, body) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      type: 'non_json_or_array',
      body_length: body.length,
    };
  }

  const keys = Object.keys(parsed).sort();
  const flags = {};
  const counts = {};

  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === 'boolean' && ['ok', 'success', 'dryRun'].includes(key)) {
      flags[key] = value;
    }

    if (
      /count|processed|updated|created|deleted|sent|failed|fixed|total|errors/i.test(key) &&
      (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    ) {
      counts[key] = value;
    }
  }

  return {
    type: 'json_object',
    keys: keys.slice(0, 40),
    flags,
    counts,
  };
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function writeStepSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;

  const rows = summary.results
    .map((result) => {
      const state = result.ok ? 'PASS' : 'FAIL';
      const httpStatus = result.http_status ?? 'n/a';
      return `| ${result.path} | ${state} | ${httpStatus} | ${result.duration_ms} |`;
    })
    .join('\n');

  const body = [
    '## Production Cron Runner',
    '',
    `Selector: \`${summary.selector}\``,
    `Target: \`${summary.target_url}\``,
    `Dry run: \`${summary.dry_run}\``,
    '',
    '| Path | Result | HTTP | Duration ms |',
    '|------|--------|------|-------------|',
    rows,
    '',
    `Summary artifact: \`${summaryPath}\``,
    '',
  ].join('\n');

  writeFileSync(path, body, { flag: 'a' });
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function slugify(value) {
  return value.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function sanitizeErrorMessage(message) {
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
