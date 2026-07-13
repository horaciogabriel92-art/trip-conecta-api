-- ============================================
-- MIGRACIÓN 022: Agregar plan de test de 1 USD
-- ============================================
-- Plan temporal para probar el flujo de compra con Stripe.

INSERT INTO plans (
  slug,
  nombre,
  max_users,
  max_cotizaciones_por_mes,
  max_paquetes,
  permite_dominio_propio,
  precio_mensual_usd,
  precio_usuario_extra_usd,
  activo,
  interval,
  stripe_price_id,
  features
)
VALUES (
  'test',
  'Test',
  2,
  100,
  5,
  false,
  1.00,
  10.00,
  true,
  'month',
  'price_1TsqHORr2MaTaO2AoSH5PYT1',
  '{"comisiones": true, "vendedor_autoconfirma": true, "dominio_propio": false}'
)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  max_users = EXCLUDED.max_users,
  max_cotizaciones_por_mes = EXCLUDED.max_cotizaciones_por_mes,
  max_paquetes = EXCLUDED.max_paquetes,
  permite_dominio_propio = EXCLUDED.permite_dominio_propio,
  precio_mensual_usd = EXCLUDED.precio_mensual_usd,
  precio_usuario_extra_usd = EXCLUDED.precio_usuario_extra_usd,
  activo = EXCLUDED.activo,
  interval = EXCLUDED.interval,
  stripe_price_id = EXCLUDED.stripe_price_id,
  features = EXCLUDED.features;
