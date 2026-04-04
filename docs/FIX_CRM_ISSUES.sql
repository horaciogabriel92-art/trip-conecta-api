-- Fix para issues del CRM
-- 1. Agregar columna es_privada a notas_cliente
-- 2. Verificar todas las columnas necesarias

-- Verificar si la columna es_privada existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notas_cliente' AND column_name = 'es_privada'
    ) THEN
        ALTER TABLE notas_cliente ADD COLUMN es_privada BOOLEAN DEFAULT false;
        RAISE NOTICE 'Columna es_privada agregada';
    ELSE
        RAISE NOTICE 'Columna es_privada ya existe';
    END IF;
END $$;

-- Verificar estructura completa de notas_cliente
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'notas_cliente'
ORDER BY ordinal_position;

-- Refrescar schema cache de PostgREST (si aplica)
-- Esto se hace automáticamente al reiniciar el servicio
