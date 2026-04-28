import { Router } from 'express';
import * as jobsController from '../controllers/jobs.controller';
import { sendRecordatorioReminders } from '../controllers/recordatorios.controller';

const router = Router();

router.post('/send-payment-reminders', jobsController.sendPaymentReminders);
router.post('/send-cotizacion-vencimiento-reminders', jobsController.sendCotizacionVencimientoReminders);
router.post('/send-seguimiento-reminders', jobsController.sendSeguimientoReminders);
router.post('/send-recordatorio-reminders', sendRecordatorioReminders);

export default router;
