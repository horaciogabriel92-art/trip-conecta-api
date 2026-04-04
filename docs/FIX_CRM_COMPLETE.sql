-- FIX COMPLETO PARA CRM CLIENTES
-- Ejecutar en Supabase SQL Editor

-- ============================================
-- 1. FIX NOTAS_CLIENTE - Agregar columna es_privada
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notas_cliente' AND column_name = 'es_privada'
    ) THEN
        ALTER TABLE notas_cliente ADD COLUMN es_privada BOOLEAN DEFAULT false;
        RAISE NOTICE '✅ Columna es_privada agregada';
    ELSE
        RAISE NOTICE '✓ Columna es_privada ya existe';
    END IF;
END $$;

-- ============================================
-- 2. Verificar todas las columnas de notas_cliente
-- ============================================
SELECT 'Estructura de notas_cliente:' as info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns
WHERE table_name = 'notas_cliente'
ORDER BY ordinal_position;

-- ============================================
-- 3. Verificar columnas extendidas de clientes
-- ============================================
SELECT 'Columnas CRM de clientes:' as info;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'clientes' 
AND column_name IN ('email_alt', 'whatsapp', 'preferencias_viaje', 'temporada_preferida', 
                    'fuente_lead', 'referido_por', 'tags', 'prioridad', 
                    'fecha_proximo_viaje_ideal', 'estado')
ORDER BY column_name;

-- ============================================
-- 4. Fix tipo de columna tags (debe ser ARRAY)
-- ============================================
DO $$
BEGIN
    -- Verificar si tags es del tipo correcto
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'clientes' AND column_name = 'tags'
        AND data_type = 'ARRAY'
    ) THEN
        RAISE NOTICE '✓ Columna tags es ARRAY (correcto)';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'clientes' AND column_name = 'tags'
    ) THEN
        RAISE NOTICE '⚠ Columna tags existe pero no es ARRAY, convirtiendo...';
        ALTER TABLE clientes ALTER COLUMN tags TYPE TEXT[] USING ARRAY[tags];
    ELSE
        RAISE NOTICE '⚠ Columna tags no existe, creando...';
        ALTER TABLE clientes ADD COLUMN tags TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- ============================================
-- 5. Actualizar RLS policies para notas_cliente
-- ============================================

-- Habilitar RLS
ALTER TABLE notas_cliente ENABLE ROW LEVEL SECURITY;

-- Eliminar policies existentes para recrear
DROP POLICY IF EXISTS "Allow all access for authenticated" ON notas_cliente;
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver notas" ON notas_cliente;
DROP POLICY IF EXISTS "Usuarios autenticados pueden crear notas" ON notas_cliente;
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar sus notas" ON notas_cliente;
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar sus notas" ON notas_cliente;

-- Crear policies actualizadas
CREATE POLICY "Usuarios autenticados pueden ver notas"
ON notas_cliente FOR SELECT
TO authenticated
USING (
    es_privada = false OR vendedor_id = auth.uid()
);

CREATE POLICY "Usuarios autenticados pueden crear notas"
ON notas_cliente FOR INSERT
TO authenticated
WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Usuarios autenticados pueden actualizar sus notas"
ON notas_cliente FOR UPDATE
TO authenticated
USING (vendedor_id = auth.uid());

CREATE POLICY "Usuarios autenticados pueden eliminar sus notas"
ON notas_cliente FOR DELETE
TO authenticated
USING (vendedor_id = auth.uid());

SELECT '✅ RLS policies actualizadas para notas_cliente' as info;

-- ============================================
-- 6. Verificar datos de prueba (opcional)
-- ============================================
SELECT 'Total notas:' as metrica, COUNT(*) as valor FROM notas_cliente;
SELECT 'Total clientes con campos CRM:' as metrica, COUNT(*) as valor 
FROM clientes WHERE estado IS NOT NULL OR prioridad IS NOT NULL;
