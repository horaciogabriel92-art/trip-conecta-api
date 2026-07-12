-- Migration 013: Add permissions JSONB to users

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permisos JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.permisos IS 'Granular permissions as JSONB. Admin has all permissions implicitly.';

-- Backfill existing admins with full permissions
UPDATE users
SET permisos = jsonb_build_object(
  'ver_todas_cotizaciones', true,
  'ver_todas_ventas', true,
  'ver_reportes', true,
  'gestionar_paquetes', true,
  'ver_comisiones_otros', true,
  'editar_clientes_otros', true
)
WHERE rol = 'admin' AND (permisos IS NULL OR permisos = '{}'::jsonb);

-- Backfill existing vendedores with default permissions
UPDATE users
SET permisos = jsonb_build_object(
  'ver_todas_cotizaciones', false,
  'ver_todas_ventas', false,
  'ver_reportes', false,
  'gestionar_paquetes', true,
  'ver_comisiones_otros', false,
  'editar_clientes_otros', false
)
WHERE rol = 'vendedor' AND (permisos IS NULL OR permisos = '{}'::jsonb);
