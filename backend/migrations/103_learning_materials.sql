-- =====================================================================
-- 103 · Material de apoyo del contenido programático (aprendizaje en línea)
--
-- programmatic_content.week_number   semana de clase del tema (opcional, 1–52).
--
-- learning_materials: recursos de cada TEMA del contenido programático
-- (grado + materia + año escolar, 038/068), que publica el docente:
--   file   guía, presentación, documento, hoja de cálculo o imagen (archivo privado)
--   video  enlace de YouTube o Vimeo, que se reproduce embebido
--   link   enlace externo (https)
--   audio  nota de voz explicativa (archivo privado, hasta 5 minutos)
--   pill   "píldora de conocimiento": texto breve
--
-- Visibilidad: status 'draft' (solo el docente) o 'published'. Publicado con
-- publish_at en el futuro = PROGRAMADO: las familias lo ven desde esa hora.
-- No pasa por la revisión académica (058/059): el docente lo publica directo y
-- coordinación puede devolverlo a borrador. Las familias solo ven materiales de
-- temas visibles (programa aprobado, si la revisión está activa).
--
-- Los archivos viven en storage/learning/<tenant>/<uuid>.<ext>, fuera de las
-- carpetas estáticas: se sirven por la API, que verifica quién los pide.
-- notified_at: cuándo se avisó a las familias (aviso learning_material); los
-- programados los avisa la tarea diaria cuando llega su hora.
--
-- learning_material_progress: por alumno y material, cuándo lo abrió (viewed_at)
-- y cuándo lo marcó "¡Lo logré!" (completed_at). Lo marca la familia desde el
-- portal o el alumno en el "modo alumno" de la cuenta de su representante.
-- =====================================================================

ALTER TABLE programmatic_content ADD COLUMN IF NOT EXISTS week_number SMALLINT;
ALTER TABLE programmatic_content DROP CONSTRAINT IF EXISTS ck_programmatic_content_week;
ALTER TABLE programmatic_content ADD CONSTRAINT ck_programmatic_content_week CHECK (week_number IS NULL OR week_number BETWEEN 1 AND 52);

CREATE TABLE IF NOT EXISTS learning_materials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_id           UUID NOT NULL REFERENCES programmatic_content(id) ON DELETE CASCADE,
  type                 VARCHAR(10) NOT NULL CHECK (type IN ('file', 'video', 'link', 'audio', 'pill')),
  title                VARCHAR(150) NOT NULL CHECK (length(btrim(title)) > 0),
  description          VARCHAR(1000),
  position             INT NOT NULL DEFAULT 0,

  -- file / audio
  kind                 VARCHAR(20) CHECK (kind IS NULL OR kind IN ('pdf', 'presentation', 'document', 'spreadsheet', 'image', 'audio')),
  file_path            TEXT,
  file_mime            VARCHAR(120),
  file_original_name   VARCHAR(255),
  file_size            INTEGER CHECK (file_size IS NULL OR file_size > 0),
  -- video / link
  url                  VARCHAR(1000),
  provider             VARCHAR(10) CHECK (provider IS NULL OR provider IN ('youtube', 'vimeo')),
  video_id             VARCHAR(40),
  -- audio / video
  duration_seconds     INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 36000),
  -- pill
  body                 TEXT CHECK (body IS NULL OR length(body) <= 1500),

  status               VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  publish_at           TIMESTAMPTZ,
  notified_at          TIMESTAMPTZ,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_learning_materials_shape CHECK (
    CASE type
      WHEN 'file'  THEN file_path IS NOT NULL AND file_mime IS NOT NULL AND kind IS NOT NULL
      WHEN 'audio' THEN file_path IS NOT NULL AND file_mime IS NOT NULL AND (duration_seconds IS NULL OR duration_seconds <= 300)
      WHEN 'video' THEN url IS NOT NULL AND provider IS NOT NULL AND video_id IS NOT NULL
      WHEN 'link'  THEN url IS NOT NULL AND url LIKE 'https://%'
      WHEN 'pill'  THEN body IS NOT NULL AND length(btrim(body)) > 0
    END
  )
);
CREATE INDEX IF NOT EXISTS idx_learning_materials_content ON learning_materials (tenant_id, content_id, position);
CREATE INDEX IF NOT EXISTS idx_learning_materials_pending_notice ON learning_materials (tenant_id, publish_at)
  WHERE status = 'published' AND notified_at IS NULL;

CREATE TABLE IF NOT EXISTS learning_material_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  material_id           UUID NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  viewed_at             TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  completed_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (material_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_progress_student ON learning_material_progress (tenant_id, student_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['learning_materials', 'learning_material_progress']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid);', t);
  END LOOP;
END $$;

-- Aviso nuevo de la matriz: learning_material ("Material de apoyo publicado").
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS ck_notification_preferences_event_type;
ALTER TABLE notification_preferences
  ADD CONSTRAINT ck_notification_preferences_event_type
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting',
                        'evaluation_plan', 'evaluation_reminder', 'payment_overdue', 'recognition', 'subject_carryover',
                        'task_reminder', 'task_graded', 'learning_material'));
