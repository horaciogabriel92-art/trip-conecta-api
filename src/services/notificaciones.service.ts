import { supabase } from '../config/supabase';

/**
 * Crea una notificación in-app (campanita) de forma fire-and-forget.
 * - usuario_id: null  → visible para admins del tenant
 * - usuario_id: <id>  → visible para ese vendedor/usuario
 * Nunca lanza errores: un fallo de notificación no debe romper el flujo de negocio.
 */
export async function crearNotificacionInterna(params: {
  tenantId: string;
  usuario_id?: string | null;
  tipo: 'nueva_venta' | 'nueva_cotizacion' | 'pago_recibido' | 'comprobante_subido' | 'sistema';
  titulo: string;
  mensaje: string;
  referencia_id?: string | null;
  referencia_tipo?: string | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from('notificaciones').insert({
      tenant_id: params.tenantId,
      usuario_id: params.usuario_id ?? null,
      tipo: params.tipo,
      titulo: params.titulo,
      mensaje: params.mensaje,
      referencia_id: params.referencia_id ?? null,
      referencia_tipo: params.referencia_tipo ?? null,
      leida: false,
      created_at: new Date().toISOString()
    });

    if (error) {
      console.error('[crearNotificacionInterna] Error insertando notificación:', error);
    }
  } catch (e) {
    console.error('[crearNotificacionInterna] Excepción:', e);
  }
}
