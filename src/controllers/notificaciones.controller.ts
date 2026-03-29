import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * Obtener notificaciones del usuario actual
 * Para admins: obtiene todas las notificaciones (user_id IS NULL)
 * Para vendedores: obtiene sus notificaciones específicas
 */
export const getNotificaciones = async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    try {
        let query = supabase
            .from('notificaciones')
            .select('*')
            .order('fecha_creacion', { ascending: false })
            .limit(50);
        
        if (user.role === 'admin') {
            // Admin ve notificaciones globales (user_id IS NULL) 
            // O podríamos hacer que vea todas incluyendo las específicas
            query = query.is('user_id', null);
        } else {
            // Vendedor ve sus notificaciones específicas
            query = query.eq('user_id', user.userId);
        }
        
        const { data: notificaciones, error } = await query;
        
        if (error) {
            console.error('[getNotificaciones] Error:', error);
            return res.status(500).json({ error: 'Error al obtener notificaciones' });
        }
        
        // Contar no leídas
        const noLeidas = notificaciones?.filter((n: any) => !n.leida).length || 0;
        
        res.json({
            notificaciones: notificaciones || [],
            no_leidas: noLeidas
        });
    } catch (error: any) {
        console.error('[getNotificaciones] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Marcar notificación como leída
 */
export const marcarLeida = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Verificar que la notificación existe y el usuario tiene permiso
        const { data: notif, error: findError } = await supabase
            .from('notificaciones')
            .select('*')
            .eq('id', id)
            .single();
        
        if (findError || !notif) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }
        
        // Verificar permisos
        if (notif.user_id !== null && notif.user_id !== user.userId && user.role !== 'admin') {
            return res.status(403).json({ error: 'No tiene permisos para esta notificación' });
        }
        
        const { data, error } = await supabase
            .from('notificaciones')
            .update({ 
                leida: true, 
                fecha_leida: new Date().toISOString() 
            })
            .eq('id', id)
            .select()
            .single();
        
        if (error) {
            console.error('[marcarLeida] Error:', error);
            return res.status(500).json({ error: 'Error al marcar notificación' });
        }
        
        res.json(data);
    } catch (error: any) {
        console.error('[marcarLeida] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Marcar todas las notificaciones como leídas
 */
export const marcarTodasLeidas = async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    try {
        let query = supabase
            .from('notificaciones')
            .update({ 
                leida: true, 
                fecha_leida: new Date().toISOString() 
            })
            .eq('leida', false);
        
        if (user.role === 'admin') {
            query = query.is('user_id', null);
        } else {
            query = query.eq('user_id', user.userId);
        }
        
        const { error } = await query;
        
        if (error) {
            console.error('[marcarTodasLeidas] Error:', error);
            return res.status(500).json({ error: 'Error al marcar notificaciones' });
        }
        
        res.json({ message: 'Todas las notificaciones marcadas como leídas' });
    } catch (error: any) {
        console.error('[marcarTodasLeidas] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Crear notificación manual (solo admin)
 */
export const crearNotificacion = async (req: Request, res: Response) => {
    const { user_id, tipo, titulo, mensaje, data } = req.body;
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo admins pueden crear notificaciones' });
    }
    
    try {
        const { data: notif, error } = await supabase
            .from('notificaciones')
            .insert({
                user_id: user_id || null,
                tipo: tipo || 'sistema',
                titulo,
                mensaje,
                data: data || {}
            })
            .select()
            .single();
        
        if (error) {
            console.error('[crearNotificacion] Error:', error);
            return res.status(500).json({ error: 'Error al crear notificación' });
        }
        
        res.status(201).json(notif);
    } catch (error: any) {
        console.error('[crearNotificacion] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
