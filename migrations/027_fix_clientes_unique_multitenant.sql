-- Fix multi-tenant unique constraints en clientes
-- El constraint original no incluía tenant_id, lo que impedía que dos tenants
-- tuvieran clientes con el mismo documento o email.

-- Paso 1 (opcional, verificación): descomentar para revisar duplicados dentro del mismo tenant
-- SELECT tenant_id, tipo_documento, documento, COUNT(*)
-- FROM clientes
-- GROUP BY tenant_id, tipo_documento, documento
-- HAVING COUNT(*) > 1;
--
-- SELECT tenant_id, email, COUNT(*)
-- FROM clientes
-- WHERE email IS NOT NULL
-- GROUP BY tenant_id, email
-- HAVING COUNT(*) > 1;

-- Paso 2: eliminar constraints antiguos (globales, sin tenant_id) si aún existen
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_tipo_documento_documento_key;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_email_key;

-- Paso 3: crear constraints nuevos incluyendo tenant_id (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clientes_tenant_tipo_documento_documento_key'
  ) THEN
    ALTER TABLE clientes
      ADD CONSTRAINT clientes_tenant_tipo_documento_documento_key
      UNIQUE (tenant_id, tipo_documento, documento);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clientes_tenant_email_key'
  ) THEN
    ALTER TABLE clientes
      ADD CONSTRAINT clientes_tenant_email_key
      UNIQUE (tenant_id, email);
  END IF;
END $$;
