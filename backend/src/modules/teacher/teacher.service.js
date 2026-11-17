const { ApiError } = require('../../utils/ApiError');
const teacherScope = require('../access/teacherScope');
const submissions = require('../submissions/submission.service');
const { isContentReviewRequired } = require('../reviews/reviewSettings.service');
const { exclusionOf } = require('../academics/sectionSubjects');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');

/**
 * Portal del docente: sus CLASES (sección + materia, según su carga docente)
 * y el panel "Hoy" (pendientes, horario del día y próximas evaluaciones).
 *
 * Una clase sale de la carga ya existente (teacherScope): materias asignadas
 * por sección, más todas las materias de sus secciones de aula salvo las que
 * dicta un especialista. No hay datos nuevos que mantener, salvo el enlace de
 * clase en línea (class_links, 104).
 */

const TZ = 'America/Caracas';

/** Clases del docente (o null si no es un docente con carga restringida). */
async function listClasses(req) {
  const { db: trx, tenantId } = req;
  const scope = await teacherScope.getTeacherScope(req);
  if (!scope || !scope.sectionIds.length) return [];
  const rows = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .join('grade_subjects as gs', 'gs.grade_id', 'sec.grade_id')
    .join('subjects as sub', 'sub.id', 'gs.subject_id')
    .leftJoin('class_links as cl', function link() {
      this.on('cl.section_id', '=', 'sec.id').andOn('cl.subject_id', '=', 'sub.id');
    })
    .where('sec.tenant_id', tenantId)
    .whereIn('sec.id', scope.sectionIds)
    .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), trx.ref('sub.id')))
    .select(
      'sec.id as section_id',
      'sec.name as section_name',
      'g.id as grade_id',
      'g.name as grade_name',
      'g.level_code',
      'g.grading_scale',
      'sp.id as school_period_id',
      'sp.name as school_period_name',
      'sub.id as subject_id',
      'sub.name as subject_name',
      'sub.code as subject_code',
      'cl.url as link_url',
      'cl.label as link_label'
    )
    // El año en curso primero (puede haber otro activo ya preparado), luego nivel, grado, sección y materia.
    .orderByRaw(`${currentPeriodOrder('sp')}, el.sort_order, g.sort_order, sec.name, sub.name`);
  return rows
    .filter((r) => teacherScope.coversSubject(scope, r.section_id, r.subject_id))
    .map(({ link_url: url, link_label: label, ...r }) => ({ key: `${r.section_id}:${r.subject_id}`, ...r, link: url ? { url, label } : null }));
}

/** PUT enlace de clase en línea ({ url, label } o url null para quitarlo). */
async function setClassLink(req, sectionId, subjectId, { url, label }) {
  const { db: trx, tenantId } = req;
  const scope = await teacherScope.getAccessScope(req);
  if (!teacherScope.coversSubject(scope, sectionId, subjectId)) throw ApiError.notFound('Clase no encontrada o fuera de tu carga.');
  const exists = await trx('sections').where({ id: sectionId, tenant_id: tenantId }).first('id');
  if (!exists) throw ApiError.notFound('Sección no encontrada.');
  if (!url) {
    await trx('class_links').where({ tenant_id: tenantId, section_id: sectionId, subject_id: subjectId }).delete();
    return { link: null };
  }
  const row = { tenant_id: tenantId, section_id: sectionId, subject_id: subjectId, url, label: label || null, updated_by: req.user.id, updated_at: trx.fn.now() };
  await trx('class_links').insert(row).onConflict(['section_id', 'subject_id']).merge(['url', 'label', 'updated_by', 'updated_at']);
  return { link: { url, label: label || null } };
}

/** Alumnos activos de una sección de la carga del docente. */
async function sectionStudents(req, sectionId) {
  const { db: trx, tenantId } = req;
  await teacherScope.assertSectionAccess(req, sectionId);
  return trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .where({ 'e.tenant_id': tenantId, 'e.section_id': sectionId, 'e.status': 'active' })
    .select('s.id', 's.first_name', 's.last_name', 's.national_id', 's.birth_date')
    .orderBy(['s.last_name', 's.first_name']);
}

/** Evaluaciones (de sus planes, años activos) con su fecha en cada sección y cuántos alumnos faltan por calificar. */
async function evaluationsQuery(trx, tenantId, staffId, sectionIds) {
  if (!sectionIds.length) return [];
  const { rows } = await trx.raw(
    `
    SELECT a.id AS activity_id, a.title, a.category, a.weight_percent, a.requires_submission,
           ep.id AS plan_id, ep.subject_id, COALESCE(sub.name, ep.subject) AS subject_name,
           x.section_id, sec.name AS section_name, g.name AS grade_name, t.term_number, t.name AS term_name,
           COALESCE(asd.applied_on, a.planned_date)::text AS date,
           (SELECT count(*) FROM enrollments e WHERE e.section_id = x.section_id AND e.status = 'active')::int AS students,
           (SELECT count(*) FROM enrollments e WHERE e.section_id = x.section_id AND e.status = 'active'
              AND NOT EXISTS (SELECT 1 FROM activity_scores sc WHERE sc.evaluation_activity_id = a.id AND sc.student_id = e.student_id))::int AS missing
    FROM evaluation_activities a
    JOIN evaluation_plans ep ON ep.id = a.evaluation_plan_id
    JOIN evaluation_plan_sections x ON x.plan_id = ep.id
    JOIN sections sec ON sec.id = x.section_id
    JOIN grades g ON g.id = sec.grade_id
    JOIN terms t ON t.id = ep.term_id
    JOIN school_periods sp ON sp.id = t.school_period_id AND sp.is_active AND sp.closed_at IS NULL
    LEFT JOIN activity_section_dates asd ON asd.activity_id = a.id AND asd.section_id = x.section_id
    LEFT JOIN subjects sub ON sub.id = ep.subject_id
    WHERE a.tenant_id = :tenantId AND ep.teacher_id = :staffId AND x.section_id = ANY(CAST(:sectionIds AS uuid[]))
      AND COALESCE(asd.applied_on, a.planned_date) IS NOT NULL`,
    { tenantId, staffId, sectionIds }
  );
  return rows;
}

