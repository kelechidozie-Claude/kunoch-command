-- Phase 5: Scheduled auto-runs — Monday 07:00 Africa/Lagos (06:00 UTC)
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing schedule if present
SELECT cron.unschedule('weekly-portfolio-review');

-- Schedule weekly call to Edge Function
-- Runs every Monday at 06:00 UTC = 07:00 Lagos (WAT)
SELECT cron.schedule(
  'weekly-portfolio-review',
  '0 6 * * 1',
  $$
  SELECT
    net.http_post(
      url := 'https://eplsmeenlwbglgtnzxau.supabase.co/functions/v1/weekly-review',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify schedule
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'weekly-portfolio-review';
