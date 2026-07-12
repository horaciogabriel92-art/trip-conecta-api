-- Migración 014: ampliar servicios de cotización (alojamientos, traslados, seguros, extras)

-- ============================================================
-- 1. EXTENDER tabla hospedajes para soportar opciones y alias
-- ============================================================
ALTER TABLE hospedajes
    ADD COLUMN IF NOT EXISTS tipo_alojamiento VARCHAR(50),
    ADD COLUMN IF NOT EXISTS nombre_alojamiento VARCHAR(255),
    ADD COLUMN IF NOT EXISTS es_opcion BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS seleccionado BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS precio_por_persona NUMERIC(12, 2);

-- ============================================================
-- 2. CREAR tabla traslados / transfers
-- ============================================================
CREATE TABLE IF NOT EXISTS traslados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    origen VARCHAR(255),
    destino VARCHAR(255),
    fecha DATE,
    hora VARCHAR(10),
    precio_por_persona NUMERIC(12, 2),
    moneda VARCHAR(10) DEFAULT 'USD',
    notas TEXT,
    orden INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traslados_cotizacion ON traslados(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_traslados_tenant ON traslados(tenant_id);

-- ============================================================
-- 3. CREAR tabla seguros
-- ============================================================
CREATE TABLE IF NOT EXISTS seguros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    compania VARCHAR(255) NOT NULL,
    tipo_cobertura VARCHAR(255),
    cobertura_detalle TEXT,
    fecha_inicio DATE,
    fecha_fin DATE,
    precio_por_persona NUMERIC(12, 2),
    moneda VARCHAR(10) DEFAULT 'USD',
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seguros_cotizacion ON seguros(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_seguros_tenant ON seguros(tenant_id);

-- ============================================================
-- 4. CREAR tabla extras
-- ============================================================
CREATE TABLE IF NOT EXISTS extras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha DATE,
    precio_por_persona NUMERIC(12, 2),
    moneda VARCHAR(10) DEFAULT 'USD',
    incluido BOOLEAN DEFAULT true,
    orden INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extras_cotizacion ON extras(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_extras_tenant ON extras(tenant_id);
