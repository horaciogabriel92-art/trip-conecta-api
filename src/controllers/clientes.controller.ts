import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';

// ============================================
// CLIENTES CONTROLLER - CRM
// ============================================

/**
 * Listar clientes con filtros y paginación
 * GET /clientes?q=&page=&limit=
 */
export const getClientes = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { q, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const user = (req as any).user;
    
    try {
        let query = supabase
            .from('clientes')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId);
        
        // Si es vendedor (no admin), solo ve sus clientes
        if (user?.role !== 'admin') {
            query = query.eq('registrado_por', user?.userId);
        }
        
        // Búsqueda fuzzy si hay query
        if (q && q !== '') {
            const searchTerm = `%${q}%`;
            query = query.or(`nombre.ilike.${searchTerm},apellido.ilike.${searchTerm},email.ilike.${searchTerm},documento.ilike.${searchTerm}`);
        }
        
        const { data, error, count } = await query
            .order('fecha_registro', { ascending: false })
            .range(offset, offset + parseInt(limit as string) - 1);
        
        if (error) {
            console.error('Error fetching clientes:', error);
            return res.status(500).json({ error: 'Error al obtener clientes', details: error });
        }
        
        res.json({
            data,
            meta: {
                total: count,
                page: parseInt(page as string),
                limit: parseInt(limit as string),
                totalPages: Math.ceil((count || 0) / parseInt(limit as string))
            }
        });
    } catch (error: any) {
        console.error('Error in getClientes:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

/**
 * Buscar clientes (endpoint específico para búsqueda rápida)
 * GET /clientes/buscar?q=
 */
export const buscarClientes = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { q } = req.query;
    const user = (req as any).user;
    
    if (!q || q === '') {
        return res.status(400).json({ error: 'Query de búsqueda requerida' });
    }
    
    try {
        const searchTerm = `%${q}%`;
        let dbQuery = supabase
            .from('clientes')
            .select('id, nombre, apellido, email, telefono, tipo_documento, documento')
            .eq('tenant_id', tenantId)
            .or(`nombre.ilike.${searchTerm},apellido.ilike.${searchTerm},email.ilike.${searchTerm},documento.ilike.${searchTerm}`);
        
        // Si es vendedor (no admin), solo busca en sus clientes
        if (user?.role !== 'admin') {
            dbQuery = dbQuery.eq('registrado_por', user?.userId);
        }
        
        const { data, error } = await dbQuery.limit(10);
        
        if (error) {
            console.error('Error buscando clientes:', error);
            return res.status(500).json({ error: 'Error en búsqueda' });
        }
        
        res.json({ data });
    } catch (error: any) {
        console.error('Error in buscarClientes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Obtener cliente por ID con sus pasajeros e historial
 * GET /clientes/:id
 */
export const getClienteById = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Cliente
        const { data: cliente, error: clienteError } = await supabase
            .from('clientes')
            .select('*')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();
        
        if (clienteError || !cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        
        // Si es vendedor (no admin), verificar que sea su cliente
        if (user?.role !== 'admin' && cliente.registrado_por !== user?.userId) {
            return res.status(403).json({ error: 'No autorizado para ver este cliente' });
        }
        
        // Pasajeros asociados (perfiles de viajeros)
        const { data: pasajeros, error: pasajerosError } = await supabase
            .from('pasajeros')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_titular_id', id)
            .order('fecha_registro', { ascending: false });
        
        // Historial del cliente
        const { data: historial, error: historialError } = await supabase
            .from('historial_cliente')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_id', id)
            .order('fecha', { ascending: false })
            .limit(50);
        
        // Cotizaciones del cliente
        const { data: cotizaciones, error: cotizacionesError } = await supabase
            .from('cotizaciones')
            .select('id, codigo, estado, precio_total, fecha_creacion, destino_principal')
            .eq('tenant_id', tenantId)
            .eq('cliente_id', id)
            .order('fecha_creacion', { ascending: false })
            .limit(20);
        
        res.json({
            cliente,
            pasajeros: pasajeros || [],
            historial: historial || [],
            cotizaciones: cotizaciones || []
        });
    } catch (error: any) {
        console.error('Error in getClienteById:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

/**
 * Crear nuevo cliente
 * POST /clientes
 * 
 * Lógica:
 * 1. Validar duplicados por email o documento
 * 2. Crear cliente
 * 3. Crear pasajero titular automáticamente
 */
export const createCliente = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const {
        tipo_documento = 'CI',
        documento,
        nombre,
        apellido,
        email,
        email_alt,
        telefono,
        telefono_alt,
        whatsapp,
        fecha_nacimiento,
        nacionalidad = 'Uruguay',
        direccion,
        ciudad,
        pais = 'Uruguay',
        notas_crm,
        // Campos CRM nuevos
        preferencias_viaje,
        temporada_preferida,
        fuente_lead,
        referido_por,
        tags,
        prioridad,
        fecha_proximo_viaje_ideal,
        estado
    } = req.body;
    
    const userId = (req as any).user.userId;
    
    // Validaciones
    if (!nombre || !apellido) {
        return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
    }
    
    if (!documento && !email) {
        return res.status(400).json({ error: 'Debe proporcionar documento o email' });
    }
    
    try {
        // Verificar duplicados
        if (email) {
            const { data: existenteEmail } = await supabase
                .from('clientes')
                .select('id, nombre, apellido')
                .eq('tenant_id', tenantId)
                .eq('email', email)
                .single();
            
            if (existenteEmail) {
                return res.status(409).json({
                    error: 'Ya existe un cliente con este email',
                    cliente: existenteEmail
                });
            }
        }
        
        if (documento) {
            const { data: existenteDoc } = await supabase
                .from('clientes')
                .select('id, nombre, apellido')
                .eq('tenant_id', tenantId)
                .eq('tipo_documento', tipo_documento)
                .eq('documento', documento)
                .single();
            
            if (existenteDoc) {
                return res.status(409).json({
                    error: 'Ya existe un cliente con este documento',
                    cliente: existenteDoc
                });
            }
        }
        
        // Crear cliente
        const { data: cliente, error: clienteError } = await supabase
            .from('clientes')
            .insert({
                tipo_documento,
                documento,
                nombre,
                apellido,
                email,
                email_alt,
                telefono,
                telefono_alt,
                whatsapp,
                fecha_nacimiento,
                nacionalidad,
                direccion,
                ciudad,
                pais,
                registrado_por: userId,
                tenant_id: tenantId,
                notas_crm,
                // Campos CRM nuevos
                preferencias_viaje: preferencias_viaje ? JSON.stringify(preferencias_viaje) : null,
                temporada_preferida,
                fuente_lead,
                referido_por,
                tags: tags || [],
                prioridad: prioridad || 'media',
                fecha_proximo_viaje_ideal,
                estado: estado || 'activo'
            })
            .select()
            .single();
        
        if (clienteError || !cliente) {
            console.error('Error creating cliente:', clienteError);
            return res.status(500).json({ error: 'Error al crear cliente', details: clienteError });
        }
        
        // Crear pasajero titular automáticamente
        const { data: pasajero, error: pasajeroError } = await supabase
            .from('pasajeros')
            .insert({
                cliente_titular_id: cliente.id,
                tipo_documento,
                documento,
                nombre,
                apellido,
                fecha_nacimiento,
                nacionalidad,
                es_cliente_registrado: true,
                cliente_id: cliente.id,
                tenant_id: tenantId
            })
            .select()
            .single();
        
        if (pasajeroError) {
            console.error('Error creating pasajero titular:', pasajeroError);
            // No fallamos todo, el cliente ya se creó
        }
        
        // Registrar en historial
        await supabase
            .from('historial_cliente')
            .insert({
                cliente_id: cliente.id,
                tipo: 'nota_interna',
                descripcion: 'Cliente creado en el sistema',
                realizado_por: userId,
                realizado_por_nombre: (req as any).user.nombre || 'Usuario',
                tenant_id: tenantId
            });
        
        res.status(201).json({
            message: 'Cliente creado exitosamente',
            cliente,
            pasajero_titular: pasajero || null
        });
    } catch (error: any) {
        console.error('Error in createCliente:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

/**
 * Actualizar cliente
 * PUT /clientes/:id
 */
export const updateCliente = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const updates = req.body;
    const user = (req as any).user;
    const userId = user?.userId;
    
    // Verificar que el vendedor pueda editar este cliente
    if (user?.role !== 'admin') {
        const { data: clienteCheck, error: checkError } = await supabase
            .from('clientes')
            .select('registrado_por')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();
        
        if (checkError || !clienteCheck) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        
        if (clienteCheck.registrado_por !== userId) {
            return res.status(403).json({ error: 'No autorizado para editar este cliente' });
        }
    }
    
    // Campos permitidos para actualizar
    const allowedFields = [
        'nombre', 'apellido', 'email', 'email_alt', 'telefono', 'telefono_alt', 
        'whatsapp', 'fecha_nacimiento', 'nacionalidad', 'direccion', 'ciudad', 
        'pais', 'notas_crm', 'estado', 'preferencias_viaje', 'temporada_preferida',
        'fuente_lead', 'referido_por', 'tags', 'prioridad', 'fecha_proximo_viaje_ideal'
    ];
    
    const filteredUpdates: any = {};
    Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
            filteredUpdates[key] = updates[key];
        }
    });
    
    try {
        console.log('[updateCliente] Updating cliente:', id, 'with fields:', Object.keys(filteredUpdates));
        
        const { data: cliente, error } = await supabase
            .from('clientes')
            .update({
                ...filteredUpdates,
                fecha_ultima_interaccion: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();
        
        if (error) {
            console.error('[updateCliente] Supabase error:', error);
            return res.status(400).json({ error: 'Error actualizando cliente', details: error.message });
        }
        
        if (!cliente) {
            console.error('[updateCliente] Cliente no encontrado:', id);
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        
        // Registrar en historial
        await supabase
            .from('historial_cliente')
            .insert({
                cliente_id: id,
                tipo: 'nota_interna',
                descripcion: 'Datos del cliente actualizados',
                detalle: filteredUpdates,
                realizado_por: userId,
                realizado_por_nombre: (req as any).user.nombre || 'Usuario',
                tenant_id: tenantId
            });
        
        res.json({ message: 'Cliente actualizado', cliente });
    } catch (error: any) {
        console.error('Error in updateCliente:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Agregar pasajero a cliente
 * POST /clientes/:id/pasajeros
 */
export const addPasajero = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params; // cliente_titular_id
    const {
        tipo_documento = 'CI',
        documento,
        nombre,
        apellido,
        fecha_nacimiento,
        nacionalidad = 'Uruguay',
        notas
    } = req.body;
    
    if (!nombre || !apellido) {
        return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
    }
    
    try {
        // Verificar que el cliente titular existe
        const { data: cliente } = await supabase
            .from('clientes')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();
        
        if (!cliente) {
            return res.status(404).json({ error: 'Cliente titular no encontrado' });
        }
        
        // Verificar si ya existe este pasajero para este titular
        if (documento) {
            const { data: existente } = await supabase
                .from('pasajeros')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('cliente_titular_id', id)
                .eq('tipo_documento', tipo_documento)
                .eq('documento', documento)
                .single();
            
            if (existente) {
                return res.status(409).json({ error: 'Este pasajero ya está registrado para este cliente' });
            }
        }
        
        const { data: pasajero, error } = await supabase
            .from('pasajeros')
            .insert({
                cliente_titular_id: id,
                tipo_documento,
                documento,
                nombre,
                apellido,
                fecha_nacimiento,
                nacionalidad,
                es_cliente_registrado: false, // Por defecto no es cliente
                notas,
                tenant_id: tenantId
            })
            .select()
            .single();
        
        if (error || !pasajero) {
            console.error('Error creating pasajero:', error);
            return res.status(500).json({ error: 'Error al crear pasajero' });
        }
        
        res.status(201).json({ message: 'Pasajero agregado', pasajero });
    } catch (error: any) {
        console.error('Error in addPasajero:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Obtener pasajeros de un cliente
 * GET /clientes/:id/pasajeros
 */
export const getPasajerosByCliente = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    
    try {
        const { data, error } = await supabase
            .from('pasajeros')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_titular_id', id)
            .order('fecha_registro', { ascending: false });
        
        if (error) {
            return res.status(500).json({ error: 'Error al obtener pasajeros' });
        }
        
        res.json({ data });
    } catch (error: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
};
