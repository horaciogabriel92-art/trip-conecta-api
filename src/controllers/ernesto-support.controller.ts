import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { sendEmailAsync } from '../services/email.service';
import { deleteTicketAttachments } from './support-tickets.controller';

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  estado: z.enum(['abierto', 'en_proceso', 'resuelto', 'cerrado']).optional(),
  prioridad: z.enum(['baja', 'media', 'alta', 'urgente']).optional(),
  tenant_id: z.string().uuid().optional(),
  search: z.string().optional(),
});

const updateSchema = z.object({
  estado: z.enum(['abierto', 'en_proceso', 'resuelto', 'cerrado']).optional(),
  prioridad: z.enum(['baja', 'media', 'alta', 'urgente']).optional(),
});

const replySchema = z.object({
  mensaje: z.string().min(2).max(5000),
  es_interno: z.boolean().optional(),
  notificar_email: z.boolean().optional(),
});

function ticketSelect() {
  return `
    id,
    tenant_id,
    usuario_id,
    email,
    nombre,
    nombre_agencia,
    asunto,
    categoria,
    mensaje,
    adjunto_url,
    estado,
    prioridad,
    created_at,
    updated_at,
    tenants:tenant_id (nombre, slug, email_contacto)
  `;
}

export const listTickets = async (req: Request, res: Response) => {
  try {
    const { page, limit, estado, prioridad, tenant_id, search } = listQuerySchema.parse(req.query);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('support_tickets')
      .select(ticketSelect(), { count: 'exact' });

    if (estado) query = query.eq('estado', estado);
    if (prioridad) query = query.eq('prioridad', prioridad);
    if (tenant_id) query = query.eq('tenant_id', tenant_id);
    if (search) {
      query = query.or(`asunto.ilike.%${search}%,mensaje.ilike.%${search}%,email.ilike.%${search}%,nombre.ilike.%${search}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[Ernesto Support] List error:', error);
      return res.status(500).json({ error: 'Error al listar tickets', details: error.message });
    }

    res.json({
      tickets: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Parámetros inválidos', details: error.errors });
    }
    console.error('[Ernesto Support] List error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select(ticketSelect())
      .eq('id', id)
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const { data: replies, error: repliesError } = await supabase
      .from('support_ticket_replies')
      .select('id, superadmin_id, usuario_id, mensaje, es_interno, created_at, superadmins(nombre), users(nombre, apellido)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (repliesError) {
      console.error('[Ernesto Support] Replies error:', repliesError);
    }

    const { data: adjuntos, error: adjuntosError } = await supabase
      .from('support_ticket_attachments')
      .select('id, file_name, file_url, content_type, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (adjuntosError) {
      console.error('[Ernesto Support] Attachments error:', adjuntosError);
    }

    res.json({ ticket, replies: replies || [], adjuntos: adjuntos || [] });
  } catch (error: any) {
    console.error('[Ernesto Support] Get error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const updateTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = updateSchema.parse(req.body);

    const { data: previous } = await supabase.from('support_tickets').select('estado').eq('id', id).single();

    const { data, error } = await supabase
      .from('support_tickets')
      .update(body)
      .eq('id', id)
      .select(ticketSelect())
      .single();

    if (error) {
      console.error('[Ernesto Support] Update error:', error);
      return res.status(500).json({ error: 'Error al actualizar ticket', details: error.message });
    }

    // Si se cierra el ticket, eliminar adjuntos
    if (previous?.estado !== 'cerrado' && body.estado === 'cerrado') {
      await deleteTicketAttachments(String(id));
    }

    res.json({ ticket: data });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Support] Update error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const replyTicket = async (req: Request, res: Response) => {
  try {
    const superadmin = (req as any).superadmin;
    const { id } = req.params;
    const body = replySchema.parse(req.body);

    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('id, email, asunto, estado, tenant_id, nombre')
      .eq('id', id)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const { data: reply, error } = await supabase
      .from('support_ticket_replies')
      .insert({
        ticket_id: id,
        superadmin_id: superadmin.userId,
        mensaje: body.mensaje,
        es_interno: body.es_interno || false,
      })
      .select()
      .single();

    if (error) {
      console.error('[Ernesto Support] Reply error:', error);
      return res.status(500).json({ error: 'Error al responder ticket', details: error.message });
    }

    // Actualizar ticket si no es interno
    if (!body.es_interno) {
      const updates: any = { respuesta: body.mensaje, respondido_por: superadmin.userId, respondido_en: new Date().toISOString() };
      if (ticket.estado === 'abierto') updates.estado = 'en_proceso';
      await supabase.from('support_tickets').update(updates).eq('id', id);

      // Notificar por email
      if (body.notificar_email !== false) {
        const panelUrl = process.env.PANEL_URL || 'https://travel.quotixos.com';
        sendEmailAsync({
          to: ticket.email,
          subject: `Respuesta a tu consulta: ${ticket.asunto}`,
          templateName: 'respuesta-ticket',
          variables: {
            nombre: ticket.nombre,
            asunto: ticket.asunto,
            mensaje: body.mensaje,
            linkPanel: `${panelUrl}/ayuda`,
          },
          metadata: { tipo: 'respuesta_ticket', tenant_id: ticket.tenant_id, ticket_id: id },
        }).catch((err) => console.error('[Ernesto Support] Email error:', err));
      }
    }

    res.status(201).json({ reply });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Support] Reply error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
