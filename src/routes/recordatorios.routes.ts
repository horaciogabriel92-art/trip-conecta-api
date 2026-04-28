import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    getRecordatorios,
    getRecordatorioById,
    createRecordatorio,
    updateRecordatorio,
    deleteRecordatorio
} from '../controllers/recordatorios.controller';

const router = Router();

// CRUD de recordatorios
router.get('/', authenticateToken, getRecordatorios);
router.get('/:id', authenticateToken, getRecordatorioById);
router.post('/', authenticateToken, createRecordatorio);
router.put('/:id', authenticateToken, updateRecordatorio);
router.delete('/:id', authenticateToken, deleteRecordatorio);

export default router;
