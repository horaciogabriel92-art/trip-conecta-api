import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';
import { planAllows, getWorkflowMode } from '../utils/features';
import { deleteDemoData } from '../services/demoData.service';

const TRIP_CONECTA_TENANT_ID = '11111111-1111-1111-1111-111111111111';

interface PlanFeatures {
  comisiones?: boolean;
  vendedor_autoconfirma?: boolean;
  dominio_propio?: boolean;
  [key: string]: boolean | undefined;
}

interface PlanConfig {
  slug: string;
  nombre: string;
  max_users: number | null;
  max_cotizaciones_por_mes: number | null;
  max_paquetes: number | null;
  permite_dominio_propio: boolean;
  precio_mensual_usd: number;
  precio_usuario_extra_usd: number;
  features: PlanFeatures;
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
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  extra_users_billed?: number;
  subscription_renewal_date?: string | null;
  next_invoice_amount_usd?: number | null;
  configuracion: Record<string, any>;
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
  precio_usuario_extra_usd: 0,
  features: {
    comisiones: false,
    vendedor_autoconfirma: false,
    dominio_propio: false
  }
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
  configuracion: {
    features: { comisiones: { enabled: false } },
    workflow: { mode: 'admin_confirma' }
  },
  plan: DEFAULT_PLAN
};

const TENANT_SELECT = `
  id, nombre, slug, logo_url, color_primario, color_secundario, dominio,
  trial_ends_at, estado_suscripcion, plan_started_at, configuracion,
  stripe_customer_id, stripe_subscription_id, extra_users_billed,
  subscription_renewal_date, next_invoice_amount_usd,
  plans:plan_id (slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd, features)
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
    precio_usuario_extra_usd: Number(plan.precio_usuario_extra_usd) || 0,
    features: plan.features || {}
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
    stripe_customer_id: tenant.stripe_customer_id || null,
    stripe_subscription_id: tenant.stripe_subscription_id || null,
    extra_users_billed: tenant.extra_users_billed || 0,
    subscription_renewal_date: tenant.subscription_renewal_date || null,
    next_invoice_amount_usd: tenant.next_invoice_amount_usd ?? null,
    configuracion: tenant.configuracion || QUOTIX_TRAVEL_CONFIG.configuracion,
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
      console.warn(`[config] No tenant found for domain: ${normalizedDomain}, returning generic`);
      return res.json(QUOTIX_TRAVEL_CONFIG);
    }

    return res.json(formatTenantResponse(tenant));
  } catch (err) {
    console.error('[config] Unexpected error:', err);
    return res.json(QUOTIX_TRAVEL_CONFIG);
  }
};

export const getTenantConfigMe = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);

  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select(TENANT_SELECT)
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      console.error('[config] Error fetching tenant for authenticated user:', error);
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    return res.json(formatTenantResponse(tenant));
  } catch (err) {
    console.error('[config] Unexpected error fetching authenticated tenant:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const updateTenantConfig = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  try {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden modificar la configuración' });
    }

    const { configuracion } = req.body;
    if (!configuracion || typeof configuracion !== 'object') {
      return res.status(400).json({ error: 'Se requiere un objeto configuracion válido' });
    }

    // Fetch current tenant to validate against plan
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(TENANT_SELECT)
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error('[config] Error fetching tenant for update:', tenantError);
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const plan = normalizePlan(tenant.plans);

    // Solo se exige plan válido cuando el update toca features o workflow.
    // Otros cambios (ej. pdf_brand) no deben bloquearse por un plan faltante.
    const tocaFeaturesOWorkflow = configuracion.features !== undefined || configuracion.workflow !== undefined;

    if (tocaFeaturesOWorkflow && !plan) {
      console.error('[config] Could not normalize plan for tenant:', tenantId, 'plans:', tenant.plans);
      return res.status(500).json({ error: 'Error al obtener el plan del tenant' });
    }

    // Validate workflow mode against plan
    const requestedMode = configuracion.workflow?.mode;
    if (requestedMode === 'vendedor_autoconfirma' && plan && !planAllows(plan, 'vendedor_autoconfirma')) {
      return res.status(403).json({
        error: 'El modo vendedor_autoconfirma no está disponible en este plan'
      });
    }

    // Validate comisiones feature against plan
    const requestedComisiones = configuracion.features?.comisiones?.enabled;
    if (requestedComisiones === true && plan && !planAllows(plan, 'comisiones')) {
      return res.status(403).json({
        error: 'Las comisiones no están disponibles en este plan'
      });
    }

    // Merge with existing configuration to avoid overwriting unrelated keys
    const existingConfig = tenant.configuracion || QUOTIX_TRAVEL_CONFIG.configuracion;
    const mergedConfig = {
      ...existingConfig,
      ...configuracion,
      features: {
        ...(existingConfig.features || {}),
        ...(configuracion.features || {})
      },
      workflow: {
        ...(existingConfig.workflow || {}),
        ...(configuracion.workflow || {})
      }
    };

    const { data: updatedTenant, error: updateError } = await supabase
      .from('tenants')
      .update({ configuracion: mergedConfig })
      .eq('id', tenantId)
      .select(TENANT_SELECT)
      .single();

    if (updateError) {
      console.error('[config] Error updating tenant config:', updateError);
      return res.status(500).json({ error: 'Error al actualizar la configuración', details: updateError.message });
    }

    if (!updatedTenant) {
      console.error('[config] updateTenantConfig returned no tenant after update');
      return res.status(500).json({ error: 'Error al actualizar la configuración' });
    }

    return res.json(formatTenantResponse(updatedTenant));
  } catch (err: any) {
    console.error('[config] Unexpected error updating tenant config:', err?.message, err?.stack);
    return res.status(500).json({ error: 'Error interno del servidor', details: err?.message });
  }
};

const PLANS_SELECT_FIELDS = 'slug, nombre, description, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd, features';
const PLANS_SELECT_FALLBACK_FIELDS = 'slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd, features';

export const getPublicPlans = async (req: Request, res: Response) => {
  try {
    const firstAttempt = await supabase
      .from('plans')
      .select(PLANS_SELECT_FIELDS)
      .eq('activo', true)
      .order('precio_mensual_usd', { ascending: true });

    // Fallback por si la migración que agrega `description` aún no se ejecutó.
    let plansResult: any = firstAttempt;
    if (firstAttempt.error && firstAttempt.error.message?.toLowerCase().includes('description')) {
      console.warn('[config] Column description not found, retrying without it');
      plansResult = await supabase
        .from('plans')
        .select(PLANS_SELECT_FALLBACK_FIELDS)
        .eq('activo', true)
        .order('precio_mensual_usd', { ascending: true });
    }

    if (plansResult.error) {
      console.error('[config] Error fetching plans:', plansResult.error);
      return res.status(500).json({ error: 'Error al obtener los planes' });
    }

    return res.json(plansResult.data || []);
  } catch (err) {
    console.error('[config] Unexpected error fetching plans:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * DELETE /api/config/demo-data
 * Elimina los datos de ejemplo (prefijo DEMO-) del tenant. Solo admin.
 */
export const deleteDemoDataController = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar los datos de ejemplo' });
    }

    const tenantId = getTenantId(req);
    const { eliminados } = await deleteDemoData(tenantId);

    return res.json({
      message: 'Datos de ejemplo eliminados',
      eliminados
    });
  } catch (err) {
    console.error('[config] Error eliminando datos demo:', err);
    return res.status(500).json({ error: 'Error al eliminar los datos de ejemplo' });
  }
};
