import { Router } from 'express';
import * as cotizacionesController from '../controllers/cotizaciones.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, cotizacionesController.getCotizaciones);
router.get('/:id', authenticateToken, cotizacionesController.getCotizacionById);
router.post('/', authenticateToken, cotizacionesController.createCotizacion);
router.put('/:id', authenticateToken, cotizacionesController.updateCotizacion);
router.put('/:id/convertir', authenticateToken, cotizacionesController.convertirAVenta);
router.put('/:id/aprobar', authenticateToken, cotizacionesController.aprobarCotizacion);
router.put('/:id/rechazar', authenticateToken, cotizacionesController.rechazarCotizacion);

// Nueva cotización manual (desde cero)
router.post('/manual', authenticateToken, cotizacionesController.createCotizacionManual);

export default router;
