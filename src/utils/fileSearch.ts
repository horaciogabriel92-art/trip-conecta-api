import fs from 'fs';
import path from 'path';

/**
 * Busca un archivo de comprobante en múltiples rutas posibles.
 * Útil cuando el mount de storage puede variar entre ambientes
 * o cuando archivos legacy quedaron en rutas diferentes.
 */
export function findComprobanteFile(filename: string): string | null {
  const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
  const basename = path.basename(filename);

  const possiblePaths = [
    path.join(uploadDir, 'comprobantes', basename),
    path.join('/app/storage/uploads', 'comprobantes', basename),
    path.join('/data/trip-conecta/uploads', 'comprobantes', basename),
    path.join(process.cwd(), 'storage', 'uploads', 'comprobantes', basename),
    path.join(process.cwd(), 'comprobantes', basename),
    path.join('/app/dist/storage/uploads', 'comprobantes', basename),
    path.join('/app/dist/comprobantes', basename),
    path.join('/usr/src/app/storage/uploads', 'comprobantes', basename),
  ];

  for (const tryPath of possiblePaths) {
    if (fs.existsSync(tryPath)) {
      return tryPath;
    }
  }
  return null;
}
