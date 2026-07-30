import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { supabase } from '../config/supabase';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const loginSuperadmin = async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const { data: superadmin, error } = await supabase
      .from('superadmins')
      .select('id, email, password, nombre, rol, activo')
      .eq('email', email)
      .single();

    if (error || !superadmin) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(password, superadmin.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!superadmin.activo) {
      return res.status(401).json({ error: 'Cuenta desactivada' });
    }

    const token = jwt.sign(
      {
        userId: superadmin.id,
        email: superadmin.email,
        role: superadmin.rol
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: superadmin.id,
        email: superadmin.email,
        nombre: superadmin.nombre,
        rol: superadmin.rol
      }
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Superadmin Login] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const superadmin = (req as any).superadmin;
    res.json({
      id: superadmin.userId,
      email: superadmin.email,
      nombre: superadmin.nombre,
      rol: superadmin.role
    });
  } catch (error) {
    console.error('[Superadmin Me] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
