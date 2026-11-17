const { ApiError } = require('../../utils/ApiError');
const { exclusionOf } = require('../academics/sectionSubjects');
const { compareUnits } = require('../programmatic-content/programmaticContent.service');
const { isContentReviewRequired: familiesSeeOnlyApproved } = require('../reviews/reviewSettings.service');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');
const { notify, guardiansOfSections } = require('../notifications/notify');
const { resolveMaterialFile } = require('../../services/storage/materialStorage');

/**
 * Material de apoyo del contenido programático (migración 103).
 *
 * Cada material cuelga de un TEMA (programmatic_content: grado + materia + año).
 * El docente lo crea en borrador, lo publica o lo programa (publish_at). La
 * familia lo ve —y el alumno, en el "modo alumno" de la cuenta del
 * representante— cuando:
 *   - está publicado y su hora de publicación ya llegó;
 *   - el tema es visible para la familia: la materia se dicta en la sección del
 *     alumno y, con la revisión académica activa, el programa está aprobado
 *     (misma regla que el contenido programático en el portal).
 *
 * Progreso (learning_material_progress): viewed_at al abrirlo; completed_at con
 * "¡Lo logré!". Los porcentajes cuentan solo materiales visibles.
 */

const TYPES = ['file', 'video', 'link', 'audio', 'pill'];

// ---------------------------------------------------------------------
// Videos: YouTube y Vimeo
// ---------------------------------------------------------------------

/** URL de YouTube o Vimeo → { provider, video_id } (null si no se reconoce). */
function parseVideoUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const ytId = /^[A-Za-z0-9_-]{11}$/;
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ytId.test(id) ? { provider: 'youtube', video_id: id } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const fromQuery = url.searchParams.get('v');
    const fromPath = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1];
    const id = fromQuery || fromPath;
    return id && ytId.test(id) ? { provider: 'youtube', video_id: id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/)?.[1];
    return id ? { provider: 'vimeo', video_id: id } : null;
  }
  return null;
}

/** Estado visible: borrador, programado (publicado con hora futura) o publicado. */
function visibilityOf(m, now = new Date()) {
  if (m.status !== 'published') return 'draft';
  return m.publish_at && new Date(m.publish_at) > now ? 'scheduled' : 'published';
}

/** SQL: el material ya es visible para las familias. */
const visibleSql = (alias = 'm') => `${alias}.status = 'published' AND (${alias}.publish_at IS NULL OR ${alias}.publish_at <= now())`;

function present(m, { staff = false, progress = null, stats = null } = {}) {
  const base = {
    id: m.id,
    content_id: m.content_id,
    type: m.type,
    title: m.title,
    description: m.description,
    position: m.position,
    visibility: { status: visibilityOf(m), publish_at: m.publish_at },
  };
  if (m.type === 'file' || m.type === 'audio') {
    base.kind = m.kind;
    base.file = { name: m.file_original_name, mime: m.file_mime, size: m.file_size };
  }
  if (m.type === 'video') Object.assign(base, { provider: m.provider, video_id: m.video_id, url: m.url });
  if (m.type === 'link') Object.assign(base, { url: m.url, domain: safeDomain(m.url) });
  if (m.type === 'audio' || m.type === 'video') base.duration_seconds = m.duration_seconds;
  if (m.type === 'pill') base.body = m.body;
  if (staff) Object.assign(base, { stats, created_at: m.created_at, updated_at: m.updated_at });
  else base.student_progress = progress ? { viewed_at: progress.viewed_at, completed_at: progress.completed_at } : { viewed_at: null, completed_at: null };
  return base;
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const progressOf = (completed, total) => ({ completed, total, percent: total ? Math.round((completed / total) * 1000) / 10 : 0 });

// =====================================================================
// Docente
// =====================================================================

async function loadContent(trx, tenantId, contentId) {
  const item = await trx('programmatic_content').where({ id: contentId, tenant_id: tenantId }).first();
  if (!item) throw ApiError.notFound('Tema no encontrado.');
  return item;
}

async function loadMaterial(trx, tenantId, materialId, { forUpdate = false } = {}) {
  const q = trx('learning_materials').where({ id: materialId, tenant_id: tenantId });
  const m = await (forUpdate ? q.forUpdate().first() : q.first());
  if (!m) throw ApiError.notFound('Material no encontrado.');
  return m;
}

/** Secciones del grado y año del tema donde se dicta la materia. */
function sectionsForContent(trx, tenantId, item) {
  return trx('sections as sec')
    .where({ 'sec.tenant_id': tenantId, 'sec.grade_id': item.grade_id, 'sec.school_period_id': item.school_period_id })
    .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), item.subject_id))
    .pluck('sec.id');
}

