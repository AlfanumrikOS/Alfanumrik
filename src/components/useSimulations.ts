'use client';
import { useState, useCallback } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export interface SimulationMeta {
  id: string;
  title: string;
  description: string;
  sim_type: string;
  topic_title: string;
  chapter_number: number;
  thumbnail_emoji: string;
  estimated_time_minutes: number;
  foxy_intro_prompt: string;
}

export interface FullSimulation extends SimulationMeta {
  widget_code: string;
  widget_type: string;
  foxy_followup_prompts: string[];
  concept_tags: string[];
  difficulty: number;
  bloom_level: string;
  board_exam_relevance: number;
}

export function useSimulations() {
  const [loading, setLoading] = useState(false);

  const headers: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };

  const findSimulations = useCallback(async (
    subject: string,
    grade: string,
    _searchTerms?: string
  ): Promise<SimulationMeta[]> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('subject_code', `eq.${subject}`);
      params.append('grade', `eq.${grade}`);
      params.append('is_active', 'eq.true');
      params.append('widget_code', 'neq.PLACEHOLDER');
      params.append('select', 'id,title,description,sim_type,topic_title,chapter_number,thumbnail_emoji,estimated_time_minutes,foxy_intro_prompt');
      params.append('order', 'board_exam_relevance.desc');
      params.append('limit', '5');

      const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?${params}`, { headers });
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getSimulation = useCallback(async (
    simId: string,
    studentId?: string
  ): Promise<FullSimulation | null> => {
    setLoading(true);
    try {
      if (studentId) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_simulation`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_sim_id: simId, p_student_id: studentId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && !data.error) return data as FullSimulation;
        }
      }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?id=eq.${simId}&limit=1`, { headers });
      if (!res.ok) return null;
      const data = await res.json();
      return data[0] || null;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getChapterSimulations = useCallback(async (
    subject: string,
    grade: string,
    chapterNumber: number
  ): Promise<SimulationMeta[]> => {
    try {
      const params = new URLSearchParams();
      params.append('subject_code', `eq.${subject}`);
      params.append('grade', `eq.${grade}`);
      params.append('chapter_number', `eq.${chapterNumber}`);
      params.append('is_active', 'eq.true');
      params.append('widget_code', 'neq.PLACEHOLDER');
      params.append('select', 'id,title,description,sim_type,topic_title,chapter_number,thumbnail_emoji,estimated_time_minutes,foxy_intro_prompt');
      params.append('order', 'board_exam_relevance.desc');

      const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?${params}`, { headers });
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  }, []);

  const trackInteraction = useCallback(async (
    studentId: string,
    simulationId: string,
    timeSpent: number,
    interactionsCount: number
  ) => {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/student_simulation_progress`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          student_id: studentId,
          simulation_id: simulationId,
          time_spent_seconds: timeSpent,
          interactions_count: interactionsCount,
          last_viewed_at: new Date().toISOString()
        })
      });
    } catch { /* silent */ }
  }, []);

  return { findSimulations, getSimulation, getChapterSimulations, trackInteraction, loading };
}
