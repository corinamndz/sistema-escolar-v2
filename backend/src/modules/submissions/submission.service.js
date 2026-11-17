const { ApiError } = require('../../utils/ApiError');
const grading = require('../grading/grading.service');
const teacherScope = require('../access/teacherScope');
const { isContentReviewRequired: familiesSeeOnlyApproved } = require('../reviews/reviewSettings.service');
const { resolveSubmissionFile } = require('../../services/storage/submissionStorage');
const notices = require('./submissionNotices');

/**
 * Aula virtual: entrega de actividades y tareas en línea (migración 101).
 *
 * Una actividad del plan de evaluación con `requires_submission` recibe UNA
 * entrega por alumno (evaluation_submissions), que sube el representante desde
 * el portal antes de `submission_deadline`.
 *
 * Estados (lo que ven docente y familia):
 *   pending    la familia debe entregar: aún no hay archivo (sin fila) o el
 *              docente la devolvió para corregir (fila con status 'pending')
 *   submitted  entregada, esperando calificación
 *   graded     calificada: la nota también queda en activity_scores (la que
 *              cuenta para el período), así la libreta y el portal la ven igual
 *
 * Reglas:
 *   - Se puede subir o reemplazar mientras no esté calificada, también después
 *     de la hora límite: esas entregas quedan marcadas "fuera de plazo" (late).
 *   - Avisos (submissionNotices.js): al docente cuando llega una entrega; a la
 *     familia cuando se califica o se devuelve, y recordatorio antes del plazo.
 *   - Actividades con indicadores (formato detallado): la nota se carga por
 *     indicador en la libreta; la bandeja toma esa nota al marcarla calificada.
 */

const STATUS = { PENDING: 'pending', SUBMITTED: 'submitted', GRADED: 'graded' };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const isPastDeadline = (deadline, now = new Date()) => Boolean(deadline) && new Date(deadline) < now;

/**
 * ¿La familia puede subir (o reemplazar) el archivo? Siempre, salvo que ya esté
 * calificada. Después de la hora límite la entrega se acepta como "fuera de plazo".
 */
function canSubmit(activity, submission) {
  return submission?.status !== STATUS.GRADED;
}

const presentSubmission = (s, { withGrade = true } = {}) =>
  s && s.submission_id
    ? {
        id: s.submission_id,
        status: s.status,
        has_file: Boolean(s.file_path),
        file_original_name: s.file_original_name,
        file_mime: s.file_mime,
        file_size: s.file_size,
        submitted_at: s.submitted_at,
        late: Boolean(s.submitted_at && s.submission_deadline && new Date(s.submitted_at) > new Date(s.submission_deadline)),
        grade: withGrade && s.grade !== null && s.grade !== undefined ? Number(s.grade) : null,
        teacher_feedback: withGrade || s.status === STATUS.PENDING ? s.teacher_feedback : null,
        graded_at: withGrade ? s.graded_at : null,
      }
    : null;

// =====================================================================
// Portal del representante
// =====================================================================

/**
 * Actividades con entrega digital de las secciones donde el alumno está
 * inscrito (activo), de planes publicados para las familias.
 */
