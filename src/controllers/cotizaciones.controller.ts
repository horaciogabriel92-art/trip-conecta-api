import { Request, Response } from 'express';
import db from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export const createCotizacion = (req: Request, res: Response) => {
    const { 
        paquete_id, 
        cliente_nombre, 
        cliente_apellido, 
        cliente_email, 
        cliente_telefono,
        tipo_habitacion,
        numero_personas,
        numero_habitaciones
    } = req.body;
    const vendedor_id = (req as any).user.id;

    try {
        const paquete: any = db.prepare('SELECT * FROM paquetes WHERE id = ?').get(paquete_id);
        if (!paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        // Calculate price
        let precio_por_persona = 0;
        switch (tipo_habitacion) {
            case 'single': precio_por_persona = paquete.precio_single; break;
            case 'doble': precio_por_persona = paquete.precio_doble; break;
            case 'triple': precio_por_persona = paquete.precio_triple; break;
            case 'cuadruple': precio_por_persona = paquete.precio_cuadruple; break;
            default: return res.status(400).json({ error: 'Tipo de habitación inválido' });
        }

        const precio_total = precio_por_persona * numero_personas;
        const numero_cotizacion = `COT-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;

        const result = db.prepare(`
            INSERT INTO cotizaciones (
                numero_cotizacion, vendedor_id, paquete_id,
                cliente_nombre, cliente_apellido, cliente_email, cliente_telefono,
                tipo_habitacion, numero_habitaciones, numero_personas,
                precio_por_persona, precio_total, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
        `).run(
            numero_cotizacion, vendedor_id, paquete_id,
            cliente_nombre, cliente_apellido, cliente_email, cliente_telefono,
            tipo_habitacion, numero_habitaciones, numero_personas,
            precio_por_persona, precio_total
        );

        res.status(201).json({ id: result.lastInsertRowid, numero_cotizacion, precio_total });
    } catch (error) {
        console.error('Error creating quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCotizaciones = (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        let cotizaciones;
        if (user.role === 'admin') {
            cotizaciones = db.prepare('SELECT * FROM cotizaciones').all();
        } else {
            cotizaciones = db.prepare('SELECT * FROM cotizaciones WHERE vendedor_id = ?').all(user.id);
        }
        res.json(cotizaciones);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
