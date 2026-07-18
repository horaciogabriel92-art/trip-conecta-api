import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { sendBienvenidaRegistro } from '../services/email.service';
import { seedDemoData } from '../services/demoData.service';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

const onboardingSchema = z.object({
  tipo: z.enum(['freelance', 'agencia']),
  vendedores: z.string().nullable().optional(),
  pais: z.string().optional(),
  tipo_viajes: z.string().optional(),
  gds: z.string().optional(),
});

const registerSchema = z.object({
  nombre_agencia: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones'
  }),
  email: z.string().email(),
  password: z.string().min(8),
  nombre: z.string().min(2).max(100),
  apellido: z.string().min(2).max(100),
  plan_slug: z.string().min(1),
  onboarding: onboardingSchema.optional()
});

export const register = async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    const { nombre_agencia, slug, email, password, nombre, apellido, plan_slug, onboarding } = body;

    // Verificar que el slug del tenant no exista
    const { data: existingSlug, error: slugError } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existingSlug) {
      return res.status(409).json({ error: 'El slug de agencia ya está en uso' });
    }

    // Verificar que el email no esté registrado
    const { data: existingEmail, error: emailError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingEmail) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    // Buscar el plan
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, slug, nombre, precio_mensual_usd')
      .eq('slug', plan_slug)
      .eq('activo', true)
      .single();

    if (planError || !plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    // Crear tenant
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        nombre: nombre_agencia,
        slug,
        plan_id: plan.id,
        trial_ends_at: trialEndsAt.toISOString(),
        estado_suscripcion: 'trial',
        plan_started_at: new Date().toISOString(),
        activo: true,
        configuracion: onboarding ? { onboarding } : undefined
      })
      .select('id, nombre, slug, trial_ends_at, estado_suscripcion, plan_started_at')
      .single();

    if (tenantError || !tenant) {
      console.error('[register] Error creating tenant:', tenantError);
      return res.status(500).json({ error: 'Error al crear la agencia' });
    }

    // Crear usuario admin
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        email,
        password: hashedPassword,
        nombre,
        apellido,
        rol: 'admin',
        tenant_id: tenant.id,
        activo: true,
        fecha_registro: new Date().toISOString()
      })
      .select('id, email, nombre, apellido, rol, tenant_id, token_version')
      .single();

    if (userError || !user) {
      console.error('[register] Error creating user:', userError);
      // Rollback: eliminar tenant creado
      await supabase.from('tenants').delete().eq('id', tenant.id);
      return res.status(500).json({ error: 'Error al crear el usuario administrador' });
    }

    // Sembrar datos de ejemplo para el onboarding (fire-and-forget: un error no frena el registro)
    seedDemoData(tenant.id, user.id).catch((err) =>
      console.error('[register] Error sembrando datos demo:', err)
    );

    // Generar JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.rol,
        tenantId: user.tenant_id,
        tokenVersion: user.token_version || 0
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Enviar email de bienvenida (no bloqueante)
    const panelUrl = process.env.PANEL_URL || 'https://travel.quotixos.com';
    sendBienvenidaRegistro(
      email,
      `${nombre} ${apellido}`,
      nombre_agencia,
      email,
      plan.nombre,
      `US$ ${plan.precio_mensual_usd} / mes`,
      panelUrl
    );

    return res.status(201).json({
      token,
      user,
      tenant
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: error.errors
      });
    }
    console.error('[register] Unexpected error:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
