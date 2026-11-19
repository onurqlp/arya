CREATE TABLE IF NOT EXISTS coord_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'demo' CHECK (mode = 'demo'),
  schedule_rule_id uuid NOT NULL,
  class_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','rescheduled','cancelled','needs_human_review')),
  planned_start_at timestamptz NOT NULL,
  confirmed_start_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_rule_id, class_date)
);

CREATE TABLE IF NOT EXISTS coord_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES coord_occurrences(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('teacher_confirmation','noon_reminder','preclass_reminder')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','retry_wait','paused','simulated','dead_letter','cancelled')),
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_enabled boolean NOT NULL DEFAULT false CHECK (send_enabled = false),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
         (status <> 'leased' AND lease_owner IS NULL AND lease_until IS NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coord_jobs_due_idx ON coord_jobs (run_at, created_at)
  WHERE status IN ('queued','retry_wait');
CREATE INDEX IF NOT EXISTS coord_jobs_occurrence_idx ON coord_jobs (occurrence_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coord_jobs_lease_idx ON coord_jobs (lease_until)
  WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS coord_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES coord_jobs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','blocked','simulated','dead_letter','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_enabled boolean NOT NULL DEFAULT false CHECK (send_enabled = false),
  simulated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coord_agent_heartbeats (
  agent_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'preview_simulated',
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_job_id uuid,
  build_label text NOT NULL DEFAULT 'GO3 fake client'
);

CREATE TABLE IF NOT EXISTS coord_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  occurrence_id uuid REFERENCES coord_occurrences(id) ON DELETE SET NULL,
  job_id uuid REFERENCES coord_jobs(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coord_events_created_idx ON coord_events (created_at DESC);
CREATE INDEX IF NOT EXISTS coord_events_occurrence_idx ON coord_events (occurrence_id, created_at DESC);

REVOKE ALL ON coord_occurrences, coord_jobs, coord_outbox, coord_agent_heartbeats, coord_events FROM PUBLIC, arya_ders_app;
REVOKE ALL ON SEQUENCE coord_events_id_seq FROM PUBLIC, arya_ders_app;
GRANT SELECT, INSERT, UPDATE ON coord_occurrences, coord_jobs, coord_outbox, coord_agent_heartbeats TO arya_ders_app;
GRANT SELECT, INSERT ON coord_events TO arya_ders_app;
GRANT USAGE, SELECT ON SEQUENCE coord_events_id_seq TO arya_ders_app;
