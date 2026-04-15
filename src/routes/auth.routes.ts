import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticateToken, authorizeRole } from '../middleware/auth';
import { loginLimiter, apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/login', loginLimiter, authController.login);
router.post('/forgot-password', apiLimiter, authController.forgotPassword);
router.post('/reset-password', apiLimiter, authController.resetPassword);
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile', authenticateToken, authController.updateProfile);

// Admin routes
router.get('/users', authenticateToken, authorizeRole(['admin']), authController.getAllUsers);
router.post('/users', authenticateToken, authorizeRole(['admin']), authController.createUser);

export default router;
