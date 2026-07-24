import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';
import { randomDigits } from '../utils/cryptoRandom';
import { getAdminEmails, sendEmailAsync } from '../services/email.service';
import { isFeatureEnabled, planAllows, getEffectivePlan } from '../utils/features';

// ============================================
// PUBLIC CONTROLLER - Marketplace de paquetes
// ============================================

const DEFAULT_LANDING = {
  activo: true,
  template: 'classic',
  titulo: '',
  descripcion: '',
  hero: {
    imagen_url: '',
    eyebrow: '',
    titulo: '',
    subtitulo: '',
    cta_texto: '',
    cta_url: ''
  },
  cta_final: {
    imagen_url: '',
    titulo: '',
    subtitulo: '',
    cta_texto: ''
  },
  features: {
    titulo: '',
    subtitulo: '',
    items: [
      { icono: 'Shield', titulo: 'Seguridad', descripcion: 'Operadores certificados y asistencia 24hs.' },
      { icono: 'Users', titulo: 'Asesores', descripcion: 'Especialistas que te acompañan en todo.' },
      { icono: 'CreditCard', titulo: 'Flexibilidad', descripcion: 'Reservá con señal y pagá en cuotas.' },
      { icono: 'Gem', titulo: 'Exclusividad', descripcion: 'Alojamientos seleccionados a mano.' }
    ]
  },
  whatsapp: '',
  telefono: '',
  email: '',
  direccion: '',
  horarios: '',
  redes_sociales: {},
  color_primario: '#0ea5e9',
  color_secundario: '#6366f1',
  color_fondo: '#ffffff',
  color_texto: '#0f172a',
  fuente: 'inter',
  footer_texto: '',
  footer_links: [],
  botones_extra: [],
  seo: {},
  mostrar_precios: true,
  permitir_pdf: true
};

function normalizeLanding(landing: any) {
  return {
    ...DEFAULT_LANDING,
    ...(landing || {}),
    hero: {
      ...DEFAULT_LANDING.hero,
      ...(landing?.hero || {})
    },
    cta_final: {
      ...DEFAULT_LANDING.cta_final,
      ...(landing?.cta_final || {})
    },
    features: {
      ...DEFAULT_LANDING.features,
      ...(landing?.features || {}),
      items: landing?.features?.items || DEFAULT_LANDING.features.items
    },
    redes_sociales: { ...DEFAULT_LANDING.redes_sociales, ...(landing?.redes_sociales || {}) },
    footer_links: landing?.footer_links || DEFAULT_LANDING.footer_links,
    botones_extra: landing?.botones_extra || DEFAULT_LANDING.botones_extra,
    seo: { ...DEFAULT_LANDING.seo, ...(landing?.seo || {}) }
  };
}

function normalizePlan(plan: any) {
  if (!plan) return null;
  return {
    slug: plan.slug || 'free',
    nombre: plan.nombre || 'Free',
    features: plan.features || {}
  };
}

async function getTenantBySlug(slug: string) {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(`
      id, nombre, slug, logo_url, color_primario, color_secundario, dominio,
      trial_ends_at, estado_suscripcion, plan_started_at, configuracion, activo,
      plans:plan_id (slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd, features)
    `)
    .eq('slug', slug)
    .single();

  if (error || !tenant) return null;
  return tenant;
}

function mapearPaquetePublico(p: any) {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.titulo,
    titulo: p.titulo,
    destino: p.destino,
    descripcion: p.descripcion,
    duracion: p.duracion_dias,
    duracion_dias: p.duracion_dias,
    precio_base: p.precio_base,
    precio_doble: p.precio_doble || p.precio_base,
    precio_triple: p.precio_triple,
    precio_cuadruple: p.precio_cuadruple,
    cupos_disponibles: p.cupos_disponibles,
    cupos_totales: p.cupos_totales,
    fecha_salida: p.fecha_salida,
    imagen_url: p.imagen_principal,
    imagen_principal: p.imagen_principal,
    incluye: p.incluye || [],
    no_incluye: p.no_incluye || [],
    itinerario: p.itinerario || { texto: p.descripcion || '', dias: [] },
    galeria: p.galeria || [],
    recursos_vendedores: p.recursos_vendedores || [],
    vuelos: p.vuelos || [],
    hoteles: p.hoteles || [],
    comision_monto_usd: p.comision_monto_usd,
    politicas_cancelacion: p.politicas_cancelacion
  };
}

