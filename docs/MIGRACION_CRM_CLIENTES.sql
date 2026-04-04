-- ============================================
-- MIGRACIÓN: CRM Clientes Extendido + Notas + RLS
-- Fecha: Marzo 2026
-- Ejecutado por: Usuario
-- ============================================

-- ============================================
-- 1. AGREGAR COLUMNAS A TABLA CLIENTES
-- ============================================

-- Información de contacto extendida
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS telefono_alt varchar(20),
ADD COLUMN IF NOT EXISTS email_alt varchar(100),
ADD COLUMN IF NOT EXISTS whatsapp varchar(20),
ADD COLUMN IF NOT EXISTS fecha_nacimiento date;

-- Preferencias de viaje (JSONB para flexibilidad)
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS preferencias_viaje jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS temporada_preferida varchar(20) CHECK (temporada_preferida IN ('verano', 'invierno', 'primavera', 'otono', 'cualquiera'));

-- Metadata de CRM
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS fuente_lead varchar(50),
ADD COLUMN IF NOT EXISTS referido_por uuid REFERENCES public.clientes(id),
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Estado y segmentación
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS prioridad varchar(10) DEFAULT 'media' CHECK (prioridad IN ('alta', 'media', 'baja')),
ADD COLUMN IF NOT EXISTS fecha_proximo_viaje_ideal date,
ADD COLUMN IF NOT EXISTS estado varchar(20) DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo', 'prospecto', 'cliente_perdido', 'potencial'));

-- Auditoría adicional
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS tags_actualizados_at timestamptz,
ADD COLUMN IF NOT EXISTS preferencias_actualizadas_at timestamptz;

-- ============================================
-- 2. CREAR TABLA DE NOTAS DE CLIENTE
-- ============================================

CREATE TABLE IF NOT EXISTS public.notas_cliente (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    vendedor_id uuid NOT NULL REFERENCES public.users(id),
    contenido text NOT NULL,
    tipo varchar(20) DEFAULT 'general' CHECK (tipo IN ('general', 'llamada', 'email', 'whatsapp', 'reunion', 'sistema')),
    es_privada boolean DEFAULT false,  -- Notas privadas solo visibles por el creador y admin
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_notas_cliente_cliente_id ON public.notas_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_notas_cliente_vendedor_id ON public.notas_cliente(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_notas_cliente_created_at ON public.notas_cliente(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notas_cliente_tipo ON public.notas_cliente(tipo);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_notas_cliente_updated_at ON public.notas_cliente;
CREATE TRIGGER update_notas_cliente_updated_at
    BEFORE UPDATE ON public.notas_cliente
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. ÍNDICES ADICIONALES PARA CLIENTES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_clientes_estado ON public.clientes(estado);
CREATE INDEX IF NOT EXISTS idx_clientes_prioridad ON public.clientes(prioridad);
CREATE INDEX IF NOT EXISTS idx_clientes_fuente_lead ON public.clientes(fuente_lead);
CREATE INDEX IF NOT EXISTS idx_clientes_fecha_nacimiento ON public.clientes(fecha_nacimiento);
CREATE INDEX IF NOT EXISTS idx_clientes_referido_por ON public.clientes(referido_por);

-- Índice GIN para búsquedas en arrays (tags)
CREATE INDEX IF NOT EXISTS idx_clientes_tags ON public.clientes USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_clientes_preferencias ON public.clientes USING gin(preferencias_viaje);

-- ============================================
-- 4. RLS (ROW LEVEL SECURITY) - SEGURIDAD
-- ============================================

-- CLIENTES
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven sus clientes" ON public.clientes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.cotizaciones c
            WHERE c.cliente_id = clientes.id
            AND c.vendedor_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- COTIZACIONES
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven sus cotizaciones" ON public.cotizaciones
    FOR ALL USING (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- VENTAS
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven sus ventas" ON public.ventas
    FOR ALL USING (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- COMPROBANTES
ALTER TABLE public.comprobantes_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven comprobantes de sus cotizaciones" ON public.comprobantes_pago
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.cotizaciones c
            WHERE c.id = comprobantes_pago.cotizacion_id
            AND c.vendedor_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- VOUCHERS
ALTER TABLE public.documentos_viaje ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven documentos de sus ventas" ON public.documentos_viaje
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.ventas v
            WHERE v.id = documentos_viaje.venta_id
            AND v.vendedor_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- PAGOS DE COMISIONES
ALTER TABLE public.pagos_comisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendedores ven sus pagos" ON public.pagos_comisiones
    FOR SELECT USING (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- NOTAS DE CLIENTE
ALTER TABLE public.notas_cliente ENABLE ROW LEVEL SECURITY;

-- Política SELECT: Vendedores ven notas públicas de sus clientes + sus propias notas privadas
CREATE POLICY "Vendedores ven notas de sus clientes" ON public.notas_cliente
    FOR SELECT USING (
        -- Notas públicas de clientes asignados
        (
            es_privada = false
            AND EXISTS (
                SELECT 1 FROM public.clientes c
                JOIN public.cotizaciones cot ON cot.cliente_id = c.id
                WHERE cot.vendedor_id = auth.uid()
                AND c.id = notas_cliente.cliente_id
            )
        )
        -- Notas privadas solo si es el creador
        OR (
            es_privada = true 
            AND vendedor_id = auth.uid()
        )
        -- Admin ve todo
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- Política INSERT: Solo pueden crear notas asignadas a ellos mismos
CREATE POLICY "Vendedores crean notas" ON public.notas_cliente
    FOR INSERT WITH CHECK (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

-- Política UPDATE/DELETE: Solo el creador o admin pueden modificar/eliminar
CREATE POLICY "Vendedores actualizan sus notas" ON public.notas_cliente
    FOR UPDATE USING (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

CREATE POLICY "Vendedores eliminan sus notas" ON public.notas_cliente
    FOR DELETE USING (
        vendedor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users WHERE id = auth.uid() AND rol = 'admin'
        )
    );

COMMENT ON TABLE public.notas_cliente IS 'Notas y seguimiento de interacciones con clientes';

-- ============================================
-- NOTA IMPORTANTE
-- ============================================
-- Después de activar RLS, el backend debe usar
-- SUPABASE_SERVICE_ROLE_KEY en lugar de la anon key
-- para operaciones administrativas.
