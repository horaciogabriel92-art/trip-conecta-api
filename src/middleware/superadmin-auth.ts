import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

export interface SuperadminPayload {
  userId: string;
  email: string;
  role: 'superadmin' | 'support';
  iat?: number;
  exp?: number;
}

export const authenticateSuperadmin = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'superadmin' && decoded.role !== 'support') {
      return res.status(403).json({ error: 'Token no válido para panel de control' });
    }

    const { data: superadmin, error } = await supabase
      .from('superadmins')
      .select('id, email, nombre, rol, activo')
      .eq('id', decoded.userId)
      .single();

    if (error || !superadmin) {
      return res.status(403).json({ error: 'Superadmin no encontrado' });
    }

    if (!superadmin.activo) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    (req as any).superadmin = {
      userId: superadmin.id,
      email: superadmin.email,
      nombre: superadmin.nombre,
      role: superadmin.rol
    };

    next();
  } catch (err: any) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

export const requireSuperadmin = (req: Request, res: Response, next: NextFunction) => {
  const superadmin = (req as any).superadmin;
  if (!superadmin || superadmin.role !== 'superadmin') {
    return res.status(403).json({ error: 'Requiere rol superadmin' });
  }
  next();
};
