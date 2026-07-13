import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  createCheckout,
  createPortal,
  getInvoices,
  getSubscriptionStatus,
} from '../controllers/billing.controller';

const router = Router();

// Rutas protegidas para administradores
router.post('/checkout', authenticateToken, createCheckout);
router.post('/portal', authenticateToken, createPortal);
router.get('/invoices', authenticateToken, getInvoices);
router.get('/subscription', authenticateToken, getSubscriptionStatus);

export default router;
