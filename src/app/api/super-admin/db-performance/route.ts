import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '../../../../lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface ConnectionStateRow {
  state: string;
  count: number;
}

interface TableSizeRow {
  tablename: string;
  live_rows: number;
  dead_rows: number;
  size_bytes: number;
}

interface SlowFunctionRow {
  funcname: string;
  calls: number;
  total_time: number;
  mean_time: number;
}

interface DbPerfResponse {
  connections: {
    active: number;
    by_state: ConnectionStateRow[];
  };
  tables: TableSizeRow[];
  slow_functions: SlowFunctionRow[];
  timestamp: string;
  alert: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const [slowFunctionsResult, connectionStatsResult, tableSizesResult] = await Promise.all([
    supabaseAdmin
      .rpc('get_slow_functions_stats')
      .then((r) => (r.data as SlowFunctionRow[] | null) ?? [])
      .catch((): SlowFunctionRow[] => []),

    supabaseAdmin
      .rpc('get_connection_stats')
      .then((r) => (r.data as ConnectionStateRow[] | null) ?? [])
      .catch((): ConnectionStateRow[] => []),

    supabaseAdmin
      .rpc('get_table_sizes')
      .then((r) => (r.data as TableSizeRow[] | null) ?? [])
      .catch((): TableSizeRow[] => []),
  ]);

  const activeConnections =
    connectionStatsResult
      .filter((row) => row.state === 'active')
      .reduce((sum, row) => sum + (row.count ?? 0), 0);

  const alert: string | null =
    activeConnections > 80
      ? 'HIGH: Active connections above 80 — consider connection pooling upgrade'
      : null;

  const body: DbPerfResponse = {
    connections: {
      active: activeConnections,
      by_state: connectionStatsResult,
    },
    tables: tableSizesResult,
    slow_functions: slowFunctionsResult,
    timestamp: new Date().toISOString(),
    alert,
  };

  return NextResponse.json({ success: true, data: body });
}
