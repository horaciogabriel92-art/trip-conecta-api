-- ============================================================
-- MIGRACION 035: Hacer codigo multi-tenant en paquetes, cotizaciones y ventas
-- Problema: los UNIQUE constraints originales son globales, por lo que
-- datos de ejemplo (DEMO-*) o codigos repetidos entre tenants fallan.
-- Solucion: cambiar los constraints a (tenant_id, codigo).
-- ============================================================

-- ----------------------------
-- 1. PAQUETES
-- ----------------------------
-- Eliminar constraint global si existe (nombres por defecto de Supabase/Postgres)
ALTER TABLE paquetes DROP CONSTRAINT IF EXISTS paquetes_codigo_key;

-- Crear constraint multi-tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paquetes_tenant_codigo_key'
  ) THEN
    ALTER TABLE paquetes
      ADD CONSTRAINT paquetes_tenant_codigo_key
      UNIQUE (tenant_id, codigo);
  END IF;
END $$;

-- ----------------------------
-- 2. COTIZACIONES
-- ----------------------------
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_codigo_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cotizaciones_tenant_codigo_key'
  ) THEN
    ALTER TABLE cotizaciones
      ADD CONSTRAINT cotizaciones_tenant_codigo_key
      UNIQUE (tenant_id, codigo);
  END IF;
END $$;

-- ----------------------------
-- 3. VENTAS
-- ----------------------------
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_codigo_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ventas_tenant_codigo_key'
  ) THEN
    ALTER TABLE ventas
      ADD CONSTRAINT ventas_tenant_codigo_key
      UNIQUE (tenant_id, codigo);
  END IF;
END $$;
