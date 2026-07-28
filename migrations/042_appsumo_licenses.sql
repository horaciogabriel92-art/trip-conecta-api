-- Tabla para licencias generadas por AppSumo
CREATE TABLE IF NOT EXISTS appsumo_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key UUID UNIQUE NOT NULL,
  prev_license_key UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tier INT NOT NULL,
  plan_slug VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'deactivated')),
  partner_plan_name VARCHAR(100),
  unit_quantity INT DEFAULT 1,
  parent_license_key UUID,
  event_log JSONB DEFAULT '[]'::jsonb,
  email VARCHAR(255),
  activation_token VARCHAR(255),
  activation_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appsumo_licenses_key ON appsumo_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_appsumo_licenses_tenant ON appsumo_licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appsumo_licenses_status ON appsumo_licenses(status);
CREATE INDEX IF NOT EXISTS idx_appsumo_licenses_activation_token ON appsumo_licenses(activation_token);

-- Trigger para mantener updated_at actualizado
CREATE OR REPLACE FUNCTION update_appsumo_licenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appsumo_licenses_updated_at ON appsumo_licenses;
CREATE TRIGGER appsumo_licenses_updated_at
  BEFORE UPDATE ON appsumo_licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_appsumo_licenses_updated_at();
