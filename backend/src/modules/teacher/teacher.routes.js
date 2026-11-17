const router = require('express').Router();
const { z } = require('zod');
const service = require('./teacher.service');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { asyncHandler } = require('../../utils/asyncHandler');

/**
 * Portal del docente: sus clases, el panel "Hoy" y el enlace de clase en
 * línea. Sin permisos de módulo propios: todo se limita a la carga docente del
 * usuario (teacherScope); a quien no es docente le devuelve listas vacías.
 */
router.use(authMiddleware, tenantMiddleware);

const uuid = (label) => z.string().uuid(`${label} no es válido.`);

router.get('/classes', asyncHandler(async (req, res) => res.status(200).json(await service.listClasses(req))));

router.get('/today', asyncHandler(async (req, res) => res.status(200).json(await service.today(req))));

router.get(
  '/sections/:sectionId/students',
  asyncHandler(async (req, res) => res.status(200).json(await service.sectionStudents(req, uuid('La sección').parse(req.params.sectionId))))
);

router.put(
  '/classes/:sectionId/:subjectId/link',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        url: z.preprocess(
          (v) => (typeof v === 'string' && !v.trim() ? null : v),
          z.string().trim().max(500).regex(/^https:\/\/[^\s]+\.[^\s]+/i, 'El enlace debe empezar por https://').nullable()
        ),
        label: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(60).nullable().optional()),
      })
      .parse(req.body || {});
    res.status(200).json(await service.setClassLink(req, uuid('La sección').parse(req.params.sectionId), uuid('La materia').parse(req.params.subjectId), data));
  })
);

module.exports = router;
