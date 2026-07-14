import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';
import {
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  getSubscription,
  stripe,
} from '../services/stripe.service';

const PRICE_IDS: Record<string, string | undefined> = {
  free: process.env.STRIPE_PRICE_ID_FREE,
  freelance: process.env.STRIPE_PRICE_ID_FREELANCE,
  'pro-agencia': process.env.STRIPE_PRICE_ID_PRO_AGENCIA,
  'pro-ilimitado': process.env.STRIPE_PRICE_ID_PRO_ILIMITADO,
  test: process.env.STRIPE_PRICE_ID_TEST,
};

const EXTRA_USER_PRICE_ID = process.env.STRIPE_PRICE_ID_EXTRA_USER;

async function getPlanBySlug(slug: string) {
  const { data, error } = await supabase
    .from('plans')
    .select('id, slug, nombre, stripe_price_id')
    .eq('slug', slug)
    .eq('activo', true)
    .single();

  if (error || !data) return null;
  return data;
}

async function getPlanByPriceId(priceId: string) {
  const { data, error } = await supabase
    .from('plans')
    .select('id, slug, nombre')
    .eq('stripe_price_id', priceId)
    .eq('activo', true)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Crea una sesión de Stripe Checkout para suscribirse a un plan.
 */
export const createCheckout = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  try {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden gestionar la suscripción' });
    }

    const { plan_slug, extra_users = 0 } = req.body;
    if (!plan_slug) {
      return res.status(400).json({ error: 'plan_slug es requerido' });
    }

    if (plan_slug === 'free') {
      return res.status(400).json({ error: 'No se puede suscribir al plan Free mediante checkout' });
    }

    const plan = await getPlanBySlug(plan_slug);
    if (!plan) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const envPriceId = PRICE_IDS[plan_slug];
    if (!envPriceId) {
      return res.status(500).json({ error: `STRIPE_PRICE_ID_${plan_slug.toUpperCase().replace(/-/g, '_')} no configurado` });
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, nombre, slug, stripe_customer_id')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error('[billing] Error fetching tenant:', tenantError);
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const session = await createCheckoutSession(
      tenant,
      { email: user.email, nombre: user.nombre, apellido: user.apellido },
      { slug: plan.slug, nombre: plan.nombre, stripe_price_id: envPriceId },
      Number(extra_users) || 0,
      EXTRA_USER_PRICE_ID
    );

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('[billing] Error creating checkout session:', error);
    res.status(500).json({ error: 'Error al crear sesión de pago', details: error.message });
  }
};

/**
 * Crea una sesión del portal de Stripe para gestionar suscripción.
 */
export const createPortal = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  try {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden gestionar la suscripción' });
    }

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, nombre, slug, stripe_customer_id')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    if (!tenant.stripe_customer_id) {
      return res.status(400).json({ error: 'No hay una suscripción activa de Stripe' });
    }

    const session = await createPortalSession(tenant);
    res.json({ url: session.url });
  } catch (error: any) {
    console.error('[billing] Error creating portal session:', error);
    res.status(500).json({ error: 'Error al crear sesión del portal', details: error.message });
  }
};

/**
 * Devuelve el historial de pagos locales del tenant.
 */
export const getInvoices = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);

  try {
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(invoices || []);
  } catch (error: any) {
    console.error('[billing] Error fetching invoices:', error);
    res.status(500).json({ error: 'Error al obtener historial de pagos', details: error.message });
  }
};

/**
 * Refresca los datos de una suscripción desde Stripe y guarda en DB.
 */
async function refreshSubscriptionFromStripe(tenantId: string, stripeSubscriptionId: string) {
  try {
    const subscription = await getSubscription(stripeSubscriptionId);
    if (subscription) {
      await syncSubscription(subscription);
    }
  } catch (err) {
    console.error('[billing] Error refreshing subscription from Stripe:', err);
  }
}

/**
 * Devuelve el estado actual de la suscripción del tenant.
 */