function familyActivitiesQuery(trx, tenantId, studentId, { onlyApproved }) {
  return trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .join('evaluation_plan_sections as x', 'x.plan_id', 'ep.id')
    .join('enrollments as e', function enrolled() {
      this.on('e.section_id', '=', 'x.section_id').andOnVal('e.student_id', '=', studentId);
    })
    .join('terms as t', 't.id', 'ep.term_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .leftJoin('staff as st', 'st.id', 'ep.teacher_id')
    // Fecha de aplicación en la sección del alumno (o la estimada del plan).
    .leftJoin('activity_section_dates as asd', function sectionDate() {
      this.on('asd.activity_id', '=', 'a.id').andOn('asd.section_id', '=', 'x.section_id');
    })
    .leftJoin('evaluation_submissions as es', function own() {
      this.on('es.activity_id', '=', 'a.id').andOn('es.student_id', '=', 'e.student_id');
    })
    .where({ 'a.tenant_id': tenantId, 'a.requires_submission': true, 'e.status': 'active' })
    .modify((q) => onlyApproved && q.andWhere('ep.review_status', 'aprobado'))
    // Una fila por actividad aunque el alumno figure en dos secciones del mismo plan.
    .distinctOn('a.id')
    .orderBy('a.id')
    .select(
      'a.id',
      'a.title',
      'a.description',
      'a.category',
      'a.max_score',
      'a.weight_percent',
      'a.submission_deadline',
      trx.raw("to_char(COALESCE(asd.applied_on, a.planned_date), 'YYYY-MM-DD') AS applied_on"),
      'ep.id as plan_id',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject'),
      't.name as term_name',
      't.term_number',
      trx.raw("NULLIF(concat_ws(' ', st.first_name, st.last_name), '') AS teacher_name"),
      'es.id as submission_id',
      'es.status',
      'es.file_path',
      'es.file_mime',
      'es.file_original_name',
      'es.file_size',
      'es.submitted_at',
      'es.grade',
      'es.teacher_feedback',
      'es.graded_at'
    );
}

/**
 * GET /portal/students/:studentId/tasks — tareas con entrega digital del alumno.
 * `showGrades` = false si las calificaciones están bloqueadas por cuotas vencidas:
 * la familia puede seguir entregando, pero no ve nota ni retroalimentación de lo calificado.
 */
async function listStudentTasks(trx, tenantId, studentId, { showGrades = true } = {}) {
  const onlyApproved = await familiesSeeOnlyApproved(trx, tenantId);
  const rows = (await familyActivitiesQuery(trx, tenantId, studentId, { onlyApproved })).sort(
    (a, b) => new Date(a.submission_deadline) - new Date(b.submission_deadline)
  );
  const now = new Date();
  const tasks = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    subject: r.subject,
    term_name: r.term_name,
    term_number: r.term_number,
    teacher_name: r.teacher_name,
    max_score: Number(r.max_score),
    weight_percent: Number(r.weight_percent),
    deadline: r.submission_deadline,
    // Fecha en que se aplica la actividad (la del plan de evaluación); distinta de la hora límite de entrega.
    applied_on: r.applied_on,
    is_open: !isPastDeadline(r.submission_deadline, now),
    status: r.submission_id ? r.status : STATUS.PENDING,
    can_submit: canSubmit(r, r.submission_id ? r : null),
    // Entregar ahora quedaría fuera de plazo.
    would_be_late: isPastDeadline(r.submission_deadline, now),
    submission: presentSubmission(r, { withGrade: showGrades }),
  }));
  return {
    grades_locked: !showGrades,
    tasks,
    totals: {
      pending: tasks.filter((t) => t.status === STATUS.PENDING).length,
      submitted: tasks.filter((t) => t.status === STATUS.SUBMITTED).length,
      graded: tasks.filter((t) => t.status === STATUS.GRADED).length,
      // Pendientes con la hora límite ya pasada (aún se pueden entregar, fuera de plazo).
      overdue: tasks.filter((t) => t.status === STATUS.PENDING && t.would_be_late).length,
    },
  };
}

async function loadFamilyTask(trx, tenantId, studentId, activityId) {
  const onlyApproved = await familiesSeeOnlyApproved(trx, tenantId);
  const row = await familyActivitiesQuery(trx, tenantId, studentId, { onlyApproved }).andWhere('a.id', activityId).first();
  if (!row) throw ApiError.notFound('Tarea no encontrada.');
  return row;
}

/**
 * POST /portal/students/:studentId/tasks/:activityId/submission — la familia
 * sube (o reemplaza) el archivo. `file` ya fue guardado y validado por el
 * controlador; aquí solo se registran sus datos.
 * Devuelve { task, replacedFilePath } (el archivo anterior se borra al confirmar).
 */
