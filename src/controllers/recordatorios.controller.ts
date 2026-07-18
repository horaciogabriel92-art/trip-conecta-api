import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { sendEmailAsync, getAdminEmails } from '../services/email.service';
import { crearNotificacionInterna } from '../services/notificaciones.service';
import { getTenantId } from '../utils/tenant';

// ============================================
// RECORDATORIOS CONTROLLER
// ============================================

export const getRecordatorios = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    const { cliente_id, estado, vencidos } = req.query;

    try {
        let query = supabase
            .from('recordatorios')
            .select(`
                id, titulo, descripcion, fecha_recordatorio, estado, fecha_completado,
                notificacion_enviada, fecha_creacion,
                cliente:cliente_id(id, nombre, apellido, email),
                cotizacion:cotizacion_id(id, codigo, destino_principal),
                vendedor:vendedor_id(id, nombre, email),
                asignado:asignado_a(id, nombre, email)
            `)
            .eq('tenant_id', tenantId);

        // Filtros
        if (user.role !== 'admin') {
            // Vendedor ve los suyos (creados por él o asignados a él)
            query = query.or(`vendedor_id.eq.${user.userId},asignado_a.eq.${user.userId}`);
        }

        if (cliente_id) {
            query = query.eq('cliente_id', cliente_id as string);
        }

        if (estado) {
            query = query.eq('estado', estado as string);
        }

        if (vencidos === 'true') {
            const ahora = new Date().toISOString();
            query = query.lt('fecha_recordatorio', ahora).eq('estado', 'pendiente');
        }

        const { data, error } = await query
            .order('fecha_recordatorio', { ascending: true });

        if (error) {
            console.error('Error fetching recordatorios:', error);
            return res.status(500).json({ error: 'Error al obtener recordatorios' });
        }

        res.json({ recordatorios: data || [] });
    } catch (error: any) {
        console.error('Error in getRecordatorios:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getRecordatorioById = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;

    try {
        const { data, error } = await supabase
            .from('recordatorios')
            .select(`
                id, titulo, descripcion, fecha_recordatorio, estado, fecha_completado,
                notificacion_enviada, fecha_creacion, vendedor_id, asignado_a,
                cliente:cliente_id(id, nombre, apellido, email),
                cotizacion:cotizacion_id(id, codigo, destino_principal),
                vendedor:vendedor_id(id, nombre, email),
                asignado:asignado_a(id, nombre, email)
            `)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Recordatorio no encontrado' });
        }

        // Verificar permisos
        if (user.role !== 'admin' && data.vendedor_id !== user.userId && data.asignado_a !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        res.json(data);
    } catch (error: any) {
        console.error('Error in getRecordatorioById:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createRecordatorio = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { titulo, descripcion, cliente_id, cotizacion_id, asignado_a, fecha_recordatorio } = req.body;
    const user = (req as any).user;

    if (!titulo || !fecha_recordatorio) {
        return res.status(400).json({ error: 'titulo y fecha_recordatorio son requeridos' });
    }

    try {
        const { data, error } = await supabase
            .from('recordatorios')
            .insert({
                titulo,
                descripcion: descripcion || null,
                cliente_id: cliente_id || null,
                cotizacion_id: cotizacion_id || null,
                vendedor_id: user.userId,
                asignado_a: asignado_a || user.userId,
                fecha_recordatorio,
                estado: 'pendiente',
                tenant_id: tenantId
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating recordatorio:', error);
            return res.status(500).json({ error: 'Error al crear recordatorio' });
        }

        res.status(201).json({ recordatorio: data, message: 'Recordatorio creado exitosamente' });
    } catch (error: any) {
        console.error('Error in createRecordatorio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateRecordatorio = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { titulo, descripcion, fecha_recordatorio, estado, asignado_a } = req.body;
    const user = (req as any).user;

    try {
        // Verificar que existe y tiene permisos
        const { data: existing, error: existingError } = await supabase
            .from('recordatorios')
            .select('vendedor_id, asignado_a')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (existingError || !existing) {
            return res.status(404).json({ error: 'Recordatorio no encontrado' });
        }

        if (user.role !== 'admin' && existing.vendedor_id !== user.userId && existing.asignado_a !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const updateData: any = {};
        if (titulo !== undefined) updateData.titulo = titulo;
        if (descripcion !== undefined) updateData.descripcion = descripcion;
        if (fecha_recordatorio !== undefined) updateData.fecha_recordatorio = fecha_recordatorio;
        if (estado !== undefined) {
            updateData.estado = estado;
            if (estado === 'completado') {
                updateData.fecha_completado = new Date().toISOString();
            }
        }
        if (asignado_a !== undefined) updateData.asignado_a = asignado_a;

        const { data, error } = await supabase
            .from('recordatorios')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating recordatorio:', error);
            return res.status(500).json({ error: 'Error al actualizar recordatorio' });
        }

        res.json({ recordatorio: data, message: 'Recordatorio actualizado' });
    } catch (error: any) {
        console.error('Error in updateRecordatorio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteRecordatorio = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;

    try {
        // Verificar permisos
        const { data: existing, error: existingError } = await supabase
            .from('recordatorios')
            .select('vendedor_id')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (existingError || !existing) {
            return res.status(404).json({ error: 'Recordatorio no encontrado' });
        }

        if (user.role !== 'admin' && existing.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const { error } = await supabase
            .from('recordatorios')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', id);

        if (error) {
            console.error('Error deleting recordatorio:', error);
            return res.status(500).json({ error: 'Error al eliminar recordatorio' });
        }

        res.json({ message: 'Recordatorio eliminado' });
    } catch (error: any) {
        console.error('Error in deleteRecordatorio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ============================================
// JOB: Enviar recordatorios por email
// ============================================

export const sendRecordatorioReminders = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const secret = req.headers['x-cron-secret'];
    if (secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const ahora = new Date();
        const manana = new Date(ahora);
        manana.setDate(manana.getDate() + 1);

        // Buscar recordatorios pendientes que vencen hoy o mañana y no se notificaron
        const { data: recordatorios, error } = await supabase
            .from('recordatorios')
            .select(`
                id, titulo, descripcion, fecha_recordatorio,
                vendedor_id, asignado_a,
                cliente:cliente_id(nombre, apellido, email),
                vendedor:vendedor_id(email, nombre),
                asignado:asignado_a(email, nombre)
            `)
            .eq('tenant_id', tenantId)
            .eq('estado', 'pendiente')
            .eq('notificacion_enviada', false)
            .lte('fecha_recordatorio', manana.toISOString());

        if (error) {
            console.error('Error fetching recordatorios:', error);
            return res.status(500).json({ error: 'Error fetching recordatorios' });
        }

        let enviados = 0;
        const fallidos: string[] = [];

        for (const rec of (recordatorios || [])) {
            const asignado = (rec as any).asignado;
            const vendedor = (rec as any).vendedor;
            const cliente = (rec as any).cliente;

            const destinatario = asignado?.email || vendedor?.email;
            const nombreDestinatario = asignado?.nombre || vendedor?.nombre || 'Vendedor';

            if (!destinatario) {
                fallidos.push(rec.id);
                continue;
            }

            const fechaFormateada = new Date(rec.fecha_recordatorio).toLocaleDateString('es-ES', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            const clienteNombre = cliente 
                ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() 
                : 'Cliente';

            try {
                await sendEmailAsync({
                    to: destinatario,
                    subject: `⏰ Recordatorio: ${rec.titulo}`,
                    templateName: 'recordatorio-tarea',
                    variables: {
                        nombre: nombreDestinatario,
                        titulo: rec.titulo,
                        descripcion: rec.descripcion || 'Sin descripción',
                        clienteNombre,
                        fechaRecordatorio: fechaFormateada,
                        linkPanel: `${process.env.FRONTEND_URL || 'https://panel.tripconecta.com'}/dashboard`
                    }
                });

                // Notificación in-app (campanita) para el asignado o el vendedor
                const usuarioDestino = (rec as any).asignado_a || (rec as any).vendedor_id || null;
                await crearNotificacionInterna({
                    tenantId,
                    usuario_id: usuarioDestino,
                    tipo: 'sistema',
                    titulo: `Recordatorio: ${rec.titulo}`,
                    mensaje: `${rec.descripcion || 'Tienes un recordatorio pendiente'} — Cliente: ${clienteNombre} — ${fechaFormateada}`,
                    referencia_id: rec.id,
                    referencia_tipo: 'recordatorio'
                });

                // Marcar como notificado
                await supabase
                    .from('recordatorios')
                    .update({ notificacion_enviada: true })
                    .eq('tenant_id', tenantId)
                    .eq('id', rec.id);

                enviados++;
            } catch (err) {
                console.error(`Error enviando recordatorio ${rec.id}:`, err);
                fallidos.push(rec.id);
            }
        }

        res.json({
            message: 'Recordatorios procesados',
            total: (recordatorios || []).length,
            enviados,
            fallidos: fallidos.length
        });
    } catch (error: any) {
        console.error('Error in sendRecordatorioReminders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
