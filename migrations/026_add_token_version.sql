-- Agrega token_version para invalidación de sesiones
-- Cuando cambia password, rol o estado del usuario, se incrementa token_version
-- y los tokens JWT existentes quedan inválidos.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;

-- Asegurar que todos los usuarios existentes tengan token_version = 0
UPDATE users SET token_version = 0 WHERE token_version IS NULL;

-- Comentario en la columna para documentación
COMMENT ON COLUMN users.token_version IS 'Se incrementa al cambiar password, rol o activo para invalidar tokens JWT previos';
