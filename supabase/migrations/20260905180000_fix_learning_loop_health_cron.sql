-- Fix the `learning-loop-health` cron: 672 consecutive failures, 0 successes in 7 days.
--
-- Measured 2026-09-05 against production:
--   select jobname, count(*) filter (where status='failed')    as fails_7d,
--          count(*) filter (where status='succeeded') as ok_7d
--     from cron.job j join cron.job_run_details d on d.jobid = j.jobid
--    where jobname = 'learning-loop-health' and d.start_time > now() - interval '7 days';
--   -> fails_7d = 672, ok_7d = 0   (job runs every 15 minutes)
--
-- TWO bugs, both confirmed against the live schema.
--
-- 1. NOT NULL violation on every single insert.
--    `ops_events.environment` is `is_nullable = NO` with `column_default = NULL`,
--    but all five INSERTs in this function omit the column. Any branch that
--    tries to raise an alert therefore throws, the function aborts, and pg_cron
--    records the run as failed. The alerting path has never once succeeded:
--      select count(*) from ops_events where category = 'learning_loop_stale'
--       and occurred_at > now() - interval '7 days';  -> 0
--    Fixed by supplying the value the rest of the codebase already uses:
--    COALESCE(current_setting('app.environment', true), 'production')
--    — the same expression as `submit_quiz_results`. Deliberately NOT a
--    hardcoded 'production', so a branch/staging database labels its own rows.
--
-- 2. The mastery gauge watches a table nothing writes to.
--    Section 1 measured `concept_attempts`, which has 0 rows and has never had
--    any. Live mastery writes go to `concept_mastery` (107 rows, last updated
--    2026-09-01), written by `atomic_quiz_profile_update()`. So even once bug 1
--    is fixed, this function would emit a permanent false
--    "mastery_pipeline_never_ran: critical" while the pipeline is in fact
--    healthy. A monitor that is always red is worse than no monitor: it hides
--    the real one. Section 1 now measures `concept_mastery.updated_at`.
--
-- Everything else (sections 2-5, the 6h dedup window, severities, the return
-- value) is unchanged. This migration also brings the function under version
-- control for the first time — it previously existed only in the live database,
-- with no migration anywhere in the repo.

CREATE OR REPLACE FUNCTION public.ops_check_learning_loop_health()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_emitted    integer  := 0;
  v_dedup      interval := interval '6 hours';
  v_env        text     := coalesce(current_setting('app.environment', true), 'production');
  v_quiz_24h   bigint;
  v_mast_total bigint;
  v_mast_24h   bigint;
  v_pending    bigint;
  v_done       bigint;
  v_bad_img    bigint;
  v_disp_fail  bigint;
  v_disp_ok    bigint;
  r            record;
begin
  ------------------------------------------------------------------
  -- 1. Mastery pipeline disconnected
  --    Gauged on concept_mastery (the live write target of
  --    atomic_quiz_profile_update), NOT the empty legacy concept_attempts.
  ------------------------------------------------------------------
  select count(*) into v_quiz_24h   from quiz_responses  where created_at > now() - interval '24 hours';
  select count(*) into v_mast_total from concept_mastery;
  select count(*) into v_mast_24h   from concept_mastery where updated_at > now() - interval '24 hours';

  if v_mast_total = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'critical',
           'mastery_pipeline_never_ran: concept_mastery is empty',
           jsonb_build_object('quiz_responses_total', (select count(*) from quiz_responses),
                              'concept_mastery_total', 0),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'mastery_pipeline_never_ran: concept_mastery is empty'
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;

  elsif v_quiz_24h > 0 and v_mast_24h = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'critical',
           'mastery_pipeline_disconnected: quiz activity with no mastery updates',
           jsonb_build_object('quiz_responses_24h', v_quiz_24h, 'concept_mastery_updated_24h', 0),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'mastery_pipeline_disconnected: quiz activity with no mastery updates'
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  ------------------------------------------------------------------
  -- 2. Projector subscribed to an event kind nobody emits
  --    (structural mismatch, not lag — lag would show a moving offset)
  ------------------------------------------------------------------
  for r in
    select so.subscriber_name, so.kind_filter
      from subscriber_offsets so
     where so.kind_filter is not null
       and not exists (select 1 from state_events se where se.kind = so.kind_filter)
  loop
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'error',
           'projector_kind_never_emitted: ' || r.subscriber_name,
           jsonb_build_object('subscriber', r.subscriber_name, 'kind_filter', r.kind_filter),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'projector_kind_never_emitted: ' || r.subscriber_name
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end loop;

  ------------------------------------------------------------------
  -- 3. Embedding backfill queue has no consumer
  ------------------------------------------------------------------
  select count(*) filter (where status = 'pending' and created_at < now() - interval '24 hours'),
         count(*) filter (where status <> 'pending')
    into v_pending, v_done
    from embedding_backfill_queue;

  if v_pending > 0 and v_done = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'error',
           'embedding_backfill_stalled: no consumer has ever claimed a job',
           jsonb_build_object('pending_over_24h', v_pending, 'ever_processed', 0),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'embedding_backfill_stalled: no consumer has ever claimed a job'
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  ------------------------------------------------------------------
  -- 4. Diagram rows that cannot render as images
  ------------------------------------------------------------------
  select count(*) into v_bad_img
    from topic_diagrams
   where is_active
     and coalesce(image_url,'') <> ''
     and image_url !~* '\.(png|jpg|jpeg|webp|svg|gif|avif)$';

  if v_bad_img > 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'error',
           'diagram_assets_not_renderable: image_url is not an image file',
           jsonb_build_object('active_rows_affected', v_bad_img,
                              'ncert_assets_objects',
                              (select count(*) from storage.objects where bucket_id = 'ncert-assets')),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'diagram_assets_not_renderable: image_url is not an image file'
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  ------------------------------------------------------------------
  -- 5. Meta: the alert channel itself is failing
  ------------------------------------------------------------------
  select count(*) filter (where status = 'failed'),
         count(*) filter (where status = 'sent')
    into v_disp_fail, v_disp_ok
    from alert_dispatches
   where fired_at > now() - interval '6 hours';

  if v_disp_fail > 0 and v_disp_ok = 0 then
    insert into ops_events (occurred_at, category, source, severity, message, context, environment)
    select now(), 'learning_loop_stale', 'cron/learning-loop-health', 'critical',
           'alert_delivery_failing: every dispatch in the last 6h failed',
           jsonb_build_object('failed_6h', v_disp_fail, 'sent_6h', 0,
                              'last_error', (select delivery_error from alert_dispatches
                                              where delivery_error is not null
                                              order by fired_at desc limit 1)),
           v_env
    where not exists (
      select 1 from ops_events
       where category = 'learning_loop_stale'
         and message  = 'alert_delivery_failing: every dispatch in the last 6h failed'
         and occurred_at > now() - v_dedup);
    v_emitted := v_emitted + 1;
  end if;

  return v_emitted;
end;
$function$;

COMMENT ON FUNCTION public.ops_check_learning_loop_health() IS
  'Learning-loop health canary, run every 15 minutes by the `learning-loop-health` pg_cron job. '
  'Emits deduplicated ops_events rows (6h window) for: mastery pipeline stalled, projector subscribed '
  'to a never-emitted event kind, embedding backfill with no consumer, unrenderable diagram assets, and '
  'a failing alert channel. Section 1 gauges concept_mastery (the live write target), never the empty '
  'legacy concept_attempts table.';
