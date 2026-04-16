import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { sendEmailAsync } from '../services/email.service';

export const sendPaymentReminders = async (req: Request, res: Response) => {
  const authHeader = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && authHeader !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const hoy = new Date().toISOString().split('T')[0];

    // Buscar cotizaciones vendidas con pago parcial donde fecha_pago_resto <= mañana
    // y que no hayan recibido recordatorio hoy
    const { data: cotizaciones, error } = await supabase
      .from('cotizaciones')
      .select(`
        id,
        codigo,
        precio_total,
        monto_pagado,
        monto_restante,
        fecha_pago_resto,
        vendedor_id,
        users:vendedor_id (email, nombre)
      `)
      .eq('estado', 'vendida')
      .eq('tipo_pago', 'parcial')
      .lte('fecha_pago_resto', hoy)
      .or(`ultimo_recordatorio_enviado.is.null,ultimo_recordatorio_enviado.lt.${hoy}`);

    if (error) {
      console.error('[Jobs] Error buscando cotizaciones:', error);
      return res.status(500).json({ error: 'Error buscando cotizaciones pendientes' });
    }

    let enviados = 0;
    let fallidos = 0;

    for (const c of cotizaciones || []) {
      const vendedor = (c as any).users;
      if (!vendedor?.email) {
        console.log(`[Jobs] Vendedor sin email para cotización ${c.codigo}`);
        continue;
      }

      try {
        await sendEmailAsync({
          to: vendedor.email,
          subject: `Recordatorio de pago pendiente - Cotización ${c.codigo}`,
          templateName: 'pago-pendiente-vendedor',
          variables: {
            nombre: vendedor.nombre || 'Vendedor',
            codigoCotizacion: c.codigo,
            montoRestante: String(c.monto_restante || 0),
            fechaLimite: c.fecha_pago_resto
              ? new Date(c.fecha_pago_resto).toLocaleDateString('es-AR')
              : 'No especificada',
            linkPanel: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/cotizaciones/${c.id}`
          },
          metadata: { tipo: 'pago_pendiente_vendedor', cotizacion_id: c.id }
        });

        // Marcar recordatorio enviado
        await supabase
          .from('cotizaciones')
          .update({ ultimo_recordatorio_enviado: hoy })
          .eq('id', c.id);

        enviados++;
      } catch (err) {
        console.error(`[Jobs] Error enviando recordatorio para ${c.codigo}:`, err);
        fallidos++;
      }
    }

    res.json({
      message: 'Proceso de recordatorios completado',
      enviados,
      fallidos,
      total: (cotizaciones || []).length
    });
  } catch (error: any) {
    console.error('[Jobs] Error general:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
