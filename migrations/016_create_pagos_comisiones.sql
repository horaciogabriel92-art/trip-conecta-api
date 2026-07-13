-- ============================================
-- MIGRACIÓN 016: Crear tabla pagos_comisiones
-- ============================================
-- La tabla no existía en schema.sql ni en migraciones anteriores,
-- a pesar de que la migración 010 intentaba alterarla.

CREATE TABLE IF NOT EXISTS public.pagos_comisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  venta_id UUID NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  metodo_pago VARCHAR(100),
  referencia_pago VARCHAR(255),
  pagado_por UUID REFERENCES public.users(id),
  notas TEXT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fecha_pago TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_tenant ON public.pagos_comisiones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_vendedor ON public.pagos_comisiones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_venta ON public.pagos_comisiones(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_fecha ON public.pagos_comisiones(fecha_pago);
