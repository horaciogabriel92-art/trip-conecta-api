-- =====================================================
-- MIGRACIÓN: Recrear tabla cotizaciones según Doc 05
-- Estrategia: Borrar y recrear (no hay datos en prod)
-- =====================================================

-- 1. BORRAR tablas dependientes primero (para evitar errores de FK)
DROP TABLE IF EXISTS cotizacion_pasajeros CASCADE;
DROP TABLE IF EXISTS vuelos CASCADE;
DROP TABLE IF EXISTS hospedajes CASCADE;
DROP TABLE IF EXISTS historial_cliente CASCADE;
DROP TABLE IF EXISTS pasajeros CASCADE;

-- 2. BORRAR tabla cotizaciones vieja
DROP TABLE IF EXISTS cotizaciones CASCADE;

-- 3. CREAR tabla cotizaciones NUEVA (Doc 05)
CREATE TABLE cotizaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar UNIQUE NOT NULL,
    
    -- Relaciones clave
    cliente_id uuid NOT NULL REFERENCES clientes(id),
    vendedor_id uuid NOT NULL REFERENCES users(id),
    paquete_id uuid REFERENCES paquetes(id),
    
    -- Estado y fechas
    estado varchar DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'convertida', 'vencida', 'cancelada')),
    fecha_creacion timestamptz DEFAULT now(),
    fecha_expiracion timestamptz,
    fecha_conversion timestamptz,
    fecha_envio timestamptz,
    
    -- Datos de la cotización
    nombre_cotizacion varchar,
    tipo_cotizacion varchar DEFAULT 'manual' CHECK (tipo_cotizacion IN ('paquete', 'manual')),
    origen_datos varchar DEFAULT 'manual' CHECK (origen_datos IN ('manual', 'amadeus_pnr')),
    
    -- Precios
    precio_total numeric NOT NULL,
    precio_moneda varchar DEFAULT 'USD' CHECK (precio_moneda IN ('USD', 'UYU', 'EUR')),
    comision_vendedor numeric,
    
    -- Datos del paquete (copia inmutable)
    paquete_data jsonb,
    itinerario jsonb,
    notas text,
    
    -- Metadata
    destino_principal varchar,
    num_pasajeros integer DEFAULT 1
);

-- 4. CREAR índices
CREATE INDEX idx_cotizaciones_cliente ON cotizaciones(cliente_id);
CREATE INDEX idx_cotizaciones_vendedor ON cotizaciones(vendedor_id);
CREATE INDEX idx_cotizaciones_estado ON cotizaciones(estado);
CREATE INDEX idx_cotizaciones_fecha ON cotizaciones(fecha_creacion DESC);
CREATE INDEX idx_cotizaciones_destino ON cotizaciones(destino_principal);

-- 5. CREAR tabla pasajeros (si no existe)
CREATE TABLE IF NOT EXISTS pasajeros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_titular_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo_documento varchar DEFAULT 'CI',
    documento varchar NOT NULL,
    nombre varchar NOT NULL,
    apellido varchar NOT NULL,
    fecha_nacimiento date,
    nacionalidad varchar DEFAULT 'Uruguay',
    es_cliente_registrado boolean DEFAULT false,
    cliente_id uuid REFERENCES clientes(id),
    fecha_registro timestamptz DEFAULT now(),
    notas text,
    UNIQUE(cliente_titular_id, tipo_documento, documento)
);

CREATE INDEX IF NOT EXISTS idx_pasajeros_titular ON pasajeros(cliente_titular_id);

-- 6. CREAR tabla cotizacion_pasajeros (join table)
CREATE TABLE IF NOT EXISTS cotizacion_pasajeros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    pasajero_id uuid NOT NULL REFERENCES pasajeros(id),
    es_titular boolean DEFAULT false,
    nombre_snapshot varchar NOT NULL,
    apellido_snapshot varchar NOT NULL,
    documento_snapshot varchar,
    tipo_habitacion varchar CHECK (tipo_habitacion IN ('simple', 'doble', 'triple', 'cuadruple', 'suite')),
    regimen varchar CHECK (regimen IN ('solo_alojamiento', 'desayuno', 'media_pension', 'todo_incluido')),
    precio_individual numeric,
    UNIQUE(cotizacion_id, pasajero_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_cotizacion ON cotizacion_pasajeros(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_cp_pasajero ON cotizacion_pasajeros(pasajero_id);

-- 7. CREAR tabla vuelos
CREATE TABLE IF NOT EXISTS vuelos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    tipo_trayecto varchar CHECK (tipo_trayecto IN ('ida', 'vuelta', 'conexion')),
    orden integer DEFAULT 1,
    aerolinea_codigo varchar,
    aerolinea_nombre varchar,
    numero_vuelo varchar,
    origen_codigo varchar,
    origen_nombre varchar,
    origen_terminal varchar,
    destino_codigo varchar,
    destino_nombre varchar,
    destino_terminal varchar,
    fecha_salida date,
    hora_salida time,
    fecha_llegada date,
    hora_llegada time,
    clase_codigo varchar,
    clase_nombre varchar,
    duracion_minutos integer,
    es_escala boolean DEFAULT false,
    datos_completos jsonb
);

CREATE INDEX IF NOT EXISTS idx_vuelos_cotizacion ON vuelos(cotizacion_id);

-- 8. CREAR tabla hospedajes
CREATE TABLE IF NOT EXISTS hospedajes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cotizacion_id uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    nombre_hotel varchar NOT NULL,
    link_hotel varchar,
    cadena_hotelera varchar,
    ciudad varchar NOT NULL,
    pais varchar,
    direccion text,
    fecha_checkin date NOT NULL,
    fecha_checkout date NOT NULL,
    noches integer GENERATED ALWAYS AS (fecha_checkout - fecha_checkin) STORED,
    tipo_habitacion varchar CHECK (tipo_habitacion IN ('simple', 'doble', 'triple', 'cuadruple', 'suite')),
    regimen varchar CHECK (regimen IN ('solo_alojamiento', 'desayuno', 'media_pension', 'todo_incluido')),
    precio_noche numeric,
    precio_total numeric,
    moneda varchar DEFAULT 'USD',
    notas text
);

-- 9. CREAR tabla historial_cliente
CREATE TABLE IF NOT EXISTS historial_cliente (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo varchar NOT NULL CHECK (tipo IN (
        'cotizacion_creada', 'cotizacion_modificada', 'cotizacion_enviada', 
        'cotizacion_convertida', 'venta_confirmada', 'llamada_entrante', 
        'llamada_saliente', 'email_enviado', 'email_recibido', 'whatsapp', 
        'nota_interna', 'documento_subido', 'estado_cambiado'
    )),
    cotizacion_id uuid REFERENCES cotizaciones(id),
    venta_id uuid REFERENCES ventas(id),
    descripcion text NOT NULL,
    detalle jsonb,
    realizado_por uuid REFERENCES users(id),
    realizado_por_nombre varchar,
    fecha timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hc_cliente ON historial_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_hc_fecha ON historial_cliente(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_hc_tipo ON historial_cliente(tipo);
