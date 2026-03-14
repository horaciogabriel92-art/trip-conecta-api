import { Request, Response } from 'express';
import db from '../config/database';

export const getComisionesPendientes = (req: Request, res: Response) => {
    try {
        const comisiones = db.prepare(`
            SELECT v.*, u.nombre as vendedor_nombre, u.apellido as vendedor_apellido 
            FROM ventas v
            JOIN users u ON v.vendedor_id = u.id
            WHERE v.estado_comision = 'pendiente'
        `).all();
        res.json(comisiones);
    } catch (error) {
        console.error('Error fetching pending commissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const registrarPagoComision = (req: Request, res: Response) => {
    const { vendedor_id, monto_total, ventas_ids, metodo_pago, comprobante_numero } = req.body;
    const admin_id = (req as any).user.id;

    try {
        db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO pagos_comisiones (
                    vendedor_id, fecha_pago, monto_total, metodo_pago, 
                    comprobante_numero, ventas_ids, cantidad_ventas, procesado_por_admin_id
                ) VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?, ?)
            `).run(
                vendedor_id, monto_total, metodo_pago, comprobante_numero, 
                JSON.stringify(ventas_ids), ventas_ids.length, admin_id
            );

            // Update sales status
            const placeholders = ventas_ids.map(() => '?').join(', ');
            db.prepare(`
                UPDATE ventas 
                SET estado_comision = 'pagada', fecha_pago_comision = CURRENT_DATE 
                WHERE id IN (${placeholders})
            `).run(...ventas_ids);
        })();

        res.status(201).json({ message: 'Pago registrado correctamente' });
    } catch (error) {
        console.error('Error registering commission payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
