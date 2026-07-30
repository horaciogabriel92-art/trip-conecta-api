import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { sendEmailAsync } from '../services/email.service';

const announcementSchema = z.object({
  titulo: z.string().min(2).max(255),
  mensaje: z.string().min(10).max(5000),
  tipo: z.enum(['info', 'warning', 'success']).default('info'),
  activo: z.boolean().default(true),
  expires_at: z.string().datetime().optional().nullable(),
});

const emailCampaignSchema = z.object({
  asunto: z.string().min(2).max(255),
  mensaje: z.string().min(10).max(20000),
  filtros: z.object({
    solo_activos: z.boolean().optional(),
    plan_slug: z.string().optional(),
  }).optional(),
});

function announcementSelect() {
  return `
    id,
    titulo,
    mensaje,
    tipo,
    activo,
    created_by,
    created_at,
    expires_at
  `;
}

export const listAnnouncements = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select(announcementSelect())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Ernesto Announcements] List error:', error);
      return res.status(500).json({ error: 'Error al listar anuncios', details: error.message });
    }

    res.json({ announcements: data || [] });
  } catch (error: any) {
    console.error('[Ernesto Announcements] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    const superadmin = (req as any).superadmin;
    const body = announcementSchema.parse(req.body);

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        ...body,
        created_by: superadmin.userId,
      })
      .select(announcementSelect())
      .single();

    if (error) {
      console.error('[Ernesto Announcements] Create error:', error);
      return res.status(500).json({ error: 'Error al crear anuncio', details: error.message });
    }

    res.status(201).json({ announcement: data });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Announcements] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = announcementSchema.partial().parse(req.body);

    const { data, error } = await supabase
      .from('announcements')
      .update(body)
      .eq('id', id)
      .select(announcementSelect())
      .single();

    if (error) {
      console.error('[Ernesto Announcements] Update error:', error);
      return res.status(500).json({ error: 'Error al actualizar anuncio', details: error.message });
    }

    res.json({ announcement: data });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Announcements] Update error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.from('announcements').delete().eq('id', id);

    if (error) {
      console.error('[Ernesto Announcements] Delete error:', error);
      return res.status(500).json({ error: 'Error al eliminar anuncio', details: error.message });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Ernesto Announcements] Delete error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const sendMassEmail = async (req: Request, res: Response) => {
  try {
    const body = emailCampaignSchema.parse(req.body);

    let query = supabase.from('tenants').select('id, nombre, email_contacto, slug, plan_id, plans:plan_id(slug)');

    if (body.filtros?.solo_activos) {
      query = query.eq('activo', true);
    }

    if (body.filtros?.plan_slug) {
      const { data: plan } = await supabase.from('plans').select('id').eq('slug', body.filtros.plan_slug).single();
      if (plan) {
        query = query.eq('plan_id', plan.id);
      }
    }

    const { data: tenants, error } = await query;

    if (error) {
      console.error('[Ernesto Email] Error:', error);
      return res.status(500).json({ error: 'Error al obtener destinatarios', details: error.message });
    }

    const panelUrl = process.env.PANEL_URL || 'https://travel.quotixos.com';
    const promises = [];
    let sent = 0;
    let failed = 0;

    for (const t of tenants || []) {
      const email = t.email_contacto;
      if (!email) {
        failed++;
        continue;
      }

      promises.push(
        sendEmailAsync({
          to: email,
          subject: body.asunto,
          templateName: 'email-masivo',
          variables: {
            nombre_agencia: t.nombre,
            mensaje: body.mensaje,
            linkPanel: `${panelUrl}/login`,
          },
          metadata: { tipo: 'email_masivo', tenant_id: t.id },
        })
          .then(() => sent++)
          .catch(() => failed++)
      );
    }

    await Promise.all(promises);

    res.json({ sent, failed, total: (tenants || []).length });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Datos inválidos', details: error.errors });
    }
    console.error('[Ernesto Email] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
