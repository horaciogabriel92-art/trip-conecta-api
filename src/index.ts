import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import path from 'path';
import fs from 'fs';
import { supabase } from './config/supabase';
import { apiLimiter } from './middleware/rateLimiter';

dotenv.config();

// Crear directorios de uploads automáticamente
const storagePath = process.env.STORAGE_PATH || './storage/uploads';
const dirs = ['comprobantes', 'vouchers'];
dirs.forEach(dir => {
    const fullPath = path.join(storagePath, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`[INIT] Created directory: ${fullPath}`);
    }
});

const logger = pino(pinoPretty());
const app = express();
const port = process.env.PORT || 3001;

// Trust proxy (necesario para rate limiting detrás de Traefik/nginx)
app.set('trust proxy', 1);

app.use(cors());
// NO aplicar express.json() globalmente - se aplica por ruta
// app.use(express.json());

// Servir archivos estáticos (comprobantes de pago y documentos)
app.use('/uploads', express.static(storagePath));

// Rate limiting general para toda la API
app.use('/api/', apiLimiter);

// Rutas
import authRoutes from './routes/auth.routes';
import paquetesRoutes from './routes/paquetes.routes';
import cotizacionesRoutes from './routes/cotizaciones.routes';
import ventasRoutes from './routes/ventas.routes';
import documentosRoutes from './routes/documentos.routes';
import comisionesRoutes from './routes/comisiones.routes';
import uploadRoutes from './routes/upload.routes';
import clientesRoutes from './routes/clientes.routes';
import notificacionesRoutes from './routes/notificaciones.routes';
import adminRoutes from './routes/admin.routes';
import jobsRoutes from './routes/jobs.routes';
app.use('/api/auth', express.json(), authRoutes);
app.use('/api/admin', express.json(), adminRoutes);
app.use('/api/paquetes', express.json(), paquetesRoutes);
app.use('/api/cotizaciones', express.json(), cotizacionesRoutes);
app.use('/api/ventas', express.json(), ventasRoutes);
app.use('/api/documentos', express.json(), documentosRoutes);
app.use('/api/comisiones', express.json(), comisionesRoutes);
app.use('/api/clientes', express.json(), clientesRoutes);
app.use('/api/notificaciones', express.json(), notificacionesRoutes);
app.use('/api/upload', uploadRoutes); // Sin express.json() - usa multipart
app.use('/api/jobs', express.json(), jobsRoutes);

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
