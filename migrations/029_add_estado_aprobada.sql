-- ============================================
-- MIGRACIÓN 029: Agregar estado 'aprobada' a cotizaciones
-- ============================================
-- Permite el estado 'aprobada' para flujos de agencia donde
-- un admin debe aprobar la venta antes de emitir.

ALTER TABLE cotizaciones
    DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;

ALTER TABLE cotizaciones
    ADD CONSTRAINT cotizaciones_estado_check
    CHECK (estado IN ('nueva', 'enviada', 'vendida', 'perdida', 'aprobada'));
