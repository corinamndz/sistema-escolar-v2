const { notify } = require('../notifications/notify');
const notifications = require('../notifications/notification.service');
const prefs = require('../notifications/notificationPreferences.service');
const { isContentReviewRequired } = require('../reviews/reviewSettings.service');

/**
 * Avisos del aula virtual (migración 102).
 *
 *   Docente   entrega recibida → aviso PERSONAL en su campana (target_user_ids),
 *             con enlace a la bandeja de esa actividad. No depende de la matriz.
 *   Familia   task_graded    la tarea fue calificada o devuelta para corregir
 *             task_reminder  N días antes de la hora límite, si aún no entrega
 *                            (tarea diaria, src/jobs/dailyRemindersJob.js)
 *
 * Los avisos a la familia NO incluyen la nota: con cuotas vencidas el portal
 * la oculta, y el aviso no debe revelarla. El comentario de una devolución sí
 * va (la familia lo necesita para corregir y el portal también lo muestra).
 *
 * Todo corre en un punto de guardado y atrapa sus errores: un aviso que falla
 * nunca revierte la entrega o la calificación que lo disparó.
 */

const TZ = 'America/Caracas';
const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "vie 20/11 a las 6:00 p. m." en hora de Venezuela. */
function deadlineText(date) {
  return new Intl.DateTimeFormat('es-VE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

async function taskContext(trx, tenantId, activityId, studentId) {
  const activity = await trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .leftJoin('staff as st', 'st.id', 'ep.teacher_id')
    .where({ 'a.id': activityId, 'a.tenant_id': tenantId })
    .first('a.title', 'a.submission_deadline', trx.raw('COALESCE(sub.name, ep.subject) AS subject'), 'st.user_id as teacher_user_id');
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('first_name', 'last_name');
  return activity && student ? { ...activity, ...student } : null;
}

/** Aviso al docente del plan: llegó (o se reemplazó) una entrega. */
async function notifyTeacherOfSubmission(trx, tenantId, { activityId, studentId, late, replaced, submittedByUserId }) {
  try {
    await trx.transaction(async (sp) => {
      const c = await taskContext(sp, tenantId, activityId, studentId);
      if (!c?.teacher_user_id || c.teacher_user_id === submittedByUserId) return;
      const student = `${c.first_name} ${c.last_name}`;
      await notifications.createNotification(sp, tenantId, {
        type: 'task_submitted',
        title: clip(`${replaced ? 'Entrega actualizada' : 'Nueva entrega'}: ${c.title}`, 150),
        body: clip(`${student} ${replaced ? 'reemplazó el archivo de' : 'entregó'} la tarea «${c.title}» de ${c.subject}${late ? ' (fuera de plazo)' : ''}.`, 500),
        targetUserIds: [c.teacher_user_id],
        data: { activity_id: activityId, student_id: studentId, late: Boolean(late), links: { users: `/submissions/${activityId}` }, link_label: 'Abrir bandeja' },
      });
    });
  } catch (err) {
    console.error('[avisos] No se pudo avisar al docente de la entrega:', err.message);
  }
}

/** Aviso a la familia: tarea calificada (`returned` = false) o devuelta para corregir. */
async function notifyFamilyOfReview(trx, tenantId, opts) {
  try {
    await trx.transaction((sp) => emitFamilyReview(sp, tenantId, opts));
  } catch (err) {
    console.error('[avisos] No se pudo avisar a la familia de la revisión de la tarea:', err.message);
  }
}

async function emitFamilyReview(trx, tenantId, { activityId, studentId, returned, feedback }) {
  const c = await taskContext(trx, tenantId, activityId, studentId);
  if (!c) return;
  const guardianIds = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where({ 'g.tenant_id': tenantId, 'sg.student_id': studentId })
    .pluck('sg.guardian_id');
  if (!guardianIds.length) return;
  const student = `${c.first_name} ${c.last_name}`;
  await notify(trx, tenantId, {
    event: 'task_graded',
    guardianIds,
    title: returned ? 'Tarea devuelta para corregir' : 'Tarea calificada',
    body: returned
      ? `El docente devolvió la tarea «${c.title}» de ${c.subject} de su representado ${student} para que la corrija y la vuelva a subir.${feedback ? `\n\nComentario: ${clip(feedback, 400)}` : ''}`
      : `La tarea «${c.title}» de ${c.subject} de su representado ${student} fue calificada. Revise la nota y los comentarios del docente en el portal.`,
    data: { activity_id: activityId, student_id: studentId, returned: Boolean(returned) },
    links: { guardians: `/portal/students/${studentId}?tab=tasks` },
    linkLabel: 'Ver tareas',
    // Calificada: un solo aviso aunque el docente corrija la nota después. Devuelta: cada devolución avisa.
    dedupeKey: returned ? `task_returned:${activityId}:${studentId}:${Date.now()}` : `task_graded:${activityId}:${studentId}`,
  });
}

/**
 * Tareas por entregar a recordar hoy: una fila por (actividad, alumno sin
 * entrega o con entrega devuelta), cuya hora límite aún no pasa y cae dentro
 * de los próximos N días (fechas en hora de Venezuela):
 *
 *     ahora < límite   y   fecha(límite) ≤ hoy + N
 *
 * La ventana cubre también un día en que el servidor estuvo apagado o un
 * cambio de N; la clave de deduplicación evita repetir el aviso, y si el
 * docente cambia la hora límite se recuerda la nueva.
 */
async function dueTasks(trx, tenantId, days, onlyApproved) {
  const { rows } = await trx.raw(
    `
    WITH today AS (SELECT (now() AT TIME ZONE CAST(:tz AS text))::date AS d)
    SELECT DISTINCT ON (a.id, s.id)
           a.id AS activity_id, a.title, a.submission_deadline,
           COALESCE(sub.name, ep.subject) AS subject_name,
           ((a.submission_deadline AT TIME ZONE CAST(:tz AS text))::date - today.d) AS days_left,
           s.id AS student_id, s.first_name, s.last_name
    FROM evaluation_activities a
    JOIN evaluation_plans ep           ON ep.id = a.evaluation_plan_id
    JOIN evaluation_plan_sections eps  ON eps.plan_id = ep.id
    LEFT JOIN subjects sub             ON sub.id = ep.subject_id
    JOIN enrollments e                 ON e.section_id = eps.section_id AND e.status = 'active'
    JOIN students s                    ON s.id = e.student_id
    LEFT JOIN evaluation_submissions es ON es.activity_id = a.id AND es.student_id = s.id
    CROSS JOIN today
    WHERE a.tenant_id = CAST(:tenantId AS uuid)
      AND a.requires_submission
      AND (NOT CAST(:onlyApproved AS boolean) OR ep.review_status = 'aprobado')
      AND a.submission_deadline > now()
      AND (a.submission_deadline AT TIME ZONE CAST(:tz AS text))::date <= today.d + CAST(:days AS integer)
      AND (es.id IS NULL OR es.status = 'pending')
    ORDER BY a.id, s.id`,
    { tz: TZ, tenantId, onlyApproved, days }
  );
  return rows;
}

/** Recordatorios del día del colegio (tarea diaria): { days, tasks, students, sent }. */
async function sendTaskReminders(trx, tenantId) {
  const [bell, email] = await Promise.all([prefs.isEnabled(trx, tenantId, 'task_reminder', 'bell'), prefs.isEnabled(trx, tenantId, 'task_reminder', 'email')]);
  const days = (await prefs.reminderSettings(trx, tenantId)).taskReminderDays;
  if (!bell && !email) return { days, tasks: 0, students: 0, sent: 0, disabled: true };

  const due = await dueTasks(trx, tenantId, days, await isContentReviewRequired(trx, tenantId));
  if (!due.length) return { days, tasks: 0, students: 0, sent: 0 };

  const links = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('g.tenant_id', tenantId)
    .whereIn('sg.student_id', [...new Set(due.map((r) => r.student_id))])
    .select('sg.student_id', 'sg.guardian_id');
  const guardiansOf = new Map();
  for (const l of links) guardiansOf.set(l.student_id, [...(guardiansOf.get(l.student_id) || []), l.guardian_id]);

  let sent = 0;
  for (const r of due) {
    const guardianIds = guardiansOf.get(r.student_id);
    if (!guardianIds?.length) continue;
    const daysLeft = Number(r.days_left);
    const when = daysLeft <= 0 ? 'hoy' : daysLeft === 1 ? 'mañana' : `en ${daysLeft} días`;
    const { bell: created } = await notify(trx, tenantId, {
      event: 'task_reminder',
      guardianIds,
      title: 'Recordatorio de tarea por entregar',
      body: `Recordatorio: Su representado ${r.first_name} ${r.last_name} debe entregar la tarea «${r.title}» de ${r.subject_name} en la plataforma. La hora límite es ${when} (${deadlineText(r.submission_deadline)}).`,
      data: { activity_id: r.activity_id, student_id: r.student_id, deadline: r.submission_deadline, days_left: daysLeft },
      links: { guardians: `/portal/students/${r.student_id}?tab=tasks` },
      linkLabel: 'Entregar tarea',
      dedupeKey: `task_reminder:${r.activity_id}:${r.student_id}:${new Date(r.submission_deadline).toISOString()}`,
    });
    if (created) sent += 1;
  }
  return { days, tasks: new Set(due.map((r) => r.activity_id)).size, students: new Set(due.map((r) => r.student_id)).size, sent };
}

module.exports = { notifyTeacherOfSubmission, notifyFamilyOfReview, sendTaskReminders, dueTasks };