/** GET materiales del tema (docente), con cuántos alumnos lo abrieron y lo lograron. */
async function listMaterials(trx, tenantId, contentId) {
  const item = await loadContent(trx, tenantId, contentId);
  const sectionIds = await sectionsForContent(trx, tenantId, item);
  const students = sectionIds.length
    ? Number((await trx('enrollments').whereIn('section_id', sectionIds).andWhere('status', 'active').countDistinct('student_id as n').first()).n)
    : 0;
  const rows = await trx('learning_materials').where({ tenant_id: tenantId, content_id: contentId }).orderBy([{ column: 'position' }, { column: 'created_at' }]);
  const counts = rows.length
    ? await trx('learning_material_progress')
        .whereIn('material_id', rows.map((m) => m.id))
        .groupBy('material_id')
        .select('material_id', trx.raw('count(viewed_at)::int AS viewed'), trx.raw('count(completed_at)::int AS completed'))
    : [];
  const byId = new Map(counts.map((c) => [c.material_id, c]));
  return {
    content: { id: item.id, unit: item.unit, topic: item.topic, week_number: item.week_number },
    students,
    materials: rows.map((m) => present(m, { staff: true, stats: { students, viewed: byId.get(m.id)?.viewed || 0, completed: byId.get(m.id)?.completed || 0 } })),
  };
}

/**
 * Campos a guardar según el tipo (validados). `file` = lo que devolvió
 * saveMaterialFile (o null). Al editar, sin archivo nuevo se conserva el actual.
 */
function fieldsFor(type, data, file, existing = null) {
  const fields = {
    title: data.title,
    description: data.description ?? null,
    status: data.status,
    publish_at: data.status === 'published' ? data.publishAt ?? null : null,
    // Al cambiar de tipo se limpian los campos del tipo anterior.
    kind: null,
    url: null,
    provider: null,
    video_id: null,
    body: null,
    duration_seconds: null,
  };
  if (type === 'file' || type === 'audio') {
    const f = file || (existing && existing.type === type && existing.file_path ? existing : null);
    if (!f) throw ApiError.badRequest(type === 'audio' ? 'Adjunta o graba la nota de voz.' : 'Adjunta el archivo.', [{ path: 'file', message: 'Requerido.' }]);
    if (type === 'file' && f.kind === 'audio') throw ApiError.badRequest('Ese archivo es un audio: elige el tipo "Nota de voz".');
    Object.assign(fields, { kind: f.kind, file_path: f.file_path, file_mime: f.file_mime, file_original_name: f.file_original_name, file_size: f.file_size });
    if (type === 'audio') {
      if (data.durationSeconds && data.durationSeconds > 300) throw ApiError.badRequest('La nota de voz puede durar hasta 5 minutos.', [{ path: 'file', message: 'Máximo 5 minutos.' }]);
      fields.duration_seconds = data.durationSeconds || null;
    }
  } else {
    if (file) throw ApiError.badRequest('Este tipo de material no lleva archivo.');
    Object.assign(fields, { file_path: null, file_mime: null, file_original_name: null, file_size: null });
  }
  if (type === 'video') {
    const video = parseVideoUrl(data.url || '');
    if (!video) throw ApiError.badRequest('Pega un enlace de YouTube o Vimeo válido.', [{ path: 'url', message: 'Enlace no reconocido.' }]);
    Object.assign(fields, { url: data.url.trim(), ...video, duration_seconds: data.durationSeconds || null });
  }
  if (type === 'link') {
    const url = (data.url || '').trim();
    if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(url)) throw ApiError.badRequest('El enlace debe empezar por https://', [{ path: 'url', message: 'Enlace inválido.' }]);
    fields.url = url;
  }
  if (type === 'pill') {
    if (!data.body?.trim()) throw ApiError.badRequest('Escribe el contenido de la píldora.', [{ path: 'body', message: 'Requerido.' }]);
    fields.body = data.body.trim();
  }
  return fields;
}

