-- Migración 034: Habilitar estado 'aprobada' y columnas de aprobación en cotizaciones
--
-- Problema: aprobarCotizacion / rechazarCotizacion fallaban (reportado como 404) porque:
--   1) El CHECK de cotizaciones.estado solo permitía nueva/enviada/vendida/perdida.
--   2) Las columnas notas_admin, fecha_aprobacion, aprobada_por y fecha_rechazo no existían.
--
-- Decisión de diseño (ROADMAP_COTIZACIONES_COMPLETO §6.7): el estado 'aprobada' se usa
-- en plan agencia cuando un admin debe aprobar la venta antes de emitir.
--
-- Ejecutar en Supabase SQL Editor. Es idempotente.

-- 1) Eliminar el CHECK viejo de estado (busca su nombre real dinámicamente)
DO $$
DECLARE
    cname text;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.cotizaciones'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LIMIT 1;

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.cotizaciones DROP CONSTRAINT %I', cname);
    END IF;
END $$;

-- 2) Recrear el CHECK incluyendo 'aprobada'
ALTER TABLE public.cotizaciones
    ADD CONSTRAINT cotizaciones_estado_check
    CHECK (estado IN ('nueva', 'enviada', 'aprobada', 'vendida', 'perdida'));

-- 3) Columnas de aprobación / rechazo
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS notas_admin text;
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS fecha_aprobacion timestamptz;
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS aprobada_por uuid;
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS fecha_rechazo timestamptz;

-- 4) Verificación: debería listar el nuevo constraint y las 4 columnas
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.cotizaciones'::regclass AND contype = 'c';

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'cotizaciones'
  AND column_name IN ('notas_admin', 'fecha_aprobacion', 'aprobada_por', 'fecha_rechazo');
