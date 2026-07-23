import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getPublicLandings,
  getPublicLanding,
  getPublicPaquete,
  postPublicCotizar,
  getLandingConfig,
  updateLandingConfig
} from '../controllers/public.controller';

const router = Router();

// Endpoints públicos (sin auth)
router.get('/landings', getPublicLandings);
router.get('/landing/:slug', getPublicLanding);
router.get('/landing/:slug/paquetes/:id', getPublicPaquete);
router.post('/landing/:slug/cotizar', postPublicCotizar);

// Configuración de landing (admin autenticado)
router.get('/config/landing', authenticateToken, getLandingConfig);
router.put('/config/landing', authenticateToken, updateLandingConfig);

export default router;
