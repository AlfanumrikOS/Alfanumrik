import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('grounded_ai_traces', () => {
  it('accepts a grounded=true trace', async () => {
    const { data, error } = await supabaseAdmin.from('grounded_ai_traces').insert({
      caller: 'foxy',
      query_hash: 'sha256:abcd',
      query_preview: 'Test query preview',
      retrieved_chunk_ids: [],
      chunk_count: 0,
      grounded: true,
      confidence: 0.9,
    }).select().single();
    expect(error).toBeNull();
    expect(data!.id).toBeDefined();
    await supabaseAdmin.from('grounded_ai_traces').delete().eq('id', data!.id);
  });

  it('rejects unknown caller', async () => {
    const { error } = await supabaseAdmin.from('grounded_ai_traces').insert({
      caller: 'unknown_caller',
      query_hash: 'sha256:x', retrieved_chunk_ids: [], chunk_count: 0, grounded: false,
    });
    expect(error).not.toBeNull();
  });
});