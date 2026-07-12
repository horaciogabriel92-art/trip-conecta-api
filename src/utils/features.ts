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
