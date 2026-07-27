-- Solicitudes de demo guiada con asesor de Quotix
-- Se completan desde el panel tras el primer login y se notifican por email.

-- Recreamos la tabla para corregir el tipo de user_id (UUID, no INTEGER).
DROP TABLE IF EXISTS demo_requests CASCADE;

CREATE TABLE demo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  whatsapp TEXT,
  fecha_preferida DATE NOT NULL,
  hora_preferida TEXT NOT NULL,
  comentarios TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_estado ON demo_requests(estado);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_requests_tenant ON demo_requests(tenant_id);

-- Trigger para mantener updated_at actualizado
CREATE OR REPLACE FUNCTION update_demo_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS demo_requests_updated_at ON demo_requests;
CREATE TRIGGER demo_requests_updated_at
  BEFORE UPDATE ON demo_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_demo_requests_updated_at();
