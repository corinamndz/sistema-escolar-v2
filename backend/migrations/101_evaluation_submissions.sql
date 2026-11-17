-- =====================================================================
-- 101 · Aula virtual: entrega de actividades y tareas en línea
--
-- 1. evaluation_activities
--      requires_submission   la actividad "requiere entrega digital en la plataforma"
--      submission_deadline   fecha y hora límite (TIMESTAMPTZ) para subir el archivo
--
-- 2. evaluation_submissions: UNA entrega por alumno y actividad.
--      status   pending    devuelta por el docente para corregir (se puede volver a subir)
--               submitted  la familia subió el archivo (a tiempo)
--               graded     el docente la calificó (la familia ya no puede reemplazarla)
--      Los alumnos SIN fila aún no entregan: la bandeja del docente los muestra
--      como "pendiente" sin necesidad de crear filas vacías.
--
--      El archivo vive en storage/submissions/<tenant>/<uuid>.<ext>, FUERA de las
--      carpetas estáticas (igual que los comprobantes de pago, 008): solo se
--      descarga por la API, que verifica que quien lo pide es el docente de la
--      actividad o el representante del alumno. Por eso se guarda la RUTA
--      relativa (file_path), nunca una URL pública.
--
--      grade guarda la nota que puso el docente desde la bandeja; la nota que
--      cuenta para el período sigue siendo activity_scores (se escriben juntas).
-- =====================================================================

ALTER TABLE evaluation_activities
  ADD COLUMN IF NOT EXISTS requires_submission  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submission_deadline  TIMESTAMPTZ;

ALTER TABLE evaluation_activities DROP CONSTRAINT IF EXISTS evaluation_activities_submission_deadline;
ALTER TABLE evaluation_activities
  ADD CONSTRAINT evaluation_activities_submission_deadline
  CHECK (NOT requires_submission OR submission_deadline IS NOT NULL);

CREATE TABLE IF NOT EXISTS evaluation_submissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id            UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  student_id             UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Archivo (NULL si el docente calificó una entrega hecha en físico).
  file_path              TEXT,
  file_mime              VARCHAR(120),
  file_original_name     VARCHAR(255),
  file_size              INTEGER CHECK (file_size IS NULL OR file_size > 0),
  submitted_at           TIMESTAMPTZ,
  submitted_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,

  status                 VARCHAR(20) NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('pending', 'submitted', 'graded')),
  grade                  NUMERIC(5,2) CHECK (grade IS NULL OR grade >= 0),
  teacher_feedback       TEXT CHECK (teacher_feedback IS NULL OR length(teacher_feedback) <= 3000),
  graded_at              TIMESTAMPTZ,
  graded_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (activity_id, student_id),
  CONSTRAINT evaluation_submissions_file_fields CHECK (
    (file_path IS NULL AND file_mime IS NULL) OR (file_path IS NOT NULL AND file_mime IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT evaluation_submissions_graded CHECK (status <> 'graded' OR (grade IS NOT NULL AND graded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_evaluation_submissions_activity ON evaluation_submissions (tenant_id, activity_id, status);
CREATE INDEX IF NOT EXISTS idx_evaluation_submissions_student  ON evaluation_submissions (student_id);

ALTER TABLE evaluation_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evaluation_submissions;
CREATE POLICY tenant_isolation ON evaluation_submissions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
