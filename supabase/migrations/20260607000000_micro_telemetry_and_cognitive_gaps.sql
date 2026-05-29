-- Migration: Create micro-telemetry and cognitive gaps schema for DreamBox parity
-- This allows the frontend to stream real-time interaction metrics (latency, hesitation)
-- and allows the backend CME engine to track specific cognitive misconceptions rather than just scores.

-- 1. Micro-Telemetry Events Table
-- Stores high-volume interaction data (clicks, pauses, changed answers).
CREATE TABLE public.micro_telemetry_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    session_id UUID,
    event_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying a student's recent telemetry during CME engine evaluations
CREATE INDEX idx_micro_telemetry_events_student_created ON public.micro_telemetry_events(student_id, created_at DESC);

-- Enable RLS for telemetry
ALTER TABLE public.micro_telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students can insert their own telemetry"
    ON public.micro_telemetry_events FOR INSERT
    WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students can view their own telemetry"
    ON public.micro_telemetry_events FOR SELECT
    USING (auth.uid() = student_id);


-- 2. Cognitive Misconceptions Table
-- Tracks specific, identified logic gaps (e.g., "forgets negative sign distribution")
CREATE TABLE public.cognitive_misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    concept_tag TEXT NOT NULL,
    misconception_type TEXT NOT NULL,
    severity FLOAT NOT NULL DEFAULT 1.0, -- e.g., 0.0 to 1.0
    identified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    UNIQUE (student_id, concept_tag, misconception_type)
);

-- Index for CME engine to pull unresolved misconceptions for a concept quickly
CREATE INDEX idx_cognitive_misconceptions_unresolved ON public.cognitive_misconceptions(student_id, concept_tag) WHERE resolved_at IS NULL;

-- Enable RLS for misconceptions
ALTER TABLE public.cognitive_misconceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students can view their own misconceptions"
    ON public.cognitive_misconceptions FOR SELECT
    USING (auth.uid() = student_id);

-- System service role will manage insertions/updates for misconceptions via CME engine
