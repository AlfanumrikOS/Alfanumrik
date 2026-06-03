import { useState, useCallback } from 'react';

// Use the environment variable for staging/production, otherwise fallback to localhost for local dev.
// In Vercel staging, NEXT_PUBLIC_FOXY_API_URL should be set to the live Python backend URL.
const API_BASE_URL = process.env.NEXT_PUBLIC_FOXY_API_URL || 'http://localhost:8000/api';

export interface UIState {
  status: string;
  loop_stage: string;
  ui_schema?: any;
  ui_instruction?: string;
  adaptive_difficulty?: any;
  dopamine_events?: any[];
  hif_feedback?: string | null;
}

export function useFoxyOS(studentId: string = "STU_WEB_1") {
  const [uiState, setUiState] = useState<UIState | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const startTopic = useCallback(async (topicId: string) => {
    setLoading(true);
    setError(null);
    try {
      // First, ensure student is registered
      await fetch(`${API_BASE_URL}/students/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, grade: 10 }),
      });

      // Then, start the topic
      const res = await fetch(`${API_BASE_URL}/topics/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, topic_id: topicId }),
      });

      const data = await res.json();
      if (data.status === 'success') {
        setUiState(data.data);
      } else {
        setError(data.detail || 'Failed to start topic');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  const submitEvent = useCallback(async (actionType: string, payload: any = {}, metrics: any = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/events/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          action: {
            type: actionType,
            payload: payload,
            metrics: metrics
          }
        }),
      });

      const data = await res.json();
      if (data.status === 'success') {
        // Merge the new state instructions (like loop progression and dopamine)
        setUiState(prev => ({ ...prev, ...data.data }));
      } else {
        setError(data.detail || 'Failed to process event');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  return { uiState, loading, error, startTopic, submitEvent };
}
