-- Agrega flag incluido a hospedajes para distinguir alojamiento fijo vs opcional
ALTER TABLE hospedajes
ADD COLUMN IF NOT EXISTS incluido BOOLEAN DEFAULT true;

UPDATE hospedajes SET incluido = true WHERE incluido IS NULL;

-- Normalizar legacy: registros que NO son opción quedan como incluidos
UPDATE hospedajes SET incluido = false WHERE es_opcion = true;

CREATE INDEX IF NOT EXISTS idx_hospedajes_incluido ON hospedajes(incluido);
