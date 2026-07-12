import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getTenantConfig, getPublicPlans, updateTenantConfig } from '../controllers/config.controller';

const router = Router();

router.get('/tenant', getTenantConfig);
router.get('/plans', getPublicPlans);
router.put('/tenant', authenticateToken, updateTenantConfig);

export default router;
