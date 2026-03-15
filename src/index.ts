import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { supabase } from './config/supabase';

dotenv.config();

const logger = pino(pinoPretty());
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Rutas
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

// Health check con verificación de Supabase
app.get('/api/health', async (req, res) => {
    try {
        // Verificar conexión a Supabase
        const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
        
        if (error) {
            return res.status(500).json({ 
                status: 'error', 
                message: 'Database connection failed',
                error: error.message 
            });
        }
        
        res.json({ 
            status: 'ok', 
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Health check failed' 
        });
    }
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
