-- ============================================
-- MIGRACIÓN 024: Agregar fechas de renovación y monto próxima factura
-- ============================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_renewal_date timestamptz,
  ADD COLUMN IF NOT EXISTS next_invoice_amount_usd numeric(10, 2);
