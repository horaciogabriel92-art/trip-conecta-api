import { Router } from 'express';
import { generarPDF, descargarPDF, regenerarPDF } from '../controllers/pdf.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// POST /cotizaciones/:id/pdf - Generar nuevo PDF
router.post('/cotizaciones/:id/pdf', generarPDF);

// GET /cotizaciones/:id/pdf - Descargar PDF existente
router.get('/cotizaciones/:id/pdf', descargarPDF);

// PUT /cotizaciones/:id/pdf - Regenerar PDF
router.put('/cotizaciones/:id/pdf', regenerarPDF);

export default router;
