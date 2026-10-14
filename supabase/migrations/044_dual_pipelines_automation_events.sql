-- ============================================================
-- 044_dual_pipelines_automation_events
--
-- Neo Domus — embudos duales (Online B2C / Proyectos B2B Córdoba) y la
-- infraestructura de eventos que necesitan las automatizaciones:
--
--   1. pipelines.business_line ('general' | 'online' | 'projects')
--   2. pipeline_stages.stage_key — slug estable para automatizaciones / IA
--   3. deals: datos de pedido online + ubicación + instalación,
--      stage_entered_at; CHECKs de segmento / origen / motivo ampliados
--   4. Integridad: la etapa de un deal debe pertenecer a su pipeline y el
--      pipeline a la misma cuenta (antes nada lo impedía, ni desde la UI
--      ni desde el paso create_deal de automatizaciones, que usa la
--      service role y saltea RLS)
--   5. deal_stage_history — auditoría de cada cambio de etapa
--   6. automation_event_queue — outbox transaccional. Triggers de DB
--      encolan 'deal_stage_changed' y 'conversation_assigned' (este
--      último existía en la UI pero NUNCA se disparaba); el cron lo drena
--   7. conversations.last_inbound_at (+ window_nudge_for) — base para la
--      ventana de 24 h de Meta y para el trigger
--      'conversation_window_expiring'
--   8. conversations.ai_lead_profile — datos de calificación que el agente
--      de IA extrae antes de derivar a un humano
--   9. automation_pending_executions.claimed_at — permite detectar filas
--      'running' huérfanas (proceso reiniciado a mitad de ejecución)
--
-- Idempotente: se puede ejecutar varias veces. Requiere 043.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Línea de negocio del pipeline
-- ------------------------------------------------------------
ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS business_line TEXT NOT NULL DEFAULT 'general';

ALTER TABLE pipelines DROP CONSTRAINT IF EXISTS pipelines_business_line_check;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_business_line_check
  CHECK (business_line IN ('general', 'online', 'projects'));

CREATE INDEX IF NOT EXISTS idx_pipelines_account_line
  ON pipelines(account_id, business_line);

-- ------------------------------------------------------------
-- 2) Clave estable de etapa
-- ------------------------------------------------------------
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS stage_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_stage_key
  ON pipeline_stages(pipeline_id, stage_key)
  WHERE stage_key IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Campos de deals
-- ------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS order_ref          TEXT,
  ADD COLUMN IF NOT EXISTS tracking_code      TEXT,
  ADD COLUMN IF NOT EXISTS shipping_carrier   TEXT,
  ADD COLUMN IF NOT EXISTS province           TEXT,
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS installation_date  DATE,
  ADD COLUMN IF NOT EXISTS stage_entered_at   TIMESTAMPTZ;

UPDATE deals
SET stage_entered_at = COALESCE(updated_at, created_at)
WHERE stage_entered_at IS NULL;

ALTER TABLE deals ALTER COLUMN stage_entered_at SET DEFAULT NOW();

-- Mismo listado que src/lib/neodomus.ts (SEGMENTS / LEAD_SOURCES / LOST_REASONS).
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_segment_check;
ALTER TABLE deals ADD CONSTRAINT deals_segment_check CHECK (
  segment IS NULL OR segment IN (
    'Constructora', 'Estudio de arquitectura', 'Desarrollista',
    'Instalador / Electricista', 'Revendedor / Partner',
    'Familia / Hogar', 'Vivienda en obra / remodelación',
    'Alquiler temporario (Airbnb)', 'Oficina / Comercio',
    'Comprador online'
  )
);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lead_source_check;
ALTER TABLE deals ADD CONSTRAINT deals_lead_source_check CHECK (
  lead_source IS NULL OR lead_source IN (
    'WhatsApp en frío', 'WhatsApp entrante', 'Instagram', 'Referido', 'Web',
    'Tienda Nube', 'MercadoLibre', 'Google Maps', 'Visita a obra',
    'Cliente anterior', 'Otro'
  )
);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lost_reason_check;
ALTER TABLE deals ADD CONSTRAINT deals_lost_reason_check CHECK (
  lost_reason IS NULL OR lost_reason IN (
    'Precio', 'Timing de obra', 'No le interesa', 'Eligió competencia',
    'No responde', 'Sin stock', 'Costo / plazo de envío',
    'Pago no concretado', 'Incompatibilidad técnica', 'Fuera de zona',
    'Otro'
  )
);

CREATE INDEX IF NOT EXISTS idx_deals_contact_open
  ON deals(account_id, contact_id, pipeline_id)
  WHERE status = 'open';

