import { Router } from 'express';
import * as paquetesController from '../controllers/paquetes.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';

const router = Router();

// Public/Vendedor routes
router.get('/', authenticateToken, paquetesController.getAllPaquetes);
router.get('/:id', authenticateToken, paquetesController.getPaqueteById);

// Admin only routes
router.post('/', authenticateToken, authorizeRole(['admin']), paquetesController.createPaquete);
router.put('/:id', authenticateToken, authorizeRole(['admin']), paquetesController.updatePaquete);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), paquetesController.deletePaquete);

export default router;
