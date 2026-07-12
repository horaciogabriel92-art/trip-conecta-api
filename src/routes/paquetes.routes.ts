import { Router } from 'express';
import * as paquetesController from '../controllers/paquetes.controller';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';

const router = Router();

// Public/Vendedor routes
router.get('/', authenticateToken, paquetesController.getAllPaquetes);
router.get('/:id', authenticateToken, paquetesController.getPaqueteById);

// Routes that require package management permission
router.post('/', authenticateToken, requirePermission('gestionar_paquetes'), paquetesController.createPaquete);
router.put('/:id', authenticateToken, requirePermission('gestionar_paquetes'), paquetesController.updatePaquete);
router.delete('/:id', authenticateToken, requirePermission('gestionar_paquetes'), paquetesController.deletePaquete);

export default router;