async function submitTask(trx, tenantId, userId, studentId, activityId, file) {
  if (!file) throw ApiError.badRequest('Adjunta el archivo de la tarea.', [{ path: 'file', message: 'Requerido.' }]);
  const task = await loadFamilyTask(trx, tenantId, studentId, activityId);
  // Bloqueo de la fila (si existe) para que dos subidas simultáneas no se pisen.
  const existing = await trx('evaluation_submissions').where({ tenant_id: tenantId, activity_id: activityId, student_id: studentId }).forUpdate().first();

  if (!canSubmit(task, existing)) {
    throw ApiError.conflict('Esta tarea ya fue calificada: no se puede reemplazar el archivo.');
  }

  const fields = {
    ...file,
    submitted_at: trx.fn.now(),
    submitted_by_user_id: userId,
    status: STATUS.SUBMITTED,
    updated_at: trx.fn.now(),
  };
  if (existing) {
    await trx('evaluation_submissions').where({ id: existing.id }).update(fields);
  } else {
    await trx('evaluation_submissions').insert({ tenant_id: tenantId, activity_id: activityId, student_id: studentId, ...fields });
  }
  const { tasks } = await listStudentTasks(trx, tenantId, studentId);
  const saved = tasks.find((t) => t.id === activityId);
  await notices.notifyTeacherOfSubmission(trx, tenantId, {
    activityId,
    studentId,
    late: saved?.submission?.late,
    replaced: Boolean(existing?.file_path),
    submittedByUserId: userId,
  });
  return { task: saved, replacedFilePath: existing?.file_path || null };
}

/** Archivo que entregó la familia (solo de una tarea visible para ese alumno). */
async function getFamilyFile(trx, tenantId, studentId, activityId) {
  const task = await loadFamilyTask(trx, tenantId, studentId, activityId);
  return fileOf(task);
}

function fileOf(row) {
  const absolutePath = row?.file_path ? resolveSubmissionFile(row.file_path) : null;
  if (!absolutePath) throw ApiError.notFound('Esta entrega no tiene archivo adjunto.');
  return { absolutePath, mime: row.file_mime, name: row.file_original_name || 'tarea' };
}

// =====================================================================
// Bandeja de calificación del docente
// =====================================================================

/**
 * GET /submissions/inbox — actividades con entrega digital de los años
 * escolares activos, con sus contadores. Docente / coordinador: solo las de su
 * carga o su nivel (teacherScope.getAccessScope).
 */
async function listInbox(req) {
  const { db: trx, tenantId } = req;
  const rows = await trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('school_periods as sp', 'sp.id', 't.school_period_id')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .where({ 'a.tenant_id': tenantId, 'a.requires_submission': true, 'sp.is_active': true })
    .whereNull('sp.closed_at')
    .select(
      'a.id',
      'a.title',
      'a.submission_deadline',
      'a.max_score',
      'ep.id as plan_id',
      'ep.subject_id',
      'ep.status as plan_status',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject'),
      't.name as term_name',
      't.term_number',
      'g.name as grade_name',
      // Alumnos activos de todas las secciones del plan.
      trx.raw(`(SELECT count(DISTINCT e.student_id) FROM enrollments e JOIN evaluation_plan_sections x ON x.section_id = e.section_id
                WHERE x.plan_id = ep.id AND e.status = 'active')::int AS students`),
      trx.raw(`(SELECT count(*) FROM evaluation_submissions es WHERE es.activity_id = a.id AND es.status = 'submitted')::int AS to_grade`),
      trx.raw(`(SELECT count(*) FROM evaluation_submissions es WHERE es.activity_id = a.id AND es.status = 'graded')::int AS graded`),
      trx.raw(`(SELECT count(*) FROM evaluation_submissions es WHERE es.activity_id = a.id AND es.status = 'pending')::int AS returned`)
    )
    .orderBy([{ column: 'a.submission_deadline', order: 'desc' }]);

  const scope = await teacherScope.getAccessScope(req);
  let visible = rows;
  if (scope && rows.length) {
    const links = await trx('evaluation_plan_sections').whereIn('plan_id', [...new Set(rows.map((r) => r.plan_id))]).select('plan_id', 'section_id');
    const sectionsOf = (planId) => links.filter((l) => l.plan_id === planId).map((l) => l.section_id);
    visible = rows.filter((r) => teacherScope.coversPlan(scope, r, sectionsOf(r.plan_id)));
  }
  const now = new Date();
  return visible.map(({ subject_id: _s, ...r }) => ({
    ...r,
    max_score: Number(r.max_score),
    is_open: !isPastDeadline(r.submission_deadline, now),
    not_submitted: Math.max(0, r.students - r.to_grade - r.graded - r.returned),
  }));
}

