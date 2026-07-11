-- Migration 011: Add plans table and migrate tenants.plan -> tenants.plan_id

-- 1. Create plans table
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  max_users INT,
  max_cotizaciones_por_mes INT,
  max_paquetes INT,
  permite_dominio_propio BOOLEAN DEFAULT false,
  precio_mensual_usd NUMERIC(10,2) NOT NULL,
  precio_usuario_extra_usd NUMERIC(10,2) DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE plans IS 'Subscription plans with usage limits and pricing';
COMMENT ON COLUMN plans.max_users IS 'Maximum number of users; NULL means unlimited';
COMMENT ON COLUMN plans.max_cotizaciones_por_mes IS 'Maximum quotes per month; NULL means unlimited';
COMMENT ON COLUMN plans.max_paquetes IS 'Maximum published packages; NULL means unlimited';

-- 2. Seed default plans
INSERT INTO plans (slug, nombre, max_users, max_cotizaciones_por_mes, max_paquetes, permite_dominio_propio, precio_mensual_usd, precio_usuario_extra_usd)
VALUES
  ('free',          'Free',                 1, 10,   1,   false, 0.00,  0.00),
  ('freelance',     'Freelance',            1, 50,   5,   false, 29.00, 0.00),
  ('pro-agencia',   'Pro Agencia de Viaje', 2, 200,  10,  true,  49.00, 10.00),
  ('pro-ilimitado', 'Pro Ilimitado',        2, NULL, NULL, true,  79.00, 10.00)
ON CONFLICT (slug) DO NOTHING;

-- 3. Add plan_id to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;

-- 4. Migrate existing tenants
--    Only reference legacy `plan` column if it still exists.
DO $$
DECLARE
  plan_column_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name = 'plan'
  ) INTO plan_column_exists;

  IF plan_column_exists THEN
    UPDATE tenants
    SET plan_id = (SELECT id FROM plans WHERE slug = 'pro-ilimitado')
    WHERE plan_id IS NULL AND plan = 'enterprise';

    UPDATE tenants
    SET plan_id = (SELECT id FROM plans WHERE slug = 'pro-agencia')
    WHERE plan_id IS NULL AND plan = 'pro';
  END IF;
END $$;

-- Any tenant still without a plan gets Free
UPDATE tenants
SET plan_id = (SELECT id FROM plans WHERE slug = 'free')
WHERE plan_id IS NULL;

-- 5. Remove legacy plan column and its CHECK constraint
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_plan_check;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS plan;
