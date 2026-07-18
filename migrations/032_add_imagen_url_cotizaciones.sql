-- Agrega imagen_url a cotizaciones para la imagen de portada de la cotización
-- La columna es opcional; las cotizaciones existentes quedan con NULL.

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS imagen_url text;

-- Comentario en la columna para documentación
COMMENT ON COLUMN cotizaciones.imagen_url IS 'URL de la imagen de portada de la cotización (opcional)';
