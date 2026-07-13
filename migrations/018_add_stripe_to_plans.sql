-- ============================================
-- MIGRACIÓN 018: Vincular planes con Stripe
-- ============================================
-- Agrega columnas para almacenar los IDs de producto y precio de Stripe.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS interval VARCHAR(20) DEFAULT 'month' CHECK (interval IN ('month', 'year'));

COMMENT ON COLUMN plans.stripe_price_id IS 'Stripe price ID para checkout y suscripción';
COMMENT ON COLUMN plans.stripe_product_id IS 'Stripe product ID vinculado';
COMMENT ON COLUMN plans.interval IS 'Intervalo de facturación: month o year';
