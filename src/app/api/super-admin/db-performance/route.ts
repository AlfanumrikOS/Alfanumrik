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

async function safeRpc<T>(name: string): Promise<T[]> {
  try {
    const { data } = await supabaseAdmin.rpc(name);
    return (data as T[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const [slowFunctionsResult, connectionStatsResult, tableSizesResult] = await Promise.all([
    safeRpc<SlowFunctionRow>('get_slow_functions_stats'),
    safeRpc<ConnectionStateRow>('get_connection_stats'),
    safeRpc<TableSizeRow>('get_table_sizes'),
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
