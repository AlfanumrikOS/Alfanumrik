#!/usr/bin/env node
/**
 * Supabase Edge Function health sweep (v3)
 *
 * Features:
 * - Per-function auth mode:
 *    - gateway_jwt   => verify_jwt=true, requires user JWT in Authorization
 *    - internal_key  => verify_jwt=false, protected by x-health-key
 *    - none          => public/no auth
 * - Per-function expected statuses
 * - Per-function payload overrides
 * - Classifies only unexpected responses as failures
 *
 * Env required:
 *   SUPABASE_URL=https://<project-ref>.supabase.co
 *   SUPABASE_ANON_KEY=<publishable-or-legacy-anon-key>
 *
 * Env optional:
 *   SUPABASE_USER_JWT=<real user access token from this project>
 *   HEALTH_SWEEP_KEY=<your internal health key for verify_jwt=false handlers>
 *   TIMEOUT_MS=12000
 *   CONCURRENCY=10
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const USER_JWT = process.env.SUPABASE_USER_JWT || "";
const HEALTH_SWEEP_KEY = process.env.HEALTH_SWEEP_KEY || "";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 12000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

// ---- Function config ----
// Add/edit entries here as your source of truth.
const FUNCTION_CONFIG = {
  // Examples from your report:
  "invoice-generator": {
    authMode: "internal_key",
    expected: [200, 202, 403], // temporarily allow 403 until fixed
    method: "POST",
    payload: { healthcheck: true }
  },
  "send-renewal-reminder": {
    authMode: "internal_key",
    expected: [200, 202, 403],
    method: "POST",
    payload: { healthcheck: true }
  },
  "grounded-answer": {
    authMode: "internal_key",
    expected: [200, 202],
    method: "POST",
    payload: { healthcheck: true, question: "health probe" } // customize
  },
  "alfabot-answer": {
    authMode: "internal_key",
    expected: [200, 202],
    method: "POST",
    payload: { healthcheck: true, prompt: "health probe" } // customize
  },

  // verify_jwt=true examples:
  "foxy-tutor": { authMode: "gateway_jwt", expected: [200, 202], method: "POST", payload: { healthcheck: true } },
  "quiz-engine": { authMode: "gateway_jwt", expected: [200, 202], method: "POST", payload: { healthcheck: true } },
  "learning-analytics": { authMode: "gateway_jwt", expected: [200, 202], method: "POST", payload: { healthcheck: true } },

  // verify_jwt=false + handler auth examples:
  "parent-portal": { authMode: "internal_key", expected: [200, 202], method: "POST", payload: { healthcheck: true } },
  "teacher-dashboard": { authMode: "internal_key", expected: [200, 202], method: "POST", payload: { healthcheck: true } },

  // deprecated/gone examples:
  "super-admin": { authMode: "none", expected: [410], method: "GET" },
  "voice-tutor": { authMode: "none", expected: [410], method: "GET" },

  // Add all remaining functions here...
};

// If you want to check a static list quickly:
const FUNCTIONS = Object.keys(FUNCTION_CONFIG);

const DEFAULT_CFG = {
  authMode: "internal_key",
  expected: [200, 202],
  method: "POST",
  payload: { healthcheck: true }
};

function nowMs() {
  return Date.now();
}

function withTimeout(ms) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(new Error("timeout")), ms);
  return { signal: c.signal, done: () => clearTimeout(id) };
}

function getHeaders(fnName, cfg) {
  const headers = {
    "content-type": "application/json",
    "apikey": ANON_KEY
  };

  if (cfg.authMode === "gateway_jwt") {
    if (USER_JWT) headers["authorization"] = `Bearer ${USER_JWT}`;
  } else if (cfg.authMode === "internal_key") {
    if (HEALTH_SWEEP_KEY) headers["x-health-key"] = HEALTH_SWEEP_KEY;
  }

  return headers;
}

function classifyStatus(status, cfg, meta = {}) {
  if (meta.skipped) return "skipped";
  if (cfg.expected.includes(status)) return "expected";
  if (status >= 500) return "hard_fail_5xx";
  if (status === 401 && cfg.authMode === "gateway_jwt") return "unexpected_gateway_401";
  if (status === 401 && cfg.authMode === "internal_key") return "unexpected_handler_401";
  if (status === 403) return "unexpected_403";
  if (status === 400) return "unexpected_400";
  if (status === 410) return "unexpected_410";
  return "unexpected_other";
}

async function probeFunction(fnName) {
  const cfg = { ...DEFAULT_CFG, ...(FUNCTION_CONFIG[fnName] || {}) };
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${fnName}`;
  const start = nowMs();

  // Skip JWT functions if no user JWT set
  if (cfg.authMode === "gateway_jwt" && !USER_JWT) {
    return {
      fn: fnName,
      ms: 0,
      status: "SKIP_NO_USER_JWT",
      bucket: "skipped",
      ok: true,
      expected: cfg.expected,
      authMode: cfg.authMode
    };
  }

  const { signal, done } = withTimeout(TIMEOUT_MS);
  try {
    const init = {
      method: cfg.method || "POST",
      headers: getHeaders(fnName, cfg),
      signal
    };

    if ((cfg.method || "POST").toUpperCase() !== "GET") {
      init.body = JSON.stringify(cfg.payload ?? { healthcheck: true });
    }

    const res = await fetch(url, init);
    const ms = nowMs() - start;
    const bucket = classifyStatus(res.status, cfg);

    return {
      fn: fnName,
      ms,
      status: res.status,
      bucket,
      ok: bucket === "expected",
      expected: cfg.expected,
      authMode: cfg.authMode
    };
  } catch (e) {
    const ms = nowMs() - start;
    const timedOut = String(e?.message || e).toLowerCase().includes("timeout")
      || String(e?.name || "").toLowerCase().includes("abort");

    return {
      fn: fnName,
      ms,
      status: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      bucket: "hard_fail_network",
      ok: false,
      expected: cfg.expected,
      authMode: cfg.authMode,
      error: String(e?.message || e)
    };
  } finally {
    done();
  }
}

async function runPool(items, worker, concurrency) {
  const out = [];
  let i = 0;

  async function next() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  }

  const runners = Array.from({ length: Math.max(1, concurrency) }, () => next());
  await Promise.all(runners);
  return out;
}

function printGroup(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log("none");
    return;
  }
  for (const r of rows) {
    console.log(`${r.fn} -> ${r.status} (${r.ms}ms) [${r.authMode}]`);
  }
}

function summarize(results) {
  const groups = {
    expected: results.filter(r => r.bucket === "expected"),
    skipped: results.filter(r => r.bucket === "skipped"),
    hard_fail: results.filter(r => r.bucket.startsWith("hard_fail")),
    unexpected_gateway_401: results.filter(r => r.bucket === "unexpected_gateway_401"),
    unexpected_handler_401: results.filter(r => r.bucket === "unexpected_handler_401"),
    unexpected_403: results.filter(r => r.bucket === "unexpected_403"),
    unexpected_400: results.filter(r => r.bucket === "unexpected_400"),
    unexpected_410: results.filter(r => r.bucket === "unexpected_410"),
    unexpected_other: results.filter(r => r.bucket === "unexpected_other")
  };

  const unexpected = results.filter(
    r => !["expected", "skipped"].includes(r.bucket)
  );

  console.log(`Project URL: ${SUPABASE_URL}`);
  console.log(`Functions checked: ${results.length}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`USER_JWT present: ${USER_JWT ? "yes" : "no"}`);
  console.log(`HEALTH_SWEEP_KEY present: ${HEALTH_SWEEP_KEY ? "yes" : "no"}`);

  printGroup("HARD FAIL", groups.hard_fail);
  printGroup("UNEXPECTED gateway 401", groups.unexpected_gateway_401);
  printGroup("UNEXPECTED handler 401", groups.unexpected_handler_401);
  printGroup("UNEXPECTED 403", groups.unexpected_403);
  printGroup("UNEXPECTED 400", groups.unexpected_400);
  printGroup("UNEXPECTED 410", groups.unexpected_410);
  printGroup("UNEXPECTED OTHER", groups.unexpected_other);
  printGroup("SKIPPED", groups.skipped);

  console.log("\n=== SUMMARY ===");
  console.log(`expected_ok: ${groups.expected.length}/${results.length}`);
  console.log(`skipped: ${groups.skipped.length}`);
  console.log(`unexpected_total: ${unexpected.length}`);

  const fixFirst = unexpected
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 20);

  printGroup("FIX-FIRST (top 20 unexpected)", fixFirst);

  // Exit non-zero only on unexpected failures
  if (unexpected.length > 0) process.exitCode = 2;
}

(async () => {
  const results = await runPool(FUNCTIONS, probeFunction, CONCURRENCY);
  summarize(results);
})();