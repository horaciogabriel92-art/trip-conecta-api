import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[ 1];

    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
        const decoded: any = jwt.verify(token, JWT_SECRET);

        // Buscar usuario en BD para validar token_version y estado
        const { data: user, error } = await supabase
            .from('users')
            .select('id, tenant_id, rol, permisos, activo, token_version')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            return res.status(403).json({ error: 'Token inválido o usuario no encontrado' });
        }

        if (!user.activo) {
            return res.status(403).json({ error: 'Usuario desactivado' });
        }

        const tokenVersion = decoded.tokenVersion ?? 0;
        if ((user.token_version || 0) !== tokenVersion) {
            return res.status(403).json({ error: 'Sesión inválida. Iniciá sesión nuevamente.' });
        }

        // Fallback para tokens viejos sin tenantId o permisos
        if (!decoded.tenantId || !decoded.permisos) {
            if (user?.tenant_id) {
                decoded.tenantId = user.tenant_id;
            }
            if (user?.permisos) {
                decoded.permisos = user.permisos;
            } else if (user?.rol) {
                decoded.permisos = user.rol === 'admin'
                    ? {
                        ver_todas_cotizaciones: true,
                        ver_todas_ventas: true,
                        ver_reportes: true,
                        gestionar_paquetes: true,
                        ver_comisiones_otros: true,
                        editar_clientes_otros: true
                      }
                    : {
                        ver_todas_cotizaciones: false,
                        ver_todas_ventas: false,
                        ver_reportes: false,
                        gestionar_paquetes: true,
                        ver_comisiones_otros: false,
                        editar_clientes_otros: false
                      };
            }
        }

        (req as any).user = decoded;
        next();
    } catch (err: any) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
};

export const authorizeRole = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;
        if (!user || !roles.includes(user.role)) {
            return res.status(403).json({ error: 'No tienes permisos para realizar esta acción' });
        }
        next();
    };
};
