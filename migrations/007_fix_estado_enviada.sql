-- ============================================
-- FIX: Estado 'respondida' y columna fecha_envio
-- ============================================

-- 1. Verificar y agregar columna fecha_envio si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'cotizaciones' AND column_name = 'fecha_envio'
    ) THEN
        ALTER TABLE cotizaciones ADD COLUMN fecha_envio TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- 2. Verificar y agregar columna estado si no existe (con valores por defecto)
DO $$
BEGIN
    -- Verificar si existe el constraint
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'cotizaciones' 
        AND constraint_name = 'cotizaciones_estado_check'
    ) THEN
        -- Eliminar el constraint existente
        ALTER TABLE cotizaciones DROP CONSTRAINT cotizaciones_estado_check;
    END IF;
    
    -- Agregar el constraint con todos los estados permitidos
    ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check 
        CHECK (estado IN ('pendiente', 'respondida', 'convertida', 'vencida', 'cancelada'));
END $$;

-- 3. Verificar y establecer valores por defecto
UPDATE cotizaciones 
SET estado = 'pendiente' 
WHERE estado IS NULL OR estado NOT IN ('pendiente', 'respondida', 'convertida', 'vencida', 'cancelada');

-- 4. Verificar estructura final
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'cotizaciones' 
ORDER BY ordinal_position;
