-- =====================================================================
-- 104 · Enlace de clase en línea por clase (sección + materia)
--
-- class_links: el "aula virtual" de una clase (Google Meet, Zoom, Teams…),
-- que el docente configura una vez y aparece en "Hoy" junto a cada clase del
-- horario. Una fila por sección y materia; sin fila = sin enlace.
-- Solo https. Lo edita el docente de esa clase (o quien gestiona la sección).
-- =====================================================================

CREATE TABLE IF NOT EXISTS class_links (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  url          VARCHAR(500) NOT NULL CHECK (url LIKE 'https://%'),
  label        VARCHAR(60),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_class_links_tenant ON class_links (tenant_id);

ALTER TABLE class_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON class_links;
CREATE POLICY tenant_isolation ON class_links USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