/**
 * GET /api/public/landings
 * Lista todos los slugs públicos activos (para generación estática).
 */
export const getPublicLandings = async (req: Request, res: Response) => {
  try {
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('slug, configuracion, activo')
      .eq('activo', true);

    if (error) {
      console.error('[public] getPublicLandings error:', error);
      return res.status(500).json({ error: 'Error al obtener landings' });
    }

    const slugs = (tenants || [])
      .filter((t: any) => t.configuracion?.landing?.activo !== false)
      .map((t: any) => t.slug);

    res.json({ slugs });
  } catch (error: any) {
    console.error('[public] getPublicLandings error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * GET /api/public/landing/:slug
 */
export const getPublicLanding = async (req: Request, res: Response) => {
  const slug = req.params.slug as string;

  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant || tenant.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const landing = normalizeLanding(tenant.configuracion?.landing);
    if (landing.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const { data: paquetes } = await supabase
      .from('paquetes')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('estado', 'activo')
      .order('fecha_creacion', { ascending: false });

    res.json({
      tenant: {
        id: tenant.id,
        nombre: tenant.nombre,
        slug: tenant.slug,
        logo_url: tenant.logo_url,
        color_primario: tenant.color_primario,
        color_secundario: tenant.color_secundario,
        dominio: tenant.dominio
      },
      landing,
      paquetes: (paquetes || []).map(mapearPaquetePublico)
    });
  } catch (error: any) {
    console.error('[public] getPublicLanding error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * GET /api/public/landing/:slug/paquetes/:id
 */
export const getPublicPaquete = async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const id = req.params.id as string;

  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant || tenant.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const landing = normalizeLanding(tenant.configuracion?.landing);
    if (landing.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const { data: paquete, error } = await supabase
      .from('paquetes')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .eq('estado', 'activo')
      .single();

    if (error || !paquete) {
      return res.status(404).json({ error: 'Paquete no encontrado' });
    }

    res.json({
      tenant: {
        id: tenant.id,
        nombre: tenant.nombre,
        slug: tenant.slug,
        logo_url: tenant.logo_url,
        color_primario: tenant.color_primario,
        color_secundario: tenant.color_secundario,
        dominio: tenant.dominio
      },
      landing,
      paquete: mapearPaquetePublico(paquete)
    });
  } catch (error: any) {
    console.error('[public] getPublicPaquete error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * Asigna un vendedor al lead público.
 * Estrategia simple: primer admin activo del tenant; si no hay, primer usuario activo.
 */
async function assignVendedor(tenantId: string) {
  const { data: admins } = await supabase
    .from('users')
    .select('id, nombre, apellido, rol')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .eq('rol', 'admin')
    .order('fecha_registro', { ascending: true })
    .limit(1);

  if (admins && admins.length > 0) return admins[0];

  const { data: users } = await supabase
    .from('users')
    .select('id, nombre, apellido, rol')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .order('fecha_registro', { ascending: true })
    .limit(1);

  return users?.[0] || null;
}

/**
 * POST /api/public/landing/:slug/cotizar
 */
export const postPublicCotizar = async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const {
    paquete_id,
    nombre,
    apellido,
    email,
    telefono,
    documento,
    tipo_documento,
    num_pasajeros,
    tipo_habitacion,
    comentarios,
    fecha_salida_preferida
  } = req.body;

  if (!paquete_id || !nombre || !apellido || !email) {
    return res.status(400).json({ error: 'Paquete, nombre, apellido y email son requeridos' });
  }

  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant || tenant.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const landing = normalizeLanding(tenant.configuracion?.landing);
    if (landing.activo === false) {
      return res.status(404).json({ error: 'Página no encontrada' });
    }

    const plan = getEffectivePlan(normalizePlan(tenant.plans), tenant.estado_suscripcion);

    // Buscar paquete
    const { data: paquete, error: paqueteError } = await supabase
      .from('paquetes')
      .select('*')
      .eq('id', paquete_id)
      .eq('tenant_id', tenant.id)
      .eq('estado', 'activo')
      .single();

    if (paqueteError || !paquete) {
      return res.status(404).json({ error: 'Paquete no encontrado' });
    }

    // Asignar vendedor
    const vendedor = await assignVendedor(tenant.id as string);
    if (!vendedor) {
      return res.status(500).json({ error: 'No hay vendedores disponibles en esta agencia' });
    }

    // Buscar o crear cliente
    let clienteId: string | undefined;
    const { data: existenteEmail } = await supabase
      .from('clientes')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('email', email)
      .single();
    if (existenteEmail) clienteId = existenteEmail.id;

    if (!clienteId && documento) {
      const { data: existenteDoc } = await supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('documento', documento)
        .single();
      if (existenteDoc) clienteId = existenteDoc.id;
    }

    if (!clienteId) {
      const { data: nuevoCliente, error: clienteError } = await supabase
        .from('clientes')
        .insert({
          nombre,
          apellido,
          email,
          telefono: telefono || null,
          documento: documento || null,
          tipo_documento: tipo_documento || 'CI',
          registrado_por: vendedor.id,
          tenant_id: tenant.id,
          estado: 'activo',
          prioridad: 'media',
          tags: []
        })
        .select()
        .single();

      if (clienteError || !nuevoCliente) {
        console.error('[public] Error creando cliente:', clienteError);
        return res.status(500).json({ error: 'Error al crear cliente' });
      }
      clienteId = nuevoCliente.id;

      await supabase.from('pasajeros').insert({
        cliente_titular_id: clienteId,
        cliente_id: clienteId,
        es_cliente_registrado: true,
        nombre,
        apellido,
        documento: documento || null,
        tipo_documento: tipo_documento || 'CI',
        tenant_id: tenant.id
      });
    }

    // Crear cotización
    const numViajeros = Math.max(1, Number(num_pasajeros) || 1);
    const precioPorPersona = paquete.precio_doble || paquete.precio_base || 0;
    const precio_total = precioPorPersona * numViajeros;
    const year = new Date().getFullYear();
    const codigo = `COT-${year}-${randomDigits(5)}`;
    const fecha_expiracion = new Date();
    fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

    const comisionesHabilitadas = isFeatureEnabled(tenant.configuracion, plan, 'comisiones');

    const paqueteData: any = {
      titulo: paquete.titulo,
      destino: paquete.destino,
      descripcion: paquete.descripcion || '',
      duracion_dias: paquete.duracion_dias,
      imagen_principal: paquete.imagen_principal,
      incluye: paquete.incluye || [],
      no_incluye: paquete.no_incluye || [],
      vuelos: paquete.vuelos || []
    };

    if (paquete.itinerario) {
      if (typeof paquete.itinerario === 'object' && paquete.itinerario.texto !== undefined) {
        paqueteData.itinerario = paquete.itinerario;
      } else if (Array.isArray(paquete.itinerario)) {
        paqueteData.itinerario = { texto: '', dias: paquete.itinerario };
      } else if (typeof paquete.itinerario === 'string') {
        paqueteData.itinerario = { texto: paquete.itinerario, dias: [] };
      }
    }

    const { data: cotizacion, error: cotError } = await supabase
      .from('cotizaciones')
      .insert({
        codigo,
        vendedor_id: vendedor.id,
        cliente_id: clienteId,
        paquete_id: paquete.id,
        num_pasajeros: numViajeros,
        tipo_habitacion: tipo_habitacion || 'doble',
        fecha_salida: fecha_salida_preferida || paquete.fecha_salida || null,
        precio_total,
        precio_moneda: 'USD',
        comision_vendedor: comisionesHabilitadas ? (paquete.comision_monto_usd || 0) : 0,
        tenant_id: tenant.id,
        paquete_data: paqueteData,
        itinerario: paqueteData.itinerario,
        destino_principal: paquete.destino,
        estado: 'nueva',
        origen_datos: 'web',
        notas: comentarios || null,
        fecha_expiracion: fecha_expiracion.toISOString()
      })
      .select()
      .single();

    if (cotError || !cotizacion) {
      console.error('[public] Error creando cotización:', cotError);
      return res.status(500).json({ error: 'Error al crear cotización', details: cotError?.message });
    }

    // Vincular pasajero titular
    const { data: pasajeroTitular } = await supabase
      .from('pasajeros')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('cliente_titular_id', clienteId)
      .eq('es_cliente_registrado', true)
      .single();

    if (pasajeroTitular) {
      await supabase.from('cotizacion_pasajeros').insert({
        cotizacion_id: cotizacion.id,
        tenant_id: tenant.id,
        pasajero_id: pasajeroTitular.id,
        es_titular: true,
        nombre_snapshot: nombre,
        apellido_snapshot: apellido,
        documento_snapshot: documento || null,
        tipo_habitacion: tipo_habitacion || 'doble'
      });
    }

    // Acompañantes genéricos
    for (let i = 1; i < numViajeros; i++) {
      const { data: acompanante } = await supabase
        .from('pasajeros')
        .insert({
          cliente_titular_id: clienteId,
          nombre: `Acompañante ${i}`,
          apellido: 'Viaje',
          tenant_id: tenant.id
        })
        .select()
        .single();

      if (acompanante) {
        await supabase.from('cotizacion_pasajeros').insert({
          cotizacion_id: cotizacion.id,
          tenant_id: tenant.id,
          pasajero_id: acompanante.id,
          es_titular: false,
          nombre_snapshot: acompanante.nombre,
          apellido_snapshot: acompanante.apellido,
          tipo_habitacion: tipo_habitacion || 'doble'
        });
      }
    }

    // Historial
    await supabase.from('historial_cliente').insert({
      cliente_id: clienteId,
      tipo: 'cotizacion_creada',
      cotizacion_id: cotizacion.id,
      descripcion: `Cotización ${codigo} creada desde la web pública para ${paquete.destino}`,
      realizado_por: vendedor.id,
      realizado_por_nombre: `${vendedor.nombre} ${vendedor.apellido}`,
      tenant_id: tenant.id
    });

    // Email a admins
    const adminEmails = await getAdminEmails(tenant.id as string);
    for (const adminEmail of adminEmails) {
      sendEmailAsync({
        to: adminEmail,
        subject: `Nueva cotización web ${codigo}`,
        templateName: 'nueva-cotizacion',
        variables: {
          adminNombre: '',
          codigo,
          vendedorNombre: `${vendedor.nombre} ${vendedor.apellido}`,
          clienteNombre: `${nombre} ${apellido}`,
          montoTotal: String(cotizacion.precio_total || 0),
          linkAdmin: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/admin/cotizaciones/${cotizacion.id}`
        },
        metadata: { tipo: 'nueva_cotizacion_web', cotizacion_id: cotizacion.id }
      });
    }

    res.status(201).json({
      message: 'Cotización creada correctamente',
      cotizacion_id: cotizacion.id,
      codigo
    });
  } catch (error: any) {
    console.error('[public] postPublicCotizar error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * GET /api/config/landing
 * Config de landing del tenant autenticado.
 */
export const getLandingConfig = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden ver la configuración de landing' });
  }

  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('slug, configuracion')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    res.json({
      slug: tenant.slug,
      landing: normalizeLanding(tenant.configuracion?.landing)
    });
  } catch (error: any) {
    console.error('[public] getLandingConfig error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * PUT /api/config/landing
 */
export const updateLandingConfig = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden modificar la landing' });
  }

  const { landing } = req.body;
  if (!landing || typeof landing !== 'object') {
    return res.status(400).json({ error: 'Se requiere un objeto landing válido' });
  }

  try {
    // Obtener configuración actual
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('slug, configuracion')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const existingConfig = tenant.configuracion || {};
    const mergedLanding = normalizeLanding({ ...existingConfig.landing, ...landing });

    const { data: updated, error: updateError } = await supabase
      .from('tenants')
      .update({
        configuracion: {
          ...existingConfig,
          landing: mergedLanding
        }
      })
      .eq('id', tenantId)
      .select('slug, configuracion')
      .single();

    if (updateError) {
      console.error('[public] updateLandingConfig error:', updateError);
      return res.status(500).json({ error: 'Error al actualizar la landing', details: updateError.message });
    }

    res.json({
      slug: updated.slug,
      landing: normalizeLanding(updated.configuracion?.landing)
    });
  } catch (error: any) {
    console.error('[public] updateLandingConfig error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
