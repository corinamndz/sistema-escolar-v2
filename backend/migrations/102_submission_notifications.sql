-- =====================================================================
-- 102 · Aula virtual: avisos de las entregas de tareas
--
-- Nuevos avisos de la matriz (Configuración → Notificaciones):
--   task_reminder   recordatorio automático (tarea diaria) a la familia de cada
--                   alumno que aún no entrega, N días antes de la hora límite
--   task_graded     la tarea del alumno fue calificada o devuelta para corregir
--
-- tenant_settings.task_reminder_days   con cuántos días de anticipación se
--   recuerda (0 = el mismo día del plazo; 1 = la víspera…). Lo elige el
--   colegio en la fila del aviso.
--
-- El aviso al DOCENTE cuando llega una entrega es personal (campana,
-- notifications.target_user_ids, 059): no pasa por la matriz de las familias.
--
-- La restricción de event_type se rehace con todos los avisos del catálogo
-- (incluye subject_carryover, que estaba en el catálogo pero faltaba aquí).
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS task_reminder_days SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_settings_task_reminder_days' AND conrelid = 'tenant_settings'::regclass) THEN
    ALTER TABLE tenant_settings ADD CONSTRAINT ck_tenant_settings_task_reminder_days CHECK (task_reminder_days BETWEEN 0 AND 7);
  END IF;
END $$;

ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS ck_notification_preferences_event_type;
ALTER TABLE notification_preferences
  ADD CONSTRAINT ck_notification_preferences_event_type
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting',
                        'evaluation_plan', 'evaluation_reminder', 'payment_overdue', 'recognition', 'subject_carryover',
                        'task_reminder', 'task_graded'));
