-- Agrega flag de visibilidad independiente del estado operativo
ALTER TABLE paquetes
ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT true;

UPDATE paquetes SET visible = true WHERE visible IS NULL;

CREATE INDEX IF NOT EXISTS idx_paquetes_visible ON paquetes(visible);
