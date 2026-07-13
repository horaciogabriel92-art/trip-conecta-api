/**
 * Genera la URL pública absoluta para un comprobante de pago.
 * Si API_BASE_URL no está configurada, devuelve la ruta relativa.
 */
export function getComprobantePublicUrl(rutaArchivo: string): string {
  const baseUrl = process.env.API_BASE_URL || process.env.API_URL || '';
  const path = `/uploads/comprobantes/${rutaArchivo}`;
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }
  return path;
}
