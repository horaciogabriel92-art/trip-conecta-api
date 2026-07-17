import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { findComprobanteFile } from '../utils/fileSearch';
import { getComprobantePublicUrl } from '../utils/fileUrl';
import { getTenantId } from '../utils/tenant';
import { checkFeatureEnabled, checkWorkflowMode } from '../utils/features';
import { sendEmail } from '../services/email.service';
import fs from 'fs/promises';
import path from 'path';

export const getVentas = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    try {
        let query = supabase
            .from('ventas')
            .select('*')
            .eq('tenant_id', tenantId);

        // Filter by seller unless admin or has permission to see all sales
        if (user.role !== 'admin' && user.permisos?.ver_todas_ventas !== true) {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: ventas, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;

        // Cargar cotizaciones asociadas en query separada para evitar problemas
        // con relaciones embedded en Supabase según la configuración de FK/RLS.
        let cotizacionesMap: Record<string, any> = {};
        const cotizacionIds = (ventas || [])
            .map((v: any) => v.cotizacion_id)
            .filter(Boolean);

        if (cotizacionIds.length > 0) {
            const { data: cotizaciones, error: cotError } = await supabase
                .from('cotizaciones')
                .select('id, codigo, estado')
                .eq('tenant_id', tenantId)
                .in('id', cotizacionIds);

            if (cotError) {
                console.error('Error fetching cotizaciones for ventas:', cotError);
            } else {
                cotizacionesMap = (cotizaciones || []).reduce((acc: Record<string, any>, c: any) => {
                    acc[c.id] = c;
                    return acc;
                }, {});
            }
        }

        const ventasFormateadas = (ventas || []).map((venta: any) => {
            const cotizacion = venta.cotizacion_id ? cotizacionesMap[venta.cotizacion_id] : null;
            return {
                ...venta,
                cotizacion_id: cotizacion?.id || venta.cotizacion_id,
                cotizacion_codigo: cotizacion?.codigo || null,
                cotizacion_estado: cotizacion?.estado || null,
                cliente_nombre: venta.cliente_nombre || null,
                cliente_email: venta.cliente_email || null,
                paquete_nombre: venta.paquete_nombre || null,
            };
        });

        res.json(ventasFormateadas);
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getVentaById = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;

    try {
        // Paso 1: Obtener venta básica
        let query = supabase
            .from('ventas')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', id);
        
        if (user.role !== 'admin' && user.permisos?.ver_todas_ventas !== true) {
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
                        url: getComprobantePublicUrl(c.ruta_archivo),
                        es_descargable: true
                    }));
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
                console.warn('Error registrando historial_cliente:', e);
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
        // Obtener venta para validar permisos
        const { data: ventaActual, error: findError } = await supabase
            .from('ventas')
            .select('id, vendedor_id, cotizacion_id')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (findError || !ventaActual) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const { mode: workflowMode } = await checkWorkflowMode(req);
        const esAdmin = user.role === 'admin';
        const esVendedorDueño = ventaActual.vendedor_id === user.userId;
        const puedeCambiarEstado = esAdmin || (workflowMode === 'vendedor_autoconfirma' && esVendedorDueño);

        if (!puedeCambiarEstado) {
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
            console.warn('Error registrando historial_cliente:', e);
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

        const { enabled } = await checkFeatureEnabled(req, 'comisiones');
        if (!enabled) {
            return res.status(403).json({ error: 'Módulo de comisiones no habilitado' });
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


export const enviarConfirmacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { voucherIds } = req.body;
    const user = (req as any).user;

    try {
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

        // Permisos
        const { mode: workflowMode } = await checkWorkflowMode(req);
        const esAdmin = user.role === 'admin';
        const esVendedorDueño = venta.vendedor_id === user.userId;
        const puedeEnviar = esAdmin || (workflowMode === 'vendedor_autoconfirma' && esVendedorDueño);

        if (!puedeEnviar) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const clienteEmail = venta.cliente_email;
        if (!clienteEmail) {
            return res.status(400).json({ error: 'La venta no tiene email de cliente' });
        }

        // Cargar cotización asociada en query separada
        let cotizacion: any = null;
        if (venta.cotizacion_id) {
            const { data: cotData, error: cotError } = await supabase
                .from('cotizaciones')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('id', venta.cotizacion_id)
                .single();

            if (cotError) {
                console.error('Error fetching cotizacion for confirmation:', cotError);
            } else {
                cotizacion = cotData;
            }
        }

        // Vouchers a adjuntar
        let vouchersQuery = supabase
            .from('documentos_viaje')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('venta_id', id);

        if (Array.isArray(voucherIds) && voucherIds.length > 0) {
            vouchersQuery = vouchersQuery.in('id', voucherIds);
        }

        const { data: vouchers, error: vouchersError } = await vouchersQuery;

        if (vouchersError) {
            console.error('Error obteniendo vouchers:', vouchersError);
            return res.status(500).json({ error: 'Error al obtener vouchers' });
        }

        // Preparar adjuntos
        const attachments: { filename: string; content: Buffer }[] = [];
        const uploadDir = process.env.STORAGE_PATH || './storage/uploads';

        for (const v of vouchers || []) {
            const filePath = path.join(uploadDir, 'vouchers', v.ruta_archivo);
            try {
                const content = await fs.readFile(filePath);
                attachments.push({ filename: v.nombre_archivo, content });
            } catch (e) {
                console.warn(`No se pudo leer voucher ${v.id}:`, e);
            }
        }

        // Renderizar HTML de confirmación
        const htmlConfirmacion = renderConfirmacionHtml(venta, cotizacion);

        await sendEmail({
            to: clienteEmail,
            subject: `Confirmación de tu viaje - ${venta.codigo}`,
            templateName: 'confirmacion-viaje',
            variables: {
                subject: `Confirmación de tu viaje - ${venta.codigo}`,
                contenidoHtml: htmlConfirmacion,
                clienteNombre: venta.cliente_nombre || 'Cliente',
                codigoVenta: venta.codigo,
                paqueteNombre: venta.paquete_nombre || 'Viaje personalizado',
            },
            metadata: { tipo: 'confirmacion_viaje', venta_id: id, cotizacion_id: venta.cotizacion_id },
            attachments,
        });

        // Registrar en historial del cliente
        if (cotizacion?.cliente_id) {
            await supabase.from('historial_cliente').insert({
                cliente_id: cotizacion.cliente_id,
                tipo: 'confirmacion_enviada',
                venta_id: id,
                cotizacion_id: venta.cotizacion_id,
                descripcion: `Confirmación de viaje enviada por email a ${clienteEmail}`,
                realizado_por: user.userId,
                realizado_por_nombre: user.nombre || user.email || 'Usuario',
                tenant_id: tenantId,
            });
        }

        res.json({ message: 'Confirmación enviada correctamente', adjuntos: attachments.length });
    } catch (error: any) {
        console.error('Error enviando confirmación:', error);
        res.status(500).json({ error: 'Error al enviar confirmación', details: error.message });
    }
};

function renderConfirmacionHtml(venta: any, cotizacion: any): string {
    const pasajeros = cotizacion?.num_pasajeros || venta.num_pasajeros || 1;
    const fechaSalida = venta.fecha_salida
        ? new Date(venta.fecha_salida).toLocaleDateString('es-AR')
        : 'A definir';

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
            <h2 style="color: #0ea5e9;">¡Tu viaje está confirmado!</h2>
            <p>Hola ${venta.cliente_nombre || ''},</p>
            <p>Te confirmamos tu viaje con los siguientes datos:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: bold;">Código</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb;">${venta.codigo}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: bold;">Paquete</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb;">${venta.paquete_nombre || 'Viaje personalizado'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: bold;">Pasajeros</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb;">${pasajeros}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: bold;">Fecha de salida</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb;">${fechaSalida}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: bold;">Total</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb;">$${venta.precio_total}</td>
                </tr>
            </table>
            <p>Adjuntamos los vouchers/documentos correspondientes. Guardalos y presentalos en el momento del viaje.</p>
            <p style="color: #6b7280; font-size: 12px;">Este email fue generado automáticamente desde Trip Conecta.</p>
        </div>
    `;
}
