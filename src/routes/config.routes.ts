import { Router } from 'express';
import { getTenantConfig, getPublicPlans } from '../controllers/config.controller';

const router = Router();

router.get('/tenant', getTenantConfig);
router.get('/plans', getPublicPlans);

export default router;
