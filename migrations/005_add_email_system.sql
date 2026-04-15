-- ============================================
-- MIGRACIÓN: Sistema de Emails y Notificaciones
-- ============================================

-- 1. Tabla de log y cola de notificaciones email
CREATE TABLE IF NOT EXISTS public.notificaciones_email (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(50) NOT NULL,
  destinatario_email VARCHAR(255) NOT NULL,
  asunto VARCHAR(255) NOT NULL,
  cuerpo_html TEXT,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  error TEXT,
  intentos INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  enviado_en TIMESTAMP WITH TIME ZONE,
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_estado ON public.notificaciones_email(estado);
CREATE INDEX IF NOT EXISTS idx_notificaciones_tipo ON public.notificaciones_email(tipo);
CREATE INDEX IF NOT EXISTS idx_notificaciones_destinatario ON public.notificaciones_email(destinatario_email);

ALTER TABLE public.notificaciones_email ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to authenticated users"
ON public.notificaciones_email
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 2. Campos para recuperación de contraseña en users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP WITH TIME ZONE;
