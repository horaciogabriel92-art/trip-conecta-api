import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';

/**
 * Obtener todas las notas de un cliente
 * GET /clientes/:cliente_id/notas
 */
export const getNotasByCliente = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    console.log('[getNotasByCliente] Ruta ejecutada. Params:', req.params);
    const cliente_id = req.params.id;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.rol;

    try {
        // Verificar acceso al cliente (solo admin ve todas las notas)
        console.log('[getNotasByCliente] Verificando cliente:', cliente_id);
        const { data: cliente, error: clienteError } = await supabase
            .from('clientes')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('id', cliente_id)
            .single();

        if (clienteError) {
            console.error('[getNotasByCliente] Error buscando cliente:', clienteError);
            return res.status(404).json({ error: 'Cliente no encontrado', details: clienteError.message });
        }
        
        if (!cliente) {
            console.error('[getNotasByCliente] Cliente no existe:', cliente_id);
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        
        console.log('[getNotasByCliente] Cliente encontrado:', cliente);

        // Construir query base
        let query = supabase
            .from('notas_cliente')
            .select(`
                *,
                vendedor:vendedor_id (id, nombre, apellido)
            `)
            .eq('tenant_id', tenantId)
            .eq('cliente_id', cliente_id)
            .order('created_at', { ascending: false });

        // Si no es admin, solo ver notas públicas o las propias
        if (userRole !== 'ADMIN') {
            query = query.or(`es_privada.eq.false,vendedor_id.eq.${userId}`);
        }

        const { data: notas, error } = await query;

        if (error) {
            console.error('Error fetching notas:', error);
            return res.status(500).json({ error: 'Error al obtener notas' });
        }

        res.json({ notas: notas || [] });
    } catch (error: any) {
        console.error('Error in getNotasByCliente:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Crear una nueva nota
 * POST /clientes/:cliente_id/notas
 */
export const createNota = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const cliente_id = req.params.id;
    const { contenido, tipo = 'general', es_privada = false } = req.body;
    const userId = (req as any).user.userId;

    if (!contenido || !contenido.trim()) {
        return res.status(400).json({ error: 'El contenido de la nota es requerido' });
    }

    try {
        // Verificar que el cliente existe
        const { data: cliente, error: clienteError } = await supabase
            .from('clientes')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('id', cliente_id)
            .single();

        if (clienteError || !cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        console.log('[createNota] Insertando nota:', { cliente_id, vendedor_id: userId, tipo, es_privada });
        
        const { data: nota, error } = await supabase
            .from('notas_cliente')
            .insert({
                cliente_id,
                vendedor_id: userId,
                contenido: contenido.trim(),
                tipo,
                es_privada,
                tenant_id: tenantId
            })
            .select(`
                *,
                vendedor:vendedor_id (id, nombre, apellido)
            `)
            .single();

        if (error || !nota) {
            console.error('[createNota] Error:', error);
            return res.status(500).json({ 
                error: 'Error al crear nota', 
                details: error?.message || 'Unknown error',
                code: error?.code || 'UNKNOWN'
            });
        }

        // Actualizar fecha de última interacción del cliente
        await supabase
            .from('clientes')
            .update({ fecha_ultima_interaccion: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('id', cliente_id);

        res.status(201).json({ message: 'Nota creada', nota });
    } catch (error: any) {
        console.error('Error in createNota:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Actualizar una nota
 * PUT /notas/:id
 */
export const updateNota = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { contenido, tipo, es_privada } = req.body;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.rol;

    try {
        // Verificar que la nota existe y pertenece al usuario (o es admin)
        const { data: notaExistente, error: notaError } = await supabase
            .from('notas_cliente')
            .select('id, vendedor_id')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (notaError || !notaExistente) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        // Solo el creador o admin pueden editar
        if (notaExistente.vendedor_id !== userId && userRole !== 'ADMIN') {
            return res.status(403).json({ error: 'No tiene permiso para editar esta nota' });
        }

        const updates: any = {};
        if (contenido !== undefined) updates.contenido = contenido.trim();
        if (tipo !== undefined) updates.tipo = tipo;
        if (es_privada !== undefined) updates.es_privada = es_privada;

        const { data: nota, error } = await supabase
            .from('notas_cliente')
            .update(updates)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select(`
                *,
                vendedor:vendedor_id (id, nombre, apellido)
            `)
            .single();

        if (error || !nota) {
            console.error('Error updating nota:', error);
            return res.status(500).json({ error: 'Error al actualizar nota' });
        }

        res.json({ message: 'Nota actualizada', nota });
    } catch (error: any) {
        console.error('Error in updateNota:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Eliminar una nota
 * DELETE /notas/:id
 */
export const deleteNota = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.rol;

    try {
        // Verificar que la nota existe
        const { data: notaExistente, error: notaError } = await supabase
            .from('notas_cliente')
            .select('id, vendedor_id')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (notaError || !notaExistente) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        // Solo el creador o admin pueden eliminar
        if (notaExistente.vendedor_id !== userId && userRole !== 'ADMIN') {
            return res.status(403).json({ error: 'No tiene permiso para eliminar esta nota' });
        }

        const { error } = await supabase
            .from('notas_cliente')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', id);

        if (error) {
            console.error('Error deleting nota:', error);
            return res.status(500).json({ error: 'Error al eliminar nota' });
        }

        res.json({ message: 'Nota eliminada' });
    } catch (error: any) {
        console.error('Error in deleteNota:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
