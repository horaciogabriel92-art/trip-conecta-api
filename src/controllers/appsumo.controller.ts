import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { sendBienvenidaRegistro } from '../services/email.service';
import { seedDemoData } from '../services/demoData.service';
import { defaultAdminPermissions } from './auth.controller';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

const APPSUMO_API_KEY = process.env.APPSUMO_API_KEY;
const APPSUMO_CLIENT_ID = process.env.APPSUMO_CLIENT_ID;
const APPSUMO_CLIENT_SECRET = process.env.APPSUMO_CLIENT_SECRET;
const APPSUMO_REDIRECT_URI = process.env.APPSUMO_REDIRECT_URI || 'https://api.tripconecta.com/api/appsumo/oauth';
const PANEL_URL = process.env.PANEL_URL || 'https://panel.tripconecta.com';

const APPSUMO_TIER_TO_PLAN: Record<number, string> = {
  1: 'freelance',
  2: 'pro-agencia',
  3: 'pro-ilimitado',
};

const TIER_TO_MAX_USERS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 2,
};

const appsumoRegisterSchema = z.object({
  token: z.string().min(1),
  nombre_agencia: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones'
  }),
  email: z.string().email(),
  password: z.string().min(8),
  nombre: z.string().min(2).max(100),
  apellido: z.string().min(2).max(100),
});

function verifyWebhookSignature(body: string, signature: string | undefined, timestamp: string | undefined, secret: string): boolean {
  if (!signature || !timestamp) return false;
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}${body}`);
    const digest = hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (err) {
    console.error('[appsumo] Error verifying webhook signature:', err);
    return false;
  }
}

function generateSlug(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'agencia'}-${suffix}`;
}

function generateActivationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getPlanBySlug(slug: string) {
  return supabase
    .from('plans')
    .select('id, slug, nombre, precio_mensual_usd, features')
    .eq('slug', slug)
    .eq('activo', true)
    .single();
}

/**
 * POST /api/appsumo/webhook
 * Recibe eventos de licencia de AppSumo.
 */
