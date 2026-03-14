import { Router } from 'express';
import * as ventasController from '../controllers/ventas.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, ventasController.getVentas);
router.post('/convertir', authenticateToken, authorizeRole(['admin']), ventasController.createVentaFromCotizacion);

export default router;
