import { Router } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * Limpiar comprobantes huérfanos (registros en BD sin archivo físico)
 * POST /api/admin/cleanup-comprobantes
 */
router.post('/cleanup-comprobantes', authenticateToken, async (req, res) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo admins pueden ejecutar esta acción' });
        }

        const uploadDir = process.env.STORAGE_PATH || '/app/storage/uploads';
        const comprobantesDir = path.join(uploadDir, 'comprobantes');
        
        // Obtener todos los comprobantes de la BD
        const { data: comprobantesBD, error } = await supabase
            .from('comprobantes_pago')
            .select('id, nombre_archivo, ruta_archivo, cotizacion_id');
        
        if (error) {
            return res.status(500).json({ error: 'Error al obtener comprobantes', details: error.message });
        }

        const resultado = {
            totalEnBD: comprobantesBD?.length || 0,
            huérfanos: [] as any[],
            existentes: [] as any[],
            errores: [] as string[]
        };

        // Verificar cada comprobante
        for (const comp of (comprobantesBD || [])) {
            const filePath = path.join(comprobantesDir, comp.ruta_archivo);
            
            if (fs.existsSync(filePath)) {
                resultado.existentes.push({
                    id: comp.id,
                    nombre: comp.nombre_archivo,
                    ruta: comp.ruta_archivo
                });
            } else {
                resultado.huérfanos.push({
                    id: comp.id,
                    nombre: comp.nombre_archivo,
                    ruta: comp.ruta_archivo,
                    rutaCompleta: filePath
                });
            }
        }

        // Si hay huérfanos, eliminarlos de la BD
        if (resultado.huérfanos.length > 0) {
            const idsAEliminar = resultado.huérfanos.map(h => h.id);
            
            const { error: deleteError } = await supabase
                .from('comprobantes_pago')
                .delete()
                .in('id', idsAEliminar);
            
            if (deleteError) {
                resultado.errores.push(`Error al eliminar: ${deleteError.message}`);
            }
        }

        res.json({
            message: `Limpieza completada. ${resultado.huérfanos.length} comprobantes huérfanos eliminados.`,
            ...resultado,
            eliminados: resultado.huérfanos.length
        });

    } catch (error: any) {
        console.error('[Admin Cleanup] Error:', error);
        res.status(500).json({ error: 'Error interno', details: error.message });
    }
});

/**
 * Listar estado de archivos físicos vs BD
 * GET /api/admin/comprobantes-status
 */
router.get('/comprobantes-status', authenticateToken, async (req, res) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo admins pueden acceder' });
        }

        const uploadDir = process.env.STORAGE_PATH || '/app/storage/uploads';
        const comprobantesDir = path.join(uploadDir, 'comprobantes');
        
        // Listar archivos físicos
        let archivosFisicos: string[] = [];
        try {
            archivosFisicos = fs.readdirSync(comprobantesDir);
        } catch (e) {
            // Directorio no existe o no es accesible
        }
        
        // Obtener registros de BD
        const { data: comprobantesBD, error } = await supabase
            .from('comprobantes_pago')
            .select('id, nombre_archivo, ruta_archivo, fecha_subida')
            .order('fecha_subida', { ascending: false });
        
        if (error) {
            return res.status(500).json({ error: 'Error BD', details: error.message });
        }

        res.json({
            directorio: comprobantesDir,
            directorioExiste: fs.existsSync(comprobantesDir),
            archivosFisicos: {
                cantidad: archivosFisicos.length,
                lista: archivosFisicos.slice(0, 100) // Limitar a 100
            },
            registrosBD: {
                cantidad: comprobantesBD?.length || 0,
                lista: comprobantesBD?.slice(0, 100) || []
            }
        });

    } catch (error: any) {
        console.error('[Admin Status] Error:', error);
        res.status(500).json({ error: 'Error interno', details: error.message });
    }
});

/**
 * Crear backup de comprobantes
 * POST /api/admin/backup-comprobantes
 */
router.post('/backup-comprobantes', authenticateToken, async (req, res) => {
    try {
        const user = (req as any).user;
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo admins' });
        }

        const uploadDir = process.env.STORAGE_PATH || '/app/storage/uploads';
        const comprobantesDir = path.join(uploadDir, 'comprobantes');
        const backupDir = '/data/trip-conecta/backups';
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `comprobantes-backup-${timestamp}.tar.gz`);
        
        // Crear backup con tar
        const { execSync } = require('child_process');
        
        try {
            execSync(`tar -czf "${backupFile}" -C "${uploadDir}" comprobantes`, { 
                timeout: 60000,
                stdio: 'pipe'
            });
            
            const stats = fs.statSync(backupFile);
            
            res.json({
                message: 'Backup creado exitosamente',
                backupPath: backupFile,
                sizeBytes: stats.size,
                sizeMB: (stats.size / 1024 / 1024).toFixed(2)
            });
        } catch (execError: any) {
            res.status(500).json({ 
                error: 'Error al crear backup', 
                details: execError.message,
                stderr: execError.stderr?.toString()
            });
        }

    } catch (error: any) {
        console.error('[Admin Backup] Error:', error);
        res.status(500).json({ error: 'Error interno', details: error.message });
    }
});

export default router;
