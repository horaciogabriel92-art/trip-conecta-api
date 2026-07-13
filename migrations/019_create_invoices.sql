-- ============================================
-- MIGRACIÓN 019: Tabla de invoices/pagos locales
-- ============================================
-- Registro local de pagos recibidos desde Stripe.

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  amount_subtotal_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_total_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'usd',
  status VARCHAR(50) NOT NULL CHECK (status IN ('paid', 'unpaid', 'void', 'refunded', 'open')),
  billing_reason VARCHAR(100),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  plan_slug VARCHAR(50),
  description TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice_id ON invoices(stripe_invoice_id);

COMMENT ON TABLE invoices IS 'Registro local de pagos e invoices generados por Stripe';
