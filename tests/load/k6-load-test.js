/**
 * ALFANUMRIK — Load Test (k6)
 *
 * Simulates 5,000 concurrent students using the platform.
 *
 * Install: brew install k6  (or download from https://k6.io)
 * Run:     k6 run tests/load/k6-load-test.js
 * Cloud:   k6 cloud tests/load/k6-load-test.js
 *
 * Scenarios:
 *  1. Dashboard browsing (60% of traffic)
 *  2. Quiz sessions (20% of traffic)
 *  3. Foxy AI chat (15% of traffic)
 *  4. Study plan management (5% of traffic)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom Metrics ──
const errorRate = new Rate('errors');
const dashboardLatency = new Trend('dashboard_latency', true);
const quizLatency = new Trend('quiz_latency', true);
const foxyLatency = new Trend('foxy_chat_latency', true);
const healthCheckErrors = new Counter('health_check_errors');

// ── Configuration ──
const BASE_URL = __ENV.BASE_URL || 'https://alfanumrik.vercel.app';
const SUPABASE_URL = __ENV.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

export const options = {
  scenarios: {
    // Ramp up to 5000 concurrent users over 10 minutes
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 500 },    // Warm up
        { duration: '3m', target: 2000 },   // Ramp to 2K
        { duration: '5m', target: 5000 },   // Full load
        { duration: '5m', target: 5000 },   // Sustain
        { duration: '2m', target: 0 },      // Cool down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // SLA targets
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],   // 95th < 3s, 99th < 5s
    errors: ['rate<0.05'],                               // Error rate < 5%
    dashboard_latency: ['p(95)<2000'],                   // Dashboard < 2s
    quiz_latency: ['p(95)<2000'],                        // Quiz load < 2s
    foxy_chat_latency: ['p(95)<8000'],                   // AI chat < 8s (includes model inference)
  },
};

// ── Helper: Common headers ──
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-alfanumrik-load-test',
  };
}

// ── Scenario 1: Dashboard Browsing (60%) ──
function browseDashboard() {
  const start = Date.now();

  // Load main page
  const res = http.get(`${BASE_URL}/`, { headers: getHeaders(), tags: { name: 'dashboard' } });
  check(res, {
    'dashboard status 200': (r) => r.status === 200,
    'dashboard has content': (r) => r.body && r.body.length > 0,
  }) || errorRate.add(1);

  dashboardLatency.add(Date.now() - start);
  sleep(Math.random() * 3 + 1); // 1-4s think time
}

// ── Scenario 2: Quiz Session (20%) ──
function takeQuiz() {
  const start = Date.now();

  // Load quiz page
  const res = http.get(`${BASE_URL}/quiz`, { headers: getHeaders(), tags: { name: 'quiz_page' } });
  check(res, {
    'quiz page loads': (r) => r.status === 200,
  }) || errorRate.add(1);

  quizLatency.add(Date.now() - start);
  sleep(Math.random() * 5 + 2); // 2-7s think time (reading question)
}

// ── Scenario 3: Foxy AI Chat (15%) ──
function chatWithFoxy() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Skip if no Supabase credentials configured
    sleep(2);
    return;
  }

  const start = Date.now();
  const payload = JSON.stringify({
    message: 'Explain photosynthesis in simple terms',
    student_id: '00000000-0000-4000-8000-000000000001',
    student_name: 'Load Test Student',
    grade: '8',
    subject: 'science',
    language: 'en',
    mode: 'learn',
  });

  const res = http.post(
    `${SUPABASE_URL}/functions/v1/foxy-tutor`,
    payload,
    {
      headers: {
        ...getHeaders(),
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      tags: { name: 'foxy_chat' },
      timeout: '30s',
    },
  );

  check(res, {
    'foxy response ok': (r) => r.status === 200,
    'foxy has reply': (r) => {
      try { return JSON.parse(r.body).reply !== undefined; }
      catch { return false; }
    },
  }) || errorRate.add(1);

  foxyLatency.add(Date.now() - start);
  sleep(Math.random() * 8 + 3); // 3-11s think time (reading AI response)
}

// ── Scenario 4: Study Plan (5%) ──
function viewStudyPlan() {
  const res = http.get(`${BASE_URL}/study-plan`, {
    headers: getHeaders(),
    tags: { name: 'study_plan' },
  });

  check(res, {
    'study plan loads': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(Math.random() * 4 + 2); // 2-6s think time
}

// ── Health Check (runs once at start) ──
export function setup() {
  const res = http.get(`${BASE_URL}/api/v1/health`);
  const passed = check(res, {
    'health check passes': (r) => r.status === 200,
  });

  if (!passed) {
    healthCheckErrors.add(1);
    console.warn('⚠️ Health check failed before load test — proceeding anyway');
  } else {
    console.log('✅ Health check passed — starting load test');
  }

  return { startTime: Date.now() };
}

// ── Main VU Logic ──
export default function () {
  // Distribute traffic across scenarios
  const rand = Math.random();

  if (rand < 0.60) {
    browseDashboard();
  } else if (rand < 0.80) {
    takeQuiz();
  } else if (rand < 0.95) {
    chatWithFoxy();
  } else {
    viewStudyPlan();
  }
}

// ── Teardown ──
export function teardown(data) {
  const duration = Math.round((Date.now() - data.startTime) / 1000);
  console.log(`\n📊 Load test completed in ${duration}s`);
}
