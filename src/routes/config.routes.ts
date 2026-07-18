import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getTenantConfig, getTenantConfigMe, getPublicPlans, updateTenantConfig, deleteDemoDataController } from '../controllers/config.controller';

const router = Router();

router.get('/tenant', getTenantConfig);
router.get('/tenant/me', authenticateToken, getTenantConfigMe);
router.get('/plans', getPublicPlans);
router.put('/tenant', authenticateToken, updateTenantConfig);
router.delete('/demo-data', authenticateToken, deleteDemoDataController);

export default router;
