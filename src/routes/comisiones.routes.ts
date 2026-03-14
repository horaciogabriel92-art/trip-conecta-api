import { Router } from 'express';
import * as comisionesController from '../controllers/comisiones.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/pendientes', authenticateToken, authorizeRole(['admin']), comisionesController.getComisionesPendientes);
router.post('/pagos', authenticateToken, authorizeRole(['admin']), comisionesController.registrarPagoComision);

export default router;
