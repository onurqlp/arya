-- Dedicated PRIME report send gate; teacher/ders settings stay separate.
CREATE TABLE IF NOT EXISTS arya_prime_report_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sending_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO arya_prime_report_settings (id, sending_enabled)
VALUES (1, false) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, UPDATE ON TABLE arya_prime_report_settings TO arya_ders_app;
