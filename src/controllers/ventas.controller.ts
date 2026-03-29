import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getVentas = async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        let query = supabase.from('ventas').select('*');
        
        // Si no es admin, solo ver las suyas
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: ventas, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;
        res.json(ventas);
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getVentaById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Obtener venta con cotizacion para traer comprobantes
        let query = supabase
            .from('ventas')
            .select(`
                *,
                cotizacion:cotizacion_id (
                    id,
                    comprobantes_pago:comprobantes_pago(*)
                )
            `)
            .eq('id', id);
        
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: venta, error } = await query.single();

        if (error || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        // Formatear respuesta para incluir comprobantes en el nivel raíz
        const comprobantes = venta.cotizacion?.comprobantes_pago || [];
        const comprobantesConUrl = comprobantes.map((c: any) => ({
            ...c,
            url: `/uploads/comprobantes/${c.ruta_archivo}`
        }));
        
        const ventaFormateada = {
            ...venta,
            comprobantes_pago: comprobantesConUrl
        };
        delete (ventaFormateada as any).cotizacion;

        res.json(ventaFormateada);
    } catch (error) {
        console.error('Error fetching sale:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateEstadoVenta = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { estado } = req.body;
    const user = (req as any).user;
    
    try {
        // Solo admin puede cambiar estado
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const { data: venta, error } = await supabase
            .from('ventas')
            .update({ estado })
            .eq('id', id)
            .select()
            .single();

        if (error || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        res.json({ message: 'Estado actualizado', venta });
    } catch (error) {
        console.error('Error updating sale status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const pagarComision = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { metodo_pago, referencia_pago, notas } = req.body;
    const user = (req as any).user;
    
    try {
        // Solo admin puede pagar comisiones
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Obtener venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('*')
            .eq('id', id)
            .single();

        if (ventaError || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        if (venta.comision_estado === 'pagada') {
            return res.status(400).json({ error: 'La comisión ya fue pagada' });
        }

        // Actualizar venta
        const { error: updateError } = await supabase
            .from('ventas')
            .update({ 
                comision_estado: 'pagada',
                fecha_pago_comision: new Date().toISOString(),
                metodo_pago
            })
            .eq('id', id);

        if (updateError) throw updateError;

        // Registrar en pagos_comisiones
        const { error: pagoError } = await supabase
            .from('pagos_comisiones')
            .insert({
                vendedor_id: venta.vendedor_id,
                venta_id: id,
                monto: venta.comision_monto,
                metodo_pago,
                referencia_pago,
                pagado_por: user.userId,
                notas
            });

        if (pagoError) throw pagoError;

        res.json({ message: 'Comisión pagada exitosamente' });
    } catch (error) {
        console.error('Error paying commission:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getEstadisticas = async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    try {
        // Si es vendedor, solo sus stats
        if (user.role !== 'admin') {
            const { data: ventas, error } = await supabase
                .from('ventas')
                .select('precio_total, comision_monto, comision_estado')
                .eq('vendedor_id', user.userId);

            if (error) throw error;

            const totalVentas = ventas.reduce((sum, v) => sum + v.precio_total, 0);
            const totalComisiones = ventas.reduce((sum, v) => sum + v.comision_monto, 0);
            const comisionesPendientes = ventas
                .filter(v => v.comision_estado === 'pendiente')
                .reduce((sum, v) => sum + v.comision_monto, 0);

            res.json({
                cantidad_ventas: ventas.length,
                total_ventas: totalVentas,
                total_comisiones: totalComisiones,
                comisiones_pendientes: comisionesPendientes,
                comisiones_pagadas: totalComisiones - comisionesPendientes
            });
        } else {
            // Stats globales para admin
            const { data: ventas, error } = await supabase
                .from('ventas')
                .select('precio_total, comision_monto, comision_estado');

            if (error) throw error;

            const { count: cantidadVendedores } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('rol', 'vendedor')
                .eq('activo', true);

            const totalVentas = ventas.reduce((sum, v) => sum + v.precio_total, 0);
            const totalComisiones = ventas.reduce((sum, v) => sum + v.comision_monto, 0);
            const comisionesPendientes = ventas
                .filter(v => v.comision_estado === 'pendiente')
                .reduce((sum, v) => sum + v.comision_monto, 0);

            res.json({
                cantidad_ventas: ventas.length,
                cantidad_vendedores: cantidadVendedores || 0,
                total_ventas: totalVentas,
                total_comisiones: totalComisiones,
                comisiones_pendientes: comisionesPendientes,
                comisiones_pagadas: totalComisiones - comisionesPendientes
            });
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
