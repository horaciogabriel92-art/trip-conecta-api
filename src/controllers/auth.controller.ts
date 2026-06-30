import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { z } from 'zod';
import { sendEmailAsync } from '../services/email.service';
import { getTenantId } from '../utils/tenant';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('❌ CRITICAL: JWT_SECRET environment variable is required');
}

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
      .eq('tenant_id', user.tenant_id)
      .eq('id', user.id);

    // Generar JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.rol,
        tenantId: user.tenant_id
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        rol: user.rol,
        tenant_id: user.tenant_id,
        comision_porcentaje: user.comision_porcentaje,
        preferencias: user.preferencias || {}
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getProfile = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.userId;
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, telefono, rol, comision_porcentaje, preferencias, fecha_registro')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
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
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.userId;
    const { nombre, apellido, telefono, preferencias } = req.body;

    const updateData: any = { nombre, apellido, telefono };
    if (preferencias !== undefined) {
      const { data: current } = await supabase
        .from('users')
        .select('preferencias')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .single();
      updateData.preferencias = { ...(current?.preferencias || {}), ...preferencias };
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .eq('tenant_id', tenantId)
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
    const tenantId = getTenantId(req);
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
        comision_porcentaje: comision_porcentaje || null,
        tenant_id: tenantId
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

// Admin: Actualizar usuario existente
export const updateUser = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { id } = req.params;
    const { nombre, apellido, telefono, email, comision_porcentaje, activo, password } = req.body;

    // Si se cambia el email, verificar que no esté en uso por otro usuario
    if (email) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .eq('tenant_id', tenantId)
        .neq('id', id)
        .single();

      if (existingUser) {
        return res.status(409).json({ error: 'El email ya está registrado por otro usuario' });
      }
    }

    const updateData: any = {
      nombre,
      apellido,
      telefono,
      email,
      comision_porcentaje,
      activo
    };

    if (password && password.length >= 6) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: {
        id: data.id,
        email: data.email,
        nombre: data.nombre,
        apellido: data.apellido,
        rol: data.rol,
        comision_porcentaje: data.comision_porcentaje,
        activo: data.activo,
        telefono: data.telefono
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Admin: Listar todos los usuarios
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, telefono, rol, comision_porcentaje, activo, fecha_registro, ultimo_acceso')
      .eq('tenant_id', tenantId)
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

export const changePassword = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Contraseña actual requerida y nueva contraseña de al menos 6 caracteres' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('password')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId)
      .eq('tenant_id', tenantId);

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ======================
// RECUPERACIÓN DE CONTRASEÑA
// ======================

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6)
});

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const { data: user } = await supabase
      .from('users')
      .select('id, email, nombre, apellido, tenant_id')
      .eq('email', email)
      .single();

    // Siempre responder éxito para evitar enumeración de emails
    if (!user) {
      return res.json({ message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await supabase
      .from('users')
      .update({
        reset_token: token,
        reset_token_expires: expiresAt.toISOString()
      })
      .eq('tenant_id', user.tenant_id)
      .eq('id', user.id);

    const resetLink = `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/login/reset-password?token=${token}`;

    await sendEmailAsync({
      to: user.email,
      subject: `Recuperación de contraseña - ${process.env.EMAIL_FROM_NAME || 'Quotixos'}`,
      templateName: 'password-reset',
      variables: {
        nombre: `${user.nombre || ''} ${user.apellido || ''}`.trim() || 'Usuario',
        resetLink
      },
      metadata: { tipo: 'password_reset', user_id: user.id }
    });

    res.json({ message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);

    const { data: user, error } = await supabase
      .from('users')
      .select('id, reset_token, reset_token_expires, tenant_id')
      .eq('reset_token', token)
      .single();

    if (error || !user) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    const now = new Date();
    const expires = new Date(user.reset_token_expires);

    if (now > expires) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await supabase
      .from('users')
      .update({
        password: hashedPassword,
        reset_token: null,
        reset_token_expires: null
      })
      .eq('tenant_id', user.tenant_id)
      .eq('id', user.id);

    res.json({ message: 'Contraseña restablecida exitosamente' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