/** POST — crea un material al final del tema. */
async function createMaterial(trx, tenantId, userId, contentId, data, file) {
  await loadContent(trx, tenantId, contentId);
  const { max } = await trx('learning_materials').where({ tenant_id: tenantId, content_id: contentId }).max('position as max').first();
  const [m] = await trx('learning_materials')
    .insert({ tenant_id: tenantId, content_id: contentId, type: data.type, position: max === null ? 0 : Number(max) + 1, created_by: userId, ...fieldsFor(data.type, data, file) })
    .returning('*');
  await notifyIfDue(trx, tenantId, m);
  return present(m, { staff: true, stats: { students: 0, viewed: 0, completed: 0 } });
}

/** PUT — edita; devuelve { material, replacedFilePath } (el archivo anterior se borra al confirmar). */
async function updateMaterial(trx, tenantId, materialId, data, file) {
  const existing = await loadMaterial(trx, tenantId, materialId, { forUpdate: true });
  const type = data.type || existing.type;
  const fields = fieldsFor(type, data, file, existing);
  const [m] = await trx('learning_materials')
    .where({ id: materialId })
    .update({ type, ...fields, updated_at: trx.fn.now() })
    .returning('*');
  await notifyIfDue(trx, tenantId, m);
  const replacedFilePath = existing.file_path && existing.file_path !== m.file_path ? existing.file_path : null;
  return { material: present(m, { staff: true }), replacedFilePath };
}

/** DELETE — devuelve la ruta del archivo a borrar al confirmar (si tenía). */
async function deleteMaterial(trx, tenantId, materialId) {
  const m = await loadMaterial(trx, tenantId, materialId, { forUpdate: true });
  await trx('learning_materials').where({ id: materialId }).delete();
  return { filePath: m.file_path };
}

/** PUT — nuevo orden de los materiales del tema (todos sus ids). */
async function reorderMaterials(trx, tenantId, contentId, ids) {
  const current = await trx('learning_materials').where({ tenant_id: tenantId, content_id: contentId }).pluck('id');
  if (current.length !== ids.length || !ids.every((id) => current.includes(id))) {
    throw ApiError.badRequest('El orden debe incluir todos los materiales del tema.');
  }
  for (const [i, id] of ids.entries()) await trx('learning_materials').where({ id }).update({ position: i });
  return listMaterials(trx, tenantId, contentId);
}

/**
 * GET avance por alumno de un material (docente): cada alumno activo de las
 * secciones del grado donde se dicta la materia, con su estado:
 *   completed  lo marcó "¡Lo logré!"   viewed  lo abrió   pending  aún no lo revisa
 * Docente con carga restringida: solo los alumnos de sus secciones.
 */
