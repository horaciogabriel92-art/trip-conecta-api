import { Request, Response } from 'express';
import db from '../config/database';
import path from 'path';

export const uploadDocumento = (req: Request, res: Response) => {
    const { venta_id, tipo, titulo, descripcion } = req.body;
    const file = req.file;
    const admin_id = (req as any).user.id;

    if (!file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    try {
        const result = db.prepare(`
            INSERT INTO documentos_viaje (
                venta_id, tipo, titulo, descripcion,
                archivo_url, archivo_nombre_original, archivo_tipo, archivo_size,
                subido_por_admin_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            venta_id, tipo, titulo, descripcion,
            file.path, file.originalname, file.mimetype, file.size,
            admin_id
        );

        res.status(201).json({ id: result.lastInsertRowid, message: 'Documento subido correctamente' });
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getDocumentosByVenta = (req: Request, res: Response) => {
    const { ventaId } = req.params;
    try {
        const documentos = db.prepare('SELECT * FROM documentos_viaje WHERE venta_id = ?').all(ventaId);
        res.json(documentos);
    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
