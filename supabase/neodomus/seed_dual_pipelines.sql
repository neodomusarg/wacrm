-- Crea / adapta los embudos duales de Neo Domus para UNA cuenta.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de la migración 044.
--
--   v_email               → email con el que se inicia sesión en WaCRM
--   v_adopt_online_name   → pipeline EXISTENTE a convertir en "Ventas Online"
--                           (NULL = crear uno nuevo). Sus deals no se tocan:
--                           las etapas que coinciden por nombre se reutilizan,
--                           las que faltan se agregan y las que sobran pasan
--                           al final (posición 100+) para moverlas a mano.
--   v_adopt_projects_name → ídem para "Proyectos e Instalaciones".
--
-- Idempotente: se puede correr varias veces.
-- Las etapas deben coincidir con ONLINE_PIPELINE / PROJECTS_PIPELINE en
-- src/lib/neodomus.ts (lo verifica src/lib/neodomus-pipelines.test.ts).
DO $$
DECLARE
  v_email               TEXT := 'neodomusarg@gmail.com';
  v_adopt_online_name   TEXT := 'WS / TiendaNube';
  v_adopt_projects_name TEXT := NULL;

  v_user_id     UUID;
  v_account_id  UUID;
  v_pipeline_id UUID;
  v_stage_id    UUID;
  v_line        TEXT;
  v_name        TEXT;
  v_adopt       TEXT;
  s             RECORD;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No existe un usuario con email %', v_email;
  END IF;

  SELECT account_id INTO v_account_id FROM profiles WHERE user_id = v_user_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'El usuario % no está vinculado a ninguna cuenta', v_email;
  END IF;

  UPDATE accounts SET default_currency = 'ARS' WHERE id = v_account_id;

  FOREACH v_line IN ARRAY ARRAY['online', 'projects'] LOOP
    v_name  := CASE v_line WHEN 'online' THEN 'Ventas Online (B2C)'
                           ELSE 'Proyectos e Instalaciones (B2B Córdoba)' END;
    v_adopt := CASE v_line WHEN 'online' THEN v_adopt_online_name
                           ELSE v_adopt_projects_name END;
    v_pipeline_id := NULL;

    -- 1) Ya existe uno con esta línea de negocio
    SELECT id INTO v_pipeline_id FROM pipelines
    WHERE account_id = v_account_id AND business_line = v_line
    ORDER BY created_at LIMIT 1;

    -- 2) Adoptar un pipeline existente por nombre
    IF v_pipeline_id IS NULL AND v_adopt IS NOT NULL THEN
      SELECT id INTO v_pipeline_id FROM pipelines
      WHERE account_id = v_account_id AND name = v_adopt
      ORDER BY created_at LIMIT 1;
      IF v_pipeline_id IS NOT NULL THEN
        UPDATE pipelines SET business_line = v_line WHERE id = v_pipeline_id;
      END IF;
    END IF;

    -- 3) Crear uno nuevo
    IF v_pipeline_id IS NULL THEN
      INSERT INTO pipelines (user_id, account_id, name, business_line)
      VALUES (v_user_id, v_account_id, v_name, v_line)
      RETURNING id INTO v_pipeline_id;
    END IF;

    -- Las etapas que no son del blueprint van al final (sin borrarlas:
    -- pueden tener deals). Se hace ANTES del upsert para liberar posiciones.
    UPDATE pipeline_stages
    SET position = 100 + position
    WHERE pipeline_id = v_pipeline_id
      AND position < 100
      AND (stage_key IS NULL OR stage_key NOT LIKE CASE v_line WHEN 'online' THEN 'online_%' ELSE 'proj_%' END);

    FOR s IN
      SELECT * FROM (VALUES
        ('online',   0, 'Consulta entrante',                   '#6366f1', 'active', 'online_inquiry'),
        ('online',   1, 'Carrito / Cotización enviada',        '#0ea5e9', 'active', 'online_quote_sent'),
        ('online',   2, 'Pago pendiente',                      '#f59e0b', 'active', 'online_payment_pending'),
        ('online',   3, 'En pausa / Recontactar',              '#64748b', 'paused', 'online_paused'),
        ('online',   4, 'Compra confirmada / En preparación',  '#10b981', 'won',    'online_confirmed'),
        ('online',   5, 'Despachado',                          '#14b8a6', 'won',    'online_shipped'),
        ('online',   6, 'Entregado / Postventa',               '#059669', 'won',    'online_delivered'),
        ('online',   7, 'Perdido',                             '#e11d48', 'lost',   'online_lost'),
        ('projects', 0, 'Lead nuevo',                          '#4f46e5', 'active', 'proj_new_lead'),
        ('projects', 1, 'Relevamiento técnico / Planos',       '#0284c7', 'active', 'proj_survey'),
        ('projects', 2, 'Propuesta técnica enviada',           '#d946ef', 'active', 'proj_proposal_sent'),
        ('projects', 3, 'Negociación / Ajuste',                '#d97706', 'active', 'proj_negotiation'),
        ('projects', 4, 'En pausa / Recontactar',              '#64748b', 'paused', 'proj_paused'),
        ('projects', 5, 'Obra / Instalación agendada',         '#8b5cf6', 'active', 'proj_install_scheduled'),
        ('projects', 6, 'Instalación finalizada / Cobrado',    '#059669', 'won',    'proj_installed_paid'),
        ('projects', 7, 'Fidelización / Red de revendedores',  '#0d9488', 'won',    'proj_loyalty'),
        ('projects', 8, 'Perdido',                             '#e11d48', 'lost',   'proj_lost')
      ) AS t(line, pos, stage_name, stage_color, stage_kind, key)
      WHERE t.line = v_line
    LOOP
      v_stage_id := NULL;
      SELECT id INTO v_stage_id FROM pipeline_stages
      WHERE pipeline_id = v_pipeline_id AND (stage_key = s.key OR name = s.stage_name)
      ORDER BY (stage_key = s.key) DESC NULLS LAST
      LIMIT 1;

      IF v_stage_id IS NULL THEN
        INSERT INTO pipeline_stages (pipeline_id, name, position, color, stage_type, stage_key)
        VALUES (v_pipeline_id, s.stage_name, s.pos, s.stage_color, s.stage_kind, s.key);
      ELSE
        UPDATE pipeline_stages
        SET name = s.stage_name, position = s.pos, color = s.stage_color,
            stage_type = s.stage_kind, stage_key = s.key
        WHERE id = v_stage_id;
      END IF;
    END LOOP;

    RAISE NOTICE 'Pipeline % listo: %', v_line, v_pipeline_id;
  END LOOP;
END $$;

-- Verificación
SELECT p.name AS pipeline, p.business_line, s.position, s.name, s.stage_type, s.stage_key
FROM pipeline_stages s
JOIN pipelines p ON p.id = s.pipeline_id
WHERE p.business_line IN ('online', 'projects')
ORDER BY p.business_line, s.position;
