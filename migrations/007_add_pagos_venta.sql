-- ============================================
-- MIGRACIÓN: Historial de pagos de venta + recordatorios
-- ============================================

-- 1. Tabla de historial de pagos
CREATE TABLE IF NOT EXISTS public.pagos_venta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id UUID REFERENCES public.ventas(id) ON DELETE CASCADE,
  cotizacion_id UUID REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  medio_pago VARCHAR(100),
  fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE,
  observaciones TEXT,
  tipo VARCHAR(20) DEFAULT 'adicional' CHECK (tipo IN ('inicial', 'adicional')),
  comprobante_url TEXT,
  registrado_por UUID REFERENCES public.users(id),
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_venta_venta ON public.pagos_venta(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_venta_cotizacion ON public.pagos_venta(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_pagos_venta_fecha ON public.pagos_venta(fecha_pago);

-- 2. Campo para evitar spam de recordatorios
ALTER TABLE public.cotizaciones
ADD COLUMN IF NOT EXISTS ultimo_recordatorio_enviado DATE;
