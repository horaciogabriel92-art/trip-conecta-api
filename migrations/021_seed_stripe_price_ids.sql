-- ============================================
-- MIGRACIÓN 021: Asociar price IDs de Stripe a los planes
-- ============================================
-- IMPORTANTE: Estos IDs deben coincidir con los creados en el dashboard de Stripe.
-- Si los price IDs cambian (por ejemplo, al pasar de modo test a producción),
-- actualizar esta migración o ejecutar los UPDATE manualmente.

UPDATE plans SET stripe_price_id = 'price_1TsooBRr2MaTaO2AWHhSHqXx' WHERE slug = 'freelance';
UPDATE plans SET stripe_price_id = 'price_1TsoomRr2MaTaO2AzR5npBBi' WHERE slug = 'pro-agencia';
UPDATE plans SET stripe_price_id = 'price_1TsopuRr2MaTaO2AowjZwg72' WHERE slug = 'pro-ilimitado';

-- El plan Free no requiere price_id porque no se cobra.
UPDATE plans SET stripe_price_id = NULL WHERE slug = 'free';
