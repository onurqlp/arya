-- AYDA PRIME bağımsız zihin günlüğü v1
-- Ayrı, eklemeli kayıt tablosu; WhatsApp ve öğrenci tablolarını değiştirmez.
-- İşlem: yalnızca otomatik döngü kayıtları oluşturulur.
CREATE TABLE IF NOT EXISTS public.prime_mind_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running','completed','failed')),
  model text,
  focus text,
  title text,
  observation text,
  idea text,
  recommended_action text,
  uncertainty text,
  priority text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_output text,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text
);
CREATE INDEX IF NOT EXISTS prime_mind_journal_created_at_idx
 ON public.prime_mind_journal (created_at DESC);
-- Tablo neondb_owner tarafından oluşturulur, mevcut çalışma rolünün
-- başka tablolara yazma yetkisi genişletilmez.
