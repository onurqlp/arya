-- Install once as the Neon database owner. The deployed application role
-- arya_ders_app is intentionally not granted schema CREATE or ALTER.
CREATE TABLE IF NOT EXISTS arya_web_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name text NOT NULL,
  teacher_name text NOT NULL,
  teacher_chat_name text NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  class_time time NOT NULL,
  checkin_time time NOT NULL DEFAULT '09:00',
  response_deadline time NOT NULL DEFAULT '12:00',
  preclass_minutes integer NOT NULL DEFAULT 60 CHECK (preclass_minutes BETWEEN 5 AND 240),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE arya_web_schedules ADD COLUMN IF NOT EXISTS teacher_chat_name text;
UPDATE arya_web_schedules SET teacher_chat_name = teacher_name
WHERE teacher_chat_name IS NULL OR BTRIM(teacher_chat_name) = '';
ALTER TABLE arya_web_schedules ALTER COLUMN teacher_chat_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS arya_web_schedules_identity_idx
  ON arya_web_schedules (LOWER(group_name), weekday, class_time);
CREATE UNIQUE INDEX IF NOT EXISTS arya_web_schedules_active_group_day_idx
  ON arya_web_schedules (LOWER(group_name), weekday) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS arya_web_agent_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  approval_chat_name text,
  paused boolean NOT NULL DEFAULT true,
  dry_run boolean NOT NULL DEFAULT true,
  send_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO arya_web_agent_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS arya_web_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  run_id uuid,
  job_type text NOT NULL,
  chat_name text NOT NULL,
  body text NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','sent','uncertain','blocked','cancelled')),
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  delivered_at timestamptz,
  outcome_code text
);
CREATE INDEX IF NOT EXISTS arya_web_outbox_due_idx
  ON arya_web_outbox (run_at, created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS arya_web_outbox_single_lease_idx
  ON arya_web_outbox ((status)) WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS arya_web_worker_lease (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  agent_id text NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS arya_web_agent_heartbeats (
  agent_id text PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT NOW(),
  whatsapp_tab_open boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS arya_web_lesson_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES arya_web_schedules(id),
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_teacher'
    CHECK (status IN ('awaiting_teacher','confirmed','no_response','needs_human_review','complete')),
  confirmed_message_id text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(schedule_id, run_date)
);
CREATE TABLE IF NOT EXISTS arya_web_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES arya_web_lesson_runs(id),
  review_code text NOT NULL UNIQUE,
  source_message_id text,
  status text NOT NULL DEFAULT 'waiting_reply'
    CHECK (status IN ('waiting_reply','answered','resolved','uncertain')),
  reply_text text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS arya_web_processed_inbound (
  message_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT NOW()
);

GRANT USAGE ON SCHEMA public TO arya_ders_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  arya_web_schedules,
  arya_web_agent_settings,
  arya_web_outbox,
  arya_web_worker_lease,
  arya_web_agent_heartbeats,
  arya_web_lesson_runs,
  arya_web_reviews,
  arya_web_processed_inbound
TO arya_ders_app;
