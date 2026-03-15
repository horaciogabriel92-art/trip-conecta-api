import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this-in-prod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Buscar usuario en Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.activo) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    // Actualizar último acceso
    await supabase
      .from('users')
      .update({ ultimo_acceso: new Date().toISOString() })
      .eq('id', user.id);

    // Generar JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.rol 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        rol: user.rol,
        comision_porcentaje: user.comision_porcentaje
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, telefono, rol, comision_porcentaje, fecha_registro')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { nombre, apellido, telefono } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({ nombre, apellido, telefono })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Admin: Crear nuevo vendedor
export const createUser = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { email, password, nombre, apellido, rol, comision_porcentaje } = req.body;

    // Hash de contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert({
        email,
        password: hashedPassword,
        nombre,
        apellido,
        rol: rol || 'vendedor',
        comision_porcentaje: comision_porcentaje || 12
      })
      .select()
      .single();

    if (error) {
      if (error.message.includes('duplicate')) {
        return res.status(400).json({ error: 'El email ya está registrado' });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: data.id,
        email: data.email,
        nombre: data.nombre,
        apellido: data.apellido,
        rol: data.rol
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Admin: Listar todos los usuarios
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, telefono, rol, comision_porcentaje, activo, fecha_registro, ultimo_acceso')
      .order('fecha_registro', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(users);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
