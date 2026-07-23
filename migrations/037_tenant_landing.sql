-- Migration: 037_tenant_landing.sql
-- Prepara el tenant para soportar landing pública de paquetes.

BEGIN;

-- Asegurar slug único y not null (ya debería serlo, pero idempotente)
ALTER TABLE public.tenants
  ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_slug_key'
  ) THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_slug_key UNIQUE (slug);
  END IF;
END
$$;

-- Índice GIN para búsquedas dentro de configuracion.landing
CREATE INDEX IF NOT EXISTS idx_tenants_configuracion_gin
  ON public.tenants
  USING GIN (configuracion jsonb_path_ops);

-- Actualizar slugs vacíos o nulos con base en el nombre (fallback seguro)
UPDATE public.tenants
SET slug = COALESCE(NULLIF(TRIM(slug), ''), LOWER(REGEXP_REPLACE(nombre, '[^a-zA-Z0-9]+', '-', 'g')))
WHERE NULLIF(TRIM(slug), '') IS NULL;

COMMIT;
