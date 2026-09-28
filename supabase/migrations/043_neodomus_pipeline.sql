-- ============================================================
-- 043_neodomus_pipeline
--   * pipeline_stages.stage_type ('active','paused','won','lost')
--   * deals: segmento, origen, datos de obra, motivo de pérdida,
--     fecha de recontacto
--   * trigger: deals.status se sincroniza con el stage_type al
--     cambiar de etapa (tablero, formulario, automatizaciones, API)
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- 1) Tipo de etapa -------------------------------------------------
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_type TEXT NOT NULL DEFAULT 'active';

ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_stage_type_check;
ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_stage_type_check
  CHECK (stage_type IN ('active', 'paused', 'won', 'lost'));

-- Etapas heredadas del seed original de WaCRM
UPDATE pipeline_stages SET stage_type = 'won'
  WHERE stage_type = 'active' AND lower(trim(name)) IN ('won', 'ganado');
UPDATE pipeline_stages SET stage_type = 'lost'
  WHERE stage_type = 'active' AND lower(trim(name)) IN ('lost', 'perdido');

-- 2) Campos comerciales en deals ----------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS segment        TEXT,
  ADD COLUMN IF NOT EXISTS lead_source    TEXT,
  ADD COLUMN IF NOT EXISTS project_name   TEXT,
  ADD COLUMN IF NOT EXISTS build_stage    TEXT,
  ADD COLUMN IF NOT EXISTS units          INTEGER,
  ADD COLUMN IF NOT EXISTS square_meters  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS lost_reason    TEXT,
  ADD COLUMN IF NOT EXISTS recontact_date DATE;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_segment_check;
ALTER TABLE deals ADD CONSTRAINT deals_segment_check CHECK (
  segment IS NULL OR segment IN (
    'Constructora', 'Estudio de arquitectura', 'Desarrollista',
    'Familia / Hogar', 'Vivienda en obra / remodelación',
    'Alquiler temporario (Airbnb)', 'Oficina / Comercio'
  )
);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lead_source_check;
ALTER TABLE deals ADD CONSTRAINT deals_lead_source_check CHECK (
  lead_source IS NULL OR lead_source IN (
    'WhatsApp en frío', 'Instagram', 'Referido', 'Web',
    'Google Maps', 'Visita a obra', 'Cliente anterior', 'Otro'
  )
);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lost_reason_check;
ALTER TABLE deals ADD CONSTRAINT deals_lost_reason_check CHECK (
  lost_reason IS NULL OR lost_reason IN (
    'Precio', 'Timing de obra', 'No le interesa',
    'Eligió competencia', 'No responde', 'Otro'
  )
);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_units_check;
ALTER TABLE deals ADD CONSTRAINT deals_units_check
  CHECK (units IS NULL OR units >= 0);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_square_meters_check;
ALTER TABLE deals ADD CONSTRAINT deals_square_meters_check
  CHECK (square_meters IS NULL OR square_meters >= 0);

CREATE INDEX IF NOT EXISTS idx_deals_recontact_date
  ON deals(account_id, recontact_date)
  WHERE recontact_date IS NOT NULL;

-- 3) Sincronizar deals.status con el tipo de etapa -----------------
CREATE OR REPLACE FUNCTION public.sync_deal_status_from_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT stage_type INTO v_type FROM pipeline_stages WHERE id = NEW.stage_id;

  NEW.status := CASE v_type
    WHEN 'won'  THEN 'won'
    WHEN 'lost' THEN 'lost'
    ELSE 'open'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_sync_status ON deals;
CREATE TRIGGER trg_deals_sync_status
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_status_from_stage();
