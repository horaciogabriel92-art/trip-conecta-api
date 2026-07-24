-- ============================================
-- SCHEMA SUPABASE - TRIP CONECTA B2B
-- ============================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: users (Vendedores y Administradores)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  telefono VARCHAR(50),
  rol VARCHAR(20) DEFAULT 'vendedor' CHECK (rol IN ('admin', 'vendedor')),
  comision_porcentaje DECIMAL(5,2) DEFAULT 12.00,
  activo BOOLEAN DEFAULT true,
  fecha_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ultimo_acceso TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- TABLA: paquetes (Paquetes turísticos)
-- ============================================
CREATE TABLE IF NOT EXISTS paquetes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  destino VARCHAR(100) NOT NULL,
  descripcion TEXT,
  precio_base DECIMAL(10,2) NOT NULL,
  duracion_dias INTEGER NOT NULL,
  imagen_principal VARCHAR(500),
  galeria JSONB DEFAULT '[]',
  itinerario JSONB DEFAULT '[]',
  incluye JSONB DEFAULT '[]',
  no_incluye JSONB DEFAULT '[]',
  politicas_cancelacion TEXT,
  fecha_salida DATE,
  cupos_disponibles INTEGER DEFAULT 0,
  cupos_totales INTEGER DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'activo' CHECK (estado IN ('activo', 'completo', 'cancelado', 'eliminado')),
  visible BOOLEAN DEFAULT true,
  creado_por UUID REFERENCES users(id),
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: cotizaciones
-- ============================================
CREATE TABLE IF NOT EXISTS cotizaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  vendedor_id UUID NOT NULL REFERENCES users(id),
  cliente_nombre VARCHAR(200) NOT NULL,
  cliente_email VARCHAR(255),
  cliente_telefono VARCHAR(50),
  paquete_id UUID REFERENCES paquetes(id),
  fecha_salida DATE,
  num_pasajeros INTEGER NOT NULL DEFAULT 1,
  tipo_habitacion VARCHAR(50),
  precio_total DECIMAL(12,2),
  comision_vendedor DECIMAL(12,2),
  notas TEXT,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'convertida', 'vencida', 'cancelada')),
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_expiracion TIMESTAMP WITH TIME ZONE,
  fecha_conversion TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- TABLA: ventas
-- ============================================
CREATE TABLE IF NOT EXISTS ventas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  cotizacion_id UUID REFERENCES cotizaciones(id),
  vendedor_id UUID NOT NULL REFERENCES users(id),
  cliente_nombre VARCHAR(200) NOT NULL,
  cliente_email VARCHAR(255),
  cliente_telefono VARCHAR(50),
  paquete_id UUID REFERENCES paquetes(id),
  paquete_nombre VARCHAR(255),
  fecha_salida DATE,
  num_pasajeros INTEGER NOT NULL,
  precio_total DECIMAL(12,2) NOT NULL,
  comision_porcentaje DECIMAL(5,2) NOT NULL,
  comision_monto DECIMAL(12,2) NOT NULL,
  comision_estado VARCHAR(20) DEFAULT 'pendiente' CHECK (comision_estado IN ('pendiente', 'pagada')),
  fecha_pago_comision TIMESTAMP WITH TIME ZONE,
  metodo_pago VARCHAR(50),
  estado VARCHAR(20) DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'en_proceso', 'emitida', 'cancelada', 'reembolsada')),
  notas TEXT,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: documentos_viaje
-- ============================================
CREATE TABLE IF NOT EXISTS documentos_viaje (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('boleto_aereo', 'voucher_hotel', 'voucher_actividad', 'seguro', 'itinerario_final', 'e_ticket', 'boarding_pass', 'otro')),
  nombre_archivo VARCHAR(255) NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  descripcion TEXT,
  subido_por UUID REFERENCES users(id),
  fecha_subida TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: pagos_comisiones
-- ============================================
CREATE TABLE IF NOT EXISTS pagos_comisiones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venta_id UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
  metodo_pago VARCHAR(100),
  referencia_pago VARCHAR(255),
  pagado_por UUID REFERENCES users(id),
  notas TEXT,
  tenant_id UUID NOT NULL,
  fecha_pago TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ÍNDICES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_rol ON users(rol);
CREATE INDEX IF NOT EXISTS idx_paquetes_estado ON paquetes(estado);
CREATE INDEX IF NOT EXISTS idx_paquetes_destino ON paquetes(destino);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_vendedor ON cotizaciones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON ventas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
CREATE INDEX IF NOT EXISTS idx_documentos_venta ON documentos_viaje(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_tenant ON pagos_comisiones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_vendedor ON pagos_comisiones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_venta ON pagos_comisiones(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comisiones_fecha ON pagos_comisiones(fecha_pago);
