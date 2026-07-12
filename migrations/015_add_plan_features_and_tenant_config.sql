-- Migration 015: Add plan features and tenant configuration defaults
-- Purpose: enable feature flags per plan and per-tenant configuration

-- 1. Add features JSONB column to plans
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}';

COMMENT ON COLUMN plans.features IS 'Feature flags available for this plan (comisiones, vendedor_autoconfirma, dominio_propio, etc.)';

-- 2. Backfill features for existing plans
UPDATE plans
SET features = '{"comisiones": false, "vendedor_autoconfirma": false, "dominio_propio": false}'
WHERE slug IN ('free', 'freelance');

UPDATE plans
SET features = '{"comisiones": true, "vendedor_autoconfirma": true, "dominio_propio": true}'
WHERE slug IN ('pro-agencia', 'pro-ilimitado');

-- 3. Ensure tenants.configuracion has a safe default structure
--    Use jsonb_strip_nulls to avoid null values overriding defaults
UPDATE tenants
SET configuracion = jsonb_strip_nulls(
  COALESCE(configuracion, '{}'::jsonb)
  || '{
    "features": {"comisiones": {"enabled": false}},
    "workflow": {"mode": "admin_confirma"}
  }'::jsonb
)
WHERE configuracion IS NULL
   OR NOT configuracion ? 'features'
   OR NOT configuracion ? 'workflow';

-- 4. Backfill: enable comisiones by default for tenants on pro plans
--    to preserve existing behavior for Trip Conecta and other pro tenants
UPDATE tenants
SET configuracion = jsonb_strip_nulls(
  COALESCE(configuracion, '{}'::jsonb)
  || '{"features": {"comisiones": {"enabled": true}}}'::jsonb
)
WHERE plan_id IN (SELECT id FROM plans WHERE slug IN ('pro-agencia', 'pro-ilimitado'));

-- 5. Ensure free/freelance tenants have comisiones explicitly disabled
UPDATE tenants
SET configuracion = jsonb_strip_nulls(
  COALESCE(configuracion, '{}'::jsonb)
  || '{"features": {"comisiones": {"enabled": false}}}'::jsonb
)
WHERE plan_id IN (SELECT id FROM plans WHERE slug IN ('free', 'freelance'));
