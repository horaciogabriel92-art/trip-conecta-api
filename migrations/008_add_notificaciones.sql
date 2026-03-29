/* ============================================
   MIGRACION: Sistema de Notificaciones
   Fecha: 2026-03-22
   ============================================ */

-- Tabla de notificaciones
CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('nueva_venta', 'nueva_cotizacion', 'pago_recibido', 'comprobante_subido', 'sistema')),
  titulo VARCHAR(255) NOT NULL,
  mensaje TEXT NOT NULL,
  data JSONB,
  leida BOOLEAN DEFAULT FALSE,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_leida TIMESTAMP WITH TIME ZONE
);

-- Indices para rendimiento
CREATE INDEX IF NOT EXISTS idx_notificaciones_user_id ON notificaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida ON notificaciones(leida);
CREATE INDEX IF NOT EXISTS idx_notificaciones_fecha ON notificaciones(fecha_creacion DESC);

-- Vista para contar notificaciones no leidas por usuario
CREATE OR REPLACE VIEW notificaciones_no_leidas_count AS
SELECT 
  user_id,
  COUNT(*) as total
FROM notificaciones
WHERE leida = FALSE
GROUP BY user_id;

-- Funcion para crear notificacion automatica al generar venta
CREATE OR REPLACE FUNCTION notificar_nueva_venta()
RETURNS TRIGGER AS $$
DECLARE
  vendedor_nombre TEXT;
  cliente_nombre TEXT;
BEGIN
  SELECT u.nombre INTO vendedor_nombre
  FROM users u WHERE u.id = NEW.vendedor_id;
  
  cliente_nombre := NEW.cliente_nombre;
  
  INSERT INTO notificaciones (
    user_id,
    tipo,
    titulo,
    mensaje,
    data
  ) VALUES (
    NULL,
    'nueva_venta',
    'Nueva Venta Realizada',
    vendedor_nombre || ' vendio a ' || cliente_nombre || ' por $' || NEW.precio_total::TEXT,
    jsonb_build_object(
      'venta_id', NEW.id,
      'cotizacion_id', NEW.cotizacion_id,
      'vendedor_id', NEW.vendedor_id,
      'vendedor_nombre', vendedor_nombre,
      'cliente_nombre', cliente_nombre,
      'monto', NEW.precio_total,
      'paquete_nombre', NEW.paquete_nombre
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para notificar en cada nueva venta
DROP TRIGGER IF EXISTS trg_notificar_nueva_venta ON ventas;
CREATE TRIGGER trg_notificar_nueva_venta
  AFTER INSERT ON ventas
  FOR EACH ROW
  EXECUTE FUNCTION notificar_nueva_venta();

-- Permisos (comentados - ejecutar manualmente si es necesario)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON notificaciones TO authenticated;
-- GRANT USAGE, SELECT ON SEQUENCE notificaciones_id_seq TO authenticated;
