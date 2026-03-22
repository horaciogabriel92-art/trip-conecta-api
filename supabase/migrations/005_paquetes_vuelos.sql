-- ============================================
-- MIGRACIÓN: Agregar información de vuelos a paquetes
-- Fecha: 23 Marzo 2026
-- ============================================

-- 1. Agregar columna vuelos JSONB a la tabla paquetes
ALTER TABLE paquetes 
ADD COLUMN IF NOT EXISTS vuelos jsonb DEFAULT '[]'::jsonb;

-- 2. Índice para búsquedas por fecha de vuelo
CREATE INDEX IF NOT EXISTS idx_paquetes_vuelos ON paquetes USING GIN (vuelos jsonb_path_ops);

-- ============================================
-- DOCUMENTACIÓN DE ESTRUCTURA
-- ============================================

/*
ESTRUCTURA DEL CAMPO vuelos (array):

[
  {
    "tipo": "ida",
    "aerolinea_codigo": "UX",
    "aerolinea_nombre": "Air Europa",
    "numero_vuelo": "046",
    "origen_codigo": "MVD",
    "origen_nombre": "Montevideo",
    "destino_codigo": "MAD",
    "destino_nombre": "Madrid",
    "fecha_salida": "2026-05-16",
    "hora_salida": "12:20",
    "hora_llegada": "05:10",
    "clase": "Económica",
    "escalas": 0,
    "notas": "Vuelo directo"
  },
  {
    "tipo": "vuelta",
    "aerolinea_codigo": "UX",
    "aerolinea_nombre": "Air Europa",
    "numero_vuelo": "047",
    "origen_codigo": "MAD",
    "origen_nombre": "Madrid",
    "destino_codigo": "MVD",
    "destino_nombre": "Montevideo",
    "fecha_salida": "2026-05-23",
    "hora_salida": "14:30",
    "hora_llegada": "02:20",
    "clase": "Económica",
    "escalas": 0,
    "notas": ""
  }
]

- tipo: "ida" o "vuelta" (obligatorio)
- aerolinea_codigo: Código IATA de 2 caracteres (opcional)
- aerolinea_nombre: Nombre completo de la aerolínea (opcional)
- numero_vuelo: Número del vuelo (opcional)
- origen_codigo: Código IATA del origen (obligatorio)
- origen_nombre: Nombre de la ciudad de origen (obligatorio)
- destino_codigo: Código IATA del destino (obligatorio)
- destino_nombre: Nombre de la ciudad de destino (obligatorio)
- fecha_salida: Fecha del vuelo en formato YYYY-MM-DD (obligatorio)
- hora_salida: Hora de salida en formato HH:MM (opcional)
- hora_llegada: Hora de llegada en formato HH:MM (opcional)
- clase: Clase del vuelo (Económica, Business, etc.) (opcional)
- escalas: Número de escalas (opcional, default 0)
- notas: Notas adicionales sobre el vuelo (opcional)
*/

-- ============================================
-- EJEMPLOS DE QUERIES ÚTILES
-- ============================================

-- Buscar paquetes con vuelo a Madrid:
-- SELECT * FROM paquetes 
-- WHERE vuelos @> '[{"destino_codigo": "MAD"}]'::jsonb;

-- Buscar paquetes con fecha de salida específica:
-- SELECT * FROM paquetes 
-- WHERE vuelos @> '[{"tipo": "ida", "fecha_salida": "2026-05-16"}]'::jsonb;
