/**
 * Learning Quality Monitors API
 *
 * GET  — Get latest monitor results (cached for 5 minutes)
 * POST — Run monitors on demand and create issues for breached thresholds
 *
 * Uses session-based admin auth (authorizeAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { logger } from '@/lib/logger';
import {
  runAllMonitors,
  createIssuesFromMonitors,
  DEFAULT_MONITOR_CONFIG,
  type MonitorResult,
  type MonitorConfig,
} from '@/lib/learning-monitors';

export const runtime = 'nodejs';

// ── Helpers ──────────────────────────────────────────────────────

function jsonOk(data: unknown) {
  return NextResponse.json({ success: true, data });
}

function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for') || '';
}

// ── 5-minute in-memory cache ────────────────────────────────────

interface CachedResults {
  results: MonitorResult[];
  cached_at: string;
  expires_at: number;
}

let _cache: CachedResults | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedResults(): CachedResults | null {
  if (_cache && Date.now() < _cache.expires_at) {
    return _cache;
  }
  _cache = null;
  return null;
}

function setCachedResults(results: MonitorResult[]): CachedResults {
  const now = Date.now();
  _cache = {
    results,
    cached_at: new Date(now).toISOString(),
    expires_at: now + CACHE_TTL_MS,
  };
  return _cache;
}

// ── GET — Get latest monitor results ────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Check cache first
    const cached = getCachedResults();
    if (cached) {
      return jsonOk({
        results: cached.results,
        cached_at: cached.cached_at,
        from_cache: true,
        breached_count: cached.results.filter((r) => r.breached).length,
        total_monitors: cached.results.length,
      });
    }

    // No cache — run monitors on demand
    const results = await runAllMonitors();
    const cache = setCachedResults(results);

    return jsonOk({
      results,
      cached_at: cache.cached_at,
      from_cache: false,
      breached_count: results.filter((r) => r.breached).length,
      total_monitors: results.length,
    });
  } catch (err) {
    logger.error('learning_monitors_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return jsonError('Internal server error', 500);
  }
}

// ── POST — Run monitors on demand ───────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const ip = getIp(request);

  try {
    let config: Partial<MonitorConfig> = {};

    // Parse optional config overrides from body
    try {
      const body = await request.json();
      if (body.config && typeof body.config === 'object') {
        // Only accept known config keys with numeric values
        const validKeys = Object.keys(DEFAULT_MONITOR_CONFIG) as (keyof MonitorConfig)[];
        for (const key of validKeys) {
          if (key in body.config && typeof body.config[key] === 'number') {
            (config as Record<string, number>)[key] = body.config[key];
          }
        }
      }
    } catch {
      // Empty body is fine — use defaults
    }

    // Run all monitors
    const results = await runAllMonitors(config);

    // Create issues for breached monitors
    const issuesCreated = await createIssuesFromMonitors(results);

    // Update cache with fresh results
    setCachedResults(results);

    // Audit log
    const breachedMonitors = results.filter((r) => r.breached).map((r) => r.monitor_name);

    await logAdminAudit(
      auth as AdminAuth,
      'learning_monitors_run',
      'learning_monitor',
      'all',
      {
        total_monitors: results.length,
        breached_count: breachedMonitors.length,
        breached_monitors: breachedMonitors,
        issues_created: issuesCreated,
        config_overrides: Object.keys(config).length > 0 ? config : null,
      },
      ip,
    );

    return jsonOk({
      results,
      breached_count: breachedMonitors.length,
      breached_monitors: breachedMonitors,
      issues_created: issuesCreated,
      total_monitors: results.length,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('learning_monitors_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return jsonError('Internal server error', 500);
  }
}
