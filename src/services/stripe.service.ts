import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

if (!STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY no está configurado');
}

export const stripe = new Stripe(STRIPE_SECRET_KEY || '', {
  typescript: true,
});

interface TenantInfo {
  id: string;
  nombre: string;
  slug: string;
  stripe_customer_id?: string | null;
}

interface UserInfo {
  email: string;
  nombre?: string;
  apellido?: string;
}

interface PlanInfo {
  slug: string;
  nombre: string;
  stripe_price_id?: string | null;
}

/**
 * Crea o recupera un customer de Stripe para el tenant.
 */
export async function createOrGetCustomer(
  tenant: TenantInfo,
  user: UserInfo
): Promise<string> {
  if (tenant.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(tenant.stripe_customer_id);
      if (!customer.deleted) {
        return customer.id;
      }
    } catch (err) {
      console.warn('[stripe] Customer no encontrado o eliminado, creando nuevo:', err);
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: tenant.nombre,
    metadata: {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
    },
  });

  return customer.id;
}

/**
 * Crea una sesión de Stripe Checkout para suscripción.
 */
export async function createCheckoutSession(
  tenant: TenantInfo,
  user: UserInfo,
  plan: PlanInfo,
  extraUsers: number,
  extraUserPriceId: string | undefined
): Promise<Stripe.Checkout.Session> {
  if (!plan.stripe_price_id) {
    throw new Error(`Plan ${plan.slug} no tiene stripe_price_id configurado`);
  }

  const customerId = await createOrGetCustomer(tenant, user);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: plan.stripe_price_id,
      quantity: 1,
    },
  ];

  if (extraUsers > 0 && extraUserPriceId) {
    lineItems.push({
      price: extraUserPriceId,
      quantity: extraUsers,
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: lineItems,
    success_url: `${FRONTEND_URL}/configuracion/plan?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_URL}/configuracion/plan?canceled=1`,
    metadata: {
      tenant_id: tenant.id,
      plan_slug: plan.slug,
      extra_users: String(extraUsers),
    },
    subscription_data: {
      metadata: {
        tenant_id: tenant.id,
        plan_slug: plan.slug,
        extra_users: String(extraUsers),
      },
    },
  });

  return session;
}

/**
 * Crea una sesión del portal de Stripe para gestionar suscripción.
 */
export async function createPortalSession(tenant: TenantInfo): Promise<Stripe.BillingPortal.Session> {
  if (!tenant.stripe_customer_id) {
    throw new Error('El tenant no tiene un customer de Stripe');
  }

  return stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${FRONTEND_URL}/configuracion/plan`,
  });
}

/**
 * Valida y construye un evento de webhook de Stripe.
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET no está configurado');
  }
  return stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
}

/**
 * Obtiene el precio de Stripe por ID.
 */
export async function getPrice(priceId: string): Promise<Stripe.Price | null> {
  try {
    return await stripe.prices.retrieve(priceId);
  } catch (err) {
    console.error('[stripe] Error retrieving price:', err);
    return null;
  }
}

/**
 * Obtiene una suscripción de Stripe por ID.
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error('[stripe] Error retrieving subscription:', err);
    return null;
  }
}
