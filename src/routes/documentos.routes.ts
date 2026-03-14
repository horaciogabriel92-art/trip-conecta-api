import { Router } from 'express';
import * as documentosController from '../controllers/documentos.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.get('/venta/:ventaId', authenticateToken, documentosController.getDocumentosByVenta);
router.post('/', authenticateToken, authorizeRole(['admin']), upload.single('archivo'), documentosController.uploadDocumento);

export default router;