async function loadStaffActivity(trx, tenantId, activityId) {
  const activity = await trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .where({ 'a.id': activityId, 'a.tenant_id': tenantId })
    .first(
      'a.id',
      'a.title',
      'a.description',
      'a.max_score',
      'a.weight_percent',
      'a.requires_submission',
      'a.submission_deadline',
      'ep.id as plan_id',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject'),
      't.name as term_name',
      'g.name as grade_name',
      'g.grading_scale'
    );
  if (!activity) throw ApiError.notFound('Actividad no encontrada.');
  if (!activity.requires_submission) throw ApiError.unprocessable('Esta actividad no requiere entrega digital.');
  activity.max_score = Number(activity.max_score);
  activity.has_indicators = Boolean(await trx('evaluation_indicators').where({ activity_id: activityId }).first('id'));
  return activity;
}

/**
 * GET /submissions/activities/:activityId?sectionId= — la actividad y cada
 * alumno de las secciones del plan con su entrega (o "pendiente" si no hay) y
 * la nota de la libreta (activity_scores, la que cuenta).
 */
async function getActivityRoster(trx, tenantId, activityId, { sectionId } = {}) {
  const activity = await loadStaffActivity(trx, tenantId, activityId);
  const sections = await trx('evaluation_plan_sections as x')
    .join('sections as sec', 'sec.id', 'x.section_id')
    .where('x.plan_id', activity.plan_id)
    .select('sec.id', 'sec.name')
    .orderBy('sec.name');

  const rows = await trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .join('evaluation_plan_sections as x', 'x.section_id', 'e.section_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .leftJoin('evaluation_submissions as es', function own() {
      this.on('es.student_id', '=', 's.id').andOnVal('es.activity_id', '=', activityId);
    })
    .leftJoin('activity_scores as sc', function score() {
      this.on('sc.student_id', '=', 's.id').andOnVal('sc.evaluation_activity_id', '=', activityId);
    })
    .where({ 'x.plan_id': activity.plan_id, 'e.tenant_id': tenantId })
    // Activos, o retirados que alcanzaron a entregar (su trabajo no desaparece de la bandeja).
    .andWhere((q) => q.where('e.status', 'active').orWhereNotNull('es.id'))
    .modify((q) => sectionId && q.andWhere('e.section_id', sectionId))
    .distinctOn('s.id')
    .select(
      's.id as student_id',
      's.first_name',
      's.last_name',
      's.national_id',
      'sec.id as section_id',
      'sec.name as section_name',
      'es.id as submission_id',
      'es.status',
      'es.file_path',
      'es.file_mime',
      'es.file_original_name',
      'es.file_size',
      'es.submitted_at',
      'es.grade',
      'es.teacher_feedback',
      'es.graded_at',
      'sc.raw_score'
    )
    .orderBy('s.id')
    .orderByRaw("(e.status = 'active') DESC");

  const students = rows
    .map((r) => ({
      student_id: r.student_id,
      name: `${r.last_name}, ${r.first_name}`,
      national_id: r.national_id,
      section: { id: r.section_id, name: r.section_name },
      status: r.submission_id ? r.status : STATUS.PENDING,
      submission: presentSubmission({ ...r, submission_deadline: activity.submission_deadline }),
      // La nota de la libreta manda (pudo cargarse ahí o por indicadores).
      score: r.raw_score !== null ? Number(r.raw_score) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return {
    activity: { ...activity, is_open: !isPastDeadline(activity.submission_deadline) },
    sections,
    students,
    totals: {
      students: students.length,
      pending: students.filter((s) => s.status === STATUS.PENDING).length,
      submitted: students.filter((s) => s.status === STATUS.SUBMITTED).length,
      graded: students.filter((s) => s.status === STATUS.GRADED).length,
    },
  };
}

/** Archivo entregado por un alumno (bandeja del docente). */
async function getStaffFile(trx, tenantId, activityId, studentId) {
  const row = await trx('evaluation_submissions').where({ tenant_id: tenantId, activity_id: activityId, student_id: studentId }).first();
  return fileOf(row);
}

/**
 * PUT /submissions/activities/:activityId/students/:studentId/grade
 *   { grade?, literal?, feedback? }
 * Califica la entrega y registra la nota en la libreta (grading.upsertScore:
 * valida el rango y que el alumno sea de una sección del plan). Si no hay
 * entrega digital (la trajo en físico) se crea la fila sin archivo.
 * Actividades con indicadores: no se envía nota; se toma la de la libreta.
 */
async function gradeSubmission(trx, tenantId, userId, activityId, studentId, { grade, literal, feedback }) {
  const activity = await loadStaffActivity(trx, tenantId, activityId);
  let finalGrade;
  if (activity.has_indicators) {
    if (grade !== undefined || literal) {
      throw ApiError.badRequest('Esta actividad se califica por indicadores: carga la nota en la libreta de calificaciones.', [
        { path: 'grade', message: 'Califica por indicadores.' },
      ]);
    }
    const score = await trx('activity_scores').where({ evaluation_activity_id: activityId, student_id: studentId }).first('raw_score');
    if (!score) {
      throw ApiError.unprocessable('Primero carga la nota por indicadores en la libreta; luego marca la entrega como calificada.', [
        { path: 'grade', message: 'Sin nota en la libreta.' },
      ]);
    }
    finalGrade = Number(score.raw_score);
  } else {
    if (grade === undefined && !literal) throw ApiError.badRequest('Indica la nota.', [{ path: 'grade', message: 'Requerida.' }]);
    const score = await grading.upsertScore(trx, tenantId, { activityId, studentId, rawScore: grade, literal });
    finalGrade = Number(score.raw_score);
  }

  const fields = {
    status: STATUS.GRADED,
    grade: round2(finalGrade),
    teacher_feedback: feedback?.trim() || null,
    graded_at: trx.fn.now(),
    graded_by_user_id: userId,
    updated_at: trx.fn.now(),
  };
  const existing = await trx('evaluation_submissions').where({ tenant_id: tenantId, activity_id: activityId, student_id: studentId }).forUpdate().first('id');
  if (existing) await trx('evaluation_submissions').where({ id: existing.id }).update(fields);
  else await trx('evaluation_submissions').insert({ tenant_id: tenantId, activity_id: activityId, student_id: studentId, ...fields });

  await notices.notifyFamilyOfReview(trx, tenantId, { activityId, studentId, returned: false });
  return studentRow(trx, tenantId, activityId, studentId);
}

/**
 * POST /submissions/activities/:activityId/students/:studentId/return { feedback }
 * Devuelve una entrega (sin calificar) para que la familia la corrija y la
 * vuelva a subir, aunque haya pasado la hora límite.
 */
async function returnSubmission(trx, tenantId, userId, activityId, studentId, { feedback }) {
  await loadStaffActivity(trx, tenantId, activityId);
  const existing = await trx('evaluation_submissions').where({ tenant_id: tenantId, activity_id: activityId, student_id: studentId }).forUpdate().first();
  if (!existing?.file_path) throw ApiError.notFound('Este alumno no tiene una entrega para devolver.');
  if (existing.status === STATUS.GRADED) throw ApiError.conflict('La entrega ya está calificada: no se puede devolver.');
  await trx('evaluation_submissions')
    .where({ id: existing.id })
    .update({ status: STATUS.PENDING, teacher_feedback: feedback.trim(), graded_by_user_id: userId, updated_at: trx.fn.now() });
  await notices.notifyFamilyOfReview(trx, tenantId, { activityId, studentId, returned: true, feedback: feedback.trim() });
  return studentRow(trx, tenantId, activityId, studentId);
}

async function studentRow(trx, tenantId, activityId, studentId) {
  const roster = await getActivityRoster(trx, tenantId, activityId);
  return roster.students.find((s) => s.student_id === studentId) || null;
}

module.exports = {
  STATUS,
  canSubmit,
  listStudentTasks,
  submitTask,
  getFamilyFile,
  listInbox,
  getActivityRoster,
  getStaffFile,
  gradeSubmission,
  returnSubmission,
};
