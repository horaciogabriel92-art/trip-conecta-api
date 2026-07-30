import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';

export const listActiveAnnouncements = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.userId;

    const { data, error } = await supabase
      .from('announcements')
      .select(`
        id,
        titulo,
        mensaje,
        tipo,
        created_at,
        expires_at,
        announcement_reads!left(leido_en)
      `)
      .eq('activo', true)
      .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Announcements] List error:', error);
      return res.status(500).json({ error: 'Error al cargar anuncios', details: error.message });
    }

    const announcements = (data || []).map((a: any) => {
      const reads = Array.isArray(a.announcement_reads) ? a.announcement_reads : [a.announcement_reads];
      return {
        ...a,
        leido: reads.some((r: any) => r?.leido_en),
        announcement_reads: undefined,
      };
    });

    res.json({ announcements });
  } catch (error: any) {
    console.error('[Announcements] Unexpected error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

export const markAnnouncementAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    const { error } = await supabase.from('announcement_reads').upsert({
      announcement_id: id,
      usuario_id: userId,
      leido_en: new Date().toISOString(),
    });

    if (error) {
      console.error('[Announcements] Mark read error:', error);
      return res.status(500).json({ error: 'Error al marcar anuncio como leído', details: error.message });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Announcements] Mark read error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
