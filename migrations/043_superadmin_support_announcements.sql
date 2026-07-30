-- Migración 043: Panel de control global (ernestosplace)
-- Tablas: superadmins, support_tickets, announcements, announcement_reads

-- =====================================================
-- 1. Superadmins
-- =====================================================
CREATE TABLE IF NOT EXISTS superadmins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  rol VARCHAR(50) NOT NULL CHECK (rol IN ('superadmin', 'support')),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. Support tickets
-- =====================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  nombre_agencia VARCHAR(255) NOT NULL,
  asunto VARCHAR(255) NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  mensaje TEXT NOT NULL,
  adjunto_url TEXT,
  estado VARCHAR(50) DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
  prioridad VARCHAR(50) DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  respuesta TEXT,
  respondido_por UUID REFERENCES superadmins(id) ON DELETE SET NULL,
  respondido_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_estado ON support_tickets(estado);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);

-- Replies
CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE,
  superadmin_id UUID REFERENCES superadmins(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mensaje TEXT NOT NULL,
  es_interno BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket ON support_ticket_replies(ticket_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. Announcements
-- =====================================================
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo VARCHAR(255) NOT NULL,
  mensaje TEXT NOT NULL,
  tipo VARCHAR(50) DEFAULT 'info' CHECK (tipo IN ('info', 'warning', 'success')),
  activo BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES superadmins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_announcements_activo ON announcements(activo, expires_at);

-- =====================================================
-- 4. Announcement reads
-- =====================================================
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES users(id) ON DELETE CASCADE,
  leido_en TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (announcement_id, usuario_id)
);
