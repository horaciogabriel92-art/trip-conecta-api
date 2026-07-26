-- Tabla de cruceros asociados a cotizaciones manuales
CREATE TABLE IF NOT EXISTS cruceros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    nombre varchar(255) NOT NULL,
    compania varchar(255),
    barco varchar(255),
    puerto_embarque varchar(255),
    puerto_desembarque varchar(255),
    fecha_embarque date,
    fecha_desembarque date,
    cabina varchar(100),
    tipo_habitacion varchar(50),
    regimen varchar(100),
    precio_por_persona numeric(12,2),
    moneda varchar(10) DEFAULT 'USD',
    incluido boolean DEFAULT true,
    es_opcion boolean DEFAULT false,
    seleccionado boolean DEFAULT false,
    notas text,
    orden integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cruceros_cotizacion ON cruceros(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_cruceros_tenant ON cruceros(tenant_id);
