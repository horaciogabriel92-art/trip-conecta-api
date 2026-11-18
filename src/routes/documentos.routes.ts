import { Router } from 'express';
import * as documentosController from '../controllers/documentos.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// Middleware flexible: acepta 'documento' o 'archivo' para soportar ambos formatos de formulario
const uploadFlexible = (req: any, res: any, next: any) => {
    upload.fields([{ name: 'documento', maxCount: 1 }, { name: 'archivo', maxCount: 1 }])(req, res, (err) => {
        if (err) return next(err);
        if (req.files) {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            req.file = files['archivo']?.[0] || files['documento']?.[0];
        }
        next();
    });
};

router.get('/venta/:ventaId', authenticateToken, documentosController.getDocumentosByVenta);
router.get('/:id/download', authenticateToken, documentosController.downloadDocumento);
router.post('/', authenticateToken, uploadFlexible, documentosController.uploadDocumento);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), documentosController.deleteDocumento);

export default router;
