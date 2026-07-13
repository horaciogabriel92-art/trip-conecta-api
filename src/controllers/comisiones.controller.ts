import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';
import { checkFeatureEnabled } from '../utils/features';

const COMISIONES_FEATURE = 'comisiones';

export const getComisionesPendientes = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;

    try {
        const { enabled } = await checkFeatureEnabled(req, COMISIONES_FEATURE);
        if (!enabled) {
            return res.status(403).json({ error: 'Módulo de comisiones no habilitado' });
        }

        let query = supabase
            .from('ventas')
            .select(`
                *,
                vendedor:vendedor_id (id, nombre, apellido, email)
            `)
            .eq('tenant_id', tenantId)
            .eq('comision_estado', 'pendiente')
            .neq('estado', 'cancelada');
        
        // Si es vendedor, solo sus comisiones
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: comisiones, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;

        // Agrupar por vendedor (solo para admin)
        if (user.role === 'admin') {
            const agrupadas = comisiones?.reduce((acc: any, venta: any) => {
                const vendedorId = venta.vendedor_id;
                if (!acc[vendedorId]) {
                    acc[vendedorId] = {
                        vendedor: venta.vendedor,
                        ventas: [],
                        total_comision: 0
                    };
                }
                acc[vendedorId].ventas.push(venta);
                acc[vendedorId].total_comision += venta.comision_monto;
                return acc;
            }, {});

            res.json({
                ventas: comisiones,
                agrupadas_por_vendedor: agrupadas
            });
        } else {
            res.json(comisiones);
        }
    } catch (error) {
        console.error('Error fetching pending commissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getComisionesPagadas = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;

    try {
        const { enabled } = await checkFeatureEnabled(req, COMISIONES_FEATURE);
        if (!enabled) {
            return res.status(403).json({ error: 'Módulo de comisiones no habilitado' });
        }

        let query = supabase
            .from('pagos_comisiones')
            .select(`
                *,
                vendedor:vendedor_id (nombre, apellido, email),
                pagado_por:pagado_por (nombre, apellido)
            `)
            .eq('tenant_id', tenantId)
            .order('fecha_pago', { ascending: false });
        
        // Si es vendedor, solo sus pagos
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: pagos, error } = await query;

        if (error) throw error;
        res.json(pagos);
    } catch (error) {
        console.error('Error fetching paid commissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const registrarPagoComision = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { vendedor_id, ventas_ids, metodo_pago, referencia_pago, notas } = req.body;
    const admin_id = (req as any).user.userId;

    try {
        // Verificar que sea admin
        if ((req as any).user.role !== 'admin') {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const { enabled } = await checkFeatureEnabled(req, COMISIONES_FEATURE);
        if (!enabled) {
            return res.status(403).json({ error: 'Módulo de comisiones no habilitado' });
        }

        // Validación de inputs
        if (!vendedor_id) {
            return res.status(400).json({ error: 'vendedor_id es requerido' });
        }
        if (!Array.isArray(ventas_ids) || ventas_ids.length === 0) {
            return res.status(400).json({ error: 'ventas_ids debe ser un array no vacío' });
        }

        // Calcular monto total
        const { data: ventas, error: ventasError } = await supabase
            .from('ventas')
            .select('id, comision_monto')
            .eq('tenant_id', tenantId)
            .in('id', ventas_ids)
            .eq('comision_estado', 'pendiente');

        if (ventasError) {
            console.error('[registrarPagoComision] Error consultando ventas:', ventasError);
            return res.status(500).json({ error: 'Error consultando ventas', details: ventasError.message });
        }

        if (!ventas || ventas.length === 0) {
            return res.status(400).json({ error: 'No se encontraron ventas pendientes con los IDs proporcionados' });
        }

        const monto_total = ventas.reduce((sum, v) => sum + Number(v.comision_monto || 0), 0);

        // Crear registros de pago para cada venta
        const pagosInsert = ventas_ids.map((venta_id: string) => {
            const venta = ventas.find((v: any) => v.id === venta_id);
            return {
                vendedor_id,
                venta_id,
                monto: Number(venta?.comision_monto || 0),
                metodo_pago: metodo_pago || null,
                referencia_pago: referencia_pago || null,
                pagado_por: admin_id,
                notas: notas || null,
                tenant_id: tenantId
            };
        });

        const { error: pagoError } = await supabase
            .from('pagos_comisiones')
            .insert(pagosInsert);

        if (pagoError) {
            console.error('[registrarPagoComision] Error insertando pagos_comisiones:', pagoError);
            return res.status(500).json({ error: 'Error registrando el pago', details: pagoError.message });
        }

        // Actualizar estado de ventas
        const { error: updateError } = await supabase
            .from('ventas')
            .update({ 
                comision_estado: 'pagada',
                fecha_pago_comision: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .in('id', ventas_ids);

        if (updateError) {
            console.error('[registrarPagoComision] Error actualizando ventas:', updateError);
            return res.status(500).json({ error: 'Pago registrado pero error al actualizar ventas', details: updateError.message });
        }

        res.status(201).json({ 
            message: 'Pago registrado correctamente',
            cantidad_ventas: ventas_ids.length,
            monto_total
        });
    } catch (error: any) {
        console.error('[registrarPagoComision] Error inesperado:', error);
        res.status(500).json({ error: 'Internal server error', details: error?.message || String(error) });
    }
};

export const getResumenComisiones = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;

    try {
        const { enabled } = await checkFeatureEnabled(req, COMISIONES_FEATURE);
        if (!enabled) {
            return res.status(403).json({ error: 'Módulo de comisiones no habilitado' });
        }

        // Obtener todas las ventas del vendedor
        const { data: ventas, error } = await supabase
            .from('ventas')
            .select('comision_monto, comision_estado')
            .eq('tenant_id', tenantId)
            .eq('vendedor_id', user.userId)
            .neq('estado', 'cancelada');

        if (error) throw error;

        const totalGenerado = ventas?.reduce((sum, v) => sum + v.comision_monto, 0) || 0;
        const pagado = ventas
            ?.filter(v => v.comision_estado === 'pagada')
            .reduce((sum, v) => sum + v.comision_monto, 0) || 0;
        const pendiente = ventas
            ?.filter(v => v.comision_estado === 'pendiente')
            .reduce((sum, v) => sum + v.comision_monto, 0) || 0;

        res.json({
            total_generado: totalGenerado,
            total_pagado: pagado,
            total_pendiente: pendiente,
            cantidad_ventas: ventas?.length || 0
        });
    } catch (error) {
        console.error('Error fetching commission summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
