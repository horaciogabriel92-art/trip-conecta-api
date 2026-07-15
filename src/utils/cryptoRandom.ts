import crypto from 'crypto';

/**
 * Genera un string numérico aleatorio criptográficamente seguro.
 * @param length Cantidad de dígitos
 */
export function randomDigits(length: number): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  const range = max - min + 1;
  const bits = Math.ceil(Math.log2(range) * 8);
  const bytes = crypto.randomBytes(bits);
  const num = bytes.readUIntBE(0, Math.min(bits, 6));
  return (min + (num % range)).toString().padStart(length, '0');
}

/**
 * Genera un string alfanumérico aleatorio criptográficamente seguro.
 * @param length Longitud del string
 */
export function randomString(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

/**
 * Genera un sufijo único para nombres de archivo.
 */
export function uniqueFileSuffix(): string {
  return `${Date.now()}-${randomString(16)}`;
}
