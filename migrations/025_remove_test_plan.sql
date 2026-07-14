-- ============================================
-- MIGRACIÓN 025: Desactivar plan de test y volver Demo a Pro Ilimitado
-- ============================================

-- Desactivar el plan de test de $1 USD para que no aparezca en el listado público.
UPDATE plans
SET activo = false
WHERE slug = 'test';

-- Volver el tenant Demo al plan Pro Ilimitado (su plan original).
UPDATE tenants
SET plan_id = (SELECT id FROM plans WHERE slug = 'pro-ilimitado' AND activo = true),
    estado_suscripcion = 'activo',
    stripe_subscription_id = NULL,
    stripe_customer_id = NULL,
    extra_users_billed = 0,
    subscription_renewal_date = NULL,
    next_invoice_amount_usd = NULL
WHERE slug = 'demo';
