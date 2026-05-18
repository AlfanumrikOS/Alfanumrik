// scripts/mol-cost-report.ts
//
// Usage: tsx scripts/mol-cost-report.ts [--hours=24]
//
// Prints a per-task / per-provider cost and volume summary.

import { createClient } from '@supabase/supabase-js'

const HOURS = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 24)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('mol_request_logs')
    .select('task_type, provider, fallback_count, latency_ms, usd_cost, inr_cost')
    .gte('created_at', since)
  if (error) throw error

  const buckets = new Map<string, { count: number; usd: number; inr: number; latencySum: number; fallbacks: number }>()
  for (const r of data ?? []) {
    const key = `${r.task_type}/${r.provider}`
    const b = buckets.get(key) ?? { count: 0, usd: 0, inr: 0, latencySum: 0, fallbacks: 0 }
    b.count += 1
    b.usd += Number(r.usd_cost)
    b.inr += Number(r.inr_cost)
    b.latencySum += r.latency_ms
    b.fallbacks += r.fallback_count > 0 ? 1 : 0
    buckets.set(key, b)
  }

  const rows = [...buckets.entries()]
    .map(([k, v]) => ({
      bucket: k,
      requests: v.count,
      usd: v.usd.toFixed(4),
      inr: v.inr.toFixed(2),
      avg_latency: Math.round(v.latencySum / v.count),
      fallback_pct: ((v.fallbacks / v.count) * 100).toFixed(1),
    }))
    .sort((a, b) => parseFloat(b.usd) - parseFloat(a.usd))

  console.table(rows)
  const totalUsd = rows.reduce((s, r) => s + parseFloat(r.usd), 0)
  const totalInr = rows.reduce((s, r) => s + parseFloat(r.inr), 0)
  console.log(`\nWindow: last ${HOURS}h`)
  console.log(`Total: $${totalUsd.toFixed(4)}  /  ₹${totalInr.toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
