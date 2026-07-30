import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  createTicket,
  listMyTickets,
  getTicket,
  replyTicket,
} from '../controllers/support-tickets.controller';

const router = Router();

router.use(authenticateToken);

router.post('/tickets', createTicket);
router.get('/tickets', listMyTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/reply', replyTicket);

export default router;
