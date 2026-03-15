import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/login', loginLimiter, authController.login);
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile', authenticateToken, authController.updateProfile);

// Admin routes
router.get('/users', authenticateToken, authorizeRole(['admin']), authController.getAllUsers);
router.post('/users', authenticateToken, authorizeRole(['admin']), authController.createUser);

export default router;
