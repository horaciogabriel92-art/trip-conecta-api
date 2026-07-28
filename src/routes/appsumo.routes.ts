import { Router } from 'express';
import { webhook, oauthRedirect, activate, validateToken } from '../controllers/appsumo.controller';

const router = Router();

router.post('/webhook', webhook);
router.get('/oauth', oauthRedirect);
router.get('/validate-token', validateToken);
router.post('/activate', activate);

export default router;
