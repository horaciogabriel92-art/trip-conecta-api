-- ============================================
-- MIGRACION 009: Multi-Tenant (tenant_id)
-- ============================================

-- 1. Crear tabla tenants
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  dominio VARCHAR(255) UNIQUE,
  logo_url VARCHAR(500),
  color_primario VARCHAR(20) DEFAULT '#3b82f6',
  color_secundario VARCHAR(20) DEFAULT '#1d4ed8',
  email_contacto VARCHAR(255),
  telefono VARCHAR(50),
  direccion TEXT,
  plan VARCHAR(20) DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'enterprise')),
  activo BOOLEAN DEFAULT true,
  configuracion JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insertar tenant #1 (Trip Conecta)
INSERT INTO tenants (id, nombre, slug, dominio, logo_url, email_contacto, plan, activo)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Trip Conecta',
  'trip-conecta',
  'panel.tripconecta.com',
  NULL,
  'soporte@tripconecta.com',
  'enterprise',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 3. Agregar tenant_id a users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE users SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

-- 4. Agregar tenant_id al resto de tablas
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE pasajeros ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE cotizacion_pasajeros ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE vuelos ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE hospedajes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE paquetes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE historial_cliente ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE comprobantes_pago ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE pagos_venta ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE documentos_viaje ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE notificaciones_email ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE recordatorios ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- 5. Asignar tenant_id a datos existentes
UPDATE clientes SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE pasajeros SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE cotizaciones SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE cotizacion_pasajeros SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE vuelos SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE hospedajes SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE ventas SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE paquetes SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE historial_cliente SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE comprobantes_pago SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE pagos_venta SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE documentos_viaje SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE notificaciones SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE notificaciones_email SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE recordatorios SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;

-- 6. Indices para performance
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pasajeros_tenant ON pasajeros(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_tenant ON cotizaciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ventas_tenant ON ventas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_tenant ON paquetes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_historial_tenant ON historial_cliente(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_tenant ON notificaciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_tenant ON recordatorios(tenant_id);
