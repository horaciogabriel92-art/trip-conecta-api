-- Migración 030: Agregar fecha_salida a cotizaciones
-- La tabla fue recreada en 006 sin esta columna y el backend la utiliza.

ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS fecha_salida DATE;
