const router = require('express').Router();
const controller = require('./portal.controller');
const paymentAccounts = require('../payments/paymentAccounts.controller');
const events = require('../events/event.controller');
const appointments = require('../appointments/appointment.controller');
const submissions = require('../submissions/submission.controller');
const learning = require('../learning/learning.controller');
const { submissionUpload } = require('../../middlewares/upload.middleware');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
// Secciones que el colegio puede desactivar (Configuración → Vistas del representante): 403 si lo están.
const { requirePortalView: view } = require('../tenants/portalViews.service');

// Sin requirePermission: los datos se filtran por el usuario autenticado
// (igual que GET /payments/mine), así que no hace falta ningún permiso de módulo.
router.use(authMiddleware, tenantMiddleware);

router.get('/me', controller.getMyPortal);
// Citas con el colegio de la familia: verlas y confirmar asistencia.
router.get('/appointments', view('appointments'), appointments.myAppointments);
router.post('/appointments/:id/confirm', view('appointments'), appointments.confirmMine);
router.get('/students/:studentId/grades', view('grades'), controller.getStudentGrades);
// Materias pendientes del año anterior, con el avance de sus momentos de recuperación.
router.get('/students/:studentId/carryovers', view('grades'), controller.getStudentCarryovers);
router.get('/students/:studentId/evaluation-plans/:planId', view('evaluation_plan'), controller.getStudentPlanDetail);
// Constancia "He leído y acepto el plan de evaluación" (069).
router.post('/students/:studentId/evaluation-plans/:planId/acknowledge', view('evaluation_plan'), controller.acknowledgePlan);
// Contenido programático de una materia con sus evaluaciones publicadas (sección del alumno).
router.get('/students/:studentId/subjects/:subjectId/program', view('grades'), controller.getStudentSubjectProgram);
router.get('/students/:studentId/history', view('history'), controller.getStudentHistory);
// Certificados de promoción de todos los alumnos del representante, agrupados por alumno.
router.get('/certificates', view('history'), controller.getMyCertificates);
// Certificado de promoción: mismas reglas que el historial (bloqueado con cuotas vencidas).
router.get('/students/:studentId/certificate', view('history'), controller.getStudentCertificate);
router.get('/students/:studentId/schedule', view('schedule'), controller.getStudentSchedule);
router.get('/students/:studentId/sanctions', view('discipline'), controller.getStudentSanctions);
router.get('/students/:studentId/recognitions', view('recognitions'), controller.getStudentRecognitions);
router.get('/students/:studentId/recognitions/:id/certificate', view('recognitions'), controller.getRecognitionCertificate);
// Cronograma de evaluaciones de la sección del alumno (solo de sus representados).
router.get('/students/:studentId/evaluations', view('evaluations'), controller.getStudentEvaluations);
// Aula virtual (101): tareas con entrega digital, subir el archivo y descargar lo entregado.
router.get('/students/:studentId/tasks', view('tasks'), submissions.listStudentTasks);
router.post('/students/:studentId/tasks/:activityId/submission', view('tasks'), submissionUpload, submissions.submitTask);
router.get('/students/:studentId/tasks/:activityId/submission/file', view('tasks'), submissions.downloadFamilyFile);
// Aprender en casa (103): material de apoyo por materia, con progreso y "¡Lo logré!" (modo alumno).
router.get('/students/:studentId/learning', view('learning'), learning.listStudentSubjects);
router.get('/students/:studentId/learning/subjects/:subjectId', view('learning'), learning.getStudentSubject);
router.get('/students/:studentId/learning/materials/:materialId/file', view('learning'), learning.downloadFamilyFile);
router.post('/students/:studentId/learning/materials/:materialId/view', view('learning'), learning.markViewed);
router.put('/students/:studentId/learning/materials/:materialId/complete', view('learning'), learning.setCompleted);
// Clubes y actividades extracurriculares del alumno.
router.get('/students/:studentId/clubs', view('clubs'), controller.getStudentClubs);
// Cartelera de eventos del colegio (los de todo el colegio y los del grado/sección de sus hijos).
router.get('/events', view('events'), events.portalList);
// Datos de pago del colegio (activos) para reportar un pago.
router.get('/payment-accounts', view('payments'), paymentAccounts.listPublic);

module.exports = router;
