import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { findComprobanteFile } from '../utils/fileSearch';

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
    
    console.log('getVentaById - ID:', id, 'User:', user?.userId, 'Role:', user?.role);
    
    try {
        // Paso 1: Obtener venta básica
        let query = supabase
            .from('ventas')
            .select('*')
            .eq('id', id);
        
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: venta, error } = await query.single();

        if (error) {
            console.error('Error fetching venta:', error);
            return res.status(404).json({ error: 'Venta no encontrada', details: error.message });
        }
        
        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        console.log('Venta encontrada:', { id: venta.id, cotizacion_id: venta.cotizacion_id });

        // Paso 2: Obtener comprobantes de pago si hay cotizacion_id
        let comprobantesConUrl: any[] = [];
        let pagos: any[] = [];
        if (venta.cotizacion_id) {
            const [{ data: comprobantes, error: compError }, { data: pagosData, error: pagosError }] = await Promise.all([
                supabase.from('comprobantes_pago').select('*').eq('cotizacion_id', venta.cotizacion_id),
                supabase.from('pagos_venta').select('*').eq('cotizacion_id', venta.cotizacion_id).order('fecha_pago', { ascending: false })
            ]);
            
            if (compError) {
                console.error('Error fetching comprobantes:', compError);
            } else {
                comprobantesConUrl = (comprobantes || [])
                    .filter((c: any) => !!findComprobanteFile(c.ruta_archivo))
                    .map((c: any) => ({
                        ...c,
                        url: `/uploads/comprobantes/${c.ruta_archivo}`,
                        es_descargable: true
                    }));
                console.log('Comprobantes encontrados:', comprobantes?.length, 'Con archivo físico:', comprobantesConUrl.length);
            }

            if (pagosError) {
                console.error('Error fetching pagos:', pagosError);
            } else {
                pagos = pagosData || [];
            }
        }
        
        const ventaFormateada = {
            ...venta,
            comprobantes_pago: comprobantesConUrl,
            pagos
        };

        res.json(ventaFormateada);
    } catch (error: any) {
        console.error('Error fetching sale:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const registrarPago = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { monto, medio_pago, fecha_pago, observaciones, comprobante_url } = req.body;
    const user = (req as any).user;

    try {
        // 1. Obtener venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('id, cotizacion_id, vendedor_id, precio_total')
            .eq('id', id)
            .single();

        if (ventaError || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        // 2. Validar permisos
        if (user.role !== 'admin' && venta.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const montoNum = Number(monto);
        if (!montoNum || montoNum <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }

        // 3. Obtener cotización para verificar restante
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select('id, precio_total, monto_pagado, monto_restante')
            .eq('id', venta.cotizacion_id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización asociada no encontrada' });
        }

        const restanteActual = Math.max(0, cotizacion.precio_total - (cotizacion.monto_pagado || 0));
        if (montoNum > restanteActual) {
            return res.status(400).json({ 
                error: `El monto no puede superar el restante ($${restanteActual})` 
            });
        }

        if (restanteActual <= 0) {
            return res.status(400).json({ error: 'Esta venta ya está totalmente pagada' });
        }

        // 4. Insertar pago
        const { data: pago, error: pagoError } = await supabase
            .from('pagos_venta')
            .insert({
                venta_id: venta.id,
                cotizacion_id: venta.cotizacion_id,
                monto: montoNum,
                medio_pago: medio_pago || null,
                fecha_pago: fecha_pago || new Date().toISOString().split('T')[0],
                observaciones: observaciones || null,
                tipo: 'adicional',
                comprobante_url: comprobante_url || null,
                registrado_por: user.userId
            })
            .select()
            .single();

        if (pagoError) {
            console.error('Error insertando pago:', pagoError);
            return res.status(500).json({ error: 'Error al registrar el pago' });
        }

        // 5. Recalcular totales
        const { data: pagosSum } = await supabase
            .from('pagos_venta')
            .select('monto')
            .eq('cotizacion_id', venta.cotizacion_id);

        const nuevoMontoPagado = (pagosSum || []).reduce((sum: number, p: any) => sum + Number(p.monto), 0);
        const nuevoMontoRestante = Math.max(0, cotizacion.precio_total - nuevoMontoPagado);
        const nuevoTipoPago = nuevoMontoRestante <= 0 ? 'total' : 'parcial';

        // 6. Actualizar cotización
        const { error: updateError } = await supabase
            .from('cotizaciones')
            .update({
                monto_pagado: nuevoMontoPagado,
                monto_restante: nuevoMontoRestante,
                tipo_pago: nuevoTipoPago
            })
            .eq('id', venta.cotizacion_id);

        if (updateError) {
            console.error('Error actualizando cotización:', updateError);
            return res.status(500).json({ error: 'Pago registrado pero error al actualizar totales' });
        }

        res.json({
            message: 'Pago registrado exitosamente',
            pago,
            pago_info: {
                monto_pagado: nuevoMontoPagado,
                monto_restante: nuevoMontoRestante,
                tipo_pago: nuevoTipoPago,
                es_pago_total: nuevoMontoRestante <= 0
            }
        });
    } catch (error: any) {
        console.error('Error registrarPago:', error);
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
    const { metodo_pago, referencia_pago, notas } = req.body || {};
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
                metodo_pago: metodo_pago || null
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
                metodo_pago: metodo_pago || null,
                referencia_pago: referencia_pago || null,
                pagado_por: user.userId,
                notas: notas || null
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
