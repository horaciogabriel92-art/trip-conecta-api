-- ============================================
-- MIGRACIÓN 017: Actualizar estado de suscripción del tenant Trip Conecta
-- ============================================
-- Trip Conecta es un cliente VIP Pro y no debería estar en trial.

UPDATE public.tenants
SET 
    estado_suscripcion = 'activo',
    trial_ends_at = NULL
WHERE id = '11111111-1111-1111-1111-111111111111';