-- ------------------------------------------------------------
-- 4) Integridad deal ↔ etapa ↔ pipeline ↔ cuenta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_deal_stage_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_pipeline UUID;
  v_pipeline_account UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
     AND NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;

  SELECT s.pipeline_id, p.account_id
    INTO v_stage_pipeline, v_pipeline_account
  FROM pipeline_stages s
  JOIN pipelines p ON p.id = s.pipeline_id
  WHERE s.id = NEW.stage_id;

  IF v_stage_pipeline IS NULL THEN
    RAISE EXCEPTION 'deal stage % does not exist', NEW.stage_id
      USING ERRCODE = '23503';
  END IF;
  IF v_stage_pipeline <> NEW.pipeline_id THEN
    RAISE EXCEPTION 'stage % does not belong to pipeline %', NEW.stage_id, NEW.pipeline_id
      USING ERRCODE = '23514';
  END IF;
  IF v_pipeline_account <> NEW.account_id THEN
    RAISE EXCEPTION 'pipeline % does not belong to account %', NEW.pipeline_id, NEW.account_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_stage_integrity ON deals;
CREATE TRIGGER trg_deals_stage_integrity
  BEFORE INSERT OR UPDATE OF stage_id, pipeline_id, account_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_deal_stage_integrity();

-- ------------------------------------------------------------
-- 5) Historial de etapas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal
  ON deal_stage_history(deal_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_account
  ON deal_stage_history(account_id, changed_at DESC);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stage_history_select ON deal_stage_history;
CREATE POLICY deal_stage_history_select ON deal_stage_history
  FOR SELECT USING (is_account_member(account_id));
-- Solo escribe el trigger (SECURITY DEFINER); sin políticas de escritura.

-- ------------------------------------------------------------
-- 6) Outbox de eventos para automatizaciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_event_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_event_queue_due
  ON automation_event_queue(run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_event_queue_running
  ON automation_event_queue(claimed_at) WHERE status = 'running';

-- Service role únicamente (sin políticas).
ALTER TABLE automation_event_queue ENABLE ROW LEVEL SECURITY;

-- Encola un evento solo si la cuenta tiene al menos una automatización
-- activa con ese trigger: así la tabla no crece con eventos que nadie
-- escucha.
CREATE OR REPLACE FUNCTION public.enqueue_automation_event(
  p_account_id UUID,
  p_trigger_type TEXT,
  p_contact_id UUID,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM automations
    WHERE account_id = p_account_id
      AND trigger_type = p_trigger_type
      AND is_active = TRUE
  ) THEN
    RETURN;
  END IF;

  INSERT INTO automation_event_queue (account_id, trigger_type, contact_id, payload)
  VALUES (p_account_id, p_trigger_type, p_contact_id, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_event(UUID, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_automation_event(UUID, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_automation_event(UUID, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_automation_event(UUID, TEXT, UUID, JSONB) TO service_role;

-- Cambio de etapa → historial + evento. AFTER para ver el status ya
-- sincronizado por 043 y no encolar si el UPDATE falla.
CREATE OR REPLACE FUNCTION public.on_deal_stage_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
      RETURN NEW;
    END IF;
    v_from := OLD.stage_id;
  END IF;

  BEGIN
    INSERT INTO deal_stage_history (
      account_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by
    ) VALUES (
      NEW.account_id, NEW.id, NEW.pipeline_id, v_from, NEW.stage_id, auth.uid()
    );

    PERFORM enqueue_automation_event(
      NEW.account_id,
      'deal_stage_changed',
      NEW.contact_id,
      jsonb_build_object(
        'deal_id', NEW.id,
        'pipeline_id', NEW.pipeline_id,
        'from_stage_id', v_from,
        'to_stage_id', NEW.stage_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear el movimiento del deal por un fallo de auditoría.
    RAISE WARNING 'on_deal_stage_changed failed for deal %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.on_deal_stage_changed() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_deals_stage_changed ON deals;
CREATE TRIGGER trg_deals_stage_changed
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.on_deal_stage_changed();

-- Asignación de conversación → evento 'conversation_assigned'.
CREATE OR REPLACE FUNCTION public.on_conversation_assigned_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM enqueue_automation_event(
      NEW.account_id,
      'conversation_assigned',
      NEW.contact_id,
      jsonb_build_object(
        'conversation_id', NEW.id,
        'agent_id', NEW.assigned_agent_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conversation_assigned enqueue failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.on_conversation_assigned_enqueue() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_conversations_assigned_enqueue ON conversations;
CREATE TRIGGER trg_conversations_assigned_enqueue
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.on_conversation_assigned_enqueue();

-- Claim atómico con SKIP LOCKED: dos crons solapados nunca toman la
-- misma fila. Las filas 'running' viejas (proceso reiniciado) vuelven a
-- 'pending' hasta 3 intentos y después quedan 'failed'.
CREATE OR REPLACE FUNCTION public.claim_automation_events(p_limit INTEGER DEFAULT 50)
RETURNS SETOF automation_event_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE automation_event_queue
  SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
      last_error = COALESCE(last_error, 'stale claim reclaimed')
  WHERE status = 'running'
    AND claimed_at < NOW() - INTERVAL '15 minutes';

  RETURN QUERY
  UPDATE automation_event_queue q
  SET status = 'running',
      claimed_at = NOW(),
      attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT id FROM automation_event_queue
    WHERE status = 'pending' AND run_at <= NOW()
    ORDER BY run_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_events(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_automation_events(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_automation_events(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_events(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 7) Ventana de 24 h
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_nudge_for TIMESTAMPTZ;

UPDATE conversations c
SET last_inbound_at = m.last_at
FROM (
  SELECT conversation_id, MAX(created_at) AS last_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.last_inbound_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_inbound
  ON conversations(account_id, last_inbound_at)
  WHERE last_inbound_at IS NOT NULL;

-- Misma firma que 037; agrega last_inbound_at en el mismo UPDATE atómico.
CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      last_inbound_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) TO service_role;

-- Reclama conversaciones de una cuenta cuya ventana vence dentro de
-- p_minutes_before minutos, a las que todavía no se les envió el
-- recordatorio en este ciclo. Con p_only_awaiting_customer solo cuenta
-- las que tienen un mensaje nuestro posterior al último del cliente
-- (o sea: el cliente nos dejó en visto). Marca window_nudge_for en el
-- mismo statement para que un cron solapado no duplique el envío.
CREATE OR REPLACE FUNCTION public.claim_expiring_conversations(
  p_account_id UUID,
  p_minutes_before INTEGER,
  p_only_awaiting_customer BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (conversation_id UUID, contact_id UUID, last_inbound_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_minutes INTEGER := GREATEST(5, LEAST(COALESCE(p_minutes_before, 120), 23 * 60));
BEGIN
  RETURN QUERY
  UPDATE conversations c
  SET window_nudge_for = c.last_inbound_at
  WHERE c.id IN (
    SELECT c2.id FROM conversations c2
    WHERE c2.account_id = p_account_id
      AND c2.status <> 'closed'
      AND c2.last_inbound_at IS NOT NULL
      AND c2.last_inbound_at >  NOW() - INTERVAL '24 hours'
      AND c2.last_inbound_at <= NOW() - INTERVAL '24 hours' + make_interval(mins => v_minutes)
      AND c2.window_nudge_for IS DISTINCT FROM c2.last_inbound_at
      AND (
        NOT COALESCE(p_only_awaiting_customer, TRUE)
        OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = c2.id
            AND m.sender_type <> 'customer'
            AND m.created_at > c2.last_inbound_at
        )
      )
    ORDER BY c2.last_inbound_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.id, c.contact_id, c.last_inbound_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_expiring_conversations(UUID, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_expiring_conversations(UUID, INTEGER, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_expiring_conversations(UUID, INTEGER, BOOLEAN, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expiring_conversations(UUID, INTEGER, BOOLEAN, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 8) Perfil de lead capturado por el agente de IA
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_lead_profile JSONB;

-- ------------------------------------------------------------
-- 9) Ejecuciones en espera huérfanas
-- ------------------------------------------------------------
ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 10) Fecha de cierre (ganado / perdido)
--
-- "Ganados este mes" usaba updated_at, que se mueve con cualquier edición
-- (p. ej. cargar el código de seguimiento de un pedido ya cobrado) e
-- inflaba la métrica. closed_at se fija solo cuando el status pasa de
-- 'open' a 'won' / 'lost' y se limpia si el deal se reabre. El trigger se
-- llama trg_deals_t_closed_at para correr DESPUÉS de trg_deals_sync_status
-- (043): Postgres ejecuta los triggers del mismo evento en orden alfabético.
-- ------------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE deals
SET closed_at = COALESCE(updated_at, created_at)
WHERE closed_at IS NULL AND status IN ('won', 'lost');

CREATE OR REPLACE FUNCTION public.set_deal_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
      -- won → lost (o al revés) también cuenta como nuevo cierre.
      NEW.closed_at := NOW();
    END IF;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_t_closed_at ON deals;
CREATE TRIGGER trg_deals_t_closed_at
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.set_deal_closed_at();
