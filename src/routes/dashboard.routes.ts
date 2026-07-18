import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getDashboardSummary } from '../controllers/dashboard.controller';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// GET /api/dashboard/summary - Resumen del dashboard según rol
router.get('/summary', getDashboardSummary);

export default router;
