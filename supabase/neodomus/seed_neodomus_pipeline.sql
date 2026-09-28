-- Crea/actualiza el pipeline "NeoDomus Ventas" para UNA cuenta.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de 043.
-- Cambiar v_email por el email con el que se inicia sesión en WaCRM.
DO $$
DECLARE
  v_email       TEXT := 'neodomusarg@gmail.com';
  v_user_id     UUID;
  v_account_id  UUID;
  v_pipeline_id UUID;
  v_stage_id    UUID;
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

  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = v_account_id AND name = 'NeoDomus Ventas'
  ORDER BY created_at
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    INSERT INTO pipelines (user_id, account_id, name)
    VALUES (v_user_id, v_account_id, 'NeoDomus Ventas')
    RETURNING id INTO v_pipeline_id;
  END IF;

  FOR s IN
    SELECT * FROM (VALUES
      (0, 'Por contactar',          '#4f46e5', 'active'),
      (1, 'Primer mensaje enviado', '#0284c7', 'active'),
      (2, 'En conversación',        '#8b5cf6', 'active'),
      (3, 'Reunión agendada',       '#d97706', 'active'),
      (4, 'Presupuesto enviado',    '#d946ef', 'active'),
      (5, 'En pausa / Recontactar', '#64748b', 'paused'),
      (6, 'Ganado',                 '#059669', 'won'),
      (7, 'Perdido',                '#e11d48', 'lost')
    ) AS t(pos, stage_name, stage_color, stage_kind)
  LOOP
    v_stage_id := NULL;
    SELECT id INTO v_stage_id
    FROM pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND name = s.stage_name
    LIMIT 1;

    IF v_stage_id IS NULL THEN
      INSERT INTO pipeline_stages (pipeline_id, name, position, color, stage_type)
      VALUES (v_pipeline_id, s.stage_name, s.pos, s.stage_color, s.stage_kind);
    ELSE
      UPDATE pipeline_stages
      SET position = s.pos, color = s.stage_color, stage_type = s.stage_kind
      WHERE id = v_stage_id;
    END IF;
  END LOOP;

  -- Etapas ajenas a la lista (si las hubiera) van al final, sin borrarlas
  -- (deals.stage_id no tiene ON DELETE, borrar podría fallar).
  UPDATE pipeline_stages
  SET position = 100 + position
  WHERE pipeline_id = v_pipeline_id
    AND position < 100
    AND name NOT IN (
      'Por contactar', 'Primer mensaje enviado', 'En conversación',
      'Reunión agendada', 'Presupuesto enviado', 'En pausa / Recontactar',
      'Ganado', 'Perdido'
    );

  RAISE NOTICE 'Pipeline NeoDomus Ventas listo: %', v_pipeline_id;
END $$;

-- Verificación
SELECT s.position, s.name, s.color, s.stage_type
FROM pipeline_stages s
JOIN pipelines p ON p.id = s.pipeline_id
WHERE p.name = 'NeoDomus Ventas'
ORDER BY s.position;
