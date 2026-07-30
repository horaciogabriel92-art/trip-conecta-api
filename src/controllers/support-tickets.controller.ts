import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';

const createTicketSchema = z.object({
  asunto: z.string().min(2).max(255),
  categoria: z.enum(['soporte_tecnico', 'facturacion', 'funcionalidad', 'error', 'otro']),
  mensaje: z.string().min(10).max(5000),
  adjunto_url: z.string().url().optional().nullable(),
  prioridad: z.enum(['baja', 'media', 'alta', 'urgente']).optional(),
});

const replySchema = z.object({
  mensaje: z.string().min(2).max(5000),
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
    respuesta,
    respondido_por,
    respondido_en,
    created_at,
    updated_at
  `;
}

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = createTicketSchema.parse(req.body);

    const { data: tenant } = await supabase
      .from('tenants')
      .select('nombre')
      .eq('id', user.tenantId)
      .single();

    const { data: userData } = await supabase
      .from('users')
      .select('nombre, apellido, email')
      .eq('id', user.userId)
      .single();

    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        tenant_id: user.tenantId,
        usuario_id: user.userId,
        email: userData?.email || user.email,
        nombre: `${userData?.nombre || ''} ${userData?.apellido || ''}`.trim() || user.email,
        nombre_agencia: tenant?.nombre || 'Sin agencia',
        asunto: body.asunto,
        categoria: body.categoria,
        mensaje: body.mensaje,
        adjunto_url: body.adjunto_url,
        prioridad: body.prioridad || 'media',
      })
      .select(ticketSelect())
      .single();

    if (error) {
      console.error('[Support Tickets] Create error:', error);
      return res.status(500).json({ error: 'Error al crear ticket', details: error.message });
    }

    res.status(201).json({ ticket: data });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Support Tickets] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const listMyTickets = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const { data, error } = await supabase
      .from('support_tickets')
      .select(ticketSelect())
      .eq('tenant_id', user.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Support Tickets] List error:', error);
      return res.status(500).json({ error: 'Error al listar tickets', details: error.message });
    }

    res.json({ tickets: data || [] });
  } catch (error: any) {
    console.error('[Support Tickets] List error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const getTicket = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select(ticketSelect())
      .eq('id', id)
      .eq('tenant_id', user.tenantId)
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const { data: replies, error: repliesError } = await supabase
      .from('support_ticket_replies')
      .select('id, superadmin_id, usuario_id, mensaje, es_interno, created_at, superadmins(nombre)')
      .eq('ticket_id', id)
      .eq('es_interno', false)
      .order('created_at', { ascending: true });

    if (repliesError) {
      console.error('[Support Tickets] Replies error:', repliesError);
    }

    res.json({ ticket, replies: replies || [] });
  } catch (error: any) {
    console.error('[Support Tickets] Get error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const replyTicket = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const body = replySchema.parse(req.body);

    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('id, estado')
      .eq('id', id)
      .eq('tenant_id', user.tenantId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    const { data, error } = await supabase
      .from('support_ticket_replies')
      .insert({
        ticket_id: id,
        usuario_id: user.userId,
        mensaje: body.mensaje,
      })
      .select()
      .single();

    if (error) {
      console.error('[Support Tickets] Reply error:', error);
      return res.status(500).json({ error: 'Error al responder ticket', details: error.message });
    }

    // Reabrir si estaba resuelto o cerrado
    if (ticket.estado === 'resuelto' || ticket.estado === 'cerrado') {
      await supabase.from('support_tickets').update({ estado: 'abierto' }).eq('id', id);
    }

    res.status(201).json({ reply: data });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Support Tickets] Reply error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
