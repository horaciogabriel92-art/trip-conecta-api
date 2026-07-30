import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  activo: z.enum(['true', 'false']).optional(),
  estado_suscripcion: z.enum(['trial', 'activo', 'suspendido', 'cancelado']).optional(),
  plan_slug: z.string().optional(),
});

const updateSchema = z.object({
  nombre: z.string().min(2).max(255).optional(),
  email_contacto: z.string().email().optional().nullable(),
  telefono: z.string().max(50).optional().nullable(),
  dominio: z.string().max(255).optional().nullable(),
  plan_id: z.string().uuid().optional(),
  activo: z.boolean().optional(),
  estado_suscripcion: z.enum(['trial', 'activo', 'suspendido', 'cancelado']).optional(),
  limites_override: z.object({
    max_users: z.number().int().min(1).optional().nullable(),
    max_cotizaciones_por_mes: z.number().int().min(1).optional().nullable(),
    max_paquetes: z.number().int().min(1).optional().nullable(),
  }).optional(),
});

function getBaseSelect() {
  return `
    id,
    nombre,
    slug,
    dominio,
    logo_url,
    email_contacto,
    telefono,
    direccion,
    color_primario,
    color_secundario,
    activo,
    estado_suscripcion,
    trial_ends_at,
    plan_started_at,
    subscription_renewal_date,
    next_invoice_amount_usd,
    extra_users_billed,
    configuracion,
    created_at,
    updated_at,
    plans:plan_id (id, slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, precio_mensual_usd, precio_usuario_extra_usd, features)
  `;
}

function normalizeTenant(t: any) {
  if (!t) return null;
  const plan = t.plans || {};
  const override = t.configuracion?.limites_override || {};
  return {
    ...t,
    plan: {
      id: plan.id,
      slug: plan.slug,
      nombre: plan.nombre,
      max_users: override.max_users ?? plan.max_users,
      max_cotizaciones_por_mes: override.max_cotizaciones_por_mes ?? plan.max_cotizaciones_por_mes,
      max_paquetes: override.max_paquetes ?? plan.max_paquetes,
      precio_mensual_usd: plan.precio_mensual_usd,
      precio_usuario_extra_usd: plan.precio_usuario_extra_usd,
      features: plan.features,
    },
    limites_override: override,
    plans: undefined,
  };
}

export const listTenants = async (req: Request, res: Response) => {
  try {
    const { page, limit, search, activo, estado_suscripcion, plan_slug } = listQuerySchema.parse(req.query);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('tenants')
      .select(getBaseSelect(), { count: 'exact' });

    if (search) {
      query = query.or(`nombre.ilike.%${search}%,slug.ilike.%${search}%,email_contacto.ilike.%${search}%,dominio.ilike.%${search}%`);
    }

    if (activo !== undefined) {
      query = query.eq('activo', activo === 'true');
    }

    if (estado_suscripcion) {
      query = query.eq('estado_suscripcion', estado_suscripcion);
    }

    if (plan_slug) {
      const { data: plan } = await supabase.from('plans').select('id').eq('slug', plan_slug).single();
      if (plan) {
        query = query.eq('plan_id', plan.id);
      }
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[Ernesto Tenants] List error:', error);
      return res.status(500).json({ error: 'Error al listar tenants', details: error.message });
    }

    res.json({
      tenants: (data || []).map(normalizeTenant),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Parámetros inválidos', details: error.errors });
    }
    console.error('[Ernesto Tenants] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getTenant = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('tenants')
      .select(getBaseSelect())
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    res.json({ tenant: normalizeTenant(data) });
  } catch (error: any) {
    console.error('[Ernesto Tenants] Get error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const updateTenant = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = updateSchema.parse(req.body);

    const { data: current } = await supabase.from('tenants').select('configuracion').eq('id', id).single();
    if (!current) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const updateData: any = {};
    if (body.nombre !== undefined) updateData.nombre = body.nombre;
    if (body.email_contacto !== undefined) updateData.email_contacto = body.email_contacto;
    if (body.telefono !== undefined) updateData.telefono = body.telefono;
    if (body.dominio !== undefined) updateData.dominio = body.dominio;
    if (body.plan_id !== undefined) updateData.plan_id = body.plan_id;
    if (body.activo !== undefined) updateData.activo = body.activo;
    if (body.estado_suscripcion !== undefined) updateData.estado_suscripcion = body.estado_suscripcion;

    const configuracion = { ...(current.configuracion || {}) };
    if (body.limites_override !== undefined) {
      configuracion.limites_override = body.limites_override;
      updateData.configuracion = configuracion;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const { data, error } = await supabase
      .from('tenants')
      .update(updateData)
      .eq('id', id)
      .select(getBaseSelect())
      .single();

    if (error) {
      console.error('[Ernesto Tenants] Update error:', error);
      return res.status(500).json({ error: 'Error al actualizar tenant', details: error.message });
    }

    // Si se desactiva el tenant, también desactivamos sus usuarios
    if (body.activo === false) {
      await supabase.from('users').update({ activo: false }).eq('tenant_id', id);
    }

    res.json({ tenant: normalizeTenant(data) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Tenants] Update error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const toggleTenant = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabase
      .from('tenants')
      .select('id, activo')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const newActive = !current.activo;

    const { data, error } = await supabase
      .from('tenants')
      .update({ activo: newActive })
      .eq('id', id)
      .select(getBaseSelect())
      .single();

    if (error) {
      console.error('[Ernesto Tenants] Toggle error:', error);
      return res.status(500).json({ error: 'Error al cambiar estado del tenant', details: error.message });
    }

    await supabase.from('users').update({ activo: newActive }).eq('tenant_id', id);

    res.json({ tenant: normalizeTenant(data), activo: newActive });
  } catch (error: any) {
    console.error('[Ernesto Tenants] Toggle error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getTenantUsers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, rol, activo, comision_porcentaje, fecha_registro, ultimo_acceso')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Ernesto Tenants] Users error:', error);
      return res.status(500).json({ error: 'Error al obtener usuarios', details: error.message });
    }

    res.json({ users: data || [] });
  } catch (error: any) {
    console.error('[Ernesto Tenants] Users error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
