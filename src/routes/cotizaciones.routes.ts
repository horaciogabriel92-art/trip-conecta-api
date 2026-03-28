import { Router } from 'express';
import * as cotizacionesController from '../controllers/cotizaciones.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, cotizacionesController.getCotizaciones);
router.post('/migrate', authenticateToken, cotizacionesController.runMigration);
router.post('/', authenticateToken, cotizacionesController.createCotizacion);

// Rutas específicas (deben ir antes que /:id)
router.post('/manual', authenticateToken, cotizacionesController.createCotizacionManual);

// Rutas con :id - orden específico a genérico
router.get('/:id', authenticateToken, cotizacionesController.getCotizacionById);
router.put('/:id/convertir', authenticateToken, cotizacionesController.convertirAVenta);
router.put('/:id/aprobar', authenticateToken, cotizacionesController.aprobarCotizacion);
router.put('/:id/rechazar', authenticateToken, cotizacionesController.rechazarCotizacion);
router.put('/:id/enviar', authenticateToken, cotizacionesController.enviarCotizacion);
router.put('/:id', authenticateToken, cotizacionesController.updateCotizacion);
router.delete('/:id', authenticateToken, cotizacionesController.deleteCotizacion);

export default router;
