import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getGlobalStats = async (req: Request, res: Response) => {
  try {
    const [tenantsResult, usersResult, cotizacionesResult, clientesResult, paquetesResult] = await Promise.all([
      supabase.from('tenants').select('id, activo, estado_suscripcion, plan_id, extra_users_billed, plans:plan_id(precio_mensual_usd, precio_usuario_extra_usd)', { count: 'exact' }),
      supabase.from('users').select('id, activo', { count: 'exact' }),
      supabase.from('cotizaciones').select('id', { count: 'exact' }),
      supabase.from('clientes').select('id', { count: 'exact' }),
      supabase.from('paquetes').select('id', { count: 'exact' }),
    ]);

    if (tenantsResult.error) throw tenantsResult.error;
    if (usersResult.error) throw usersResult.error;
    if (cotizacionesResult.error) throw cotizacionesResult.error;
    if (clientesResult.error) throw clientesResult.error;
    if (paquetesResult.error) throw paquetesResult.error;

    const tenants = tenantsResult.data || [];
    const activeTenants = tenants.filter((t: any) => t.activo);
    const trialTenants = tenants.filter((t: any) => t.estado_suscripcion === 'trial');
    const payingTenants = activeTenants.filter((t: any) => {
      const plan = Array.isArray(t.plans) ? t.plans[0] : t.plans;
      const price = plan?.precio_mensual_usd || 0;
      return price > 0 && t.estado_suscripcion !== 'trial';
    });

    let mrr = 0;
    for (const t of payingTenants) {
      const plan = Array.isArray(t.plans) ? t.plans[0] : t.plans;
      const basePrice = Number(plan?.precio_mensual_usd || 0);
      const extraUserPrice = Number(plan?.precio_usuario_extra_usd || 0);
      const extras = Number(t.extra_users_billed || 0);
      mrr += basePrice + (extraUserPrice * extras);
    }

    res.json({
      tenants: {
        total: tenantsResult.count || 0,
        activos: activeTenants.length,
        inactivos: tenants.length - activeTenants.length,
        trial: trialTenants.length,
        pagando: payingTenants.length,
      },
      users: {
        total: usersResult.count || 0,
        activos: (usersResult.data || []).filter((u: any) => u.activo).length,
      },
      cotizaciones: cotizacionesResult.count || 0,
      clientes: clientesResult.count || 0,
      paquetes: paquetesResult.count || 0,
      finances: {
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(mrr * 12 * 100) / 100,
      },
    });
  } catch (error: any) {
    console.error('[Ernesto Stats] Error:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas', details: error.message });
  }
};
