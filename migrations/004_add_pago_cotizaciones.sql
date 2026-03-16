-- Agregar campos de pago a cotizaciones
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS pago_realizado BOOLEAN DEFAULT FALSE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(12, 2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS tipo_pago VARCHAR(20); -- 'adelanto', 'total', 'pendiente'
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS medio_pago VARCHAR(50);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS observaciones_pago TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS comprobante_pago_url TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMP;

-- Crear tabla para comprobantes de pago (múltiples por cotización)
CREATE TABLE IF NOT EXISTS comprobantes_pago (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    vendedor_id UUID NOT NULL REFERENCES users(id),
    nombre_archivo VARCHAR(255) NOT NULL,
    ruta_archivo VARCHAR(500) NOT NULL,
    tipo_archivo VARCHAR(50) NOT NULL, -- 'imagen', 'pdf'
    tamaño_bytes INTEGER,
    descripcion TEXT,
    fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_comprobantes_cotizacion ON comprobantes_pago(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_vendedor ON comprobantes_pago(vendedor_id);

-- Actualizar ventas para heredar datos de pago desde cotización
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS pago_heredado BOOLEAN DEFAULT FALSE;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS monto_pagado_heredado DECIMAL(12, 2);
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tipo_pago_heredado VARCHAR(20);
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS observaciones_pago_heredado TEXT;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS comprobantes_pago_urls TEXT; -- JSON array de URLs
