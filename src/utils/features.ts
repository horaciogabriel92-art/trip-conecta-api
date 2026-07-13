import { Request } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from './tenant';

export interface PlanFeatures {
  comisiones?: boolean;
  vendedor_autoconfirma?: boolean;
  dominio_propio?: boolean;
  [key: string]: boolean | undefined;
}

export interface PlanConfig {
  slug: string;
  nombre: string;
  features?: PlanFeatures;
  [key: string]: any;
}

export interface TenantConfiguracion {
  features?: {
    comisiones?: { enabled?: boolean };
    [key: string]: any;
  };
  workflow?: {
    mode?: 'admin_confirma' | 'vendedor_autoconfirma' | 'simple';
  };
  [key: string]: any;
}

/**
 * Verifica si un plan permite una feature específica.
 */
export function planAllows(plan: PlanConfig | null | undefined, feature: string): boolean {
  if (!plan) return false;
  return plan.features?.[feature] === true;
}

/**
 * Verifica si una feature está habilitada para un tenant.
 * Requiere que el plan la permita Y que el admin la haya activado.
 */
export function isFeatureEnabled(
  configuracion: TenantConfiguracion | null | undefined,
  plan: PlanConfig | null | undefined,
  feature: string
): boolean {
  if (!planAllows(plan, feature)) return false;
  const featureConfig = configuracion?.features?.[feature];
  if (!featureConfig) return false;
  return featureConfig.enabled === true;
}

/**
 * Obtiene el modo de trabajo configurado para el tenant.
 * Default: 'admin_confirma'.
 */
export function getWorkflowMode(
  configuracion: TenantConfiguracion | null | undefined
): 'admin_confirma' | 'vendedor_autoconfirma' | 'simple' {
  const mode = configuracion?.workflow?.mode;
  if (mode === 'vendedor_autoconfirma' || mode === 'simple') {
    return mode;
  }
  return 'admin_confirma';
}

/**
 * Verifica si el modo de trabajo permite que el vendedor autoconfirme sus ventas.
 */
export function vendedorPuedeAutoconfirmar(
  configuracion: TenantConfiguracion | null | undefined,
  plan: PlanConfig | null | undefined
): boolean {
  if (!planAllows(plan, 'vendedor_autoconfirma')) return false;
  return getWorkflowMode(configuracion) === 'vendedor_autoconfirma';
}

/**
 * Verifica si el tenant está en modo simple (free/freelance o explícito).
 */
export function isSimpleWorkflow(
  configuracion: TenantConfiguracion | null | undefined,
  plan: PlanConfig | null | undefined
): boolean {
  if (plan?.slug === 'free' || plan?.slug === 'freelance') return true;
  return getWorkflowMode(configuracion) === 'simple';
}

/**
 * Consulta la BD para verificar si una feature está habilitada para el tenant actual.
 * Útil en controllers donde no se dispone del plan/configuración precargados.
 */
export async function checkFeatureEnabled(
  req: Request,
  feature: string
): Promise<{ enabled: boolean; allowed: boolean }> {
  const tenantId = getTenantId(req);
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('configuracion, plans:plan_id(features)')
    .eq('id', tenantId)
    .single();

  if (error || !tenant) {
    console.error(`[features] Error fetching tenant for feature ${feature}:`, error);
    return { enabled: false, allowed: false };
  }

  const plan = normalizePlan(tenant.plans);
  const configuracion = tenant.configuracion;

  return {
    allowed: planAllows(plan, feature),
    enabled: isFeatureEnabled(configuracion, plan, feature)
  };
}

/**
 * Consulta la BD para obtener el modo de trabajo del tenant actual.
 */
export async function checkWorkflowMode(
  req: Request
): Promise<{
  mode: 'admin_confirma' | 'vendedor_autoconfirma' | 'simple';
  canVendedorAutoconfirmar: boolean;
  isSimple: boolean;
}> {
  const tenantId = getTenantId(req);
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('configuracion, plans:plan_id(slug, features)')
    .eq('id', tenantId)
    .single();

  if (error || !tenant) {
    console.error('[features] Error fetching tenant for workflow mode:', error);
    return { mode: 'admin_confirma', canVendedorAutoconfirmar: false, isSimple: false };
  }

  const plan = normalizePlan(tenant.plans);
  const configuracion = tenant.configuracion;
  const mode = getWorkflowMode(configuracion);

  return {
    mode,
    canVendedorAutoconfirmar: vendedorPuedeAutoconfirmar(configuracion, plan),
    isSimple: isSimpleWorkflow(configuracion, plan)
  };
}

function normalizePlan(plan: any): PlanConfig | null {
  if (!plan) return null;
  return {
    slug: plan.slug || 'free',
    nombre: plan.nombre || 'Free',
    features: plan.features || {}
  };
}
