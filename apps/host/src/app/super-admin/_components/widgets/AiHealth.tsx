'use client';

import { StalenessTag } from '@alfanumrik/ui/admin-ui';
import type { AiHealthData } from './control-room-types';

interface AiHealthProps {
  aiHealth: AiHealthData | null;
  lastUpdated: Date | null;
}

/** Count circuit breakers currently reporting an `open` sample (last minute). */
export function countOpenCircuits(aiHealth: AiHealthData | null): number {
  if (!aiHealth || aiHealth.circuitState !== 'live') return 0;
  return Object.values(aiHealth.circuitStates).filter(s => (s.open ?? 0) > 0).length;
}

/**
 * Phase 3 Master Control tile — AI health.
 *
 * Reuses the existing GET /api/super-admin/grounding/health endpoint
 * (grounded_ai_traces + ops_events aggregates). Renders factual state only:
 * calls/min, foxy grounded rate, upstream error rates, circuit-breaker state.
 * Severity thresholds/KPI definitions stay with ops (super-admin boundary).
 */
export default function AiHealth({ aiHealth, lastUpdated }: AiHealthProps) {
  if (!aiHealth) return null;

  const callsPerMin = Object.values(aiHealth.callsPerMin).reduce((a, b) => a + b, 0);
  const foxyGrounded = aiHealth.groundedRate.foxy ?? 0;
  const openCircuits = countOpenCircuits(aiHealth);
  const pctFmt = (v: number) => `${(v * 100).toFixed(1)}%`;

  const items: { label: string; value: string; warn: boolean }[] = [
    { label: 'AI calls/min', value: String(callsPerMin), warn: false },
    { label: 'Foxy grounded (1h)', value: pctFmt(foxyGrounded), warn: false },
    { label: 'Claude errors (5m)', value: pctFmt(aiHealth.claudeErrorRate), warn: aiHealth.claudeErrorRate > 0 },
    { label: 'Voyage errors (5m)', value: pctFmt(aiHealth.voyageErrorRate), warn: aiHealth.voyageErrorRate > 0 },
    { label: 'Latency p95', value: `${aiHealth.latency.p95}ms`, warn: false },
    {
      label: 'Circuits',
      value:
        aiHealth.circuitState === 'pending_instrumentation'
          ? 'pending'
          : openCircuits > 0
            ? `${openCircuits} open`
            : 'closed',
      warn: openCircuits > 0,
    },
  ];

  return (
    <div className="mb-4 rounded-lg border border-surface-3 bg-surface-1 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">AI Health</span>
          <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />
        </div>
        <a
          href="/super-admin/grounding/health"
          className="text-[11px] font-medium text-muted-foreground no-underline hover:text-foreground"
        >
          Grounding Health {'→'}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">{item.label}:</span>
            <span className={`text-xs font-bold ${item.warn ? 'text-danger' : 'text-foreground'}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
