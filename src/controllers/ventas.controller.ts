import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { findComprobanteFile } from '../utils/fileSearch';
import { getTenantId } from '../utils/tenant';

export const getVentas = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    try {
        let query = supabase.from('ventas').select('*').eq('tenant_id', tenantId);
        
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
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;
    
    console.log('getVentaById - ID:', id, 'User:', user?.userId, 'Role:', user?.role);
    
    try {
        // Paso 1: Obtener venta básica
        let query = supabase
            .from('ventas')
            .select('*')
            .eq('tenant_id', tenantId)
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
                supabase.from('comprobantes_pago').select('*').eq('tenant_id', tenantId).eq('cotizacion_id', venta.cotizacion_id),
                supabase.from('pagos_venta').select('*').eq('tenant_id', tenantId).eq('cotizacion_id', venta.cotizacion_id).order('fecha_pago', { ascending: false })
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
        
        let montoPagado = (pagos || []).reduce((sum: number, p: any) => sum + Number(p.monto), 0);
        // Preservar pagos heredados que no están en pagos_venta
        montoPagado = Math.max(montoPagado, venta.monto_pagado_heredado || 0);
        const montoRestante = Math.max(0, venta.precio_total - montoPagado);
        const tipoPago = montoRestante <= 0 ? 'total' : (montoPagado > 0 ? 'parcial' : 'pendiente');

        const ventaFormateada = {
            ...venta,
            monto_pagado: montoPagado,
            monto_restante: montoRestante,
            tipo_pago: tipoPago,
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
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { monto, medio_pago, fecha_pago, observaciones, comprobante_url } = req.body;
    const user = (req as any).user;

    try {
        // 1. Obtener venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('id, cotizacion_id, vendedor_id, precio_total')
            .eq('tenant_id', tenantId)
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
            .select('id, cliente_id, precio_total, monto_pagado, monto_restante')
            .eq('tenant_id', tenantId)
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
                registrado_por: user.userId,
                tenant_id: tenantId
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
            .eq('tenant_id', tenantId)
            .eq('cotizacion_id', venta.cotizacion_id);

        let nuevoMontoPagado = (pagosSum || []).reduce((sum: number, p: any) => sum + Number(p.monto), 0);
        // Preservar pagos heredados que no están en pagos_venta
        nuevoMontoPagado = Math.max(nuevoMontoPagado, cotizacion.monto_pagado || 0);
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
            .eq('tenant_id', tenantId)
            .eq('id', venta.cotizacion_id);

        if (updateError) {
            console.error('Error actualizando cotización:', updateError);
            return res.status(500).json({ error: 'Pago registrado pero error al actualizar totales' });
        }

        // 7. Registrar en historial_cliente
        if (cotizacion?.cliente_id) {
            try {
                await supabase.from('historial_cliente').insert({
                    cliente_id: cotizacion.cliente_id,
                    tipo: 'venta_confirmada',
                    venta_id: venta.id,
                    descripcion: `Pago de $${montoNum} registrado. Restante: $${nuevoMontoRestante}`,
                    realizado_por: user.userId,
                    realizado_por_nombre: user.nombre || user.email || 'Usuario',
                    tenant_id: tenantId
                });
            } catch (e) {
                console.log('Error registrando historial_cliente:', e);
            }
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
    const tenantId = getTenantId(req);
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
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (error || !venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        // Registrar en historial_cliente
        try {
            const { data: cot } = await supabase
                .from('cotizaciones')
                .select('cliente_id')
                .eq('tenant_id', tenantId)
                .eq('id', venta.cotizacion_id)
                .single();
            if (cot?.cliente_id) {
                await supabase.from('historial_cliente').insert({
                    cliente_id: cot.cliente_id,
                    tipo: 'estado_cambiado',
                    venta_id: venta.id,
                    descripcion: `Estado de venta cambiado a ${estado}`,
                    realizado_por: user.userId,
                    realizado_por_nombre: user.nombre || user.email || 'Usuario',
                    tenant_id: tenantId
                });
            }
        } catch (e) {
            console.log('Error registrando historial_cliente:', e);
        }

        res.json({ message: 'Estado actualizado', venta });
    } catch (error) {
        console.error('Error updating sale status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const pagarComision = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
            .eq('tenant_id', tenantId)
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
            .eq('tenant_id', tenantId)
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
                notas: notas || null,
                tenant_id: tenantId
            });

        if (pagoError) throw pagoError;

        res.json({ message: 'Comisión pagada exitosamente' });
    } catch (error) {
        console.error('Error paying commission:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getEstadisticas = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    
    try {
        // Calcular rango del mes actual
        const ahora = new Date();
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
        const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

        // Si es vendedor, solo sus stats
        if (user.role !== 'admin') {
            const [
                { data: ventas, error: ventasError },
                { data: cotizaciones, error: cotError },
                { data: cotizacionesMes, error: cotMesError },
                { data: cotizacionesEnviadas, error: cotEnvError }
            ] = await Promise.all([
                supabase
                    .from('ventas')
                    .select('precio_total, comision_monto, comision_estado')
                    .eq('tenant_id', tenantId)
                    .eq('vendedor_id', user.userId),
                supabase
                    .from('cotizaciones')
                    .select('estado')
                    .eq('tenant_id', tenantId)
                    .eq('vendedor_id', user.userId),
                supabase
                    .from('cotizaciones')
                    .select('estado')
                    .eq('tenant_id', tenantId)
                    .eq('vendedor_id', user.userId)
                    .gte('fecha_creacion', inicioMes)
                    .lte('fecha_creacion', finMes),
                supabase
                    .from('cotizaciones')
                    .select('id')
                    .eq('tenant_id', tenantId)
                    .eq('vendedor_id', user.userId)
                    .eq('estado', 'enviada')
            ]);

            if (ventasError) throw ventasError;
            if (cotError) throw cotError;

            const totalVentas = ventas.reduce((sum, v) => sum + v.precio_total, 0);
            const totalComisiones = ventas.reduce((sum, v) => sum + v.comision_monto, 0);
            const comisionesPendientes = ventas
                .filter(v => v.comision_estado === 'pendiente')
                .reduce((sum, v) => sum + v.comision_monto, 0);

            const cantidadVentas = ventas.length;
            const ticketPromedio = cantidadVentas > 0 ? totalVentas / cantidadVentas : 0;

            const totalCotizaciones = cotizaciones?.length || 0;
            const cotizacionesVendidas = cotizaciones?.filter((c: any) => c.estado === 'vendida').length || 0;
            const tasaConversion = totalCotizaciones > 0 ? (cotizacionesVendidas / totalCotizaciones) * 100 : 0;

            res.json({
                cantidad_ventas: cantidadVentas,
                total_ventas: totalVentas,
                total_comisiones: totalComisiones,
                comisiones_pendientes: comisionesPendientes,
                comisiones_pagadas: totalComisiones - comisionesPendientes,
                ticket_promedio: ticketPromedio,
                cotizaciones_mes: cotizacionesMes?.length || 0,
                cotizaciones_enviadas: cotizacionesEnviadas?.length || 0,
                tasa_conversion: Math.round(tasaConversion * 10) / 10
            });
        } else {
            // Stats globales para admin
            const [
                { data: ventas, error: ventasError },
                { data: cotizaciones, error: cotError },
                { data: cotizacionesMes, error: cotMesError },
                { data: cotizacionesEnviadas, error: cotEnvError }
            ] = await Promise.all([
                supabase
                    .from('ventas')
                    .select('precio_total, comision_monto, comision_estado')
                    .eq('tenant_id', tenantId),
                supabase
                    .from('cotizaciones')
                    .select('estado')
                    .eq('tenant_id', tenantId),
                supabase
                    .from('cotizaciones')
                    .select('estado')
                    .eq('tenant_id', tenantId)
                    .gte('fecha_creacion', inicioMes)
                    .lte('fecha_creacion', finMes),
                supabase
                    .from('cotizaciones')
                    .select('id')
                    .eq('tenant_id', tenantId)
                    .eq('estado', 'enviada')
            ]);

            if (ventasError) throw ventasError;
            if (cotError) throw cotError;

            const { count: cantidadVendedores } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('tenant_id', tenantId)
                .eq('rol', 'vendedor')
                .eq('activo', true);

            const totalVentas = ventas.reduce((sum, v) => sum + v.precio_total, 0);
            const totalComisiones = ventas.reduce((sum, v) => sum + v.comision_monto, 0);
            const comisionesPendientes = ventas
                .filter(v => v.comision_estado === 'pendiente')
                .reduce((sum, v) => sum + v.comision_monto, 0);

            const cantidadVentas = ventas.length;
            const ticketPromedio = cantidadVentas > 0 ? totalVentas / cantidadVentas : 0;

            const totalCotizaciones = cotizaciones?.length || 0;
            const cotizacionesVendidas = cotizaciones?.filter((c: any) => c.estado === 'vendida').length || 0;
            const tasaConversion = totalCotizaciones > 0 ? (cotizacionesVendidas / totalCotizaciones) * 100 : 0;

            res.json({
                cantidad_ventas: cantidadVentas,
                cantidad_vendedores: cantidadVendedores || 0,
                total_ventas: totalVentas,
                total_comisiones: totalComisiones,
                comisiones_pendientes: comisionesPendientes,
                comisiones_pagadas: totalComisiones - comisionesPendientes,
                ticket_promedio: ticketPromedio,
                cotizaciones_mes: cotizacionesMes?.length || 0,
                cotizaciones_enviadas: cotizacionesEnviadas?.length || 0,
                tasa_conversion: Math.round(tasaConversion * 10) / 10
            });
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
