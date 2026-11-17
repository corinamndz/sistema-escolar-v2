const { z } = require('zod');
const service = require('./submission.service');
const grades = require('../portal/grades.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { saveSubmissionFile, deleteSubmissionFile } = require('../../services/storage/submissionStorage');

const uuid = (label) => z.string().uuid(`${label} no es válido.`);

/**
 * Envía el archivo privado. PDF e imágenes se pueden ver en el navegador; los
 * documentos de Office se descargan siempre como adjunto.
 */
function sendSubmissionFile(res, { absolutePath, mime, name }) {
  const inline = mime === 'application/pdf' || mime.startsWith('image/');
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(absolutePath);
}

// =====================================================================
// Portal del representante  (montado en /portal, ver portal.routes.js)
// =====================================================================

/** GET /portal/students/:studentId/tasks */
const listStudentTasks = asyncHandler(async (req, res) => {
  const studentId = uuid('El alumno').parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  // Con cuotas vencidas puede seguir entregando, pero no ve notas ni retroalimentación.
  const showGrades = (await grades.overdueCount(req.db, req.tenantId, studentId)) === 0;
  res.status(200).json(await service.listStudentTasks(req.db, req.tenantId, studentId, { showGrades }));
});

/**
 * POST /portal/students/:studentId/tasks/:activityId/submission (multipart, campo `file`)
 * El archivo se escribe en disco ANTES de confirmar la transacción del tenant;
 * al terminar la respuesta:
 *   - éxito → se borra el archivo anterior que se reemplazó;
 *   - error → se borra el recién subido (no quedan huérfanos).
 */
const submitTask = asyncHandler(async (req, res) => {
  const studentId = uuid('El alumno').parse(req.params.studentId);
  const activityId = uuid('La tarea').parse(req.params.activityId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId);

  const file = req.file ? await saveSubmissionFile(req.tenantId, req.file) : null;
  let replaced = null;
  res.on('finish', () => {
    if (res.statusCode < 400) deleteSubmissionFile(replaced);
    else if (file) deleteSubmissionFile(file.file_path);
  });

  const { task, replacedFilePath } = await service.submitTask(req.db, req.tenantId, req.user.id, studentId, activityId, file);
  replaced = replacedFilePath;
  res.status(201).json(task);
});

/** GET /portal/students/:studentId/tasks/:activityId/submission/file */
const downloadFamilyFile = asyncHandler(async (req, res) => {
  const studentId = uuid('El alumno').parse(req.params.studentId);
  const activityId = uuid('La tarea').parse(req.params.activityId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId);
  sendSubmissionFile(res, await service.getFamilyFile(req.db, req.tenantId, studentId, activityId));
});

// =====================================================================
// Bandeja del docente  (montado en /submissions)
// =====================================================================

/** GET /submissions/inbox */
const listInbox = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listInbox(req));
});

/** GET /submissions/activities/:activityId?sectionId= */
const getActivityRoster = asyncHandler(async (req, res) => {
  const activityId = uuid('La actividad').parse(req.params.activityId);
  const sectionId = uuid('La sección').optional().parse(req.query.sectionId || undefined);
  res.status(200).json(await service.getActivityRoster(req.db, req.tenantId, activityId, { sectionId }));
});

/** GET /submissions/activities/:activityId/students/:studentId/file */
const downloadStaffFile = asyncHandler(async (req, res) => {
  const activityId = uuid('La actividad').parse(req.params.activityId);
  const studentId = uuid('El alumno').parse(req.params.studentId);
  sendSubmissionFile(res, await service.getStaffFile(req.db, req.tenantId, activityId, studentId));
});

const twoDecimals = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const gradeSchema = z.object({
  grade: z.number({ invalid_type_error: 'La nota debe ser un número.' }).min(0, 'La nota no puede ser negativa.').refine(twoDecimals, 'Usa como máximo 2 decimales.').optional(),
  // Grados con escala cualitativa (Inicial / Primaria).
  literal: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined), z.enum(['A', 'B', 'C', 'D', 'E']).optional()),
  feedback: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(3000, 'Máximo 3000 caracteres.').nullable().optional()),
});

/** PUT /submissions/activities/:activityId/students/:studentId/grade */
const gradeSubmission = asyncHandler(async (req, res) => {
  const activityId = uuid('La actividad').parse(req.params.activityId);
  const studentId = uuid('El alumno').parse(req.params.studentId);
  const data = gradeSchema.parse(req.body);
  res.status(200).json(await service.gradeSubmission(req.db, req.tenantId, req.user.id, activityId, studentId, data));
});

/** POST /submissions/activities/:activityId/students/:studentId/return */
const returnSubmission = asyncHandler(async (req, res) => {
  const activityId = uuid('La actividad').parse(req.params.activityId);
  const studentId = uuid('El alumno').parse(req.params.studentId);
  const data = z.object({ feedback: z.string().trim().min(1, 'Explica qué debe corregir.').max(3000) }).parse(req.body);
  res.status(200).json(await service.returnSubmission(req.db, req.tenantId, req.user.id, activityId, studentId, data));
});

module.exports = {
  listStudentTasks,
  submitTask,
  downloadFamilyFile,
  listInbox,
  getActivityRoster,
  downloadStaffFile,
  gradeSubmission,
  returnSubmission,
};
