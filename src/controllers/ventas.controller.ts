import { Request, Response } from 'express';
import db from '../config/database';

export const createVentaFromCotizacion = (req: Request, res: Response) => {
    const { cotizacion_id } = req.body;
    const admin_id = (req as any).user.id;

    try {
        const cotizacion: any = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(cotizacion_id);
        if (!cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        if (cotizacion.status === 'convertida') {
            return res.status(400).json({ error: 'Esta cotización ya ha sido convertida en venta' });
        }

        const user: any = db.prepare('SELECT comision_porcentaje FROM users WHERE id = ?').get(cotizacion.vendedor_id);
        const comision_porcentaje = user.comision_porcentaje || 12.00;
        const comision_monto = cotizacion.precio_total * (comision_porcentaje / 100);

        const numero_venta = `VEN-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;

        db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO ventas (
                    numero_venta, vendedor_id, paquete_id, cotizacion_id,
                    cliente_nombre, cliente_apellido, cliente_email, cliente_telefono,
                    tipo_habitacion, numero_habitaciones, numero_personas,
                    precio_venta_total, comision_porcentaje_aplicado, comision_monto,
                    estado_venta, estado_comision
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', 'pendiente')
            `).run(
                numero_venta, cotizacion.vendedor_id, cotizacion.paquete_id, cotizacion.id,
                cotizacion.cliente_nombre, cotizacion.cliente_apellido, cotizacion.cliente_email, cotizacion.cliente_telefono,
                cotizacion.tipo_habitacion, cotizacion.numero_habitaciones, cotizacion.numero_personas,
                cotizacion.precio_total, comision_porcentaje, comision_monto
            );

            db.prepare('UPDATE cotizaciones SET status = "convertida", convertida_en_venta_id = ? WHERE id = ?').run(result.lastInsertRowid, cotizacion.id);
            
            // Update package stock (if managed)
            db.prepare('UPDATE paquetes SET cupos_vendidos = cupos_vendidos + ?, cupos_disponibles = cupos_disponibles - ? WHERE id = ?').run(
                cotizacion.numero_personas, cotizacion.numero_personas, cotizacion.paquete_id
            );
        })();

        res.status(201).json({ numero_venta });
    } catch (error) {
        console.error('Error creating sale:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getVentas = (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        let ventas;
        if (user.role === 'admin') {
            ventas = db.prepare('SELECT * FROM ventas').all();
        } else {
            ventas = db.prepare('SELECT * FROM ventas WHERE vendedor_id = ?').all(user.id);
        }
        res.json(ventas);
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