export const getSubscriptionStatus = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);

  try {
    let { data: tenant, error } = await supabase
      .from('tenants')
      .select(`
        id,
        stripe_subscription_id,
        trial_ends_at,
        estado_suscripcion,
        plan_started_at,
        extra_users_billed,
        subscription_renewal_date,
        next_invoice_amount_usd,
        plans:plan_id (slug, nombre, precio_mensual_usd, precio_usuario_extra_usd)
      `)
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    // Si tenemos suscripción en Stripe pero aún no hay fecha de renovación local,
    // sincronizamos en el momento para mostrar datos actualizados.
    if (tenant.stripe_subscription_id && !tenant.subscription_renewal_date) {
      await refreshSubscriptionFromStripe(tenantId, tenant.stripe_subscription_id);
      let { data: refreshedTenant } = await supabase
        .from('tenants')
        .select(`
          id,
          stripe_subscription_id,
          stripe_customer_id,
          trial_ends_at,
          estado_suscripcion,
          plan_started_at,
          extra_users_billed,
          subscription_renewal_date,
          next_invoice_amount_usd,
          plans:plan_id (slug, nombre, precio_mensual_usd, precio_usuario_extra_usd)
        `)
        .eq('id', tenantId)
        .single();

      // Fallback por si Stripe no devuelve current_period_end en la subscription:
      // usamos la última invoice pagada para obtener el period_end.
      if (refreshedTenant && !refreshedTenant.subscription_renewal_date) {
        const { data: lastInvoice } = await supabase
          .from('invoices')
          .select('period_end')
          .eq('tenant_id', tenantId)
          .eq('status', 'paid')
          .order('period_end', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastInvoice?.period_end) {
          const renewalDate = new Date(lastInvoice.period_end).toISOString();
          await supabase
            .from('tenants')
            .update({ subscription_renewal_date: renewalDate })
            .eq('id', tenantId);
          refreshedTenant = { ...refreshedTenant, subscription_renewal_date: renewalDate };
        }
      }

      if (refreshedTenant) {
        tenant = refreshedTenant;
      }
    }

    res.json({
      trial_ends_at: tenant.trial_ends_at,
      estado_suscripcion: tenant.estado_suscripcion,
      plan_started_at: tenant.plan_started_at,
      extra_users_billed: tenant.extra_users_billed,
      subscription_renewal_date: tenant.subscription_renewal_date,
      next_invoice_amount_usd: tenant.next_invoice_amount_usd,
      plan: tenant.plans,
    });
  } catch (error: any) {
    console.error('[billing] Error fetching subscription status:', error);
    res.status(500).json({ error: 'Error al obtener estado de suscripción', details: error.message });
  }
};

/**
 * Cancela la suscripción activa de Stripe para el tenant.
 */
export const cancelSubscription = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const user = (req as any).user;

  try {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden cancelar la suscripción' });
    }

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, stripe_subscription_id, stripe_customer_id')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    if (!tenant.stripe_subscription_id) {
      return res.status(400).json({ error: 'No hay una suscripción activa para cancelar' });
    }

    await stripe.subscriptions.cancel(tenant.stripe_subscription_id);

    const freePlan = await getPlanBySlug('free');
    const updateData: any = {
      estado_suscripcion: 'cancelado',
      extra_users_billed: 0,
      subscription_renewal_date: null,
      next_invoice_amount_usd: null,
    };
    if (freePlan) {
      updateData.plan_id = freePlan.id;
    }

    await supabase.from('tenants').update(updateData).eq('id', tenantId);

    res.json({ message: 'Suscripción cancelada correctamente' });
  } catch (error: any) {
    console.error('[billing] Error canceling subscription:', error);
    res.status(500).json({ error: 'Error al cancelar suscripción', details: error.message });
  }
};

/**
 * Busca un tenant por customer_id o subscription_id de Stripe.
 */
async function findTenantByStripeIds(stripeInvoice: any): Promise<{ id: string; plan_slug?: string } | null> {
  return findTenantByStripeCustomerOrSubscription(
    typeof stripeInvoice.customer === 'string' ? stripeInvoice.customer : undefined,
    typeof stripeInvoice.subscription === 'string' ? stripeInvoice.subscription : undefined
  );
}

async function findTenantByStripeCustomerOrSubscription(
  customerId?: string,
  subscriptionId?: string
): Promise<{ id: string; plan_slug?: string } | null> {
  if (customerId) {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, plans:plan_id(slug)')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (!error && tenant) {
      const plans = Array.isArray(tenant.plans) ? tenant.plans : [tenant.plans];
      return {
        id: tenant.id,
        plan_slug: plans[0]?.slug,
      };
    }
  }

  if (subscriptionId) {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, plans:plan_id(slug)')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();

    if (!error && tenant) {
      const plans = Array.isArray(tenant.plans) ? tenant.plans : [tenant.plans];
      return {
        id: tenant.id,
        plan_slug: plans[0]?.slug,
      };
    }
  }

  return null;
}

/**
 * Guarda o actualiza un invoice local a partir de un Stripe Invoice.
 */
async function upsertInvoiceFromStripe(
  tenantId: string | null | undefined,
  stripeInvoice: any,
  planSlug?: string
) {
  let resolvedTenantId = tenantId;
  let resolvedPlanSlug = planSlug;

  if (!resolvedTenantId) {
    const tenant = await findTenantByStripeIds(stripeInvoice);
    if (tenant) {
      resolvedTenantId = tenant.id;
      resolvedPlanSlug = resolvedPlanSlug || tenant.plan_slug;
    }
  }

  if (!resolvedTenantId) {
    console.warn('[billing] No se pudo determinar tenant para invoice:', stripeInvoice.id);
    return;
  }

  const existing = await supabase
    .from('invoices')
    .select('id')
    .eq('stripe_invoice_id', stripeInvoice.id)
    .maybeSingle();

  const invoiceData = {
    tenant_id: resolvedTenantId,
    stripe_customer_id: typeof stripeInvoice.customer === 'string' ? stripeInvoice.customer : undefined,
    stripe_subscription_id: typeof stripeInvoice.subscription === 'string' ? stripeInvoice.subscription : undefined,
    stripe_invoice_id: stripeInvoice.id,
    stripe_payment_intent_id: typeof stripeInvoice.payment_intent === 'string' ? stripeInvoice.payment_intent : undefined,
    amount_subtotal_usd: (stripeInvoice.subtotal || 0) / 100,
    amount_total_usd: (stripeInvoice.total || 0) / 100,
    currency: stripeInvoice.currency,
    status: stripeInvoice.status || 'open',
    billing_reason: stripeInvoice.billing_reason,
    period_start: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000).toISOString() : undefined,
    period_end: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000).toISOString() : undefined,
    plan_slug: resolvedPlanSlug,
    description: stripeInvoice.description || `Pago de suscripción`,
    paid_at: stripeInvoice.status === 'paid' ? new Date().toISOString() : undefined,
  };

  if (existing.data) {
    await supabase.from('invoices').update(invoiceData).eq('id', existing.data.id);
  } else {
    await supabase.from('invoices').insert(invoiceData);
  }
}

