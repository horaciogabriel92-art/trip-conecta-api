-- Migration 012: Add trial and subscription fields to tenants

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estado_suscripcion VARCHAR(20) DEFAULT 'trial'
    CHECK (estado_suscripcion IN ('trial', 'activo', 'suspendido', 'cancelado')),
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);

COMMENT ON COLUMN tenants.trial_ends_at IS 'Trial expiration timestamp; null means no trial or Free plan';
COMMENT ON COLUMN tenants.estado_suscripcion IS 'Subscription status: trial, active, suspended, cancelled';
COMMENT ON COLUMN tenants.plan_started_at IS 'When the current plan/trial started';
COMMENT ON COLUMN tenants.stripe_customer_id IS 'Stripe customer ID (future use)';
COMMENT ON COLUMN tenants.stripe_subscription_id IS 'Stripe subscription ID (future use)';

-- Backfill existing tenants with a 7-day trial window from now
UPDATE tenants
SET trial_ends_at = COALESCE(trial_ends_at, NOW() + INTERVAL '7 days'),
    estado_suscripcion = COALESCE(estado_suscripcion, 'trial'),
    plan_started_at = COALESCE(plan_started_at, NOW())
WHERE trial_ends_at IS NULL;