export const webhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-appsumo-signature'] as string | undefined;
    const timestamp = req.headers['x-appsumo-timestamp'] as string | undefined;

    let rawBody: string;
    let payload: any;

    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
      payload = JSON.parse(rawBody);
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
      payload = JSON.parse(rawBody);
    } else {
      rawBody = JSON.stringify(req.body);
      payload = req.body;
    }

    if (APPSUMO_API_KEY && !verifyWebhookSignature(rawBody, signature, timestamp, APPSUMO_API_KEY)) {
      console.warn('[appsumo] Invalid webhook signature');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const event = payload.event;

    if (!event) {
      return res.status(400).json({ error: 'Evento requerido' });
    }

    console.log('[appsumo] Webhook received:', event, payload.license_key);

    if (payload.test === true) {
      return res.status(200).json({ event, success: true });
    }

    const licenseKey = payload.license_key;
    const tier = payload.tier || 1;
    const planSlug = APPSUMO_TIER_TO_PLAN[tier] || 'freelance';

    switch (event) {
      case 'purchase': {
        const { data: existing } = await supabase
          .from('appsumo_licenses')
          .select('id')
          .eq('license_key', licenseKey)
          .single();

        if (!existing) {
          await supabase.from('appsumo_licenses').insert({
            license_key: licenseKey,
            tier,
            plan_slug: planSlug,
            status: 'inactive',
            partner_plan_name: payload.partner_plan_name || null,
            unit_quantity: payload.unit_quantity || 1,
            parent_license_key: payload.parent_license_key || null,
            event_log: [{ event: 'purchase', timestamp: new Date().toISOString(), payload }],
          });
        }
        break;
      }

      case 'activate': {
        await supabase
          .from('appsumo_licenses')
          .update({
            status: 'active',
            event_log: [{ event: 'activate', timestamp: new Date().toISOString(), payload }],
          })
          .eq('license_key', licenseKey);
        break;
      }

      case 'deactivate': {
        const { data: license } = await supabase
          .from('appsumo_licenses')
          .select('tenant_id')
          .eq('license_key', licenseKey)
          .single();

        if (license?.tenant_id) {
          await supabase.from('tenants').update({ activo: false }).eq('id', license.tenant_id);
          await supabase.from('users').update({ activo: false }).eq('tenant_id', license.tenant_id);
        }

        await supabase
          .from('appsumo_licenses')
          .update({
            status: 'deactivated',
            event_log: [{ event: 'deactivate', timestamp: new Date().toISOString(), payload }],
          })
          .eq('license_key', licenseKey);
        break;
      }

      case 'upgrade':
      case 'downgrade': {
        const newTier = payload.tier || 1;
        const newPlanSlug = APPSUMO_TIER_TO_PLAN[newTier] || 'freelance';
        const prevLicenseKey = payload.prev_license_key;

        const { data: prevLicense } = await supabase
          .from('appsumo_licenses')
          .select('tenant_id')
          .eq('license_key', prevLicenseKey)
          .single();

        await supabase.from('appsumo_licenses').insert({
          license_key: licenseKey,
          prev_license_key: prevLicenseKey,
          tenant_id: prevLicense?.tenant_id || null,
          tier: newTier,
          plan_slug: newPlanSlug,
          status: 'active',
          event_log: [{ event, timestamp: new Date().toISOString(), payload }],
        });

        if (prevLicense?.tenant_id) {
          const { data: plan } = await getPlanBySlug(newPlanSlug);
          if (plan) {
            await supabase
              .from('tenants')
              .update({ plan_id: plan.id })
              .eq('id', prevLicense.tenant_id);
          }
        }
        break;
      }

      case 'migrate': {
        // Add-ons: el parent_license_key cambia, la propia no.
        break;
      }

      default:
        console.warn('[appsumo] Unknown event:', event);
    }

    return res.status(200).json({ event, success: true });
  } catch (error: any) {
    console.error('[appsumo] Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/appsumo/oauth
 * AppSumo redirige acá con ?code=...
 */
export const oauthRedirect = async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización requerido' });
  }

  try {
    const tokenResponse = await fetch('https://appsumo.com/openid/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: APPSUMO_CLIENT_ID || '',
        client_secret: APPSUMO_CLIENT_SECRET || '',
        redirect_uri: APPSUMO_REDIRECT_URI,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[appsumo] Token exchange failed:', errorText);
      return res.status(400).json({ error: 'Error canjeando código OAuth', details: errorText });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(400).json({ error: 'No access token received' });
    }

    const licenseResponse = await fetch(`https://appsumo.com/openid/license_key/?access_token=${accessToken}`);
    if (!licenseResponse.ok) {
      const errorText = await licenseResponse.text();
      console.error('[appsumo] License fetch failed:', errorText);
      return res.status(400).json({ error: 'Error obteniendo license key', details: errorText });
    }

    const licenseData = await licenseResponse.json();
    const licenseKey = licenseData.license_key;
    const licenseStatus = licenseData.status;

    if (!licenseKey) {
      return res.status(400).json({ error: 'No license key received' });
    }

    const { data: license } = await supabase
      .from('appsumo_licenses')
      .select('*')
      .eq('license_key', licenseKey)
      .single();

    if (license?.tenant_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, email, nombre, apellido, rol, tenant_id, token_version')
        .eq('tenant_id', license.tenant_id)
        .eq('rol', 'admin')
        .single();

      if (user) {
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            role: user.rol,
            tenantId: user.tenant_id,
            tokenVersion: user.token_version || 0,
          },
          JWT_SECRET,
          { expiresIn: '1d' }
        );
        return res.redirect(`${PANEL_URL}/login?token=${token}&appsumo=login`);
      }
    }

    if (licenseStatus === 'deactivated') {
      return res.redirect(`${PANEL_URL}/login?error=licencia_desactivada`);
    }

    const activationToken = generateActivationToken();
    const activationTokenExpires = new Date();
    activationTokenExpires.setHours(activationTokenExpires.getHours() + 24);

    await supabase
      .from('appsumo_licenses')
      .update({
        activation_token: activationToken,
        activation_token_expires: activationTokenExpires.toISOString(),
      })
      .eq('license_key', licenseKey);

    return res.redirect(`${PANEL_URL}/registro-appsumo?token=${activationToken}`);
  } catch (error: any) {
    console.error('[appsumo] OAuth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/appsumo/validate-token
 * Valida si un token de activación existe y no expiró.
 */
export const validateToken = async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string | undefined;

    if (!token) {
      return res.status(400).json({ error: 'Token requerido' });
    }

    const { data: license, error } = await supabase
      .from('appsumo_licenses')
      .select('license_key, tier, plan_slug, status, tenant_id, activation_token_expires')
      .eq('activation_token', token)
      .gt('activation_token_expires', new Date().toISOString())
      .single();

    if (error || !license) {
      return res.status(400).json({ error: 'Token de activación inválido o expirado' });
    }

    if (license.tenant_id) {
      return res.status(409).json({ error: 'Esta licencia ya fue activada' });
    }

    return res.status(200).json({
      valid: true,
      tier: license.tier,
      plan_slug: license.plan_slug,
      plan_name: PLAN_NAMES[license.tier] || 'Freelance',
    });
  } catch (error: any) {
    console.error('[appsumo] Validate token error:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const PLAN_NAMES: Record<number, string> = {
  1: 'Freelance',
  2: 'Pro Agencia',
  3: 'Pro Ilimitado',
};

/**
 * POST /api/appsumo/activate
 * Crea tenant + usuario admin para una licencia AppSumo.
 */
export const activate = async (req: Request, res: Response) => {
  try {
    const body = appsumoRegisterSchema.parse(req.body);
    const { token, nombre_agencia, slug, email, password, nombre, apellido } = body;

    const { data: license, error: licenseError } = await supabase
      .from('appsumo_licenses')
      .select('*')
      .eq('activation_token', token)
      .gt('activation_token_expires', new Date().toISOString())
      .single();

    if (licenseError || !license) {
      return res.status(400).json({ error: 'Token de activación inválido o expirado' });
    }

    if (license.tenant_id) {
      return res.status(409).json({ error: 'Esta licencia ya fue activada' });
    }

    const { data: existingSlug } = await supabase.from('tenants').select('id').eq('slug', slug).single();
    if (existingSlug) {
      return res.status(409).json({ error: 'El slug de agencia ya está en uso' });
    }

    const { data: existingEmail } = await supabase.from('users').select('id').eq('email', email).single();
    if (existingEmail) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const { data: plan, error: planError } = await getPlanBySlug(license.plan_slug);
    if (planError || !plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        nombre: nombre_agencia,
        slug,
        plan_id: plan.id,
        estado_suscripcion: 'activo',
        plan_started_at: new Date().toISOString(),
        trial_ends_at: null,
        activo: true,
        configuracion: {
          appsumo: {
            license_key: license.license_key,
            tier: license.tier,
            plan_slug: license.plan_slug,
          },
        },
      })
      .select('id, nombre, slug, plan_started_at, estado_suscripcion')
      .single();

    if (tenantError || !tenant) {
      console.error('[appsumo] Error creating tenant:', tenantError);
      return res.status(500).json({ error: 'Error al crear la agencia' });
    }

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
        permisos: defaultAdminPermissions,
        fecha_registro: new Date().toISOString(),
      })
      .select('id, email, nombre, apellido, rol, tenant_id, token_version')
      .single();

    if (userError || !user) {
      console.error('[appsumo] Error creating user:', userError);
      await supabase.from('tenants').delete().eq('id', tenant.id);
      return res.status(500).json({ error: 'Error al crear el usuario administrador' });
    }

    await supabase
      .from('appsumo_licenses')
      .update({
        tenant_id: tenant.id,
        user_id: user.id,
        status: 'active',
        activation_token: null,
        activation_token_expires: null,
      })
      .eq('license_key', license.license_key);

    seedDemoData(tenant.id, user.id).catch((err) =>
      console.error('[appsumo] Error seeding demo data:', err)
    );

    const tokenJwt = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.rol,
        tenantId: user.tenant_id,
        tokenVersion: user.token_version || 0,
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    sendBienvenidaRegistro(
      email,
      `${nombre} ${apellido}`,
      nombre_agencia,
      email,
      plan.nombre,
      'Lifetime via AppSumo',
      PANEL_URL
    );

    return res.status(201).json({ token: tokenJwt, user, tenant });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[appsumo] Activate error:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
