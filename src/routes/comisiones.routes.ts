import { Router } from 'express';
import * as comisionesController from '../controllers/comisiones.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/pendientes', authenticateToken, comisionesController.getComisionesPendientes);
router.get('/pagadas', authenticateToken, comisionesController.getComisionesPagadas);
router.get('/resumen', authenticateToken, comisionesController.getResumenComisiones);
router.post('/pagos', authenticateToken, authorizeRole(['admin']), comisionesController.registrarPagoComision);

export default router;
