import { Router } from 'express';
import * as cotizacionesController from '../controllers/cotizaciones.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, cotizacionesController.getCotizaciones);
router.post('/', authenticateToken, cotizacionesController.createCotizacion);

export default router;