/**
 * GET /teacher/today — panel "Hoy" del docente:
 *   today        { date, weekday } en hora de Venezuela
 *   schedule     sus clases de la semana (el frontend toma las de hoy y la siguiente)
 *   pending      to_grade (entregas), ungraded (evaluaciones aplicadas sin nota),
 *                observed (planes observados), incomplete (no suman 100 %),
 *                ready (100 % sin enviar a revisión, si la revisión está activa)
 *   upcoming     evaluaciones de los próximos 7 días
 */
async function today(req) {
  const { db: trx, tenantId } = req;
  const scope = await teacherScope.getTeacherScope(req);
  const { rows: [now] } = await trx.raw(
    "SELECT (now() AT TIME ZONE CAST(? AS text))::date::text AS date, EXTRACT(ISODOW FROM (now() AT TIME ZONE CAST(? AS text)))::int AS weekday, ((now() AT TIME ZONE CAST(? AS text))::date + 7)::text AS in_week",
    [TZ, TZ, TZ]
  );
  const empty = { today: { date: now.date, weekday: now.weekday }, schedule: [], pending: { to_grade: [], ungraded: [], observed: [], incomplete: [], ready: [] }, upcoming: [] };
  if (!scope?.staffId) return empty;
  const staffId = scope.staffId;

  const schedule = await trx('class_schedules as cs')
    .join('subjects as sub', 'sub.id', 'cs.subject_id')
    .join('sections as sec', 'sec.id', 'cs.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .join('time_slots as ts', 'ts.id', 'cs.time_slot_id')
    .leftJoin('classrooms as room', 'room.id', 'sec.classroom_id')
    .leftJoin('class_links as cl', function link() {
      this.on('cl.section_id', '=', 'cs.section_id').andOn('cl.subject_id', '=', 'cs.subject_id');
    })
    .where({ 'cs.tenant_id': tenantId, 'cs.staff_id': staffId, 'sp.is_active': true })
    .whereNull('sp.closed_at')
    .select(
      'cs.id',
      'cs.day_of_week',
      'cs.section_id',
      'cs.subject_id',
      'sub.name as subject_name',
      'sec.name as section_name',
      'g.name as grade_name',
      trx.raw("to_char(ts.start_time, 'HH24:MI') AS start_time"),
      trx.raw("to_char(ts.end_time, 'HH24:MI') AS end_time"),
      'room.name as classroom_name',
      'cl.url as link_url'
    )
    .orderBy([{ column: 'cs.day_of_week' }, { column: 'ts.start_time' }]);

  const evaluations = await evaluationsQuery(trx, tenantId, staffId, scope.sectionIds);
  const ungraded = evaluations
    .filter((e) => e.date < now.date && e.missing > 0 && !e.requires_submission)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  const upcoming = evaluations.filter((e) => e.date >= now.date && e.date <= now.in_week).sort((a, b) => a.date.localeCompare(b.date));

  const toGrade = (await submissions.listInbox(req))
    .filter((a) => a.to_grade > 0)
    .map((a) => ({ activity_id: a.id, title: a.title, subject_name: a.subject, grade_name: a.grade_name, to_grade: a.to_grade }));

  const plans = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('school_periods as sp', 'sp.id', 't.school_period_id')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .where({ 'ep.tenant_id': tenantId, 'ep.teacher_id': staffId, 'sp.is_active': true, 'ep.status': 'open' })
    .whereNull('sp.closed_at')
    .select(
      'ep.id',
      'ep.review_status',
      'ep.subject_id',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject_name'),
      'g.name as grade_name',
      't.name as term_name',
      trx.raw('(SELECT string_agg(s2.name, \', \' ORDER BY s2.name) FROM evaluation_plan_sections x JOIN sections s2 ON s2.id = x.section_id WHERE x.plan_id = ep.id) AS section_names'),
      trx.raw('(SELECT COALESCE(sum(a.weight_percent), 0)::float FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS total_weight'),
      trx.raw(
        "(SELECT rc.body FROM review_comments rc WHERE rc.plan_id = ep.id AND rc.kind IN ('observed', 'comment') AND rc.author_role <> 'docente' ORDER BY rc.created_at DESC LIMIT 1) AS last_observation"
      )
    );
  const reviewOn = await isContentReviewRequired(trx, tenantId);
  const round = (n) => Math.round(Number(n) * 100) / 100;

  return {
    today: { date: now.date, weekday: now.weekday },
    schedule: schedule.map(({ link_url: url, ...s }) => ({ ...s, link: url || null })),
    pending: {
      to_grade: toGrade,
      ungraded,
      observed: plans.filter((p) => p.review_status === 'observado'),
      incomplete: plans.filter((p) => round(p.total_weight) < 100 && p.review_status !== 'observado'),
      ready: reviewOn ? plans.filter((p) => round(p.total_weight) === 100 && p.review_status === 'borrador') : [],
    },
    upcoming,
  };
}

module.exports = { listClasses, setClassLink, sectionStudents, today };
