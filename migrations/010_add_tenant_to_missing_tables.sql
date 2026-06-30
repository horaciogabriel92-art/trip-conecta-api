-- ============================================
-- MIGRACION 010: Agregar tenant_id a tablas faltantes
-- ============================================

-- Tablas que no tenian tenant_id en la migracion 009
ALTER TABLE pagos_comisiones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE notas_cliente ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Asignar tenant #1 (Trip Conecta) a datos existentes
UPDATE pagos_comisiones SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
UPDATE notas_cliente SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;

-- Hacer NOT NULL donde corresponde
ALTER TABLE pagos_comisiones ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notas_cliente ALTER COLUMN tenant_id SET NOT NULL;

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_tenant ON pagos_comisiones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notas_cliente_tenant ON notas_cliente(tenant_id);
