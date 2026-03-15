import { Router } from 'express';
import * as documentosController from '../controllers/documentos.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.get('/venta/:ventaId', authenticateToken, documentosController.getDocumentosByVenta);
router.get('/:id/download', authenticateToken, documentosController.downloadDocumento);
router.post('/', authenticateToken, upload.single('documento'), documentosController.uploadDocumento);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), documentosController.deleteDocumento);

export default router;
