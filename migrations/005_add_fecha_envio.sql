-- Agregar columna fecha_envio a cotizaciones
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_envio TIMESTAMP WITH TIME ZONE;

-- Actualizar los estados permitidos para incluir 'respondida'
-- Primero eliminamos el constraint existente
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;

-- Creamos el nuevo constraint con los estados correctos
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check 
    CHECK (estado IN ('pendiente', 'respondida', 'convertida', 'vencida', 'cancelada'));
