import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { sendEmailAsync, sendRecordatorioCotizacionVencer, sendRecordatorioSeguimiento } from '../services/email.service';
import { getTenantId } from '../utils/tenant';

export const sendPaymentReminders = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
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
      .eq('tenant_id', tenantId)
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
          .eq('tenant_id', tenantId)
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


export const sendCotizacionVencimientoReminders = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const authHeader = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && authHeader !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + 2);
    const limiteStr = limite.toISOString().split('T')[0];

    const { data: cotizaciones, error } = await supabase
      .from('cotizaciones')
      .select(`
        id,
        codigo,
        fecha_expiracion,
        nombre_cotizacion,
        vendedor_id,
        cliente:cliente_id (nombre, apellido),
        users:vendedor_id (email, nombre)
      `)
      .eq('tenant_id', tenantId)
      .eq('estado', 'nueva')
      .lte('fecha_expiracion', limiteStr)
      .gte('fecha_expiracion', hoyStr)
      .or(`ultimo_recordatorio_enviado.is.null,ultimo_recordatorio_enviado.lt.${hoyStr}`);

    if (error) {
      console.error('[Jobs] Error buscando cotizaciones por vencer:', error);
      return res.status(500).json({ error: 'Error buscando cotizaciones' });
    }

    let enviados = 0;
    let fallidos = 0;

    for (const c of cotizaciones || []) {
      const vendedor = (c as any).users;
      if (!vendedor?.email) {
        console.log(`[Jobs] Vendedor sin email para cotización ${c.codigo}`);
        continue;
      }

      const cliente = (c as any).cliente;
      const clienteNombre = cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'Cliente';
      const diasRestantes = Math.ceil((new Date(c.fecha_expiracion).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));

      try {
        await sendRecordatorioCotizacionVencer(
          vendedor.email,
          vendedor.nombre || 'Vendedor',
          c.codigo,
          String(diasRestantes),
          new Date(c.fecha_expiracion).toLocaleDateString('es-AR'),
          clienteNombre,
          `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/cotizaciones/${c.id}`
        );

        await supabase.from('cotizaciones').update({ ultimo_recordatorio_enviado: hoyStr }).eq('tenant_id', tenantId).eq('id', c.id);
        enviados++;
      } catch (err) {
        console.error(`[Jobs] Error enviando recordatorio de vencimiento para ${c.codigo}:`, err);
        fallidos++;
      }
    }

    res.json({ message: 'Recordatorios de vencimiento completados', enviados, fallidos, total: (cotizaciones || []).length });
  } catch (error: any) {
    console.error('[Jobs] Error general:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const sendSeguimientoReminders = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const authHeader = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && authHeader !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() - 5);
    const limiteStr = limite.toISOString().split('T')[0];

    const { data: cotizaciones, error } = await supabase
      .from('cotizaciones')
      .select(`
        id,
        codigo,
        fecha_envio,
        nombre_cotizacion,
        vendedor_id,
        cliente:cliente_id (nombre, apellido),
        users:vendedor_id (email, nombre)
      `)
      .eq('tenant_id', tenantId)
      .eq('estado', 'enviada')
      .lte('fecha_envio', limiteStr)
      .or(`ultimo_recordatorio_enviado.is.null,ultimo_recordatorio_enviado.lt.${hoyStr}`);

    if (error) {
      console.error('[Jobs] Error buscando cotizaciones para seguimiento:', error);
      return res.status(500).json({ error: 'Error buscando cotizaciones' });
    }

    let enviados = 0;
    let fallidos = 0;

    for (const c of cotizaciones || []) {
      const vendedor = (c as any).users;
      if (!vendedor?.email) {
        console.log(`[Jobs] Vendedor sin email para cotización ${c.codigo}`);
        continue;
      }

      const cliente = (c as any).cliente;
      const clienteNombre = cliente ? `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() : 'Cliente';
      const diasSinRespuesta = Math.ceil((hoy.getTime() - new Date(c.fecha_envio).getTime()) / (1000 * 60 * 60 * 24));

      try {
        await sendRecordatorioSeguimiento(
          vendedor.email,
          vendedor.nombre || 'Vendedor',
          c.codigo,
          String(diasSinRespuesta),
          new Date(c.fecha_envio).toLocaleDateString('es-AR'),
          clienteNombre,
          `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/cotizaciones/${c.id}`
        );

        await supabase.from('cotizaciones').update({ ultimo_recordatorio_enviado: hoyStr }).eq('tenant_id', tenantId).eq('id', c.id);
        enviados++;
      } catch (err) {
        console.error(`[Jobs] Error enviando recordatorio de seguimiento para ${c.codigo}:`, err);
        fallidos++;
      }
    }

    res.json({ message: 'Recordatorios de seguimiento completados', enviados, fallidos, total: (cotizaciones || []).length });
  } catch (error: any) {
    console.error('[Jobs] Error general:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
