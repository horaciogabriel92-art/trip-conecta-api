import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  listActiveAnnouncements,
  markAnnouncementAsRead,
} from '../controllers/announcements.controller';

const router = Router();

router.use(authenticateToken);

router.get('/', listActiveAnnouncements);
router.post('/:id/read', markAnnouncementAsRead);

export default router;
