import { Request } from 'express';

const DEFAULT_TRIP_CONECTA_TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * Extrae el tenantId del usuario autenticado.
 * Si no existe (tokens viejos), devuelve el tenant por defecto de Trip Conecta.
 */
export const getTenantId = (req: Request): string => {
    const user = (req as any).user;
    return user?.tenantId || DEFAULT_TRIP_CONECTA_TENANT;
};
