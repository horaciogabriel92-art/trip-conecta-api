-- ============================================
-- MIGRACIÓN: Soporte para Cotizaciones Manuales
-- Fecha: 21 Marzo 2026
-- ============================================

-- 1. Agregar campo tipo_cotizacion para distinguir origen
ALTER TABLE cotizaciones 
ADD COLUMN IF NOT EXISTS tipo_cotizacion varchar(20) DEFAULT 'paquete' 
CHECK (tipo_cotizacion IN ('paquete', 'manual'));

-- 2. Campos JSONB para datos estructurados
ALTER TABLE cotizaciones 
ADD COLUMN IF NOT EXISTS vuelos jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS hospedaje jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS datos_completos jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS incluye jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS no_incluye jsonb DEFAULT '[]'::jsonb;

-- 2b. Campo para nombre de la cotización (manual)
ALTER TABLE cotizaciones 
ADD COLUMN IF NOT EXISTS nombre_cotizacion varchar(255);

-- 3. Campo texto para itinerario libre
ALTER TABLE cotizaciones 
ADD COLUMN IF NOT EXISTS itinerario_manual text;

-- 4. Actualizar registros existentes (marcar como tipo 'paquete')
UPDATE cotizaciones 
SET tipo_cotizacion = 'paquete' 
WHERE tipo_cotizacion IS NULL;

-- 5. Índices para búsquedas eficientes en JSONB
CREATE INDEX IF NOT EXISTS idx_cotizaciones_tipo ON cotizaciones(tipo_cotizacion);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_vuelos ON cotizaciones USING GIN (vuelos jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_datos ON cotizaciones USING GIN (datos_completos jsonb_path_ops);

-- ============================================
-- DOCUMENTACIÓN DE ESTRUCTURA JSONB
-- ============================================

/*
ESTRUCTURA DE CAMPOS JSONB:

1. vuelos (array)
[
  {
    "linea": 1,
    "aerolinea_codigo": "UX",
    "aerolinea_nombre": "Air Europa",
    "numero_vuelo": "046",
    "clase_codigo": "T",
    "fecha_salida": "2026-05-16",
    "hora_salida": "12:20",
    "hora_llegada": "05:10",
    "origen_codigo": "MVD",
    "origen_nombre": "Carrasco International Airport",
    "origen_ciudad": "Montevideo",
    "destino_codigo": "MAD",
    "destino_nombre": "Adolfo Suárez Madrid–Barajas Airport",
    "destino_ciudad": "Madrid",
    "estado_codigo": "DK",
    "asientos": 1,
    "aeronave": "789"
  }
]

2. hospedaje (array)
[
  {
    "id": 1,
    "nombre_hotel": "Hotel Ibis Madrid",
    "ciudad": "Madrid",
    "fecha_checkin": "2026-05-17",
    "fecha_checkout": "2026-05-20",
    "noches": 3,
    "tipo_habitacion": "doble",
    "regimen": "desayuno"
  }
]

3. datos_completos (objeto)
{
  "cliente": {
    "nombre": "Juan",
    "apellido": "Pérez",
    "documento": "12345678",
    "email": "juan@email.com",
    "telefono": "099123456",
    "fecha_nacimiento": "1990-05-15",
    "nacionalidad": "Uruguay"
  },
  "pasajeros": [
    {
      "nombre": "María",
      "apellido": "Gómez",
      "documento": "87654321"
    }
  ]
}

4. incluye / no_incluye (arrays de strings)
["Aéreos ida y vuelta", "Hospedaje", "Traslados"]
["Gastos personales", "Propinas"]
*/

-- ============================================
-- EJEMPLOS DE QUERIES ÚTILES
-- ============================================

-- Buscar cotizaciones que incluyen vuelo a Madrid:
-- SELECT * FROM cotizaciones 
-- WHERE vuelos @> '[{"destino_codigo": "MAD"}]'::jsonb;

-- Buscar cotizaciones de cliente específico:
-- SELECT * FROM cotizaciones 
-- WHERE datos_completos->'cliente'->>'email' = 'juan@email.com';

-- Listar todas las cotizaciones manuales:
-- SELECT * FROM cotizaciones WHERE tipo_cotizacion = 'manual';
