-- ============================================
-- FIX: Estados correctos para el pipeline
-- Estados: nueva, enviada, vendida, perdida
-- ============================================

-- 1. Eliminar constraint existente si existe
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;

-- 2. Agregar constraint con los estados correctos del pipeline
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check 
    CHECK (estado IN ('nueva', 'enviada', 'vendida', 'perdida'));

-- 3. Actualizar estados existentes al nuevo formato
UPDATE cotizaciones SET estado = 'nueva' WHERE estado = 'pendiente' OR estado IS NULL;
UPDATE cotizaciones SET estado = 'enviada' WHERE estado = 'respondida';
UPDATE cotizaciones SET estado = 'vendida' WHERE estado = 'convertida';
UPDATE cotizaciones SET estado = 'perdida' WHERE estado = 'cancelada' OR estado = 'vencida';

-- 4. Verificar estructura final
SELECT DISTINCT estado, COUNT(*) as cantidad 
FROM cotizaciones 
GROUP BY estado;
