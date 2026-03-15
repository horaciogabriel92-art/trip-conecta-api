import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const uploadDocumento = async (req: Request, res: Response) => {
    const { venta_id, tipo, descripcion } = req.body;
    const file = req.file;
    const user = (req as any).user;

    if (!file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    try {
        // Verificar que la venta existe y el vendedor tiene acceso
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('vendedor_id')
            .eq('id', venta_id)
            .single();

        if (ventaError || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        // Solo admin o el vendedor de la venta pueden subir documentos
        if (user.role !== 'admin' && venta.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Guardar referencia del archivo
        // Nota: En producción, los archivos deberían ir a S3 o Supabase Storage
        const ruta_archivo = file.path || `/storage/uploads/${file.filename}`;

        const { data: documento, error } = await supabase
            .from('documentos_viaje')
            .insert({
                venta_id,
                tipo,
                nombre_archivo: file.originalname,
                ruta_archivo: ruta_archivo,
                descripcion,
                subido_por: user.userId
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ 
            message: 'Documento subido correctamente',
            documento 
        });
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getDocumentosByVenta = async (req: Request, res: Response) => {
    const { ventaId } = req.params;
    const user = (req as any).user;
    
    try {
        // Verificar acceso a la venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('vendedor_id')
            .eq('id', ventaId)
            .single();

        if (ventaError || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        if (user.role !== 'admin' && venta.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const { data: documentos, error } = await supabase
            .from('documentos_viaje')
            .select(`
                *,
                subido_por:subido_por (nombre, apellido)
            `)
            .eq('venta_id', ventaId)
            .order('fecha_subida', { ascending: false });

        if (error) throw error;
        res.json(documentos);
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteDocumento = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Solo admin puede eliminar
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const { error } = await supabase
            .from('documentos_viaje')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Documento eliminado correctamente' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const downloadDocumento = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Obtener documento
        const { data: documento, error: docError } = await supabase
            .from('documentos_viaje')
            .select('*')
            .eq('id', id)
            .single();

        if (docError || !documento) {
            return res.status(404).json({ error: 'Documento no encontrado' });
        }

        // Verificar acceso a la venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('vendedor_id')
            .eq('id', documento.venta_id)
            .single();

        if (ventaError || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        if (user.role !== 'admin' && venta.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Si está en Supabase Storage
        if (documento.ruta_archivo.startsWith('http')) {
            return res.redirect(documento.ruta_archivo);
        }

        // Si es archivo local
        const fs = require('fs');
        const path = require('path');
        
        // Intentar varias rutas posibles
        let filePath = documento.ruta_archivo;
        if (!fs.existsSync(filePath)) {
            filePath = path.join(process.cwd(), documento.ruta_archivo);
        }
        if (!fs.existsSync(filePath)) {
            filePath = path.join(process.cwd(), 'storage', 'uploads', path.basename(documento.ruta_archivo));
        }
        
        if (!fs.existsSync(filePath)) {
            console.error('Archivo no encontrado en:', filePath);
            return res.status(404).json({ error: 'Archivo no encontrado en servidor' });
        }

        // Determinar content type
        const ext = path.extname(documento.nombre_archivo).toLowerCase();
        const contentType = 
            ext === '.pdf' ? 'application/pdf' :
            ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
            ext === '.png' ? 'image/png' :
            'application/octet-stream';

        res.setHeader('Content-Disposition', `attachment; filename="${documento.nombre_archivo}"`);
        res.setHeader('Content-Type', contentType);
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (err: any) => {
            console.error('Error leyendo archivo:', err);
            res.status(500).json({ error: 'Error leyendo archivo' });
        });
    } catch (error) {
        console.error('Error downloading document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
