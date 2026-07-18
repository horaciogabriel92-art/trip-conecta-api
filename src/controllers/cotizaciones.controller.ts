import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import fs from 'fs';
import path from 'path';
import { sendEmailAsync, getAdminEmails, sendCotizacionPdfEmail } from '../services/email.service';
import { crearNotificacionInterna } from '../services/notificaciones.service';
import { findComprobanteFile } from '../utils/fileSearch';
import { getTenantId } from '../utils/tenant';
import { checkFeatureEnabled, checkWorkflowMode } from '../utils/features';
import { randomDigits } from '../utils/cryptoRandom';

// Helper para evitar que el PNR se guarde repetido en itinerario
function limpiarItinerarioRepetido(itinerario: any, pnrRaw: any): any {
    if (!itinerario || typeof itinerario !== 'string') return itinerario || null;
    if (!pnrRaw || typeof pnrRaw !== 'string') return itinerario;
    const occurrences = itinerario.split(pnrRaw).length - 1;
    if (occurrences > 1) {
        return pnrRaw.trim();
    }
    return itinerario;
}

export const createCotizacion = async (req: Request, res: Response) => {
    const { 
        paquete_id, 
        cliente_nombre, 
        cliente_email, 
        cliente_telefono,
        cliente_documento,
        tipo_habitacion,
        num_pasajeros,
        fecha_salida,
        precio_total: precio_enviado,
        notas,
        datos_completos
    } = req.body;
    const vendedor_id = (req as any).user.userId;
    const tenantId = getTenantId(req);

    try {
        // ========== PASO 1: OBTENER PAQUETE ==========
        const { data: paquete, error: paqueteError } = await supabase
            .from('paquetes')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', paquete_id)
            .single();

        if (paqueteError || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        // ========== PASO 2: BUSCAR O CREAR CLIENTE ==========
        let clienteId: string | undefined;
        
        // Buscar cliente por email o documento
        if (cliente_email) {
            const { data: existenteEmail } = await supabase
                .from('clientes')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('email', cliente_email)
                .single();
            if (existenteEmail) clienteId = existenteEmail.id;
        }
        
        if (!clienteId && cliente_documento) {
            const { data: existenteDoc } = await supabase
                .from('clientes')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('documento', cliente_documento)
                .single();
            if (existenteDoc) clienteId = existenteDoc.id;
        }
        
        // Si no existe, crear cliente nuevo
        if (!clienteId) {
            const { data: nuevoCliente, error: clienteError } = await supabase
                .from('clientes')
                .insert({
                    nombre: cliente_nombre?.split(' ')[0] || 'Cliente',
                    apellido: cliente_nombre?.split(' ').slice(1).join(' ') || '',
                    email: cliente_email,
                    telefono: cliente_telefono,
                    documento: cliente_documento,
                    registrado_por: vendedor_id,
                    tenant_id: tenantId
                })
                .select()
                .single();
            
            if (clienteError) {
                console.error('Error creando cliente:', clienteError);
                return res.status(500).json({ error: 'Error al crear cliente' });
            }
            clienteId = nuevoCliente.id;
            
            // Crear pasajero titular automáticamente
            await supabase.from('pasajeros').insert({
                cliente_titular_id: clienteId,
                cliente_id: clienteId,
                es_cliente_registrado: true,
                nombre: nuevoCliente.nombre,
                apellido: nuevoCliente.apellido,
                documento: cliente_documento,
                tenant_id: tenantId
            });
        }

        // ========== PASO 3: CREAR PASAJEROS ADICIONALES ==========
        const pasajerosVinculados: any[] = [];
        const numViajeros = num_pasajeros || 2; // Default 2 para base doble
        
        // Pasajero 1: Titular (el cliente)
        const { data: pasajeroTitular } = await supabase
            .from('pasajeros')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_titular_id', clienteId)
            .eq('es_cliente_registrado', true)
            .single();
        
        if (pasajeroTitular) {
            pasajerosVinculados.push({
                pasajero_id: pasajeroTitular.id,
                es_titular: true,
                nombre_snapshot: pasajeroTitular.nombre,
                apellido_snapshot: pasajeroTitular.apellido,
                documento_snapshot: pasajeroTitular.documento,
                tipo_habitacion: tipo_habitacion || 'doble'
            });
        }
        
        // Pasajeros 2+: Acompañantes (crear genéricos si no hay datos)
        for (let i = 1; i < numViajeros; i++) {
            const { data: acompanante } = await supabase
                .from('pasajeros')
                .insert({
                    cliente_titular_id: clienteId,
                    nombre: `Acompañante ${i}`,
                    apellido: 'Viaje',
                    tenant_id: tenantId
                })
                .select()
                .single();
            
            if (acompanante) {
                pasajerosVinculados.push({
                    pasajero_id: acompanante.id,
                    es_titular: false,
                    nombre_snapshot: acompanante.nombre,
                    apellido_snapshot: acompanante.apellido,
                    tipo_habitacion: tipo_habitacion || 'doble'
                });
            }
        }

        // ========== PASO 4: PREPARAR DATOS COTIZACIÓN ==========
        const precio_total = precio_enviado || paquete.precio_base * numViajeros;
        const year = new Date().getFullYear();
        const random = randomDigits(5);
        const codigo = `COT-${year}-${random}`;
        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

        // Verificar si el módulo de comisiones está habilitado
        const { enabled: comisionesHabilitadas } = await checkFeatureEnabled(req, 'comisiones');

        // Preparar paquete_data con TODO el contenido
        const paqueteData: any = {
            titulo: paquete.titulo,
            destino: paquete.destino,
            descripcion: paquete.descripcion || '',
            duracion_dias: paquete.duracion_dias,
            imagen_principal: paquete.imagen_principal,
            politicas_cancelacion: paquete.politicas_cancelacion,
            incluye: paquete.incluye || [],
            no_incluye: paquete.no_incluye || [],
            vuelos: paquete.vuelos || []
        };
        
        // Itinerario
        if (paquete.itinerario) {
            if (typeof paquete.itinerario === 'object' && paquete.itinerario.texto !== undefined) {
                paqueteData.itinerario = paquete.itinerario;
            } else if (Array.isArray(paquete.itinerario)) {
                paqueteData.itinerario = { texto: '', dias: paquete.itinerario };
            } else if (typeof paquete.itinerario === 'string') {
                paqueteData.itinerario = { texto: paquete.itinerario, dias: [] };
            }
        }

        // ========== PASO 5: CREAR COTIZACIÓN ==========
        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .insert({
                codigo,
                vendedor_id,
                paquete_id,
                cliente_id: clienteId,
                cliente_nombre,
                cliente_email,
                cliente_telefono,
                tipo_habitacion: tipo_habitacion || 'doble',
                num_pasajeros: numViajeros,
                fecha_salida: fecha_salida || null,
                precio_total,
                precio_moneda: 'USD',
                comision_vendedor: comisionesHabilitadas ? (paquete.comision_monto_usd || 0) : 0,
                tenant_id: tenantId,
                paquete_data: paqueteData,
                itinerario: paqueteData.itinerario,
                destino_principal: paquete.destino,
                estado: 'nueva',
                fecha_expiracion: fecha_expiracion.toISOString()
            })
            .select()
            .single();

        if (error || !cotizacion) {
            console.error('Error creando cotizacion:', error);
            return res.status(500).json({ error: 'Error al crear cotización' });
        }

        // ========== PASO 6: VINCULAR PASAJEROS ==========
        for (const pv of pasajerosVinculados) {
            await supabase.from('cotizacion_pasajeros').insert({
                cotizacion_id: cotizacion.id,
                tenant_id: tenantId,
                pasajero_id: pv.pasajero_id,
                es_titular: pv.es_titular,
                nombre_snapshot: pv.nombre_snapshot,
                apellido_snapshot: pv.apellido_snapshot,
                documento_snapshot: pv.documento_snapshot,
                tipo_habitacion: pv.tipo_habitacion
            });
        }

        // ========== PASO 7: REGISTRAR EN HISTORIAL ==========
        await supabase.from('historial_cliente').insert({
            cliente_id: clienteId,
            tipo: 'cotizacion_creada',
            cotizacion_id: cotizacion.id,
            descripcion: `Cotización ${codigo} creada para ${paquete.destino}`,
            realizado_por: vendedor_id,
            realizado_por_nombre: (req as any).user.nombre || 'Vendedor',
            tenant_id: tenantId
        });

        // Notificar a admins por email (fire-and-forget)
        const adminEmails = await getAdminEmails(tenantId);
        for (const adminEmail of adminEmails) {
            sendEmailAsync({
                to: adminEmail,
                subject: `Nueva cotización ${codigo}`,
                templateName: 'nueva-cotizacion',
                variables: {
                    adminNombre: '',
                    codigo,
                    vendedorNombre: (req as any).user?.nombre || 'Vendedor',
                    clienteNombre: cliente_nombre || 'Cliente',
                    montoTotal: String(cotizacion.precio_total || 0),
                    linkAdmin: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/admin/cotizaciones/${cotizacion.id}`
                },
                metadata: { tipo: 'nueva_cotizacion', cotizacion_id: cotizacion.id }
            });
        }

        res.status(201).json(cotizacion);
    } catch (error: any) {
        console.error('[createCotizacion] Error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const getCotizaciones = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    try {
        // 1. Traer cotizaciones básicas
        let query = supabase
            .from('cotizaciones')
            .select('*')
            .eq('tenant_id', tenantId);
        
        // Filter by seller unless admin or has permission to see all quotes
        if (user.role !== 'admin' && user.permisos?.ver_todas_cotizaciones !== true) {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizaciones, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) {
            console.error('[getCotizaciones] Error:', error);
            return res.status(500).json({ error: 'Error al obtener cotizaciones', details: error.message });
        }
        
        // 2. Obtener IDs únicos de clientes y vendedores para consulta batch
        const clienteIds = [...new Set(cotizaciones?.filter(c => c.cliente_id).map(c => c.cliente_id) || [])];
        const vendedorIds = [...new Set(cotizaciones?.filter(c => c.vendedor_id).map(c => c.vendedor_id) || [])];
        
        // 3. Consultar clientes en batch
        let clientesMap: any = {};
        if (clienteIds.length > 0) {
            const { data: clientes } = await supabase
                .from('clientes')
                .select('id, nombre, apellido')
                .eq('tenant_id', tenantId)
                .in('id', clienteIds);
            
            clientes?.forEach(c => {
                clientesMap[c.id] = c;
            });
        }
        
        // 3b. Consultar vendedores en batch
        let vendedoresMap: any = {};
        if (vendedorIds.length > 0) {
            const { data: vendedores } = await supabase
                .from('users')
                .select('id, nombre, apellido')
                .eq('tenant_id', tenantId)
                .in('id', vendedorIds);
            
            vendedores?.forEach(v => {
                vendedoresMap[v.id] = v;
            });
        }

        // 3c. Consultar ventas asociadas para obtener venta_id
        const cotizacionIds = (cotizaciones || []).map((c: any) => c.id);
        let ventaIdMap: Record<string, string> = {};
        if (cotizacionIds.length > 0) {
            const { data: ventas } = await supabase
                .from('ventas')
                .select('id, cotizacion_id')
                .eq('tenant_id', tenantId)
                .in('cotizacion_id', cotizacionIds);
            
            ventas?.forEach((v: any) => {
                if (v.cotizacion_id) ventaIdMap[v.cotizacion_id] = v.id;
            });
        }
        
        // 4. Para cada cotización, obtener conteos de vuelos y hospedajes
        const cotizacionesConDatos = await Promise.all(
            (cotizaciones || []).map(async (c: any) => {
                // Contar vuelos
                const { count: numVuelos } = await supabase
                    .from('vuelos')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenantId)
                    .eq('cotizacion_id', c.id);
                
                // Contar hospedajes
                const { count: numHospedajes } = await supabase
                    .from('hospedajes')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenantId)
                    .eq('cotizacion_id', c.id);
                
                // Determinar tipo y nombres
                const tipoCotizacion = c.tipo_cotizacion || (c.paquete_id ? 'paquete' : 'manual');
                
                // Cliente: usar tabla clientes si existe, sino legacy
                let clienteNombre = c.cliente_nombre || 'Sin cliente';
                if (c.cliente_id && clientesMap[c.cliente_id]) {
                    clienteNombre = `${clientesMap[c.cliente_id].nombre} ${clientesMap[c.cliente_id].apellido}`;
                }
                
                // Vendedor: usar tabla users
                let vendedorNombre = c.vendedor_nombre || 'Sin vendedor';
                if (c.vendedor_id && vendedoresMap[c.vendedor_id]) {
                    vendedorNombre = `${vendedoresMap[c.vendedor_id].nombre} ${vendedoresMap[c.vendedor_id].apellido}`;
                }
                
                const paqueteNombre = c.nombre_cotizacion || c.paquete_nombre || 'Cotización';
                
                return {
                    ...c,
                    tipo_cotizacion: tipoCotizacion,
                    cliente_nombre: clienteNombre,
                    vendedor_nombre: vendedorNombre,
                    paquete_nombre: paqueteNombre,
                    venta_id: ventaIdMap[c.id] || null,
                    vuelos: Array(numVuelos || 0).fill({}), // Array vacío del tamaño correcto para la UI
                    hospedaje: Array(numHospedajes || 0).fill({}),
                    num_pasajeros: c.num_pasajeros || 1
                };
            })
        );
        
        res.json(cotizacionesConDatos);
    } catch (error: any) {
        console.error('[getCotizaciones] Error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const getCotizacionById = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;

    try {
        // Primero: consulta simple sin joins para verificar existencia y permisos
        let basicQuery = supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado')
            .eq('tenant_id', tenantId)
            .eq('id', id);
        
        if (user.role !== 'admin') {
            basicQuery = basicQuery.eq('vendedor_id', user.userId);
        }
        
        const { data: basicData, error: basicError } = await basicQuery.single();
        
        if (basicError || !basicData) {
            return res.status(404).json({ error: 'Cotización no encontrada o sin permisos' });
        }
        
        // Segundo: consulta con datos del cliente (sin las relaciones problemáticas)
        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .select(`
                *,
                cliente:cliente_id (*)
            `)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();
        
        if (error) {
            console.error('[getCotizacionById] Error con cliente:', error);
            // Si falla el join con cliente, devolver sin esa relación
            const { data: cotizacionSinCliente } = await supabase
                .from('cotizaciones')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('id', id)
                .single();
            
            if (cotizacionSinCliente) {
                return res.json({
                    ...cotizacionSinCliente,
                    cliente: null,
                    pasajeros: [],
                    vuelos: [],
                    hospedajes: []
                });
            }
        }
        
        // Tercero: cargar relaciones por separado si la consulta principal funcionó
        // Las queries independientes se ejecutan en paralelo; cada loader captura
        // sus propios errores y nunca rechaza (misma tolerancia a fallos que antes).
        let [
            vendedor,
            pasajeros,
            vuelos,
            hospedajes,
            traslados,
            seguros,
            extras,
            venta
        ] = await Promise.all([
            // Cargar vendedor
            (async () => {
                try {
                    if (cotizacion?.vendedor_id) {
                        const { data: v } = await supabase
                            .from('users')
                            .select('id, nombre, apellido, email, telefono')
                            .eq('id', cotizacion.vendedor_id)
                            .single();
                        return v;
                    }
                } catch (e) { /* noop */ }
                return null;
            })(),

            // Cargar pasajeros
            (async () => {
                try {
                    const { data: p } = await supabase
                        .from('cotizacion_pasajeros')
                        .select('*, pasajero:pasajero_id (*)')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id);
                    return p || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // Cargar vuelos desde tabla vuelos (cotizaciones manuales)
            (async () => {
                try {
                    const { data: v } = await supabase
                        .from('vuelos')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id);
                    return v || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // Cargar hospedajes
            (async () => {
                try {
                    const { data: h } = await supabase
                        .from('hospedajes')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id);
                    return h || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // Cargar traslados
            (async () => {
                try {
                    const { data: t } = await supabase
                        .from('traslados')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id)
                        .order('orden', { ascending: true });
                    return t || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // Cargar seguros
            (async () => {
                try {
                    const { data: s } = await supabase
                        .from('seguros')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id);
                    return s || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // Cargar extras
            (async () => {
                try {
                    const { data: e } = await supabase
                        .from('extras')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id)
                        .order('orden', { ascending: true });
                    return e || [];
                } catch (e) { /* noop */ }
                return [];
            })(),

            // SIEMPRE verificar si existe venta asociada (incluso si estado no es 'vendida')
            // Esto maneja casos de inconsistencia donde la venta existe pero la cotización no se actualizó
            (async () => {
                try {
                    const { data: v } = await supabase
                        .from('ventas')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .eq('cotizacion_id', id)
                        .maybeSingle();  // Usar maybeSingle para no fallar si no existe
                    return v;
                } catch (e) { /* noop */ }
                return null;
            })()
        ]);

        if (venta && cotizacion?.estado !== 'vendida') {
            console.warn(`[getCotizacionById] INCONSISTENCIA: Venta ${venta.id} existe pero cotización ${id} está en estado ${cotizacion?.estado}`);
        }

        // ========== CARGAR DATOS DE PAQUETE, COMPROBANTES Y PAGOS ==========
        // Estas queries dependen de los resultados anteriores (paquete_id / venta)
        // pero son independientes entre sí, por lo que también van en paralelo.
        let paquete = null;
        let comprobantesPago: any[] = [];
        let pagos: any[] = [];

        await Promise.all([
            // Si es cotización de paquete, cargar datos del paquete (vuelos, itinerario, etc.)
            (async () => {
                if (cotizacion?.paquete_id) {
                    try {
                        const { data: p } = await supabase
                            .from('paquetes')
                            .select('*')
                            .eq('tenant_id', tenantId)
                            .eq('id', cotizacion.paquete_id)
                            .single();
                        paquete = p;

                        // Si no hay vuelos en la tabla vuelos, usar los del paquete
                        if (vuelos.length === 0 && paquete?.vuelos) {
                            vuelos = paquete.vuelos;
                        }
                    } catch (e) { /* noop */ }
                }
            })(),

            // Si hay venta, cargar pagos y comprobantes
            (async () => {
                if (venta) {
                    // Cargar pagos del historial
                    try {
                        const { data: pagosData } = await supabase
                            .from('pagos_venta')
                            .select('*')
                            .eq('tenant_id', tenantId)
                            .eq('cotizacion_id', id)
                            .order('fecha_pago', { ascending: false });
                        pagos = pagosData || [];
                    } catch (e) { /* noop */ }

                    // Parsear comprobantes_pago_urls si existe
                    if (venta.comprobantes_pago_urls) {
                        try {
                            const urls = JSON.parse(venta.comprobantes_pago_urls);
                            let idx = 0;
                            for (const url of urls) {
                                const filename = url.split('/').pop() || `comprobante_${idx + 1}`;
                                const filePath = findComprobanteFile(filename);

                                if (filePath) {
                                    comprobantesPago.push({
                                        id: `comp_${idx}`,
                                        nombre_archivo: filename,
                                        url: url,
                                        ruta_archivo: url,
                                        es_descargable: true
                                    });
                                }
                                idx++;
                            }
                        } catch (e) { /* noop */ }
                    }

                    // También buscar en tabla comprobantes_pago si existe
                    try {
                        const { data: comps } = await supabase
                            .from('comprobantes_pago')
                            .select('*')
                            .eq('tenant_id', tenantId)
                            .eq('venta_id', venta.id);
                        if (comps && comps.length > 0) {
                            // Merge comprobantes de la tabla con los de JSON
                            const existingUrls = new Set(comprobantesPago.map((c: any) => c.ruta_archivo || c.url));
                            for (const comp of comps) {
                                const compUrl = `/uploads/comprobantes/${comp.ruta_archivo}`;
                                if (!existingUrls.has(compUrl)) {
                                    const filePath = findComprobanteFile(comp.ruta_archivo);

                                    if (filePath) {
                                        comprobantesPago.push({
                                            id: comp.id,
                                            nombre_archivo: comp.nombre_archivo,
                                            url: compUrl,
                                            ruta_archivo: compUrl,
                                            es_descargable: true
                                        });
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // La tabla puede no existir, ignorar error
                    }
                }
            })()
        ]);
        
        // Mapear vuelos para compatibilidad de campos (origen_nombre -> origen_ciudad, etc.)
        const vuelosMapeados = vuelos.map((v: any) => ({
            ...v,
            origen_ciudad: v.origen_ciudad || v.origen_nombre || v.origen,
            destino_ciudad: v.destino_ciudad || v.destino_nombre || v.destino,
            aerolinea_nombre: v.aerolinea_nombre || v.aerolinea,
            aerolinea_codigo: v.aerolinea_codigo || v.aerolinea?.substring(0, 2)?.toUpperCase() || 'AV'
        }));

        // Compatibilidad con datos legacy + desglose de precios desde paquete_data
        const paqueteDataPrecios = cotizacion?.paquete_data || {};
        const resultado = {
            ...cotizacion,
            pasajeros,
            vuelos: vuelosMapeados,
            hospedajes,
            traslados,
            seguros,
            extras,
            paquete,
            // Datos de venta (solo para admin/vendedor cuando está vendida)
            venta,
            comprobantes_pago: comprobantesPago,
            pagos,
            // Campos legacy para compatibilidad
            cliente_nombre: cotizacion?.cliente 
                ? `${cotizacion.cliente.nombre} ${cotizacion.cliente.apellido}`
                : cotizacion?.cliente_nombre || 'Sin cliente',
            vendedor_nombre: vendedor 
                ? `${vendedor.nombre} ${vendedor.apellido}`
                : 'Sin vendedor',
            vendedor,
            tipo_cotizacion: cotizacion?.tipo_cotizacion || (cotizacion?.paquete_id ? 'paquete' : 'manual'),
            // Desglose de precios expuesto en raíz para frontends
            precio_vuelos: paqueteDataPrecios.precio_vuelos ?? cotizacion?.precio_vuelos ?? 0,
            precio_hospedajes: paqueteDataPrecios.precio_hospedajes ?? cotizacion?.precio_hospedajes ?? 0,
            precio_traslados: paqueteDataPrecios.precio_traslados ?? cotizacion?.precio_traslados ?? 0,
            precio_seguros: paqueteDataPrecios.precio_seguros ?? cotizacion?.precio_seguros ?? 0,
            precio_extras: paqueteDataPrecios.precio_extras ?? cotizacion?.precio_extras ?? 0,
            precio_subtotal: paqueteDataPrecios.precio_subtotal ?? cotizacion?.precio_subtotal ?? 0,
            precio_impuestos: paqueteDataPrecios.precio_impuestos ?? cotizacion?.precio_impuestos ?? 0,
        };
        
        res.json(resultado);
    } catch (error) {
        console.error('Error fetching quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const convertirAVenta = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { 
        pago_realizado, 
        monto_pagado, 
        tipo_pago, 
        medio_pago, 
        observaciones_pago,
        fecha_pago_resto,
        datos_pasajeros 
    } = req.body;
    const user = (req as any).user;
    
    try {
        // Obtener cotización con sus comprobantes
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // Verificar permisos según metodología de trabajo
        const { mode: workflowMode } = await checkWorkflowMode(req);
        const esAdmin = user.role === 'admin';
        const esVendedorDueño = cotizacion.vendedor_id === user.userId;
        const puedeConvertir = esAdmin || (workflowMode === 'vendedor_autoconfirma' && esVendedorDueño);

        if (!puedeConvertir) {
            return res.status(403).json({
                error: workflowMode === 'admin_confirma'
                    ? 'Solo un administrador puede convertir cotizaciones en este modo'
                    : 'No autorizado'
            });
        }

        // Verificar si el módulo de comisiones está habilitado
        const { enabled: comisionesHabilitadas } = await checkFeatureEnabled(req, 'comisiones');

        // Verificar que no exista ya una venta para esta cotización
        const { data: ventaExistente, error: ventaCheckError } = await supabase
            .from('ventas')
            .select('id, codigo')
            .eq('tenant_id', tenantId)
            .eq('cotizacion_id', id)
            .maybeSingle();
        
        if (ventaExistente) {
            return res.status(400).json({ 
                error: 'Ya existe una venta para esta cotización',
                venta_id: ventaExistente.id,
                codigo: ventaExistente.codigo
            });
        }

        // Obtener datos del cliente si no están en la cotización
        let clienteNombre = cotizacion.cliente_nombre;
        let clienteEmail = cotizacion.cliente_email;
        let clienteTelefono = cotizacion.cliente_telefono;
        
        if (!clienteNombre && cotizacion.cliente_id) {
            const { data: cliente } = await supabase
                .from('clientes')
                .select('nombre, apellido, email, telefono')
                .eq('tenant_id', tenantId)
                .eq('id', cotizacion.cliente_id)
                .single();
            
            if (cliente) {
                clienteNombre = `${cliente.nombre} ${cliente.apellido}`.trim();
                clienteEmail = cliente.email;
                clienteTelefono = cliente.telefono;
            }
        }

        // Verificar cupos solo si viene de un paquete (cotizaciones manuales no tienen paquete_id)
        let paquete = null;
        if (cotizacion.paquete_id) {
            const { data: paqueteData, error: paqueteError } = await supabase
                .from('paquetes')
                .select('titulo, cupos_disponibles, cupos_totales')
                .eq('tenant_id', tenantId)
                .eq('id', cotizacion.paquete_id)
                .single();

            if (paqueteError || !paqueteData) {
                return res.status(404).json({ error: 'Paquete no encontrado' });
            }

            // Descuento atómico de cupos para evitar race condition/overbooking
            if (paqueteData.cupos_disponibles !== null && paqueteData.cupos_disponibles !== undefined) {
                const { data: paqueteActualizado, error: updateError } = await supabase
                    .from('paquetes')
                    .update({ cupos_disponibles: paqueteData.cupos_disponibles - cotizacion.num_pasajeros })
                    .eq('tenant_id', tenantId)
                    .eq('id', cotizacion.paquete_id)
                    .gte('cupos_disponibles', cotizacion.num_pasajeros)
                    .select()
                    .single();

                if (updateError || !paqueteActualizado) {
                    return res.status(400).json({ 
                        error: 'No hay cupos disponibles', 
                        disponibles: paqueteData.cupos_disponibles,
                        solicitados: cotizacion.num_pasajeros
                    });
                }
            }
            
            paquete = paqueteData;
        }

        // Obtener comprobantes de pago asociados
        const { data: comprobantes } = await supabase
            .from('comprobantes_pago')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cotizacion_id', id);

        // Generar código de venta
        const year = new Date().getFullYear();
        const random = randomDigits(5);
        const codigo_venta = `VEN-${year}-${random}`;

        // Preparar notas de venta con datos de pago
        let notasVenta = '';
        
        // Sección de pago
        notasVenta += `=== INFORMACIÓN DE PAGO ===\n`;
        notasVenta += `Pago Realizado: ${pago_realizado ? 'SÍ' : 'NO'}\n`;
        
        if (pago_realizado) {
            notasVenta += `Monto Pagado: $${monto_pagado || 0}\n`;
            notasVenta += `Tipo de Pago: ${tipo_pago === 'total' ? 'Pago Total' : 'Adelanto/Seña'}\n`;
            notasVenta += `Medio de Pago: ${medio_pago || 'No especificado'}\n`;
            notasVenta += `Fecha de Pago: ${new Date().toLocaleDateString('es-AR')}\n`;
            
            if (observaciones_pago) {
                notasVenta += `\nObservaciones del Pago:\n${observaciones_pago}\n`;
            }
        } else {
            notasVenta += `Estado: Pago pendiente - el cliente aún no ha realizado ningún pago\n`;
            if (observaciones_pago) {
                notasVenta += `\nNotas sobre pago pendiente:\n${observaciones_pago}\n`;
            }
        }
        
        // Comprobantes adjuntos
        if (comprobantes && comprobantes.length > 0) {
            notasVenta += `\n=== COMPROBANTES ADJUNTOS ===\n`;
            comprobantes.forEach((c: any, idx: number) => {
                notasVenta += `${idx + 1}. ${c.nombre_archivo} (${c.tipo_archivo})\n`;
            });
        }

        // Datos de pasajeros
        if (datos_pasajeros) {
            notasVenta += `\n=== DATOS DE PASAJEROS ===\n${datos_pasajeros}\n`;
        }

        // Notas originales
        if (cotizacion.notas) {
            notasVenta += `\n=== NOTAS ORIGINALES DE COTIZACIÓN ===\n${cotizacion.notas}`;
        }

        // Crear venta con datos heredados
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .insert({
                codigo: codigo_venta,
                cotizacion_id: id,
                vendedor_id: cotizacion.vendedor_id,
                cliente_nombre: clienteNombre || 'Cliente sin nombre',
                cliente_email: clienteEmail || null,
                cliente_telefono: clienteTelefono || null,
                paquete_id: cotizacion.paquete_id,
                paquete_nombre: paquete?.titulo || cotizacion.nombre_cotizacion || 'Viaje personalizado',
                fecha_salida: cotizacion.fecha_salida,
                num_pasajeros: cotizacion.num_pasajeros,
                precio_total: cotizacion.precio_total,
                tenant_id: tenantId,
                comision_porcentaje: 0,
                comision_monto: comisionesHabilitadas ? (cotizacion.comision_vendedor || 0) : 0,
                estado: (workflowMode === 'vendedor_autoconfirma' && pago_realizado) ? 'confirmada' : 'pendiente',
                notas: notasVenta || null,
                metodo_pago: medio_pago || null,
                // Campos heredados de pago
                pago_heredado: pago_realizado || false,
                monto_pagado_heredado: pago_realizado ? (monto_pagado || 0) : 0,
                tipo_pago_heredado: tipo_pago || 'pendiente',
                observaciones_pago_heredado: observaciones_pago || null,
                comprobantes_pago_urls: comprobantes && comprobantes.length > 0 
                    ? JSON.stringify(comprobantes.map((c: any) => `/uploads/comprobantes/${c.ruta_archivo}`))
                    : null
            })
            .select()
            .single();

        if (ventaError) {
            console.error('Error creating venta:', ventaError);
            return res.status(500).json({ 
                error: 'Error al crear venta', 
                details: ventaError.message,
                code: ventaError.code
            });
        }

        // Calcular monto restante
        const montoPagadoNum = Number(monto_pagado) || 0;
        const montoRestante = Math.max(0, cotizacion.precio_total - montoPagadoNum);
        
        // Actualizar cotización con datos de pago - ESTO ES CRÍTICO
        
        const updateData: any = { 
            estado: 'vendida',
            fecha_conversion: new Date().toISOString(),
            venta_id: venta.id
        };
        
        // Solo agregar campos de pago si se proporcionaron
        if (pago_realizado !== undefined) {
            updateData.pago_realizado = pago_realizado;
            updateData.monto_pagado = montoPagadoNum;
            updateData.monto_restante = montoRestante;
            updateData.tipo_pago = tipo_pago || (montoRestante > 0 ? 'parcial' : 'total');
            updateData.medio_pago = medio_pago || null;
            updateData.observaciones_pago = observaciones_pago || null;
            
            if (pago_realizado) {
                updateData.fecha_pago = new Date().toISOString();
                
                // Fecha pago resto solo si hay restante y se proporcionó
                if (montoRestante > 0 && fecha_pago_resto) {
                    updateData.fecha_pago_resto = fecha_pago_resto;
                }
            }
        }
        
        const { error: updateError } = await supabase
            .from('cotizaciones')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', id);
        if (updateError) {
            console.error('ERROR CRÍTICO: Venta creada pero cotización no actualizada:', updateError);
            // Intentar compensación: actualizar venta con estado especial
            await supabase
                .from('ventas')
                .update({ 
                    estado: 'pendiente_sync',
                    notas: (venta.notas || '') + '\n\n[ERROR] La cotización no se pudo marcar como vendida. ID de cotización: ' + id
                })
                .eq('tenant_id', tenantId)
                .eq('id', venta.id);
                
            return res.status(500).json({ 
                error: 'Error crítico: La venta se creó pero no se pudo actualizar la cotización', 
                venta_id: venta.id,
                details: updateError.message
            });
        }

        // Registrar pago inicial en historial
        if (pago_realizado && montoPagadoNum > 0) {
            await supabase.from('pagos_venta').insert({
                venta_id: venta.id,
                cotizacion_id: id,
                monto: montoPagadoNum,
                medio_pago: medio_pago || null,
                fecha_pago: new Date().toISOString().split('T')[0],
                observaciones: observaciones_pago || null,
                tipo: 'inicial',
                registrado_por: user.userId,
                tenant_id: tenantId
            });
        }

        // RESTAR CUPOS DISPONIBLES (solo si viene de un paquete)
        let nuevosCupos = null;
        if (paquete && cotizacion.paquete_id) {
            nuevosCupos = (paquete.cupos_disponibles || 0) - cotizacion.num_pasajeros;
            await supabase
                .from('paquetes')
                .update({ cupos_disponibles: nuevosCupos })
                .eq('tenant_id', tenantId)
                .eq('id', cotizacion.paquete_id);
        }

        // Notificar a admins y vendedor por email (fire-and-forget)
        const adminEmailsVenta = await getAdminEmails(tenantId);
        for (const adminEmail of adminEmailsVenta) {
            sendEmailAsync({
                to: adminEmail,
                subject: `Venta confirmada ${codigo_venta}`,
                templateName: 'nueva-venta',
                variables: {
                    adminNombre: '',
                    codigoVenta: codigo_venta,
                    vendedorNombre: (req as any).user?.nombre || 'Vendedor',
                    clienteNombre: clienteNombre || 'Cliente',
                    precioTotal: String(cotizacion.precio_total || 0),
                    comision: String(venta.comision_monto || 0),
                    linkAdmin: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/admin/cotizaciones/${id}`
                },
                metadata: { tipo: 'nueva_venta', venta_id: venta.id, cotizacion_id: id }
            });
        }

        // Notificar al vendedor
        const { data: vendedorData } = await supabase
            .from('users')
            .select('email, nombre')
            .eq('id', cotizacion.vendedor_id)
            .single();

        if (vendedorData?.email) {
            sendEmailAsync({
                to: vendedorData.email,
                subject: `Venta confirmada ${codigo_venta}`,
                templateName: 'nueva-venta-vendedor',
                variables: {
                    vendedorNombre: vendedorData.nombre || 'Vendedor',
                    codigoVenta: codigo_venta,
                    clienteNombre: clienteNombre || 'Cliente',
                    precioTotal: String(cotizacion.precio_total || 0),
                    comision: String(venta.comision_monto || 0),
                    linkVendedor: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/mis-ventas`
                },
                metadata: { tipo: 'nueva_venta_vendedor', venta_id: venta.id, cotizacion_id: id }
            });
        }

        // Notificación in-app (campanita): admins del tenant + vendedor dueño
        crearNotificacionInterna({
            tenantId,
            usuario_id: null,
            tipo: 'nueva_venta',
            titulo: `Venta confirmada ${codigo_venta}`,
            mensaje: `${(req as any).user?.nombre || 'Vendedor'} convirtió la cotización de ${clienteNombre || 'Cliente'} en venta por $${cotizacion.precio_total || 0}`,
            referencia_id: venta.id,
            referencia_tipo: 'venta'
        });
        if (cotizacion.vendedor_id) {
            crearNotificacionInterna({
                tenantId,
                usuario_id: cotizacion.vendedor_id,
                tipo: 'nueva_venta',
                titulo: `Venta confirmada ${codigo_venta}`,
                mensaje: `Tu cotización de ${clienteNombre || 'Cliente'} se convirtió en venta por $${cotizacion.precio_total || 0}`,
                referencia_id: venta.id,
                referencia_tipo: 'venta'
            });
        }

        // Usar montoPagadoNum y montoRestante ya calculados arriba
        res.status(201).json({ 
            message: 'Cotización convertida a venta exitosamente', 
            venta,
            cupos_restantes: nuevosCupos,
            comprobantes_count: comprobantes?.length || 0,
            pago_info: {
                monto_pagado: montoPagadoNum,
                monto_restante: montoRestante,
                tipo_pago: tipo_pago || (montoRestante > 0 ? 'parcial' : 'total'),
                fecha_pago_resto: montoRestante > 0 ? fecha_pago_resto : null,
                es_pago_total: montoRestante === 0
            }
        });
    } catch (error: any) {
        console.error('=== ERROR CONVERTIR A VENTA ===');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        console.error('Stack:', error.stack);
        
        res.status(500).json({ 
            error: 'Error al crear venta', 
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
    }
};

export const updateCotizacionManual = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const {
        nombre_cotizacion,
        vendedor_id: vendedor_id_body,
        vuelos,
        hospedajes,
        traslados,
        seguros,
        extras,
        itinerario,
        itinerario_manual,
        incluye,
        no_incluye,
        politicas_cancelacion,
        precios,
        destino_principal,
        pasajeros_ids,
        pasajeros_nuevos,
        cliente_id,
        mostrar_desglose_pdf,
        costo_neto,
        margen_agencia_porcentaje,
        margen_agencia_monto,
        comision_vendedor_porcentaje,
        comision_vendedor_monto_estimado,
        num_pasajeros,
        fecha_salida,
        amadeus_pnr_raw,
        notas_internas,
        imagen_url
    } = req.body;
    const user = (req as any).user;

    try {
        // 1. Obtener cotización existente
        const { data: cotizacionExistente, error: cotError } = await supabase
            .from('cotizaciones')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (cotError || !cotizacionExistente) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // 2. Validar estado
        if (cotizacionExistente.estado === 'vendida' || cotizacionExistente.estado === 'perdida') {
            return res.status(400).json({ error: 'No se puede editar una cotización vendida o perdida' });
        }

        // 3. Validar precios si vienen
        if (precios && (typeof precios.total !== 'number' || Number.isNaN(precios.total))) {
            return res.status(400).json({ error: 'Precio total debe ser un número' });
        }

        // 3. Validar permisos
        if (user.role !== 'admin' && cotizacionExistente.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // 4. Procesar pasajeros
        const pasajerosVinculados: Array<{
            pasajero_id: string;
            es_titular: boolean;
            nombre_snapshot: string;
            apellido_snapshot: string;
            documento_snapshot: string;
        }> = [];

        let clienteFinalId = cotizacionExistente.cliente_id;

        // Si cambió el cliente, actualizar
        if (cliente_id && cliente_id !== cotizacionExistente.cliente_id) {
            const { data: clienteExistente } = await supabase.from('clientes').select('*').eq('tenant_id', tenantId).eq('id', cliente_id).single();
            if (clienteExistente) {
                clienteFinalId = cliente_id;
            }
        }

        // Obtener datos del cliente
        const { data: clienteData } = await supabase.from('clientes').select('*').eq('tenant_id', tenantId).eq('id', clienteFinalId).single();

        // Procesar pasajeros existentes
        if (pasajeros_ids && pasajeros_ids.length > 0) {
            const { data: pasajerosExistentes } = await supabase.from('pasajeros').select('*').eq('tenant_id', tenantId).in('id', pasajeros_ids);
            if (pasajerosExistentes) {
                for (const p of pasajerosExistentes) {
                    pasajerosVinculados.push({
                        pasajero_id: p.id,
                        es_titular: p.es_cliente_registrado || false,
                        nombre_snapshot: p.nombre,
                        apellido_snapshot: p.apellido,
                        documento_snapshot: p.documento
                    });
                }
            }
        }

        // Obtener pasajero titular del cliente
        const { data: pasajeroTitular } = await supabase
            .from('pasajeros')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_titular_id', clienteFinalId)
            .eq('es_cliente_registrado', true)
            .single();

        if (pasajeroTitular) {
            const yaExiste = pasajerosVinculados.some(p => p.pasajero_id === pasajeroTitular.id);
            if (!yaExiste) {
                pasajerosVinculados.push({
                    pasajero_id: pasajeroTitular.id,
                    es_titular: true,
                    nombre_snapshot: pasajeroTitular.nombre,
                    apellido_snapshot: pasajeroTitular.apellido,
                    documento_snapshot: pasajeroTitular.documento
                });
            }
        }

        // Crear pasajeros nuevos
        if (pasajeros_nuevos && pasajeros_nuevos.length > 0) {
            for (const p of pasajeros_nuevos) {
                const { data: nuevoPasajero, error: pasajeroError } = await supabase
                    .from('pasajeros')
                    .insert({
                        cliente_titular_id: clienteFinalId,
                        tipo_documento: p.tipo_documento || 'CI',
                        documento: p.documento,
                        nombre: p.nombre,
                        apellido: p.apellido,
                        fecha_nacimiento: p.fecha_nacimiento,
                        nacionalidad: p.nacionalidad || 'Uruguay',
                        es_cliente_registrado: false,
                        tenant_id: tenantId
                    })
                    .select()
                    .single();

                if (pasajeroError || !nuevoPasajero) {
                    console.error('Error creating pasajero:', pasajeroError);
                    continue;
                }

                pasajerosVinculados.push({
                    pasajero_id: nuevoPasajero.id,
                    es_titular: false,
                    nombre_snapshot: nuevoPasajero.nombre,
                    apellido_snapshot: nuevoPasajero.apellido,
                    documento_snapshot: nuevoPasajero.documento
                });
            }
        }

        // 5. Sincronizar vuelos: eliminar existentes + insertar nuevos
        await supabase.from('vuelos').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);

        const vuelosValidos = (vuelos || []).filter((v: any) =>
            (v.origen_nombre || v.origen_codigo || v.origen_ciudad) &&
            (v.destino_nombre || v.destino_codigo || v.destino_ciudad) &&
            (v.aerolinea_nombre || v.aerolinea_codigo || v.numero_vuelo)
        );
        if (vuelosValidos.length > 0) {
            const vuelosInsert = vuelosValidos.map((v: any, index: number) => ({
                cotizacion_id: id,
                tipo_trayecto: v.tipo_trayecto || v.tipo || 'ida',
                orden: index + 1,
                aerolinea_codigo: v.aerolinea_codigo,
                aerolinea_nombre: v.aerolinea_nombre,
                numero_vuelo: v.numero_vuelo,
                origen_codigo: v.origen_codigo,
                origen_nombre: v.origen_nombre || v.origen_ciudad,
                origen_terminal: v.origen_terminal,
                destino_codigo: v.destino_codigo,
                destino_nombre: v.destino_nombre || v.destino_ciudad,
                destino_terminal: v.destino_terminal,
                fecha_salida: v.fecha_salida,
                hora_salida: v.hora_salida,
                fecha_llegada: v.fecha_llegada,
                hora_llegada: v.hora_llegada,
                clase_codigo: v.clase_codigo,
                clase_nombre: v.clase_nombre,
                duracion_minutos: v.duracion_minutos,
                es_escala: v.es_escala || false,
                datos_completos: { ...v, precio_por_persona: typeof v.precio_por_persona === 'number' ? v.precio_por_persona : null }
            }));

            const { error: vuelosError } = await supabase.from('vuelos').insert(vuelosInsert.map((v: any) => ({ ...v, tenant_id: tenantId })));
            if (vuelosError) console.error('Error updating vuelos:', vuelosError);
        }

        // 6. Sincronizar hospedajes: eliminar existentes + insertar nuevos
        await supabase.from('hospedajes').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);

        const hospedajesValidos = (hospedajes || []).filter((h: any) =>
            (h.nombre_alojamiento || h.nombre_hotel) && h.ciudad && h.fecha_checkin && h.fecha_checkout
        );
        if (hospedajesValidos.length > 0) {
            const hospedajesInsert = hospedajesValidos.map((h: any) => ({
                cotizacion_id: id,
                nombre_hotel: h.nombre_alojamiento || h.nombre_hotel,
                nombre_alojamiento: h.nombre_alojamiento || h.nombre_hotel,
                tipo_alojamiento: h.tipo_alojamiento || 'Hotel',
                link_hotel: h.link_hotel,
                cadena_hotelera: h.cadena_hotelera,
                ciudad: h.ciudad,
                pais: h.pais,
                direccion: h.direccion,
                fecha_checkin: h.fecha_checkin,
                fecha_checkout: h.fecha_checkout,
                tipo_habitacion: h.tipo_habitacion,
                regimen: h.regimen,
                precio_noche: h.precio_noche,
                precio_total: h.precio_total,
                precio_por_persona: h.precio_por_persona,
                moneda: h.moneda || 'USD',
                es_opcion: h.es_opcion || false,
                seleccionado: h.seleccionado || false,
                notas: h.notas
            }));

            const { error: hospedajesError } = await supabase.from('hospedajes').insert(hospedajesInsert.map((h: any) => ({ ...h, tenant_id: tenantId })));
            if (hospedajesError) console.error('Error updating hospedajes:', hospedajesError);
        }

        // 6b. Sincronizar traslados
        await supabase.from('traslados').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);
        const trasladosValidos = (traslados || []).filter((t: any) => t.nombre);
        if (trasladosValidos.length > 0) {
            const trasladosInsert = trasladosValidos.map((t: any, index: number) => ({
                cotizacion_id: id,
                tenant_id: tenantId,
                nombre: t.nombre,
                origen: t.origen,
                destino: t.destino,
                fecha: t.fecha,
                hora: t.hora,
                precio_por_persona: t.precio_por_persona,
                moneda: t.moneda || 'USD',
                notas: t.notas,
                orden: t.orden || index + 1
            }));
            const { error: trasladosError } = await supabase.from('traslados').insert(trasladosInsert);
            if (trasladosError) console.error('Error updating traslados:', trasladosError);
        }

        // 6c. Sincronizar seguros
        await supabase.from('seguros').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);
        const segurosValidos = (seguros || []).filter((s: any) => s.compania);
        if (segurosValidos.length > 0) {
            const segurosInsert = segurosValidos.map((s: any) => ({
                cotizacion_id: id,
                tenant_id: tenantId,
                compania: s.compania,
                tipo_cobertura: s.tipo_cobertura,
                cobertura_detalle: s.cobertura_detalle,
                fecha_inicio: s.fecha_inicio,
                fecha_fin: s.fecha_fin,
                precio_por_persona: s.precio_por_persona,
                moneda: s.moneda || 'USD',
                notas: s.notas
            }));
            const { error: segurosError } = await supabase.from('seguros').insert(segurosInsert);
            if (segurosError) console.error('Error updating seguros:', segurosError);
        }

        // 6d. Sincronizar extras
        await supabase.from('extras').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);
        const extrasValidos = (extras || []).filter((e: any) => e.nombre);
        if (extrasValidos.length > 0) {
            const extrasInsert = extrasValidos.map((e: any, index: number) => ({
                cotizacion_id: id,
                tenant_id: tenantId,
                nombre: e.nombre,
                descripcion: e.descripcion,
                fecha: e.fecha,
                precio_por_persona: e.precio_por_persona,
                moneda: e.moneda || 'USD',
                incluido: e.incluido !== false,
                orden: e.orden || index + 1
            }));
            const { error: extrasError } = await supabase.from('extras').insert(extrasInsert);
            if (extrasError) console.error('Error updating extras:', extrasError);
        }

        // 7. Sincronizar pasajeros: eliminar existentes + insertar nuevos
        await supabase.from('cotizacion_pasajeros').delete().eq('tenant_id', tenantId).eq('cotizacion_id', id);

        if (pasajerosVinculados.length > 0) {
            const pasajerosInsert = pasajerosVinculados.map((p: any) => ({
                cotizacion_id: id,
                pasajero_id: p.pasajero_id,
                es_titular: p.es_titular,
                nombre_snapshot: p.nombre_snapshot,
                apellido_snapshot: p.apellido_snapshot,
                documento_snapshot: p.documento_snapshot
            }));

            const { error: cpError } = await supabase.from('cotizacion_pasajeros').insert(pasajerosInsert.map((p: any) => ({ ...p, tenant_id: tenantId })));
            if (cpError) console.error('Error updating cotizacion_pasajeros:', cpError);
        }

        // 8. Armar paquete_data actualizado
        const itinerarioFinal = itinerario_manual || itinerario || cotizacionExistente.itinerario || null;
        const paqueteDataJson: any = {
            ...(cotizacionExistente.paquete_data || {}),
            titulo: nombre_cotizacion || cotizacionExistente.nombre_cotizacion || '',
            destino: destino_principal || cotizacionExistente.destino_principal || '',
            politicas_cancelacion: politicas_cancelacion || (cotizacionExistente.paquete_data?.politicas_cancelacion) || '',
            incluye: incluye || (cotizacionExistente.paquete_data?.incluye) || [],
            no_incluye: no_incluye || (cotizacionExistente.paquete_data?.no_incluye) || [],
            itinerario: itinerarioFinal,
            amadeus_pnr_raw: amadeus_pnr_raw ?? (cotizacionExistente.paquete_data?.amadeus_pnr_raw) ?? null,
            precio_vuelos: precios?.vuelos ?? 0,
            precio_hospedajes: precios?.hospedajes ?? 0,
            precio_traslados: precios?.traslados ?? 0,
            precio_seguros: precios?.seguros ?? 0,
            precio_extras: precios?.extras ?? 0,
            precio_subtotal: precios?.subtotal ?? 0,
            precio_impuestos: precios?.impuestos ?? 0
        };

        const precioTotal = precios?.total ?? cotizacionExistente.precio_total ?? 0;
        const destinoFinal = destino_principal || cotizacionExistente.destino_principal || '';

        // 9. Actualizar cotización
        const updatePayload: any = {
            cliente_id: clienteFinalId,
            nombre_cotizacion: nombre_cotizacion || cotizacionExistente.nombre_cotizacion,
            precio_total: precioTotal,
            precio_moneda: precios?.moneda || cotizacionExistente.precio_moneda || 'USD',
            paquete_data: paqueteDataJson,
            itinerario: itinerarioFinal,
            destino_principal: destinoFinal,
            num_pasajeros: num_pasajeros ?? pasajerosVinculados.length ?? cotizacionExistente.num_pasajeros ?? 1,
            fecha_salida: fecha_salida ?? cotizacionExistente.fecha_salida ?? null,
            mostrar_desglose_pdf: mostrar_desglose_pdf !== undefined ? mostrar_desglose_pdf : cotizacionExistente.mostrar_desglose_pdf,
            costo_neto: costo_neto !== undefined ? costo_neto : cotizacionExistente.costo_neto,
            margen_agencia_porcentaje: margen_agencia_porcentaje !== undefined ? margen_agencia_porcentaje : cotizacionExistente.margen_agencia_porcentaje,
            margen_agencia_monto: margen_agencia_monto !== undefined ? margen_agencia_monto : cotizacionExistente.margen_agencia_monto,
            comision_vendedor_porcentaje: comision_vendedor_porcentaje !== undefined ? comision_vendedor_porcentaje : cotizacionExistente.comision_vendedor_porcentaje,
            comision_vendedor_monto_estimado: comision_vendedor_monto_estimado !== undefined ? comision_vendedor_monto_estimado : cotizacionExistente.comision_vendedor_monto_estimado,
            notas_internas: notas_internas !== undefined ? notas_internas : cotizacionExistente.notas_internas,
            imagen_url: imagen_url !== undefined ? imagen_url : cotizacionExistente.imagen_url
        };

        if (user.role === 'admin' && vendedor_id_body) {
            updatePayload.vendedor_id = vendedor_id_body;
        }

        const { data: cotizacion, error: updateError } = await supabase
            .from('cotizaciones')
            .update(updatePayload)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (updateError || !cotizacion) {
            console.error('Error updating cotizacion:', updateError);
            return res.status(500).json({ error: 'Error al actualizar cotización', details: updateError });
        }

        // 10. Actualizar fecha_ultima_interaccion del cliente
        await supabase.from('clientes').update({ fecha_ultima_interaccion: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', clienteFinalId);

        // 11. Registrar en historial
        await supabase.from('historial_cliente').insert({
            cliente_id: clienteFinalId,
            tipo: 'cotizacion_editada',
            cotizacion_id: id,
            descripcion: `Cotización ${cotizacion.codigo} editada`,
            realizado_por: user.userId,
            realizado_por_nombre: user.nombre || user.email || 'Usuario',
            tenant_id: tenantId
        });

        res.json({
            message: 'Cotización actualizada exitosamente',
            cotizacion: {
                ...cotizacion,
                cliente: clienteData,
                pasajeros: pasajerosVinculados.length
            }
        });
    } catch (error: any) {
        console.error('Error updating manual quote:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const updateCotizacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const data = req.body;
    const user = (req as any).user;

    // Campos que nunca se pueden actualizar por API
    const forbiddenFields = ['id', 'tenant_id', 'codigo', 'created_at', 'updated_at'];

    // Campos editables por vendedores (dueños de la cotización)
    const vendedorAllowedFields = [
        'nombre_cotizacion', 'cliente_id', 'pasajeros', 'servicios', 'precio_total',
        'moneda', 'notas', 'fecha_expiracion', 'tipo_pago', 'monto_pagado',
        'monto_restante', 'fecha_pago_resto', 'incluye_iva', 'cotizacion_pdf_url',
        'comprobantes', 'estado', 'notas_internas'
    ];

    // Campos editables solo por admin
    const adminAllowedFields = [
        ...vendedorAllowedFields,
        'estado', 'vendedor_id', 'notas_admin', 'fecha_aprobacion', 'aprobada_por',
        'ultimo_recordatorio_enviado'
    ];

    const allowedFields = user.role === 'admin' ? adminAllowedFields : vendedorAllowedFields;

    // Filtrar campos permitidos y rechazar campos prohibidos
    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
        if (forbiddenFields.includes(key)) {
            return res.status(403).json({ error: `No se puede modificar el campo '${key}'` });
        }
        if (allowedFields.includes(key)) {
            updateData[key] = value;
        }
    }

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron campos válidos para actualizar' });
    }

    // Vendedores no pueden marcar como vendida directamente; debe usar convertirAVenta
    if (user.role !== 'admin' && updateData.estado === 'vendida') {
        return res.status(403).json({ error: 'Para convertir en venta usá el botón Convertir a Venta' });
    }

    try {
        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin') {
            const { data: cot, error: permError } = await supabase
                .from('cotizaciones')
                .select('vendedor_id')
                .eq('tenant_id', tenantId)
                .eq('id', id)
                .single();
            
            if (!cot || cot.vendedor_id !== user.userId) {
                return res.status(403).json({ error: 'No autorizado' });
            }
        }

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update(updateData)
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada', details: error });
        }

        res.json({ message: 'Cotización actualizada', cotizacion });
    } catch (error) {
        console.error('Error updating quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Nuevos endpoints para admin
export const aprobarCotizacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { notas_admin } = req.body;
    const user = (req as any).user;
    
    try {
        // Solo admin puede aprobar
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden aprobar cotizaciones' });
        }

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update({
                estado: 'aprobada',
                notas_admin: notas_admin || null,
                fecha_aprobacion: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        res.json({ message: 'Cotización aprobada', cotizacion });
    } catch (error) {
        console.error('Error approving quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const rechazarCotizacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { notas_admin } = req.body;
    const user = (req as any).user;
    
    try {
        // Solo admin puede rechazar
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden rechazar cotizaciones' });
        }

        if (!notas_admin) {
            return res.status(400).json({ error: 'Debe indicar el motivo del rechazo' });
        }

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update({
                estado: 'perdida',
                notas_admin: notas_admin,
                fecha_rechazo: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        res.json({ message: 'Cotización rechazada', cotizacion });
    } catch (error) {
        console.error('Error rejecting quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


// ============================================
// NUEVA COTIZACIÓN MANUAL (DESDE CERO) - CRM v2
// ============================================

// Endpoint: POST /api/cotizaciones/manual
export const createCotizacionManual = async (req: Request, res: Response) => {
    try {
        const { 
            cliente_id,           // Si existe cliente
            cliente_nuevo,        // Si hay que crear cliente { nombre, apellido, email, documento, ... }
            pasajeros_ids,        // IDs de pasajeros existentes [id1, id2]
            pasajeros_nuevos,     // Nuevos pasajeros [{ nombre, apellido, documento, ... }]
            pasajero_titular_id,  // ID del pasajero titular (debe estar en pasajeros_ids o ser creado)
            nombre_cotizacion,
            vendedor_id: vendedor_id_body,
            paquete_id,           // Si viene de un paquete del catálogo
            tipo_cotizacion,      // 'manual' | 'paquete'
            hotel_seleccionado_id, // ID del hotel seleccionado (si viene de paquete con hoteles)
            tipo_habitacion,      // 'doble' | 'triple' | 'cuadruple'
            vuelos,
            hospedajes,
            traslados,
            seguros,
            extras,
            itinerario,
            itinerario_manual,
            incluye,
            no_incluye,
            politicas_cancelacion,
            precios,
            origen_datos,
            amadeus_pnr_raw,
            mostrar_desglose_pdf,
            costo_neto,
            margen_agencia_porcentaje,
            margen_agencia_monto,
            comision_vendedor_porcentaje,
            comision_vendedor_monto_estimado,
            num_pasajeros,
            fecha_salida,
            notas_internas,
            imagen_url
        } = req.body;

        const user = (req as any).user;
        const tenantId = getTenantId(req);
        const vendedor_id = (user.role === 'admin' && vendedor_id_body) 
            ? vendedor_id_body 
            : user.userId;

        // ========== VALIDACIONES ==========
        if (!cliente_id && !cliente_nuevo) {
            return res.status(400).json({ error: 'Debe proporcionar cliente_id o datos de cliente_nuevo' });
        }

        if (!precios || typeof precios.total !== 'number' || Number.isNaN(precios.total)) {
            return res.status(400).json({ error: 'Precio total es requerido y debe ser un número' });
        }

        // ========== PASO 1: BUSCAR O CREAR CLIENTE ==========
        let clienteFinalId: string;
        let clienteData: any = null;

        if (cliente_id) {
            // Usar cliente existente
            const { data: clienteExistente, error: clienteError } = await supabase
                .from('clientes')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('id', cliente_id)
                .single();
            
            if (clienteError || !clienteExistente) {
                return res.status(404).json({ error: 'Cliente no encontrado' });
            }
            
            clienteFinalId = cliente_id;
            clienteData = clienteExistente;
        } else {
            // Crear nuevo cliente
            const { data: nuevoCliente, error: createError } = await supabase
                .from('clientes')
                .insert({
                    tipo_documento: cliente_nuevo.tipo_documento || 'CI',
                    documento: cliente_nuevo.documento,
                    nombre: cliente_nuevo.nombre,
                    apellido: cliente_nuevo.apellido,
                    email: cliente_nuevo.email,
                    telefono: cliente_nuevo.telefono,
                    telefono_alt: cliente_nuevo.telefono_alt,
                    fecha_nacimiento: cliente_nuevo.fecha_nacimiento,
                    nacionalidad: cliente_nuevo.nacionalidad || 'Uruguay',
                    registrado_por: vendedor_id,
                    tenant_id: tenantId
                })
                .select()
                .single();
            
            if (createError || !nuevoCliente) {
                console.error('Error creating cliente:', createError);
                return res.status(500).json({ error: 'Error al crear cliente', details: createError });
            }
            
            clienteFinalId = nuevoCliente.id;
            clienteData = nuevoCliente;
            
            // Crear pasajero titular automáticamente para el nuevo cliente
            const { data: pasajeroTitular, error: pasajeroError } = await supabase
                .from('pasajeros')
                .insert({
                    cliente_titular_id: nuevoCliente.id,
                    tipo_documento: cliente_nuevo.tipo_documento || 'CI',
                    documento: cliente_nuevo.documento,
                    nombre: cliente_nuevo.nombre,
                    apellido: cliente_nuevo.apellido,
                    fecha_nacimiento: cliente_nuevo.fecha_nacimiento,
                    nacionalidad: cliente_nuevo.nacionalidad || 'Uruguay',
                    es_cliente_registrado: true,
                    cliente_id: nuevoCliente.id,
                    tenant_id: tenantId
                })
                .select()
                .single();
            
            if (pasajeroError) {
                console.error('Error creating pasajero titular:', pasajeroError);
            }
        }

        // ========== PASO 2: MANEJAR PASAJEROS ==========
        const pasajerosVinculados: Array<{
            pasajero_id: string;
            es_titular: boolean;
            nombre_snapshot: string;
            apellido_snapshot: string;
            documento_snapshot: string;
            tipo_habitacion?: string;
            regimen?: string;
            precio_individual?: number;
        }> = [];

        // 2.1: Procesar pasajeros existentes
        if (pasajeros_ids && pasajeros_ids.length > 0) {
            const { data: pasajerosExistentes, error: pasajerosError } = await supabase
                .from('pasajeros')
                .select('*')
                .eq('tenant_id', tenantId)
                .in('id', pasajeros_ids);
            
            if (pasajerosError) {
                console.error('Error fetching pasajeros:', pasajerosError);
            } else if (pasajerosExistentes) {
                for (const p of pasajerosExistentes) {
                    pasajerosVinculados.push({
                        pasajero_id: p.id,
                        es_titular: p.id === pasajero_titular_id,
                        nombre_snapshot: p.nombre,
                        apellido_snapshot: p.apellido,
                        documento_snapshot: p.documento
                    });
                }
            }
        }

        // 2.2: SIEMPRE obtener el pasajero titular del cliente
        // Primero buscar si ya existe
        let { data: pasajeroTitular } = await supabase
            .from('pasajeros')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('cliente_titular_id', clienteFinalId)
            .eq('es_cliente_registrado', true)
            .single();
        
        // Si NO existe pasajero titular, crearlo automáticamente con datos del cliente
        if (!pasajeroTitular && clienteData) {
            const { data: nuevoTitular, error: errorCreando } = await supabase
                .from('pasajeros')
                .insert({
                    cliente_titular_id: clienteFinalId,
                    tipo_documento: clienteData.tipo_documento || 'CI',
                    documento: clienteData.documento,
                    nombre: clienteData.nombre,
                    apellido: clienteData.apellido,
                    fecha_nacimiento: clienteData.fecha_nacimiento,
                    nacionalidad: clienteData.nacionalidad || 'Uruguay',
                    es_cliente_registrado: true,
                    notas: 'Creado automáticamente al generar cotización',
                    tenant_id: tenantId
                })
                .select()
                .single();
            
            if (errorCreando) {
                console.error('Error creando pasajero titular:', errorCreando);
            } else {
                pasajeroTitular = nuevoTitular;
            }
        }
        
        // Agregar el titular a la lista (evitando duplicados)
        if (pasajeroTitular) {
            const yaExiste = pasajerosVinculados.some(p => p.pasajero_id === pasajeroTitular.id);
            if (!yaExiste) {
                pasajerosVinculados.push({
                    pasajero_id: pasajeroTitular.id,
                    es_titular: true,
                    nombre_snapshot: pasajeroTitular.nombre,
                    apellido_snapshot: pasajeroTitular.apellido,
                    documento_snapshot: pasajeroTitular.documento
                });
            }
        }

        // 2.3: Crear pasajeros nuevos (acompañantes)
        if (pasajeros_nuevos && pasajeros_nuevos.length > 0) {
            for (const p of pasajeros_nuevos) {
                const { data: nuevoPasajero, error: pasajeroError } = await supabase
                    .from('pasajeros')
                    .insert({
                        cliente_titular_id: clienteFinalId,
                        tipo_documento: p.tipo_documento || 'CI',
                        documento: p.documento,
                        nombre: p.nombre,
                        apellido: p.apellido,
                        fecha_nacimiento: p.fecha_nacimiento,
                        nacionalidad: p.nacionalidad || 'Uruguay',
                        es_cliente_registrado: false,
                        tenant_id: tenantId
                    })
                    .select()
                    .single();
                
                if (pasajeroError || !nuevoPasajero) {
                    console.error('Error creating pasajero:', pasajeroError);
                    continue;
                }
                
                pasajerosVinculados.push({
                    pasajero_id: nuevoPasajero.id,
                    es_titular: false,
                    nombre_snapshot: nuevoPasajero.nombre,
                    apellido_snapshot: nuevoPasajero.apellido,
                    documento_snapshot: nuevoPasajero.documento
                });
            }
        }

        // ========== PASO 3: CONSULTAR PAQUETE (si aplica) ==========
        let paqueteData: any = null;
        let paqueteItinerario = itinerario_manual || itinerario || null;
        let paqueteIncluye = incluye || [];
        let paqueteNoIncluye = no_incluye || [];
        let paquetePoliticas = politicas_cancelacion || '';
        let paqueteDestino = '';
        let hotelSeleccionado: any = null;
        let precioCalculado = precios?.total ?? 0;
        const habitacionTipo = tipo_habitacion || 'doble';
        const numViajeros = num_pasajeros ?? pasajerosVinculados.length ?? 1;
        
        if (paquete_id) {
            const { data: paquete } = await supabase
                .from('paquetes')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('id', paquete_id)
                .single();
            
            if (paquete) {
                paqueteData = paquete;
                paqueteDestino = paquete.destino || '';
                
                // Usar datos del paquete si no se proporcionaron explícitamente
                if (!paqueteItinerario && paquete.itinerario) {
                    paqueteItinerario = paquete.itinerario;
                }
                if (paqueteIncluye.length === 0 && paquete.incluye) {
                    paqueteIncluye = paquete.incluye;
                }
                if (paqueteNoIncluye.length === 0 && paquete.no_incluye) {
                    paqueteNoIncluye = paquete.no_incluye;
                }
                if (!paquetePoliticas && paquete.politicas_cancelacion) {
                    paquetePoliticas = paquete.politicas_cancelacion;
                }
                
                // Buscar hotel seleccionado
                const hoteles = paquete.hoteles || [];
                if (hotel_seleccionado_id && hoteles.length > 0) {
                    hotelSeleccionado = hoteles.find((h: any) => h.id === hotel_seleccionado_id);
                }
                // Si no se especificó hotel pero hay hoteles, usar el primero
                if (!hotelSeleccionado && hoteles.length > 0) {
                    hotelSeleccionado = hoteles[0];
                }
                
                // Calcular precio según hotel y tipo de habitación
                if (hotelSeleccionado) {
                    const precioPorPersona = hotelSeleccionado.precios?.[habitacionTipo] 
                        || hotelSeleccionado.precios?.doble 
                        || paquete.precio_doble 
                        || paquete.precio_base 
                        || 0;
                    precioCalculado = precioPorPersona * numViajeros;
                }
            }
        }

        // Normalizar origen_datos: 'amadeus' es legacy, la DB acepta 'manual' o 'amadeus_pnr'
        const origenDatosNormalizado = (origen_datos === 'amadeus' ? 'amadeus_pnr' : origen_datos) || 'manual';

        // ========== PASO 4: CREAR COTIZACIÓN ==========
        const year = new Date().getFullYear();
        const random = randomDigits(5);
        const codigo = `COT-${year}-${random}`;

        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

        // Determinar destino principal
        let destino_principal = paqueteDestino;
        if (!destino_principal && hotelSeleccionado?.ciudad) {
            destino_principal = hotelSeleccionado.ciudad;
        } else if (!destino_principal && hospedajes && hospedajes.length > 0) {
            destino_principal = hospedajes[0].ciudad;
        } else if (!destino_principal && vuelos && vuelos.length > 0) {
            const vueloDestino = vuelos.find((v: any) => v.tipo_trayecto === 'ida' || !v.tipo_trayecto);
            destino_principal = vueloDestino?.destino_ciudad || vuelos[0].destino_ciudad;
        }

        // Preparar paquete_data
        const paqueteDataJson: any = {
            titulo: paqueteData?.titulo || nombre_cotizacion || '',
            destino: paqueteData?.destino || destino_principal,
            descripcion: paqueteData?.descripcion || '',
            duracion_dias: paqueteData?.duracion_dias,
            imagen_principal: paqueteData?.imagen_principal,
            politicas_cancelacion: paquetePoliticas,
            incluye: paqueteIncluye,
            no_incluye: paqueteNoIncluye,
            itinerario: limpiarItinerarioRepetido(paqueteItinerario, amadeus_pnr_raw),
            vuelos: paqueteData?.vuelos || [],
            amadeus_pnr_raw: amadeus_pnr_raw || null,
            // Desglose de precios
            precio_vuelos: precios?.vuelos ?? 0,
            precio_hospedajes: precios?.hospedajes ?? 0,
            precio_traslados: precios?.traslados ?? 0,
            precio_seguros: precios?.seguros ?? 0,
            precio_extras: precios?.extras ?? 0,
            precio_subtotal: precios?.subtotal ?? 0,
            precio_impuestos: precios?.impuestos ?? 0
        };
        
        // Agregar hotel seleccionado al paquete_data
        if (hotelSeleccionado) {
            paqueteDataJson.hotel_seleccionado = {
                id: hotelSeleccionado.id,
                nombre: hotelSeleccionado.nombre,
                link: hotelSeleccionado.link,
                ciudad: hotelSeleccionado.ciudad,
                tipo_habitacion: habitacionTipo,
                precio_por_persona: hotelSeleccionado.precios?.[habitacionTipo] || hotelSeleccionado.precios?.doble || 0
            };
        }

        const { data: cotizacion, error: cotizacionError } = await supabase
            .from('cotizaciones')
            .insert({
                codigo,
                cliente_id: clienteFinalId,
                vendedor_id,
                paquete_id: paquete_id || null,
                estado: 'nueva',
                fecha_creacion: new Date().toISOString(),
                fecha_expiracion: fecha_expiracion.toISOString(),
                nombre_cotizacion: nombre_cotizacion || `Viaje a ${destino_principal || 'Destino'}`,
                tipo_cotizacion: 'manual',
                origen_datos: origenDatosNormalizado,
                precio_total: precioCalculado,
                precio_moneda: precios?.moneda || 'USD',
                comision_vendedor: 0,
                costo_neto: costo_neto ?? null,
                margen_agencia_porcentaje: margen_agencia_porcentaje ?? null,
                margen_agencia_monto: margen_agencia_monto ?? null,
                comision_vendedor_porcentaje: comision_vendedor_porcentaje ?? null,
                comision_vendedor_monto_estimado: comision_vendedor_monto_estimado ?? null,
                mostrar_desglose_pdf: mostrar_desglose_pdf !== undefined ? mostrar_desglose_pdf : true,
                paquete_data: paqueteDataJson,
                itinerario: paqueteItinerario,
                notas: paquete_id 
                    ? `Cotización desde paquete: ${paqueteData?.titulo || ''}. Destino: ${destino_principal}`
                    : `Cotización manual creada desde cero. Destino: ${destino_principal}`,
                destino_principal,
                num_pasajeros: num_pasajeros ?? pasajerosVinculados.length ?? 1,
                fecha_salida: fecha_salida || null,
                notas_internas: notas_internas || null,
                imagen_url: imagen_url || null,
                tenant_id: tenantId
            })
            .select()
            .single();

        if (cotizacionError || !cotizacion) {
            console.error('Error creating cotizacion:', cotizacionError);
            return res.status(500).json({ error: 'Error al crear cotización', details: cotizacionError });
        }

        // ========== PASO 4: GUARDAR VUELOS ==========
        // Si hay vuelos explícitos, usarlos. Si no y hay paquete, usar vuelos del paquete
        const vuelosAGuardar = ((vuelos && vuelos.length > 0)
            ? vuelos
            : (paqueteData?.vuelos || []))
            .filter((v: any) =>
                (v.origen_nombre || v.origen_codigo || v.origen_ciudad) &&
                (v.destino_nombre || v.destino_codigo || v.destino_ciudad) &&
                (v.aerolinea_nombre || v.aerolinea_codigo || v.numero_vuelo)
            );
        
        if (vuelosAGuardar.length > 0) {
            const vuelosInsert = vuelosAGuardar.map((v: any, index: number) => ({
                cotizacion_id: cotizacion.id,
                tipo_trayecto: v.tipo || v.tipo_trayecto || 'ida',
                orden: index + 1,
                aerolinea_codigo: v.aerolinea_codigo,
                aerolinea_nombre: v.aerolinea_nombre,
                numero_vuelo: v.numero_vuelo,
                origen_codigo: v.origen_codigo,
                origen_nombre: v.origen_nombre || v.origen_ciudad,
                origen_terminal: v.origen_terminal,
                destino_codigo: v.destino_codigo,
                destino_nombre: v.destino_nombre || v.destino_ciudad,
                destino_terminal: v.destino_terminal,
                fecha_salida: v.fecha_salida,
                hora_salida: v.hora_salida,
                fecha_llegada: v.fecha_llegada,
                hora_llegada: v.hora_llegada,
                clase_codigo: v.clase_codigo,
                clase_nombre: v.clase_nombre,
                duracion_minutos: v.duracion_minutos,
                es_escala: v.es_escala || false,
                datos_completos: { ...v, precio_por_persona: typeof v.precio_por_persona === 'number' ? v.precio_por_persona : null }
            }));

            const { error: vuelosError } = await supabase
                .from('vuelos')
                .insert(vuelosInsert.map((v: any) => ({ ...v, tenant_id: tenantId })));

            if (vuelosError) {
                console.error('Error creating vuelos:', vuelosError);
            }
        }

        // ========== PASO 5: GUARDAR HOSPEDAJES ==========
        const hospedajesValidos = (hospedajes || []).filter((h: any) =>
            (h.nombre_alojamiento || h.nombre_hotel) && h.ciudad && h.fecha_checkin && h.fecha_checkout
        );
        if (hospedajesValidos.length > 0) {
            const hospedajesInsert = hospedajesValidos.map((h: any) => ({
                cotizacion_id: cotizacion.id,
                nombre_hotel: h.nombre_alojamiento || h.nombre_hotel,
                nombre_alojamiento: h.nombre_alojamiento || h.nombre_hotel,
                tipo_alojamiento: h.tipo_alojamiento || 'Hotel',
                link_hotel: h.link_hotel,
                cadena_hotelera: h.cadena_hotelera,
                ciudad: h.ciudad,
                pais: h.pais,
                direccion: h.direccion,
                fecha_checkin: h.fecha_checkin,
                fecha_checkout: h.fecha_checkout,
                tipo_habitacion: h.tipo_habitacion,
                regimen: h.regimen,
                precio_noche: h.precio_noche,
                precio_total: h.precio_total,
                precio_por_persona: h.precio_por_persona,
                moneda: h.moneda || 'USD',
                es_opcion: h.es_opcion || false,
                seleccionado: h.seleccionado || false,
                notas: h.notas
            }));

            const { error: hospedajesError } = await supabase
                .from('hospedajes')
                .insert(hospedajesInsert.map((h: any) => ({ ...h, tenant_id: tenantId })));

            if (hospedajesError) {
                console.error('Error creating hospedajes:', hospedajesError);
            }
        }

        // ========== PASO 5b: GUARDAR TRASLADOS ==========
        const trasladosValidos = (traslados || []).filter((t: any) => t.nombre);
        if (trasladosValidos.length > 0) {
            const trasladosInsert = trasladosValidos.map((t: any, index: number) => ({
                cotizacion_id: cotizacion.id,
                tenant_id: tenantId,
                nombre: t.nombre,
                origen: t.origen,
                destino: t.destino,
                fecha: t.fecha,
                hora: t.hora,
                precio_por_persona: t.precio_por_persona,
                moneda: t.moneda || 'USD',
                notas: t.notas,
                orden: t.orden || index + 1
            }));

            const { error: trasladosError } = await supabase
                .from('traslados')
                .insert(trasladosInsert);

            if (trasladosError) {
                console.error('Error creating traslados:', trasladosError);
            }
        }

        // ========== PASO 5c: GUARDAR SEGUROS ==========
        const segurosValidos = (seguros || []).filter((s: any) => s.compania);
        if (segurosValidos.length > 0) {
            const segurosInsert = segurosValidos.map((s: any) => ({
                cotizacion_id: cotizacion.id,
                tenant_id: tenantId,
                compania: s.compania,
                tipo_cobertura: s.tipo_cobertura,
                cobertura_detalle: s.cobertura_detalle,
                fecha_inicio: s.fecha_inicio,
                fecha_fin: s.fecha_fin,
                precio_por_persona: s.precio_por_persona,
                moneda: s.moneda || 'USD',
                notas: s.notas
            }));

            const { error: segurosError } = await supabase
                .from('seguros')
                .insert(segurosInsert);

            if (segurosError) {
                console.error('Error creating seguros:', segurosError);
            }
        }

        // ========== PASO 5d: GUARDAR EXTRAS ==========
        const extrasValidos = (extras || []).filter((e: any) => e.nombre);
        if (extrasValidos.length > 0) {
            const extrasInsert = extrasValidos.map((e: any, index: number) => ({
                cotizacion_id: cotizacion.id,
                tenant_id: tenantId,
                nombre: e.nombre,
                descripcion: e.descripcion,
                fecha: e.fecha,
                precio_por_persona: e.precio_por_persona,
                moneda: e.moneda || 'USD',
                incluido: e.incluido !== false,
                orden: e.orden || index + 1
            }));

            const { error: extrasError } = await supabase
                .from('extras')
                .insert(extrasInsert);

            if (extrasError) {
                console.error('Error creating extras:', extrasError);
            }
        }

        // ========== PASO 6: VINCULAR PASAJEROS A COTIZACIÓN ==========
        if (pasajerosVinculados.length > 0) {
            const pasajerosInsert = pasajerosVinculados.map((p: any) => ({
                cotizacion_id: cotizacion.id,
                pasajero_id: p.pasajero_id,
                es_titular: p.es_titular,
                nombre_snapshot: p.nombre_snapshot,
                apellido_snapshot: p.apellido_snapshot,
                documento_snapshot: p.documento_snapshot
            }));

            const { error: cpError } = await supabase
                .from('cotizacion_pasajeros')
                .insert(pasajerosInsert.map((p: any) => ({ ...p, tenant_id: tenantId })));

            if (cpError) {
                console.error('Error creating cotizacion_pasajeros:', cpError);
            }
        }

        // ========== PASO 7: REGISTRAR EN HISTORIAL ==========
        await supabase
            .from('historial_cliente')
            .insert({
                cliente_id: clienteFinalId,
                tipo: 'cotizacion_creada',
                cotizacion_id: cotizacion.id,
                descripcion: `Cotización ${codigo} creada para ${destino_principal || 'destino personalizado'}`,
                realizado_por: vendedor_id,
                realizado_por_nombre: user.nombre || user.email || 'Usuario',
                tenant_id: tenantId
            });

        // Actualizar fecha_ultima_interaccion del cliente
        await supabase
            .from('clientes')
            .update({ fecha_ultima_interaccion: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('id', clienteFinalId);

        // Notificar a admins por email (fire-and-forget)
        const adminEmailsManual = await getAdminEmails(tenantId);
        for (const adminEmail of adminEmailsManual) {
            sendEmailAsync({
                to: adminEmail,
                subject: `Nueva cotización ${codigo}`,
                templateName: 'nueva-cotizacion',
                variables: {
                    adminNombre: '',
                    codigo,
                    vendedorNombre: user.nombre || 'Vendedor',
                    clienteNombre: clienteData ? `${clienteData.nombre || ''} ${clienteData.apellido || ''}`.trim() : 'Cliente',
                    montoTotal: String(cotizacion.precio_total || 0),
                    linkAdmin: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/admin/cotizaciones/${cotizacion.id}`
                },
                metadata: { tipo: 'nueva_cotizacion', cotizacion_id: cotizacion.id }
            });
        }

        // Notificación in-app (campanita) para admins del tenant
        crearNotificacionInterna({
            tenantId,
            usuario_id: null,
            tipo: 'nueva_cotizacion',
            titulo: `Nueva cotización ${codigo}`,
            mensaje: `${user.nombre || user.email || 'Vendedor'} creó una cotización para ${clienteData ? `${clienteData.nombre || ''} ${clienteData.apellido || ''}`.trim() : 'Cliente'} por $${cotizacion.precio_total || 0}`,
            referencia_id: cotizacion.id,
            referencia_tipo: 'cotizacion'
        });

        res.status(201).json({
            message: 'Cotización creada exitosamente',
            cotizacion: {
                ...cotizacion,
                cliente: clienteData,
                pasajeros: pasajerosVinculados.length
            }
        });

    } catch (error: any) {
        console.error('Error creating manual quote:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const deleteCotizacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const vendedor_id = (req as any).user.userId;
    const userRole = (req as any).user.role;

    try {
        // Verificar que la cotización existe
        const { data: cotizacion, error: findError } = await supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (findError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // Verificar permisos: solo el dueño o un admin puede eliminar
        if (cotizacion.vendedor_id !== vendedor_id && userRole !== 'admin') {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta cotización' });
        }

        // No permitir eliminar cotizaciones ya vendidas (convertidas)
        if (cotizacion.estado === 'vendida') {
            return res.status(400).json({ 
                error: 'No se puede eliminar una cotización que ya fue convertida en venta',
                message: 'Esta cotización ya fue vendida y no puede ser eliminada por razones de auditoría.'
            });
        }

        // Eliminar la cotización
        const { error: deleteError } = await supabase
            .from('cotizaciones')
            .delete()
            .eq('tenant_id', tenantId)
            .eq('id', id);

        if (deleteError) {
            console.error('Error deleting cotizacion:', deleteError);
            return res.status(500).json({ error: 'Error al eliminar la cotización', details: deleteError.message });
        }

        res.json({
            message: 'Cotización eliminada permanentemente',
            id: id
        });

    } catch (error: any) {
        console.error('Error deleting cotizacion:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

// ============================================
// ENDPOINT PARA ENVIAR COTIZACIÓN (marcar como enviada)
// ============================================

export const enviarCotizacion = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;

    try {
        // Primero verificar que exista la cotización
        const { data: cotizacionExistente, error: findError } = await supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado, codigo')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();
        
        if (findError || !cotizacionExistente) {
            return res.status(404).json({ error: 'Cotización no encontrada', details: findError });
        }
        
        // Verificar permisos
        if (user.role !== 'admin' && cotizacionExistente.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        
        // Actualizar estado a enviada
        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update({ 
                estado: 'enviada'
            })
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .select()
            .single();
        
        if (error) {
            console.error('ENVIAR COTIZACION - Update error:', error);
            return res.status(500).json({ error: 'Error al actualizar', details: error });
        }
        
        res.json({ 
            message: 'Cotización marcada como enviada', 
            cotizacion 
        });
        
    } catch (error: any) {
        console.error('Error enviando cotización:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

// ============================================
// ENVIAR COTIZACIÓN PDF POR EMAIL
// ============================================

export const enviarCotizacionPdf = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const user = (req as any).user;
    const { to, pdfBase64, filename } = req.body;

    try {
        // Validar datos requeridos
        if (!to || !pdfBase64) {
            return res.status(400).json({ error: 'Destinatario (to) y pdfBase64 son requeridos' });
        }

        // Verificar que exista la cotización y permisos
        const { data: cotizacionExistente, error: findError } = await supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado, codigo, cliente_id, precio_total, precio_moneda, destino_principal, nombre_cotizacion, paquete_data')
            .eq('tenant_id', tenantId)
            .eq('id', id)
            .single();

        if (findError || !cotizacionExistente) {
            return res.status(404).json({ error: 'Cotización no encontrada', details: findError });
        }

        if (user.role !== 'admin' && cotizacionExistente.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Decodificar PDF
        let pdfBuffer: Buffer;
        try {
            const base64Data = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;
            pdfBuffer = Buffer.from(base64Data, 'base64');
        } catch (decodeError: any) {
            return res.status(400).json({ error: 'PDF inválido', details: decodeError.message });
        }

        // Obtener datos del cliente y vendedor para personalizar
        let clienteNombre = 'Cliente';
        try {
            const { data: cliente } = await supabase
                .from('clientes')
                .select('nombre, apellido, email')
                .eq('tenant_id', tenantId)
                .eq('id', cotizacionExistente.cliente_id)
                .single();
            if (cliente) {
                clienteNombre = `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() || 'Cliente';
            }
        } catch (e) { /* noop */ }

        let vendedorNombre = user.nombre || user.email || 'Vendedor';
        try {
            const { data: vendedor } = await supabase
                .from('users')
                .select('nombre, apellido')
                .eq('id', cotizacionExistente.vendedor_id)
                .single();
            if (vendedor) {
                vendedorNombre = `${vendedor.nombre || ''} ${vendedor.apellido || ''}`.trim() || vendedorNombre;
            }
        } catch (e) { /* noop */ }

        const destino = cotizacionExistente.destino_principal
            || cotizacionExistente.nombre_cotizacion
            || 'Viaje';
        const montoTotal = `${cotizacionExistente.precio_moneda || 'USD'} ${cotizacionExistente.precio_total || 0}`;
        const pdfFilename = filename || `COT-${cotizacionExistente.codigo}.pdf`;

        // Enviar email (fire-and-forget)
        sendCotizacionPdfEmail(
            to,
            {
                clienteNombre,
                codigo: cotizacionExistente.codigo,
                destino,
                montoTotal,
                vendedorNombre,
                linkPanel: `${process.env.PANEL_URL || 'https://panel.tripconecta.com'}/cotizaciones/${cotizacionExistente.id}`
            },
            pdfBuffer,
            pdfFilename,
            { cotizacion_id: cotizacionExistente.id, tenant_id: tenantId, enviado_por: user.userId }
        );

        // Actualizar estado a enviada si aún está nueva
        if (cotizacionExistente.estado === 'nueva') {
            await supabase
                .from('cotizaciones')
                .update({ estado: 'enviada', fecha_envio: new Date().toISOString() })
                .eq('tenant_id', tenantId)
                .eq('id', id);
        }

        res.json({ message: 'Cotización enviada por email' });
    } catch (error: any) {
        console.error('Error enviando cotización PDF:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

// ============================================
// MIGRACIÓN TEMPORAL - Solo para admin
// ============================================

export const runMigration = async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden ejecutar migraciones' });
    }
    
    try {
        // Ejecutar la migración SQL
        const { error } = await supabase.rpc('exec_sql', {
            sql: `
                ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_envio TIMESTAMP WITH TIME ZONE;
                ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;
                ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check 
                    CHECK (estado IN ('nueva', 'enviada', 'vendida', 'perdida', 'aprobada'));

                -- Migración 027: fix multi-tenant unique constraints en clientes
                ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_tipo_documento_documento_key;
                ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_email_key;
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'clientes_tenant_tipo_documento_documento_key'
                  ) THEN
                    ALTER TABLE clientes
                      ADD CONSTRAINT clientes_tenant_tipo_documento_documento_key
                      UNIQUE (tenant_id, tipo_documento, documento);
                  END IF;

                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'clientes_tenant_email_key'
                  ) THEN
                    ALTER TABLE clientes
                      ADD CONSTRAINT clientes_tenant_email_key
                      UNIQUE (tenant_id, email);
                  END IF;
                END $$;

                -- Migración 028: mejoras de pricing
                ALTER TABLE cotizaciones
                    ALTER COLUMN precio_moneda TYPE VARCHAR(10);
                ALTER TABLE cotizaciones
                    ADD COLUMN IF NOT EXISTS costo_neto NUMERIC(12,2),
                    ADD COLUMN IF NOT EXISTS margen_agencia_monto NUMERIC(12,2),
                    ADD COLUMN IF NOT EXISTS margen_agencia_porcentaje NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS comision_vendedor_porcentaje NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS comision_vendedor_monto_estimado NUMERIC(12,2),
                    ADD COLUMN IF NOT EXISTS mostrar_desglose_pdf BOOLEAN DEFAULT true;
                CREATE INDEX IF NOT EXISTS idx_cotizaciones_mostrar_desglose ON cotizaciones(mostrar_desglose_pdf);
            `
        });
        
        if (error) {
            console.error('Error en migración:', error);
            return res.status(500).json({ error: 'Error en migración', details: error });
        }
        
        res.json({ message: 'Migración ejecutada exitosamente' });
    } catch (error: any) {
        console.error('Error ejecutando migración:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};
