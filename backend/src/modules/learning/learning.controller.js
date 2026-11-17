const { z } = require('zod');
const service = require('./learning.service');
const grades = require('../portal/grades.service');
const teacherScope = require('../access/teacherScope');
const { asyncHandler } = require('../../utils/asyncHandler');
const { saveMaterialFile, deleteMaterialFile } = require('../../services/storage/materialStorage');

const uuid = (label) => z.string().uuid(`${label} no es válido.`);
const blankToNull = (v) => (v === '' || v === 'null' ? null : v);

/**
 * Datos de un material. Llegan como multipart (todo texto) cuando hay archivo,
 * o como JSON: por eso los números y nulos se normalizan aquí.
 */
const materialSchema = z.object({
  type: z.enum(service.TYPES, { errorMap: () => ({ message: 'Tipo de material inválido.' }) }),
  title: z.string().trim().min(1, 'Escribe el título.').max(150, 'Máximo 150 caracteres.'),
  description: z.preprocess(blankToNull, z.string().trim().max(1000, 'Máximo 1000 caracteres.').nullable().optional()),
  status: z.enum(['draft', 'published']).default('draft'),
  // Programado: ISO con zona horaria; null = publicar ya.
  publishAt: z.preprocess(blankToNull, z.string().datetime({ offset: true, message: 'Fecha de publicación inválida.' }).nullable().optional()),
  url: z.preprocess(blankToNull, z.string().trim().max(1000).nullable().optional()),
  body: z.preprocess(blankToNull, z.string().trim().max(1500, 'Máximo 1500 caracteres.').nullable().optional()),
  durationSeconds: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(36000).nullable().optional()),
});

/**
 * Guarda el archivo subido (si hay) y programa la limpieza al terminar la
 * respuesta: éxito → borra el archivo reemplazado; error → borra el recién subido.
 */
async function handleUpload(req, res, type) {
  const file = req.file ? await saveMaterialFile(req.tenantId, req.file, { audio: type === 'audio' }) : null;
  let replaced = null;
  res.on('finish', () => {
    if (res.statusCode < 400) deleteMaterialFile(replaced);
    else if (file) deleteMaterialFile(file.file_path);
  });
  return { file, setReplaced: (p) => (replaced = p) };
}

function sendFile(res, { absolutePath, mime, name }, { download = false } = {}) {
  const inline = !download && (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('audio/'));
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(absolutePath);
}

// =====================================================================
// Docente (montado en /learning)
// =====================================================================

/** Middleware: el tema (:contentId) es de una materia y grado de la carga del docente (o de su nivel). */
const ownContent = async (req, res, next) => {
  try {
    const item = await service.loadContent(req.db, req.tenantId, uuid('El tema').parse(req.params.contentId));
    await teacherScope.assertGradeSubjectAccess(req, item.grade_id, item.subject_id);
    next();
  } catch (err) {
    next(err);
  }
};

/** Middleware: igual, partiendo del material (:materialId). */
const ownMaterial = async (req, res, next) => {
  try {
    const m = await service.loadMaterial(req.db, req.tenantId, uuid('El material').parse(req.params.materialId));
    const item = await service.loadContent(req.db, req.tenantId, m.content_id);
    await teacherScope.assertGradeSubjectAccess(req, item.grade_id, item.subject_id);
    req.material = m;
    next();
  } catch (err) {
    next(err);
  }
};

const listMaterials = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listMaterials(req.db, req.tenantId, req.params.contentId));
});

const createMaterial = asyncHandler(async (req, res) => {
  const data = materialSchema.parse(req.body);
  const { file } = await handleUpload(req, res, data.type);
  res.status(201).json(await service.createMaterial(req.db, req.tenantId, req.user.id, req.params.contentId, data, file));
});

const updateMaterial = asyncHandler(async (req, res) => {
  const data = materialSchema.parse(req.body);
  const { file, setReplaced } = await handleUpload(req, res, data.type);
  const { material, replacedFilePath } = await service.updateMaterial(req.db, req.tenantId, req.params.materialId, data, file);
  setReplaced(replacedFilePath);
  res.status(200).json(material);
});

const deleteMaterial = asyncHandler(async (req, res) => {
  const { filePath } = await service.deleteMaterial(req.db, req.tenantId, req.params.materialId);
  res.on('finish', () => res.statusCode < 400 && deleteMaterialFile(filePath));
  res.status(204).send();
});

const reorderMaterials = asyncHandler(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(req.body);
  res.status(200).json(await service.reorderMaterials(req.db, req.tenantId, req.params.contentId, ids));
});

/** GET /learning/materials/:materialId/progress — avance por alumno (docente: solo sus secciones). */
const materialProgress = asyncHandler(async (req, res) => {
  const scope = await teacherScope.getAccessScope(req);
  res.status(200).json(await service.materialProgress(req.db, req.tenantId, req.params.materialId, { sectionIds: scope ? scope.sectionIds : null }));
});

const downloadStaffFile = asyncHandler(async (req, res) => {
  sendFile(res, await service.getStaffFile(req.db, req.tenantId, req.params.materialId), { download: req.query.download === '1' });
});

// =====================================================================
// Familia y modo alumno (montado en /portal)
// =====================================================================

/** Valida :studentId y que sea representado del usuario (404 si no). */
async function ownStudent(req) {
  const studentId = uuid('El alumno').parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId);
  return studentId;
}

const listStudentSubjects = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listStudentSubjects(req.db, req.tenantId, await ownStudent(req)));
});

const getStudentSubject = asyncHandler(async (req, res) => {
  const studentId = await ownStudent(req);
  res.status(200).json(await service.getStudentSubjectLearning(req.db, req.tenantId, studentId, uuid('La materia').parse(req.params.subjectId)));
});

const downloadFamilyFile = asyncHandler(async (req, res) => {
  const studentId = await ownStudent(req);
  sendFile(res, await service.getFamilyFile(req.db, req.tenantId, studentId, uuid('El material').parse(req.params.materialId)), { download: req.query.download === '1' });
});

const markViewed = asyncHandler(async (req, res) => {
  const studentId = await ownStudent(req);
  res.status(200).json(await service.markViewed(req.db, req.tenantId, studentId, uuid('El material').parse(req.params.materialId)));
});

const setCompleted = asyncHandler(async (req, res) => {
  const studentId = await ownStudent(req);
  const { completed } = z.object({ completed: z.boolean() }).parse(req.body);
  res.status(200).json(await service.setCompleted(req.db, req.tenantId, req.user.id, studentId, uuid('El material').parse(req.params.materialId), completed));
});

module.exports = {
  ownContent,
  ownMaterial,
  listMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  reorderMaterials,
  downloadStaffFile,
  materialProgress,
  listStudentSubjects,
  getStudentSubject,
  downloadFamilyFile,
  markViewed,
  setCompleted,
};
