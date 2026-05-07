-- Migration: 20260507000007_add_ff_event_bus_v1.sql
-- Purpose: Phase F of the white-label SaaS foundation. Seeds the flag that
--          gates the in-process event bus (src/lib/events/). No schema change
--          — the bus is in-memory; this flag only decides whether publishers
--          actually broadcast and subscribers actually fire.
--
-- The bus is a typed EventEmitter that lets feature code emit declarative
-- events (student.created, assessment.completed, payment.received, …) and
-- attach side-effects (PostHog capture, audit log row, email trigger) as
-- subscribers. When OFF, emit() is a no-op so we can ship publisher call
-- sites ahead of subscriber readiness.
--
-- DOWN: DELETE FROM feature_flags WHERE flag_name = 'ff_event_bus_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_event_bus_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_event_bus_v1',
      false,
      0,
      'Gates the in-process event bus (src/lib/events/). When ON, emit() '
      'broadcasts to registered subscribers; when OFF, emit() is a no-op so '
      'publisher call sites can be deployed ahead of subscribers. The bus '
      'is in-process synchronous EventEmitter — future-ready for Kafka/'
      'RabbitMQ migration without touching publishers. Owner: principal-architect.'
    );
  END IF;
END $$;
