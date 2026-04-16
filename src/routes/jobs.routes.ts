import { Router } from 'express';
import * as jobsController from '../controllers/jobs.controller';

const router = Router();

router.post('/send-payment-reminders', jobsController.sendPaymentReminders);

export default router;
