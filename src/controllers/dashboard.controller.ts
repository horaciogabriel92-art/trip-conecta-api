import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';

// ============================================
// DASHBOARD CONTROLLER
// ============================================

export const getDashboardSummary = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    const isAdmin = user.role === 'admin';

    try {
        const ahora = new Date();
        const en48h = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);
        const finDeHoy = new Date(ahora);
        finDeHoy.setHours(23, 59, 59, 999);
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const inicioMesSiguiente = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

        // Scope: admin ve todo el tenant, vendedor solo lo suyo
        const scopeCotizaciones = (query: any) =>
            isAdmin ? query : query.eq('vendedor_id', user.userId);
        const scopeVentas = (query: any) =>
            isAdmin ? query : query.eq('vendedor_id', user.userId);

        const baseCot = (select: string, options?: any): any =>
            supabase.from('cotizaciones').select(select, options).eq('tenant_id', tenantId);
        const baseVentas = (select: string, options?: any): any =>
            supabase.from('ventas').select(select, options).eq('tenant_id', tenantId);

        const [
            activasRes,
            ventasMesRes,
            porCobrarRes,
            totalCotRes,
            vendidasRes,
            vendedoresActivosRes,
            pendientesAprobRes,
            comisionRes,
            porVencerRes,
            recordatoriosRes,
            pagosPendRes,
            funnelNuevaRes,
            funnelEnviadaRes,
            funnelAprobadaRes,
            funnelVendidaRes,
            funnelPerdidaRes,
            ventasRecientesRes
        ] = await Promise.all([
            // KPI: cotizaciones activas (nueva o enviada)
            scopeCotizaciones(
                baseCot('id', { count: 'exact', head: true })
                    .in('estado', ['nueva', 'enviada'])
            ),
            // KPI: ventas del mes calendario actual
            scopeVentas(
                baseVentas('precio_total')
                    .gte('fecha_creacion', inicioMes.toISOString())
                    .lt('fecha_creacion', inicioMesSiguiente.toISOString())
            ),
            // KPI: por cobrar (vendidas con saldo pendiente)
            scopeCotizaciones(
                baseCot('monto_restante')
                    .eq('estado', 'vendida')
                    .gt('monto_restante', 0)
            ),
            // Conversión: total de cotizaciones del scope
            scopeCotizaciones(
                baseCot('id', { count: 'exact', head: true })
            ),
            // Conversión: vendidas del scope
            scopeCotizaciones(
                baseCot('id', { count: 'exact', head: true })
                    .eq('estado', 'vendida')
            ),
            // Solo admin: vendedores activos del tenant
            isAdmin
                ? supabase.from('users')
                    .select('id', { count: 'exact', head: true })
                    .eq('tenant_id', tenantId)
                    .eq('rol', 'vendedor')
                    .eq('activo', true)
                : Promise.resolve({ count: null, error: null } as any),
            // Solo admin: cotizaciones pendientes de aprobación (estado nueva)
            isAdmin
                ? baseCot('id', { count: 'exact', head: true })
                    .eq('estado', 'nueva')
                : Promise.resolve({ count: null, error: null } as any),
            // Solo vendedor: comisión acumulada de sus ventas
            !isAdmin
                ? baseVentas('comision_monto')
                    .eq('vendedor_id', user.userId)
                : Promise.resolve({ data: null, error: null } as any),
            // Atención: cotizaciones por vencer (próximas 48h o ya vencidas)
            scopeCotizaciones(
                baseCot('id, codigo, nombre_cotizacion, fecha_expiracion')
                    .in('estado', ['nueva', 'enviada'])
                    .lte('fecha_expiracion', en48h.toISOString())
                    .order('fecha_expiracion', { ascending: true })
                    .limit(5)
            ),
            // Atención: recordatorios pendientes hasta fin de hoy
            (() => {
                let q = supabase
                    .from('recordatorios')
                    .select('id, titulo, fecha_recordatorio, cliente_id')
                    .eq('tenant_id', tenantId)
                    .eq('estado', 'pendiente')
                    .lte('fecha_recordatorio', finDeHoy.toISOString());
                if (!isAdmin) {
                    q = q.or(`vendedor_id.eq.${user.userId},asignado_a.eq.${user.userId}`);
                }
                return q.order('fecha_recordatorio', { ascending: true }).limit(5);
            })(),
            // Atención: pagos pendientes (vendidas con saldo)
            scopeCotizaciones(
                baseCot('id, codigo, monto_restante, fecha_pago_resto')
                    .eq('estado', 'vendida')
                    .gt('monto_restante', 0)
                    .order('fecha_pago_resto', { ascending: true, nullsFirst: false })
                    .limit(5)
            ),
            // Funnel por estado
            scopeCotizaciones(baseCot('id', { count: 'exact', head: true }).eq('estado', 'nueva')),
            scopeCotizaciones(baseCot('id', { count: 'exact', head: true }).eq('estado', 'enviada')),
            scopeCotizaciones(baseCot('id', { count: 'exact', head: true }).eq('estado', 'aprobada')),
            scopeCotizaciones(baseCot('id', { count: 'exact', head: true }).eq('estado', 'vendida')),
            scopeCotizaciones(baseCot('id', { count: 'exact', head: true }).eq('estado', 'perdida')),
            // Ventas recientes del scope
            scopeVentas(
                baseVentas('id, codigo, cliente_nombre, precio_total, fecha_creacion')
                    .order('fecha_creacion', { ascending: false })
                    .limit(5)
            )
        ]);

        // Verificar errores en las queries
        const errores = [
            activasRes, ventasMesRes, porCobrarRes, totalCotRes, vendidasRes,
            vendedoresActivosRes, pendientesAprobRes, comisionRes,
            porVencerRes, recordatoriosRes, pagosPendRes,
            funnelNuevaRes, funnelEnviadaRes, funnelAprobadaRes, funnelVendidaRes, funnelPerdidaRes,
            ventasRecientesRes
        ].filter(r => r?.error);
        if (errores.length > 0) {
            console.error('Error en dashboard summary:', errores.map(e => e.error));
            return res.status(500).json({ error: 'Error al obtener resumen del dashboard' });
        }

        const ventasMes = ventasMesRes.data || [];
        const porCobrarData = porCobrarRes.data || [];
        const comisionData = comisionRes?.data || [];
        const totalCot = totalCotRes.count || 0;
        const vendidas = vendidasRes.count || 0;

        const recordatorios = (recordatoriosRes.data || []).map((r: any) => ({
            id: r.id,
            titulo: r.titulo,
            fecha_recordatorio: r.fecha_recordatorio,
            cliente_id: r.cliente_id,
            vencido: new Date(r.fecha_recordatorio) < ahora
        }));

        res.json({
            rol: user.role,
            kpis: {
                cotizaciones_activas: activasRes.count || 0,
                ventas_mes_count: ventasMes.length,
                ventas_mes_monto: ventasMes.reduce((sum: number, v: any) => sum + Number(v.precio_total || 0), 0),
                por_cobrar: porCobrarData.reduce((sum: number, c: any) => sum + Number(c.monto_restante || 0), 0),
                conversion_pct: totalCot > 0 ? Math.round((vendidas / totalCot) * 100) : 0,
                vendedores_activos: isAdmin ? (vendedoresActivosRes.count || 0) : null,
                pendientes_aprobacion: isAdmin ? (pendientesAprobRes.count || 0) : null,
                comision_acumulada: !isAdmin
                    ? comisionData.reduce((sum: number, v: any) => sum + Number(v.comision_monto || 0), 0)
                    : null
            },
            atencion: {
                por_vencer: porVencerRes.data || [],
                recordatorios,
                pagos_pendientes: pagosPendRes.data || []
            },
            funnel: {
                nueva: funnelNuevaRes.count || 0,
                enviada: funnelEnviadaRes.count || 0,
                aprobada: funnelAprobadaRes.count || 0,
                vendida: funnelVendidaRes.count || 0,
                perdida: funnelPerdidaRes.count || 0
            },
            ventas_recientes: ventasRecientesRes.data || []
        });
    } catch (error: any) {
        console.error('Error in getDashboardSummary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
