import { Router } from 'express';
import * as reportesController from '../controllers/reportes.controller';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';

const router = Router();

router.get('/pipeline', authenticateToken, requirePermission('ver_reportes'), reportesController.getPipelineReport);
router.get('/cobranza', authenticateToken, requirePermission('ver_reportes'), reportesController.getCobranzaReport);
router.get('/vendedores', authenticateToken, requirePermission('ver_reportes'), reportesController.getVendedoresReport);
router.get('/productos', authenticateToken, requirePermission('ver_reportes'), reportesController.getProductosReport);
router.get('/crm', authenticateToken, requirePermission('ver_reportes'), reportesController.getCRMReport);

export default router;
