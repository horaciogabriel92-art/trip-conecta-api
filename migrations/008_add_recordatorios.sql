-- ============================================
-- MIGRACION 008: Tabla de Recordatorios/Seguimientos
-- ============================================

CREATE TABLE IF NOT EXISTS recordatorios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo VARCHAR(255) NOT NULL,
  descripcion TEXT,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  cotizacion_id UUID REFERENCES cotizaciones(id) ON DELETE SET NULL,
  vendedor_id UUID NOT NULL REFERENCES users(id),
  asignado_a UUID REFERENCES users(id),
  fecha_recordatorio TIMESTAMP WITH TIME ZONE NOT NULL,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado', 'cancelado')),
  fecha_completado TIMESTAMP WITH TIME ZONE,
  notificacion_enviada BOOLEAN DEFAULT false,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_recordatorios_cliente ON recordatorios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_vendedor ON recordatorios(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_asignado ON recordatorios(asignado_a);
CREATE INDEX IF NOT EXISTS idx_recordatorios_estado ON recordatorios(estado);
CREATE INDEX IF NOT EXISTS idx_recordatorios_fecha ON recordatorios(fecha_recordatorio);
CREATE INDEX IF NOT EXISTS idx_recordatorios_notificacion ON recordatorios(notificacion_enviada, estado, fecha_recordatorio);
