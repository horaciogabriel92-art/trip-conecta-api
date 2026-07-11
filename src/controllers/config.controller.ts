import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

const TRIP_CONECTA_TENANT_ID = '11111111-1111-1111-1111-111111111111';

interface PlanConfig {
  slug: string;
  nombre: string;
  max_users: number | null;
  max_cotizaciones_por_mes: number | null;
  max_paquetes: number | null;
  permite_dominio_propio: boolean;
  precio_mensual_usd: number;
  precio_usuario_extra_usd: number;
}

interface TenantConfig {
  id: string | null;
  nombre: string;
  slug: string;
  logo_url: string;
  color_primario: string;
  color_secundario: string;
  dominio: string;
  trial_ends_at: string | null;
  estado_suscripcion: string | null;
  plan_started_at: string | null;
  plan: PlanConfig | null;
}

const DEFAULT_PLAN: PlanConfig = {
  slug: 'free',
  nombre: 'Free',
  max_users: 1,
  max_cotizaciones_por_mes: 10,
  max_paquetes: 1,
  permite_dominio_propio: false,
  precio_mensual_usd: 0,
  precio_usuario_extra_usd: 0
};

const QUOTIX_TRAVEL_CONFIG: TenantConfig = {
  id: null,
  nombre: 'Quotix Travel',
  slug: 'quotix-travel',
  logo_url: '/logo-quotix-travel.png',
  color_primario: '#0ea5e9',
  color_secundario: '#6366f1',
  dominio: 'travel.quotixos.com',
  trial_ends_at: null,
  estado_suscripcion: null,
  plan_started_at: null,
  plan: DEFAULT_PLAN
};

const TENANT_SELECT = `
  id, nombre, slug, logo_url, color_primario, color_secundario, dominio,
  trial_ends_at, estado_suscripcion, plan_started_at,
  plans:plan_id (slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd)
`;

function normalizePlan(plan: any): PlanConfig | null {
  if (!plan) return null;
  return {
    slug: plan.slug || 'free',
    nombre: plan.nombre || 'Free',
    max_users: plan.max_users ?? null,
    max_cotizaciones_por_mes: plan.max_cotizaciones_por_mes ?? null,
    max_paquetes: plan.max_paquetes ?? null,
    permite_dominio_propio: plan.permite_dominio_propio ?? false,
    precio_mensual_usd: Number(plan.precio_mensual_usd) || 0,
    precio_usuario_extra_usd: Number(plan.precio_usuario_extra_usd) || 0
  };
}

function formatTenantResponse(tenant: any): TenantConfig {
  return {
    id: tenant.id || null,
    nombre: tenant.nombre,
    slug: tenant.slug,
    logo_url: tenant.logo_url,
    color_primario: tenant.color_primario,
    color_secundario: tenant.color_secundario,
    dominio: tenant.dominio,
    trial_ends_at: tenant.trial_ends_at || null,
    estado_suscripcion: tenant.estado_suscripcion || null,
    plan_started_at: tenant.plan_started_at || null,
    plan: normalizePlan(tenant.plans)
  };
}

export const getTenantConfig = async (req: Request, res: Response) => {
  try {
    const domain = (req.query.domain as string) || req.headers.host || '';
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();

    // Dominios que siempre resuelven a Trip Conecta
    const tripConectaDomains = ['panel.tripconecta.com', 'tripconecta.com', 'localhost'];
    if (tripConectaDomains.includes(normalizedDomain) || normalizedDomain.startsWith('localhost')) {
      const { data: tenant, error } = await supabase
        .from('tenants')
        .select(TENANT_SELECT)
        .eq('id', TRIP_CONECTA_TENANT_ID)
        .single();

      if (error || !tenant) {
        console.error('[config] Error fetching Trip Conecta tenant:', error);
        return res.json(QUOTIX_TRAVEL_CONFIG);
      }

      return res.json(formatTenantResponse(tenant));
    }

    // Portal genérico de Quotix Travel
    if (normalizedDomain === 'travel.quotixos.com' || normalizedDomain === 'quotixos.com') {
      return res.json(QUOTIX_TRAVEL_CONFIG);
    }

    // Buscar por dominio personalizado
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select(TENANT_SELECT)
      .eq('dominio', normalizedDomain)
      .eq('activo', true)
      .single();

    if (error || !tenant) {
      console.log(`[config] No tenant found for domain: ${normalizedDomain}, returning generic`);
      return res.json(QUOTIX_TRAVEL_CONFIG);
    }

    return res.json(formatTenantResponse(tenant));
  } catch (err) {
    console.error('[config] Unexpected error:', err);
    return res.json(QUOTIX_TRAVEL_CONFIG);
  }
};

export const getPublicPlans = async (req: Request, res: Response) => {
  try {
    const { data: plans, error } = await supabase
      .from('plans')
      .select('slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd')
      .eq('activo', true)
      .order('precio_mensual_usd', { ascending: true });

    if (error) {
      console.error('[config] Error fetching plans:', error);
      return res.status(500).json({ error: 'Error al obtener los planes' });
    }

    return res.json(plans || []);
  } catch (err) {
    console.error('[config] Unexpected error fetching plans:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
