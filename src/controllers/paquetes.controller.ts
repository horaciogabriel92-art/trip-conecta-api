import { Request, Response } from 'express';
import db from '../config/database';

export const getAllPaquetes = (req: Request, res: Response) => {
    try {
        const paquetes = db.prepare('SELECT * FROM paquetes WHERE status != "eliminado"').all();
        res.json(paquetes);
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPaqueteById = (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const paquete = db.prepare('SELECT * FROM paquetes WHERE id = ?').get(id);
        if (!paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        res.json(paquete);
    } catch (error) {
        console.error('Error fetching package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createPaquete = (req: Request, res: Response) => {
    const data = req.body;
    try {
        const columns = Object.keys(data).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const values = Object.values(data);

        const result = db.prepare(`INSERT INTO paquetes (${columns}) VALUES (${placeholders})`).run(...values);
        res.status(201).json({ id: result.lastInsertRowid, ...data });
    } catch (error) {
        console.error('Error creating package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updatePaquete = (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    try {
        const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), id];

        const result = db.prepare(`UPDATE paquetes SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        res.json({ message: 'Paquete actualizado correctamente' });
    } catch (error) {
        console.error('Error updating package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deletePaquete = (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Soft delete
        const result = db.prepare('UPDATE paquetes SET status = "eliminado", updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        res.json({ message: 'Paquete eliminado correctamente' });
    } catch (error) {
        console.error('Error deleting package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
