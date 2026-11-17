const router = require('express').Router();
const controller = require('./submission.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

/**
 * Bandeja de calificación de entregas (aula virtual, migración 101).
 * Mismos permisos que la libreta: leer = grading.read, calificar = grading.update.
 * Docente / coordinador: solo actividades de su carga o su nivel (los demás → 404).
 * Las rutas de la familia están en portal.routes.js.
 */
const ownActivity = scope.guardParam(scope.assertActivityAccess, 'activityId');

router.use(authMiddleware, tenantMiddleware);

router.get('/inbox', requirePermission('grading', 'read'), controller.listInbox);
router.get('/activities/:activityId', requirePermission('grading', 'read'), ownActivity, controller.getActivityRoster);
router.get('/activities/:activityId/students/:studentId/file', requirePermission('grading', 'read'), ownActivity, controller.downloadStaffFile);
router.put('/activities/:activityId/students/:studentId/grade', requirePermission('grading', 'update'), ownActivity, controller.gradeSubmission);
router.post('/activities/:activityId/students/:studentId/return', requirePermission('grading', 'update'), ownActivity, controller.returnSubmission);

module.exports = router;
