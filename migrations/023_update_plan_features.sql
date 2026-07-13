-- ============================================
-- MIGRACIÓN 023: Actualizar features y descripciones de planes
-- ============================================
-- Alinea los planes con la página pública de precios de Quotix.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description VARCHAR(255);

UPDATE plans SET
  nombre = 'Gratis',
  description = 'Para empezar a cotizar',
  features = '{
    "pdf_cotizaciones": true,
    "crm_agentes": true,
    "kanban_cotizaciones": true,
    "emails_automaticos": true,
    "amadeus_pnr": true,
    "subdominio": false,
    "dominio_propio": false,
    "soporte_prioritario": false,
    "reportes": false,
    "comisiones_avanzado": false,
    "vouchers_documentos": false,
    "usuarios_extra": false
  }'::jsonb
WHERE slug = 'free';

UPDATE plans SET
  description = 'Para agentes independientes',
  features = '{
    "pdf_cotizaciones": true,
    "crm_agentes": true,
    "kanban_cotizaciones": true,
    "emails_automaticos": true,
    "amadeus_pnr": true,
    "subdominio": false,
    "dominio_propio": false,
    "soporte_prioritario": false,
    "reportes": false,
    "comisiones_avanzado": false,
    "vouchers_documentos": false,
    "usuarios_extra": false
  }'::jsonb
WHERE slug = 'freelance';

UPDATE plans SET
  description = 'Para agencias en crecimiento',
  features = '{
    "pdf_cotizaciones": true,
    "crm_agentes": true,
    "kanban_cotizaciones": true,
    "emails_automaticos": true,
    "amadeus_pnr": true,
    "subdominio": false,
    "dominio_propio": true,
    "soporte_prioritario": true,
    "reportes": true,
    "comisiones_avanzado": false,
    "vouchers_documentos": false,
    "usuarios_extra": true
  }'::jsonb
WHERE slug = 'pro-agencia';

UPDATE plans SET
  description = 'Para agencias que venden en serio',
  features = '{
    "pdf_cotizaciones": true,
    "crm_agentes": true,
    "kanban_cotizaciones": true,
    "emails_automaticos": true,
    "amadeus_pnr": true,
    "subdominio": false,
    "dominio_propio": true,
    "soporte_prioritario": true,
    "reportes": true,
    "comisiones_avanzado": true,
    "vouchers_documentos": true,
    "usuarios_extra": true
  }'::jsonb
WHERE slug = 'pro-ilimitado';

UPDATE plans SET
  description = 'Plan de prueba',
  features = '{
    "pdf_cotizaciones": true,
    "crm_agentes": true,
    "kanban_cotizaciones": true,
    "emails_automaticos": true,
    "amadeus_pnr": true,
    "subdominio": false,
    "dominio_propio": true,
    "soporte_prioritario": true,
    "reportes": true,
    "comisiones_avanzado": true,
    "vouchers_documentos": true,
    "usuarios_extra": true
  }'::jsonb
WHERE slug = 'test';
