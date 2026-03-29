import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    getNotificaciones,
    marcarLeida,
    marcarTodasLeidas,
    crearNotificacion
} from '../controllers/notificaciones.controller';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// GET /api/notificaciones - Obtener notificaciones del usuario
router.get('/', getNotificaciones);

// POST /api/notificaciones - Crear notificación (solo admin)
router.post('/', crearNotificacion);

// PUT /api/notificaciones/:id/leida - Marcar como leída
router.put('/:id/leida', marcarLeida);

// PUT /api/notificaciones/marcar-todas-leidas - Marcar todas como leídas
router.put('/marcar-todas-leidas', marcarTodasLeidas);

export default router;
