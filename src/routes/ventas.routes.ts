import { Router } from 'express';
import * as ventasController from '../controllers/ventas.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, ventasController.getVentas);
router.get('/stats', authenticateToken, ventasController.getEstadisticas);
router.get('/:id', authenticateToken, ventasController.getVentaById);
router.put('/:id/estado', authenticateToken, authorizeRole(['admin']), ventasController.updateEstadoVenta);
router.put('/:id/pagar-comision', authenticateToken, authorizeRole(['admin']), ventasController.pagarComision);

export default router;
