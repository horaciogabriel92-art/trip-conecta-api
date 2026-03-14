import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

dotenv.config();

const logger = pino(pinoPretty());
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

import authRoutes from './routes/auth.routes';
import paquetesRoutes from './routes/paquetes.routes';
import cotizacionesRoutes from './routes/cotizaciones.routes';
import ventasRoutes from './routes/ventas.routes';
import documentosRoutes from './routes/documentos.routes';
import comisionesRoutes from './routes/comisiones.routes';

app.use('/api/auth', authRoutes);
app.use('/api/paquetes', paquetesRoutes);
app.use('/api/cotizaciones', cotizacionesRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/comisiones', comisionesRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});