/**
 * Actualiza el tenant a partir de una suscripción de Stripe.
 */
async function syncSubscription(subscription: any) {
  let tenantId = subscription.metadata?.tenant_id;

  if (!tenantId) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    const tenant = await findTenantByStripeCustomerOrSubscription(customerId, subscription.id);
    if (tenant) {
      tenantId = tenant.id;
    }
  }

  if (!tenantId) {
    console.warn('[billing] Subscription sin tenant_id:', subscription.id);
    return;
  }

  const planSlug = subscription.metadata?.plan_slug;
  const extraUsers = parseInt(subscription.metadata?.extra_users || '0', 10) || 0;

  let planId: string | null = null;
  if (planSlug) {
    const plan = await getPlanBySlug(planSlug);
    planId = plan?.id || null;
  }

  if (!planId && subscription.items?.data.length > 0) {
    const mainItem = subscription.items.data[0];
    const priceId = typeof mainItem.price === 'string' ? mainItem.price : mainItem.price?.id;
    if (priceId) {
      const plan = await getPlanByPriceId(priceId);
      planId = plan?.id || null;
    }
  }

  const status = subscription.status;
  let estadoSuscripcion: string;

  if (status === 'active' || status === 'trialing') {
    estadoSuscripcion = 'activo';
  } else if (status === 'past_due' || status === 'unpaid' || status === 'incomplete_expired') {
    estadoSuscripcion = 'suspendido';
  } else if (status === 'canceled' || status === 'paused') {
    estadoSuscripcion = 'cancelado';
  } else {
    estadoSuscripcion = 'trial';
  }

  // Calcular monto estimado de la próxima factura desde los items de Stripe.
  let nextInvoiceAmount = 0;
  if (Array.isArray(subscription.items?.data)) {
    for (const item of subscription.items.data) {
      const unitAmount = item.price?.unit_amount || 0;
      const quantity = item.quantity || 1;
      nextInvoiceAmount += (unitAmount * quantity) / 100;
    }
  }

  const updateData: any = {
    estado_suscripcion: estadoSuscripcion,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    extra_users_billed: extraUsers,
    next_invoice_amount_usd: nextInvoiceAmount > 0 ? nextInvoiceAmount : null,
  };

  if (subscription.current_period_end) {
    updateData.subscription_renewal_date = new Date(subscription.current_period_end * 1000).toISOString();
  }

  if (planId) {
    updateData.plan_id = planId;
  }

  if (status === 'canceled' || status === 'paused') {
    const freePlan = await getPlanBySlug('free');
    if (freePlan) {
      updateData.plan_id = freePlan.id;
      updateData.estado_suscripcion = 'cancelado';
      updateData.extra_users_billed = 0;
    }
  }

  const { error } = await supabase
    .from('tenants')
    .update(updateData)
    .eq('id', tenantId);

  if (error) {
    console.error('[billing] Error syncing subscription:', error);
  }
}

/**
 * Webhook de Stripe.
 * NOTA: Este endpoint requiere el body raw para validar la firma.
 */
export const webhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  try {
    const event = constructWebhookEvent(req.body, sig);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        if (session.mode === 'subscription' && session.subscription) {
          const subscription = await getSubscription(session.subscription as string);
          if (subscription) {
            await syncSubscription(subscription);
          }
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const tenantId = invoice.subscription_details?.metadata?.tenant_id || invoice.metadata?.tenant_id;
        const planSlug = invoice.subscription_details?.metadata?.plan_slug || invoice.metadata?.plan_slug;

        await upsertInvoiceFromStripe(tenantId, invoice, planSlug);

        if (invoice.subscription) {
          const subscription = await getSubscription(invoice.subscription as string);
          if (subscription) {
            await syncSubscription(subscription);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscription = await getSubscription(invoice.subscription as string);
          if (subscription) {
            await syncSubscription(subscription);
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        await syncSubscription(subscription);
        break;
      }

      default:
        console.log(`[billing] Webhook evento no manejado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('[billing] Webhook error:', error);
    res.status(400).json({ error: 'Webhook error', details: error.message });
  }
};
