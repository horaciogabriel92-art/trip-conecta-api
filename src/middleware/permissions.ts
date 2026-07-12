import { Request, Response, NextFunction } from 'express';

export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    // Admin always has all permissions
    if (user.role === 'admin') {
      return next();
    }

    if (user.permisos?.[permission] === true) {
      return next();
    }

    return res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
  };
};

export const hasPermission = (user: any, permission: string): boolean => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.permisos?.[permission] === true;
};
