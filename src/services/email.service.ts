import { Resend } from 'resend';
import fs from 'fs/promises';
import path from 'path';
import { supabase } from '../config/supabase';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Quotixos';

interface EmailPayload {
  to: string | string[];
  subject: string;
  templateName: string;
  variables: Record<string, string | number>;
  metadata?: Record<string, any>;
}

async function renderTemplate(templateName: string, variables: Record<string, string | number>): Promise<string> {
  const templatesDir = path.join(__dirname, '../templates/emails');
  
  const [layoutHtml, bodyHtml] = await Promise.all([
    fs.readFile(path.join(templatesDir, 'layout.html'), 'utf-8'),
    fs.readFile(path.join(templatesDir, `${templateName}.html`), 'utf-8')
  ]);

  let content = bodyHtml;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }

  return layoutHtml.replace('{{{body}}}', content).replace('{{subject}}', String(variables.subject || ''));
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const { to, subject, templateName, variables, metadata } = payload;

  try {
    const html = await renderTemplate(templateName, { ...variables, subject });

    const result = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });

    // Log éxito
    await supabase.from('notificaciones_email').insert({
      tipo: metadata?.tipo || templateName,
      destinatario_email: Array.isArray(to) ? to.join(', ') : to,
      asunto: subject,
      cuerpo_html: html,
      estado: 'enviado',
      intentos: 1,
      metadata: metadata || {},
      enviado_en: new Date().toISOString(),
    });

    console.log(`[EmailService] Enviado a ${to}: ${subject}`, result);
  } catch (error: any) {
    console.error('[EmailService] Error enviando email:', error);

    // Log fallo
    await supabase.from('notificaciones_email').insert({
      tipo: metadata?.tipo || templateName,
      destinatario_email: Array.isArray(to) ? to.join(', ') : to,
      asunto: subject,
      cuerpo_html: '',
      estado: 'fallido',
      error: error.message || 'Error desconocido',
      intentos: 1,
      metadata: metadata || {},
    });

    throw error;
  }
}

export async function sendEmailAsync(payload: EmailPayload): Promise<void> {
  // No bloquear la respuesta HTTP; fire-and-forget con catch silencioso
  sendEmail(payload).catch(() => {});
}

export async function sendPagoPendienteVendedor(to: string, nombre: string, codigoCotizacion: string, montoRestante: string, fechaLimite: string, linkPanel: string) {
  return sendEmailAsync({
    to,
    subject: `Recordatorio de pago pendiente - Cotización ${codigoCotizacion}`,
    templateName: 'pago-pendiente-vendedor',
    variables: {
      nombre,
      codigoCotizacion,
      montoRestante,
      fechaLimite,
      linkPanel
    },
    metadata: { tipo: 'pago_pendiente_vendedor' }
  });
}

export async function sendRecordatorioCotizacionVencer(to: string, nombre: string, codigoCotizacion: string, diasRestantes: string, fechaExpiracion: string, clienteNombre: string, linkPanel: string) {
  return sendEmailAsync({
    to,
    subject: `Tu cotización ${codigoCotizacion} vence en ${diasRestantes} días`,
    templateName: 'recordatorio-cotizacion-vencer',
    variables: {
      nombre,
      codigoCotizacion,
      diasRestantes,
      fechaExpiracion,
      clienteNombre,
      linkPanel
    },
    metadata: { tipo: 'recordatorio_cotizacion_vencer' }
  });
}

export async function sendRecordatorioSeguimiento(to: string, nombre: string, codigoCotizacion: string, diasSinRespuesta: string, fechaEnvio: string, clienteNombre: string, linkPanel: string) {
  return sendEmailAsync({
    to,
    subject: `Seguimiento pendiente - Cotización ${codigoCotizacion}`,
    templateName: 'recordatorio-seguimiento-cliente',
    variables: {
      nombre,
      codigoCotizacion,
      diasSinRespuesta,
      fechaEnvio,
      clienteNombre,
      linkPanel
    },
    metadata: { tipo: 'recordatorio_seguimiento_cliente' }
  });
}

export async function getAdminEmails(tenantId: string): Promise<string[]> {
  const { data: admins, error } = await supabase
    .from('users')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('rol', 'admin')
    .eq('activo', true);

  if (error) {
    console.error('[EmailService] Error obteniendo admins:', error);
    return [];
  }

  return admins?.map((a: any) => a.email).filter(Boolean) || [];
}
