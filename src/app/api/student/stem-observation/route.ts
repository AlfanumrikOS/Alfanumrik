/**
 * POST /api/student/stem-observation
 *
 * Records a STEM lab experiment observation.
 * Replaces direct anon-client insert in stem-centre/page.tsx.
 *
 * WHY:
 *   - student_id came from client state
 *   - No validation on observation_type or simulation_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const ALLOWED_OBSERVATION_TYPES = ['simple', 'structured', 'quiz'];

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'stem.observe', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const {
    simulation_id, experiment_id, observation_type,
    observation_text, structured_observations, data_entries, conclusion,
    quiz_score, total_questions,
  } = body;
  const studentId = auth.studentId!;

  if (typeof simulation_id !== 'string' || !simulation_id.trim()) return err('simulation_id required', 400);
  if (typeof observation_type !== 'string' || !ALLOWED_OBSERVATION_TYPES.includes(observation_type)) {
    return err(`observation_type must be one of: ${ALLOWED_OBSERVATION_TYPES.join(', ')}`, 400);
  }

  const { error } = await supabaseAdmin.from('experiment_observations').insert({
    student_id: studentId,
    simulation_id,
    experiment_id: typeof experiment_id === 'string' ? experiment_id : null,
    observation_type,
    observation_text: observation_type === 'simple' && typeof observation_text === 'string'
      ? observation_text.substring(0, 5000) : null,
    structured_observations: structured_observations ?? null,
    data_entries: data_entries ?? null,
    conclusion: typeof conclusion === 'string' ? conclusion.substring(0, 2000) : null,
    quiz_score: typeof quiz_score === 'number' ? quiz_score : null,
    total_questions: typeof total_questions === 'number' ? total_questions : null,
  });

  if (error) {
    logger.error('stem_observation_insert_failed', {
      error: new Error(error.message),
      studentId,
      simulationId: simulation_id,
    });
    return err('Failed to record observation', 500);
  }

  return NextResponse.json({ success: true });
}
