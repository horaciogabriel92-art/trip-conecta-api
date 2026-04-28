import { Router } from 'express';
import * as jobsController from '../controllers/jobs.controller';

const router = Router();

router.post('/send-payment-reminders', jobsController.sendPaymentReminders);
router.post('/send-cotizacion-vencimiento-reminders', jobsController.sendCotizacionVencimientoReminders);
router.post('/send-seguimiento-reminders', jobsController.sendSeguimientoReminders);

export default router;
