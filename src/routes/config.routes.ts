import { Router } from 'express';
import { getTenantConfig } from '../controllers/config.controller';

const router = Router();

router.get('/tenant', getTenantConfig);

export default router;
