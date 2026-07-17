-- Migración 031: Agregar notas internas a cotizaciones
-- Campo de texto libre para uso interno del vendedor/admin.
-- No se muestra en el PDF enviado al cliente.

ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS notas_internas TEXT;
