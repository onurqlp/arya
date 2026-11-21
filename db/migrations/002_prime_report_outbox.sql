-- Install as the Neon database owner in the isolated ARYA coordinator database.
-- PRIME reports have their own one-shot queue and never share the lesson outbox.
CREATE TABLE IF NOT EXISTS arya_prime_report_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  target_chat text NOT NULL DEFAULT 'ARYA ONAY' CHECK (target_chat = 'ARYA ONAY'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 3000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  data_reviewed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sending','sent_verified','uncertain','blocked','cancelled')),
  approved_sha256 text,
  approved_at timestamptz,
  worker_agent_id text,
  attempt_started_at timestamptz,
  finished_at timestamptz,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS arya_prime_report_outbox_recent_idx
  ON arya_prime_report_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS arya_prime_report_outbox_approved_idx
  ON arya_prime_report_outbox (created_at) WHERE status = 'approved';
CREATE UNIQUE INDEX IF NOT EXISTS arya_prime_report_outbox_single_sending_idx
  ON arya_prime_report_outbox ((status)) WHERE status = 'sending';
GRANT SELECT, INSERT, UPDATE ON TABLE arya_prime_report_outbox TO arya_ders_app;
