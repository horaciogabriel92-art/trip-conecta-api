import { Router } from 'express';
import { authenticateSuperadmin, requireSuperadmin } from '../middleware/superadmin-auth';
import { loginSuperadmin, getMe } from '../controllers/ernesto-auth.controller';
import { listTenants, getTenant, updateTenant, toggleTenant, getTenantUsers } from '../controllers/ernesto-tenants.controller';
import { getGlobalStats } from '../controllers/ernesto-stats.controller';
import { listTickets, getTicket, updateTicket, replyTicket } from '../controllers/ernesto-support.controller';
import { listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, sendMassEmail } from '../controllers/ernesto-announcements.controller';

const router = Router();

// Auth público
router.post('/auth/login', loginSuperadmin);

// Todo lo siguiente requiere ser superadmin o support
router.use(authenticateSuperadmin);

router.get('/auth/me', getMe);
router.get('/stats', getGlobalStats);

// Tenants
router.get('/tenants', listTenants);
router.get('/tenants/:id', getTenant);
router.put('/tenants/:id', updateTenant);
router.post('/tenants/:id/toggle', toggleTenant);
router.get('/tenants/:id/users', getTenantUsers);

// Soporte
router.get('/support-tickets', listTickets);
router.get('/support-tickets/:id', getTicket);
router.put('/support-tickets/:id', updateTicket);
router.post('/support-tickets/:id/reply', replyTicket);

// Comunicaciones (solo superadmin)
router.get('/announcements', requireSuperadmin, listAnnouncements);
router.post('/announcements', requireSuperadmin, createAnnouncement);
router.put('/announcements/:id', requireSuperadmin, updateAnnouncement);
router.delete('/announcements/:id', requireSuperadmin, deleteAnnouncement);
router.post('/email-campaigns', requireSuperadmin, sendMassEmail);

export default router;