async function materialProgress(trx, tenantId, materialId, { sectionIds: allowed = null } = {}) {
  const m = await loadMaterial(trx, tenantId, materialId);
  const item = await loadContent(trx, tenantId, m.content_id);
  let sectionIds = await sectionsForContent(trx, tenantId, item);
  if (allowed) sectionIds = sectionIds.filter((id) => allowed.includes(id));
  const rows = sectionIds.length
    ? await trx('enrollments as e')
        .join('students as s', 's.id', 'e.student_id')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .leftJoin('learning_material_progress as p', function own() {
          this.on('p.student_id', '=', 's.id').andOnVal('p.material_id', '=', materialId);
        })
        .whereIn('e.section_id', sectionIds)
        .andWhere('e.status', 'active')
        .distinctOn('s.id')
        .select('s.id', 's.first_name', 's.last_name', 'sec.name as section_name', 'p.viewed_at', 'p.completed_at')
        .orderBy('s.id')
    : [];
  const students = rows
    .map((r) => ({
      student_id: r.id,
      name: `${r.last_name}, ${r.first_name}`,
      section_name: r.section_name,
      status: r.completed_at ? 'completed' : r.viewed_at ? 'viewed' : 'pending',
      viewed_at: r.viewed_at,
      completed_at: r.completed_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const count = (st) => students.filter((s) => s.status === st).length;
  return {
    material: { id: m.id, title: m.title, type: m.type, visibility: { status: visibilityOf(m), publish_at: m.publish_at } },
    sections: [...new Set(students.map((s) => s.section_name))].sort(),
    totals: { students: students.length, completed: count('completed'), viewed: count('viewed') + count('completed'), pending: count('pending') },
    students,
  };
}

/** Archivo del material para el docente (ya validado el acceso al tema). */
async function getStaffFile(trx, tenantId, materialId) {
  return fileOf(await loadMaterial(trx, tenantId, materialId));
}

function fileOf(m) {
  const absolutePath = m?.file_path ? resolveMaterialFile(m.file_path) : null;
  if (!absolutePath) throw ApiError.notFound('Este material no tiene archivo.');
  return { absolutePath, mime: m.file_mime, name: m.file_original_name || 'material' };
}

// =====================================================================
// Familia y modo alumno
// =====================================================================

/** Sección vigente del alumno (inscripción activa, año en curso). */
async function studentSection(trx, tenantId, studentId) {
  const section = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .select('sec.id', 'sec.name', 'sec.grade_id', 'sec.school_period_id', 'g.name as grade_name', 'g.level_code')
    .orderByRaw(currentPeriodOrder('sp'))
    .first();
  return section || null;
}

/**
 * Temas visibles para la familia del alumno: del grado y año de su sección,
 * de materias que se dictan en ella y (con revisión activa) de programas aprobados.
 * Síncrona a propósito: devuelve el query builder sin ejecutarlo (un `await` lo ejecutaría).
 */
function visibleTopicsQuery(trx, tenantId, section, onlyApproved) {
  return trx('programmatic_content as pc')
    .join('subjects as s', 's.id', 'pc.subject_id')
    .where({ 'pc.tenant_id': tenantId, 'pc.grade_id': section.grade_id, 'pc.school_period_id': section.school_period_id })
    .whereNotExists(exclusionOf(trx, section.id, trx.ref('pc.subject_id')))
    .modify((q) => {
      if (!onlyApproved) return;
      q.whereExists(
        trx('programmatic_content_reviews as r')
          .whereRaw('r.grade_id = pc.grade_id AND r.subject_id = pc.subject_id AND r.school_period_id = pc.school_period_id')
          .andWhere('r.status', 'aprobado')
          .select(trx.raw('1'))
      );
    });
}

/** Materiales visibles de esos temas, con el progreso del alumno. */
async function visibleMaterials(trx, tenantId, studentId, topicIds) {
  if (!topicIds.length) return [];
  return trx('learning_materials as m')
    .leftJoin('learning_material_progress as p', function own() {
      this.on('p.material_id', '=', 'm.id').andOnVal('p.student_id', '=', studentId);
    })
    .where('m.tenant_id', tenantId)
    .whereIn('m.content_id', topicIds)
    .whereRaw(visibleSql('m'))
    .select('m.*', 'p.viewed_at', 'p.completed_at')
    .orderBy([{ column: 'm.position' }, { column: 'm.created_at' }]);
}

/** GET /portal/students/:id/learning — materias con material publicado y su avance. */
async function listStudentSubjects(trx, tenantId, studentId) {
  const section = await studentSection(trx, tenantId, studentId);
  if (!section) return { section: null, subjects: [] };
  const onlyApproved = await familiesSeeOnlyApproved(trx, tenantId);
  const topics = await visibleTopicsQuery(trx, tenantId, section, onlyApproved).select('pc.id', 'pc.subject_id', 's.name as subject_name');
  const materials = await visibleMaterials(trx, tenantId, studentId, topics.map((t) => t.id));
  const subjectOf = new Map(topics.map((t) => [t.id, t]));
  const bySubject = new Map();
  for (const m of materials) {
    const t = subjectOf.get(m.content_id);
    const entry = bySubject.get(t.subject_id) || { id: t.subject_id, name: t.subject_name, total: 0, completed: 0, latest: null };
    entry.total += 1;
    if (m.completed_at) entry.completed += 1;
    const shownAt = m.publish_at || m.created_at;
    if (!entry.latest || new Date(shownAt) > new Date(entry.latest)) entry.latest = shownAt;
    bySubject.set(t.subject_id, entry);
  }
  return {
    section: { id: section.id, name: section.name, grade_name: section.grade_name, level_code: section.level_code },
    subjects: [...bySubject.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map(({ total, completed, ...s }) => ({ ...s, progress: progressOf(completed, total) })),
  };
}

/** GET /portal/students/:id/learning/:subjectId — unidades → temas → materiales con progreso. */
async function getStudentSubjectLearning(trx, tenantId, studentId, subjectId) {
  const section = await studentSection(trx, tenantId, studentId);
  if (!section) throw ApiError.notFound('El alumno no tiene una inscripción activa.');
  const onlyApproved = await familiesSeeOnlyApproved(trx, tenantId);
  const topics = await visibleTopicsQuery(trx, tenantId, section, onlyApproved)
    .andWhere('pc.subject_id', subjectId)
    .select('pc.*', 's.name as subject_name')
    .orderBy([{ column: 'pc.sort_order' }, { column: 'pc.created_at' }]);
  if (!topics.length) throw ApiError.notFound('Esta materia aún no tiene contenido publicado.');
  const materials = await visibleMaterials(trx, tenantId, studentId, topics.map((t) => t.id));

  const units = [...new Set(topics.map((t) => t.unit))].sort(compareUnits).map((unit, position) => {
    const unitTopics = topics
      .filter((t) => t.unit === unit)
      .map((t) => ({
        id: t.id,
        title: t.topic,
        description: t.description,
        week: t.week_number,
        materials: materials.filter((m) => m.content_id === t.id).map((m) => present(m, { progress: m })),
      }));
    const all = unitTopics.flatMap((t) => t.materials);
    return { name: unit, position, topics: unitTopics, progress: progressOf(all.filter((m) => m.student_progress.completed_at).length, all.length) };
  });
  return {
    subject: { id: subjectId, name: topics[0].subject_name },
    grade: { id: section.grade_id, name: section.grade_name, level_code: section.level_code },
    school_period_id: section.school_period_id,
    progress: progressOf(materials.filter((m) => m.completed_at).length, materials.length),
    units,
  };
}

/** Material visible para el alumno (404 si no lo es). */
async function loadVisibleMaterial(trx, tenantId, studentId, materialId) {
  const section = await studentSection(trx, tenantId, studentId);
  if (!section) throw ApiError.notFound('Material no encontrado.');
  const onlyApproved = await familiesSeeOnlyApproved(trx, tenantId);
  const m = await trx('learning_materials as m')
    .where({ 'm.id': materialId, 'm.tenant_id': tenantId })
    .whereRaw(visibleSql('m'))
    .whereIn('m.content_id', visibleTopicsQuery(trx, tenantId, section, onlyApproved).select('pc.id'))
    .first('m.*');
  if (!m) throw ApiError.notFound('Material no encontrado.');
  return m;
}

/** POST …/view — registra que el alumno abrió el material (la primera vez). */
async function markViewed(trx, tenantId, studentId, materialId) {
  await loadVisibleMaterial(trx, tenantId, studentId, materialId);
  await trx('learning_material_progress')
    .insert({ tenant_id: tenantId, material_id: materialId, student_id: studentId, viewed_at: trx.fn.now() })
    .onConflict(['material_id', 'student_id'])
    .merge({ viewed_at: trx.raw('COALESCE(learning_material_progress.viewed_at, EXCLUDED.viewed_at)') });
  return progressRow(trx, materialId, studentId);
}

/** PUT …/complete { completed } — "¡Lo logré!" (o desmarcarlo). */
async function setCompleted(trx, tenantId, userId, studentId, materialId, completed) {
  await loadVisibleMaterial(trx, tenantId, studentId, materialId);
  const values = completed
    ? { completed_at: trx.fn.now(), completed_by_user_id: userId }
    : { completed_at: null, completed_by_user_id: null };
  await trx('learning_material_progress')
    .insert({ tenant_id: tenantId, material_id: materialId, student_id: studentId, viewed_at: trx.fn.now(), ...values })
    .onConflict(['material_id', 'student_id'])
    .merge({ ...values, viewed_at: trx.raw('COALESCE(learning_material_progress.viewed_at, EXCLUDED.viewed_at)') });
  return progressRow(trx, materialId, studentId);
}

async function progressRow(trx, materialId, studentId) {
  const p = await trx('learning_material_progress').where({ material_id: materialId, student_id: studentId }).first('viewed_at', 'completed_at');
  return { material_id: materialId, viewed_at: p?.viewed_at || null, completed_at: p?.completed_at || null };
}

async function getFamilyFile(trx, tenantId, studentId, materialId) {
  return fileOf(await loadVisibleMaterial(trx, tenantId, studentId, materialId));
}

// =====================================================================
// Avisos (learning_material)
// =====================================================================

const TYPE_LABEL = { file: 'una guía', video: 'un video', link: 'un enlace', audio: 'una nota de voz', pill: 'una píldora de conocimiento' };

/**
 * Avisa a las familias de un material ya visible que aún no se avisó
 * (notified_at). Sin temas visibles (programa sin aprobar) no avisa: lo hará la
 * tarea diaria cuando lo estén. Nunca revierte la operación que lo dispara.
 */
async function notifyIfDue(trx, tenantId, m) {
  if (m.notified_at || visibilityOf(m) !== 'published') return false;
  try {
    return await trx.transaction(async (sp) => {
      const item = await sp('programmatic_content as pc').join('subjects as s', 's.id', 'pc.subject_id').where('pc.id', m.content_id).first('pc.*', 's.name as subject_name');
      if (!item) return false;
      if (await familiesSeeOnlyApproved(sp, tenantId)) {
        const review = await sp('programmatic_content_reviews').where({ tenant_id: tenantId, grade_id: item.grade_id, subject_id: item.subject_id, school_period_id: item.school_period_id }).first('status');
        if (review?.status !== 'aprobado') return false;
      }
      const sectionIds = await sectionsForContent(sp, tenantId, item);
      const guardianIds = await guardiansOfSections(sp, tenantId, sectionIds);
      await sp('learning_materials').where({ id: m.id }).update({ notified_at: sp.fn.now() });
      if (!guardianIds.length) return false;
      const { bell } = await notify(sp, tenantId, {
        event: 'learning_material',
        guardianIds,
        title: `Material nuevo: ${item.subject_name}`,
        body: `El docente publicó ${TYPE_LABEL[m.type] || 'material'} «${m.title}» del tema «${item.topic}» (${item.unit}) para repasar en casa.`,
        data: { material_id: m.id, content_id: item.id, subject_id: item.subject_id },
        links: { guardians: `/portal/learning?materia=${item.subject_id}` },
        linkLabel: 'Ver material',
        dedupeKey: `learning_material:${m.id}`,
      });
      return Boolean(bell);
    });
  } catch (err) {
    console.error('[avisos] No se pudo avisar del material', m.id, err.message);
    return false;
  }
}

/** Tarea diaria: materiales programados cuya hora ya llegó (o cuyo programa se aprobó después). */
async function sendDueMaterialNotices(trx, tenantId) {
  const due = await trx('learning_materials as m').where('m.tenant_id', tenantId).whereNull('m.notified_at').whereRaw(visibleSql('m')).select('m.*');
  let sent = 0;
  for (const m of due) if (await notifyIfDue(trx, tenantId, m)) sent += 1;
  return { pending: due.length, sent };
}

module.exports = {
  TYPES,
  parseVideoUrl,
  visibilityOf,
  loadContent,
  loadMaterial,
  listMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  reorderMaterials,
  getStaffFile,
  materialProgress,
  studentSection,
  listStudentSubjects,
  getStudentSubjectLearning,
  markViewed,
  setCompleted,
  getFamilyFile,
  sendDueMaterialNotices,
};
