-- Migración 033: Eliminar trigger/función rotos de la migración 008
--
-- La migración 008 creó la tabla notificaciones con columnas user_id/fecha_creacion/data
-- y un trigger trg_notificar_nueva_venta que inserta usando esos nombres.
-- La tabla viva usa usuario_id/created_at/referencia_*, por lo que el trigger
-- quedó incompatible. Además, las notificaciones de venta ahora se generan
-- desde el backend (notificaciones.service.ts), por lo que el trigger es innecesario.
--
-- Ejecutar en Supabase SQL Editor. Es idempotente (IF EXISTS).

-- 1) Verificación (opcional): debería devolver 0 o 1 fila
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_notificar_nueva_venta';

-- 2) Eliminar trigger y función
DROP TRIGGER IF EXISTS trg_notificar_nueva_venta ON ventas;
DROP FUNCTION IF EXISTS notificar_nueva_venta();
