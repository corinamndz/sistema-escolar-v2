const router = require('express').Router();
const controller = require('./learning.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { materialUpload } = require('../../middlewares/upload.middleware');

/**
 * Material de apoyo del contenido programático (migración 103), lado del
 * docente. Mismos permisos que el contenido programático (evaluation_plans) y
 * el mismo alcance: el docente solo gestiona las materias y grados que dicta;
 * el coordinador, los de su nivel (los demás → 404).
 * Las rutas de la familia y del modo alumno están en portal.routes.js.
 */
const can = (action) => requirePermission('evaluation_plans', action);

router.use(authMiddleware, tenantMiddleware);

router.get('/contents/:contentId/materials', can('read'), controller.ownContent, controller.listMaterials);
router.post('/contents/:contentId/materials', can('create'), controller.ownContent, materialUpload, controller.createMaterial);
router.put('/contents/:contentId/materials/order', can('update'), controller.ownContent, controller.reorderMaterials);
router.put('/materials/:materialId', can('update'), controller.ownMaterial, materialUpload, controller.updateMaterial);
router.delete('/materials/:materialId', can('delete'), controller.ownMaterial, controller.deleteMaterial);
router.get('/materials/:materialId/progress', can('read'), controller.ownMaterial, controller.materialProgress);
router.get('/materials/:materialId/file', can('read'), controller.ownMaterial, controller.downloadStaffFile);

module.exports = router;
