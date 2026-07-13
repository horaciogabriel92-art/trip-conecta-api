-- ============================================
-- MIGRACIÓN 020: Usuarios extra facturados
-- ============================================
-- Cantidad de usuarios adicionales que el tenant tiene activos en Stripe.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS extra_users_billed INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN tenants.extra_users_billed IS 'Cantidad de usuarios extra pagos en la suscripción de Stripe';
