import { Router } from 'express';
import * as reportesController from '../controllers/reportes.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/pipeline', authenticateToken, reportesController.getPipelineReport);
router.get('/cobranza', authenticateToken, reportesController.getCobranzaReport);
router.get('/vendedores', authenticateToken, reportesController.getVendedoresReport);
router.get('/productos', authenticateToken, reportesController.getProductosReport);
router.get('/crm', authenticateToken, reportesController.getCRMReport);

export default router;
