-- ============================================
-- MIGRACIÓN 028: Mejoras en pricing de cotización
-- ============================================
-- Agrega soporte para:
-- - Múltiples monedas (ya eran VARCHAR, se asegura longitud)
-- - Margen de agencia (costo neto vs precio final)
-- - Previsualización de comisión de vendedor
-- - Opción de mostrar/ocultar desglose en PDF

-- 1. Asegurar longitud de moneda
ALTER TABLE cotizaciones
    ALTER COLUMN precio_moneda TYPE VARCHAR(10);

-- 2. Campos de margen y comisión
ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS costo_neto NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS margen_agencia_monto NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS margen_agencia_porcentaje NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS comision_vendedor_porcentaje NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS comision_vendedor_monto_estimado NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS mostrar_desglose_pdf BOOLEAN DEFAULT true;

-- 3. Indices útiles
CREATE INDEX IF NOT EXISTS idx_cotizaciones_mostrar_desglose ON cotizaciones(mostrar_desglose_pdf);
