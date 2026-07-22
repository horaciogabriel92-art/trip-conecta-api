-- Migration: 036_cliente_vendedores.sql
-- Rastrea qué vendedores han tocado un cliente para control de visibilidad.

BEGIN;

-- 1. Tabla de asociación cliente ↔ vendedor
CREATE TABLE IF NOT EXISTS public.cliente_vendedores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  vendedor_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, vendedor_id)
);

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_cliente_vendedores_cliente_id ON public.cliente_vendedores(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_vendedores_vendedor_id ON public.cliente_vendedores(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_cliente_vendedores_tenant_id ON public.cliente_vendedores(tenant_id);

-- 3. Poblar asociaciones iniciales desde clientes.registrado_por
INSERT INTO public.cliente_vendedores (cliente_id, vendedor_id, tenant_id)
SELECT  c.id,
        c.registrado_por,
        c.tenant_id
FROM    public.clientes c
WHERE   c.registrado_por IS NOT NULL
ON CONFLICT (cliente_id, vendedor_id) DO NOTHING;

-- 4. RLS
ALTER TABLE public.cliente_vendedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendedores ven sus asociaciones de clientes" ON public.cliente_vendedores;
CREATE POLICY "Vendedores ven sus asociaciones de clientes"
  ON public.cliente_vendedores
  FOR ALL
  TO public
  USING (
    vendedor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.rol = 'admin'
    )
  );

COMMIT;
