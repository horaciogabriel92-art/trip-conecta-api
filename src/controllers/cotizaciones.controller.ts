import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

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

    console.log('[createCotizacion] Data:', req.body);

    try {
        // ========== PASO 1: OBTENER PAQUETE ==========
        const { data: paquete, error: paqueteError } = await supabase
            .from('paquetes')
            .select('*')
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
                .eq('email', cliente_email)
                .single();
            if (existenteEmail) clienteId = existenteEmail.id;
        }
        
        if (!clienteId && cliente_documento) {
            const { data: existenteDoc } = await supabase
                .from('clientes')
                .select('id')
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
                    registrado_por: vendedor_id
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
                documento: cliente_documento
            });
        }

        // ========== PASO 3: CREAR PASAJEROS ADICIONALES ==========
        const pasajerosVinculados: any[] = [];
        const numViajeros = num_pasajeros || 2; // Default 2 para base doble
        
        // Pasajero 1: Titular (el cliente)
        const { data: pasajeroTitular } = await supabase
            .from('pasajeros')
            .select('*')
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
                    apellido: 'Viaje'
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
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const codigo = `COT-${year}-${random}`;
        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

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
                comision_vendedor: precio_total * 0.12,
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
            realizado_por_nombre: (req as any).user.nombre || 'Vendedor'
        });

        res.status(201).json(cotizacion);
    } catch (error: any) {
        console.error('[createCotizacion] Error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const getCotizaciones = async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        console.log('[getCotizaciones] User:', { userId: user?.userId, role: user?.role });
        
        // 1. Traer cotizaciones básicas
        let query = supabase
            .from('cotizaciones')
            .select('*');
        
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizaciones, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) {
            console.error('[getCotizaciones] Error:', error);
            return res.status(500).json({ error: 'Error al obtener cotizaciones', details: error.message });
        }
        
        console.log('[getCotizaciones] Encontradas:', cotizaciones?.length || 0);
        
        // 2. Obtener IDs únicos de clientes para consulta batch
        const clienteIds = [...new Set(cotizaciones?.filter(c => c.cliente_id).map(c => c.cliente_id) || [])];
        
        // 3. Consultar clientes en batch
        let clientesMap: any = {};
        if (clienteIds.length > 0) {
            const { data: clientes } = await supabase
                .from('clientes')
                .select('id, nombre, apellido')
                .in('id', clienteIds);
            
            clientes?.forEach(c => {
                clientesMap[c.id] = c;
            });
        }
        
        // 4. Para cada cotización, obtener conteos de vuelos y hospedajes
        const cotizacionesConDatos = await Promise.all(
            (cotizaciones || []).map(async (c: any) => {
                // Contar vuelos
                const { count: numVuelos } = await supabase
                    .from('vuelos')
                    .select('*', { count: 'exact', head: true })
                    .eq('cotizacion_id', c.id);
                
                // Contar hospedajes
                const { count: numHospedajes } = await supabase
                    .from('hospedajes')
                    .select('*', { count: 'exact', head: true })
                    .eq('cotizacion_id', c.id);
                
                // Determinar tipo y nombres
                const tipoCotizacion = c.tipo_cotizacion || (c.paquete_id ? 'paquete' : 'manual');
                
                // Cliente: usar tabla clientes si existe, sino legacy
                let clienteNombre = c.cliente_nombre || 'Sin cliente';
                if (c.cliente_id && clientesMap[c.cliente_id]) {
                    clienteNombre = `${clientesMap[c.cliente_id].nombre} ${clientesMap[c.cliente_id].apellido}`;
                }
                
                const paqueteNombre = c.nombre_cotizacion || c.paquete_nombre || 'Cotización';
                
                return {
                    ...c,
                    tipo_cotizacion: tipoCotizacion,
                    cliente_nombre: clienteNombre,
                    paquete_nombre: paqueteNombre,
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
    const { id } = req.params;
    const user = (req as any).user;
    
    console.log('[getCotizacionById] User:', { userId: user?.userId, role: user?.role });
    console.log('[getCotizacionById] Cotizacion ID:', id);
    
    try {
        // Primero: consulta simple sin joins para verificar existencia y permisos
        let basicQuery = supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado')
            .eq('id', id);
        
        if (user.role !== 'admin') {
            basicQuery = basicQuery.eq('vendedor_id', user.userId);
        }
        
        const { data: basicData, error: basicError } = await basicQuery.single();
        
        console.log('[getCotizacionById] Basic query:', { found: !!basicData, error: basicError?.message });
        
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
            .eq('id', id)
            .single();
        
        if (error) {
            console.error('[getCotizacionById] Error con cliente:', error);
            // Si falla el join con cliente, devolver sin esa relación
            const { data: cotizacionSinCliente } = await supabase
                .from('cotizaciones')
                .select('*')
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
        let pasajeros = [];
        let vuelos = [];
        let hospedajes = [];
        let paquete = null;
        
        // Cargar pasajeros
        try {
            const { data: p } = await supabase
                .from('cotizacion_pasajeros')
                .select('*, pasajero:pasajero_id (*)')
                .eq('cotizacion_id', id);
            pasajeros = p || [];
        } catch (e) { console.log('Error cargando pasajeros:', e); }
        
        // Cargar vuelos desde tabla vuelos (cotizaciones manuales)
        try {
            const { data: v } = await supabase
                .from('vuelos')
                .select('*')
                .eq('cotizacion_id', id);
            vuelos = v || [];
        } catch (e) { console.log('Error cargando vuelos:', e); }
        
        // Cargar hospedajes
        try {
            const { data: h } = await supabase
                .from('hospedajes')
                .select('*')
                .eq('cotizacion_id', id);
            hospedajes = h || [];
        } catch (e) { console.log('Error cargando hospedajes:', e); }
        
        // Si es cotización de paquete, cargar datos del paquete (vuelos, itinerario, etc.)
        if (cotizacion?.paquete_id) {
            try {
                const { data: p } = await supabase
                    .from('paquetes')
                    .select('*')
                    .eq('id', cotizacion.paquete_id)
                    .single();
                paquete = p;
                
                // Si no hay vuelos en la tabla vuelos, usar los del paquete
                if (vuelos.length === 0 && paquete?.vuelos) {
                    vuelos = paquete.vuelos;
                }
            } catch (e) { console.log('Error cargando paquete:', e); }
        }
        
        // ========== CARGAR DATOS DE VENTA Y COMPROBANTES (si está vendida) ==========
        let venta = null;
        let comprobantesPago: any[] = [];
        
        if (cotizacion?.estado === 'vendida') {
            try {
                // Buscar venta asociada
                const { data: v } = await supabase
                    .from('ventas')
                    .select('*')
                    .eq('cotizacion_id', id)
                    .single();
                venta = v;
                
                if (venta) {
                    // Parsear comprobantes_pago_urls si existe
                    if (venta.comprobantes_pago_urls) {
                        try {
                            const urls = JSON.parse(venta.comprobantes_pago_urls);
                            comprobantesPago = urls.map((url: string, idx: number) => {
                                const filename = url.split('/').pop() || `comprobante_${idx + 1}`;
                                return {
                                    id: `comp_${idx}`,
                                    nombre_archivo: filename,
                                    url: url,
                                    es_descargable: true
                                };
                            });
                        } catch (e) {
                            console.log('Error parseando comprobantes_pago_urls:', e);
                        }
                    }
                    
                    // También buscar en tabla comprobantes_pago si existe
                    try {
                        const { data: comps } = await supabase
                            .from('comprobantes_pago')
                            .select('*')
                            .eq('venta_id', venta.id);
                        if (comps && comps.length > 0) {
                            // Merge comprobantes de la tabla con los de JSON
                            const existingUrls = new Set(comprobantesPago.map((c: any) => c.url));
                            comps.forEach((comp: any) => {
                                if (!existingUrls.has(comp.ruta_archivo)) {
                                    comprobantesPago.push({
                                        id: comp.id,
                                        nombre_archivo: comp.nombre_archivo,
                                        url: comp.ruta_archivo,
                                        es_descargable: true
                                    });
                                }
                            });
                        }
                    } catch (e) {
                        // La tabla puede no existir, ignorar error
                        console.log('Tabla comprobantes_pago no disponible:', e);
                    }
                }
            } catch (e) { 
                console.log('Error cargando venta/comprobantes:', e); 
            }
        }
        
        // Mapear vuelos para compatibilidad de campos (origen_nombre -> origen_ciudad, etc.)
        const vuelosMapeados = vuelos.map((v: any) => ({
            ...v,
            origen_ciudad: v.origen_ciudad || v.origen_nombre || v.origen,
            destino_ciudad: v.destino_ciudad || v.destino_nombre || v.destino,
            aerolinea_nombre: v.aerolinea_nombre || v.aerolinea,
            aerolinea_codigo: v.aerolinea_codigo || v.aerolinea?.substring(0, 2)?.toUpperCase() || 'AV'
        }));

        // Compatibilidad con datos legacy
        const resultado = {
            ...cotizacion,
            pasajeros,
            vuelos: vuelosMapeados,
            hospedajes,
            paquete,
            // Datos de venta (solo para admin/vendedor cuando está vendida)
            venta,
            comprobantes_pago: comprobantesPago,
            // Campos legacy para compatibilidad
            cliente_nombre: cotizacion?.cliente 
                ? `${cotizacion.cliente.nombre} ${cotizacion.cliente.apellido}`
                : cotizacion?.cliente_nombre || 'Sin cliente',
            tipo_cotizacion: cotizacion?.tipo_cotizacion || (cotizacion?.paquete_id ? 'paquete' : 'manual')
        };
        
        res.json(resultado);
    } catch (error) {
        console.error('Error fetching quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const convertirAVenta = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { 
        pago_realizado, 
        monto_pagado, 
        tipo_pago, 
        medio_pago, 
        observaciones_pago,
        datos_pasajeros 
    } = req.body;
    const user = (req as any).user;
    
    console.log('=== CONVERTIR A VENTA ===');
    console.log('ID:', id);
    console.log('User:', user?.userId, 'Role:', user?.role);
    console.log('Body:', { pago_realizado, monto_pagado, tipo_pago, medio_pago, observaciones_pago: observaciones_pago?.substring(0, 50) });
    
    try {
        // Obtener cotización con sus comprobantes
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select('*')
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        console.log('Cotización encontrada:', { 
            id: cotizacion.id, 
            cliente_id: cotizacion.cliente_id,
            cliente_nombre: cotizacion.cliente_nombre,
            cliente_email: cotizacion.cliente_email,
            cliente_telefono: cotizacion.cliente_telefono
        });

        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Verificar que no exista ya una venta para esta cotización
        const { data: ventaExistente, error: ventaCheckError } = await supabase
            .from('ventas')
            .select('id, codigo')
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
                .eq('id', cotizacion.cliente_id)
                .single();
            
            if (cliente) {
                clienteNombre = `${cliente.nombre} ${cliente.apellido}`.trim();
                clienteEmail = cliente.email;
                clienteTelefono = cliente.telefono;
                console.log('Cliente obtenido de tabla clientes:', { clienteNombre, clienteEmail });
            }
        }

        // Verificar que haya cupos disponibles
        const { data: paquete, error: paqueteError } = await supabase
            .from('paquetes')
            .select('titulo, cupos_disponibles, cupos_totales')
            .eq('id', cotizacion.paquete_id)
            .single();

        if (paqueteError || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        if ((paquete.cupos_disponibles || 0) < cotizacion.num_pasajeros) {
            return res.status(400).json({ 
                error: 'No hay cupos disponibles', 
                disponibles: paquete.cupos_disponibles,
                solicitados: cotizacion.num_pasajeros
            });
        }

        // Obtener comprobantes de pago asociados
        const { data: comprobantes } = await supabase
            .from('comprobantes_pago')
            .select('*')
            .eq('cotizacion_id', id);

        // Generar código de venta
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
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
        console.log('Creando venta con:', { clienteNombre, clienteEmail, clienteTelefono });
        
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
                paquete_nombre: paquete?.titulo || 'Paquete',
                fecha_salida: cotizacion.fecha_salida,
                num_pasajeros: cotizacion.num_pasajeros,
                precio_total: cotizacion.precio_total,
                comision_porcentaje: 12,
                comision_monto: cotizacion.comision_vendedor || (cotizacion.precio_total * 0.12),
                estado: 'confirmada',
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

        // Actualizar cotización con datos de pago
        console.log('Actualizando cotización a vendida...');
        const { error: updateError } = await supabase
            .from('cotizaciones')
            .update({ 
                estado: 'vendida',
                fecha_conversion: new Date().toISOString(),
                pago_realizado: pago_realizado || false,
                monto_pagado: pago_realizado ? monto_pagado : null,
                tipo_pago: tipo_pago || 'pendiente',
                medio_pago: medio_pago || null,
                observaciones_pago: observaciones_pago || null,
                fecha_pago: pago_realizado ? new Date().toISOString() : null
            })
            .eq('id', id);
        
        if (updateError) {
            console.error('Error actualizando cotización:', updateError);
            // No fallamos la venta si esto falla, solo logueamos
        } else {
            console.log('Cotización actualizada a vendida exitosamente');
        }

        // RESTAR CUPOS DISPONIBLES
        const nuevosCupos = (paquete.cupos_disponibles || 0) - cotizacion.num_pasajeros;
        await supabase
            .from('paquetes')
            .update({ cupos_disponibles: nuevosCupos })
            .eq('id', cotizacion.paquete_id);

        res.status(201).json({ 
            message: 'Cotización convertida a venta exitosamente', 
            venta,
            cupos_restantes: nuevosCupos,
            comprobantes_count: comprobantes?.length || 0
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

export const updateCotizacion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    const user = (req as any).user;
    
    console.log('UPDATE COTIZACION - ID recibido:', id, 'tipo:', typeof id);
    console.log('UPDATE COTIZACION - User:', user.userId, 'Role:', user.role);
    console.log('UPDATE COTIZACION - Data:', data);
    
    try {
        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin') {
            const { data: cot, error: permError } = await supabase
                .from('cotizaciones')
                .select('vendedor_id')
                .eq('id', id)
                .single();
            
            console.log('UPDATE COTIZACION - Perm check:', cot, 'Error:', permError);
            
            if (!cot || cot.vendedor_id !== user.userId) {
                return res.status(403).json({ error: 'No autorizado' });
            }
        }

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update(data)
            .eq('id', id)
            .select()
            .single();

        console.log('UPDATE COTIZACION - Result:', cotizacion, 'Error:', error);

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
            itinerario,
            incluye,
            no_incluye,
            politicas_cancelacion,
            precios,
            origen_datos,
            amadeus_pnr_raw
        } = req.body;

        const user = (req as any).user;
        const vendedor_id = (user.role === 'admin' && vendedor_id_body) 
            ? vendedor_id_body 
            : user.userId;

        // ========== VALIDACIONES ==========
        if (!cliente_id && !cliente_nuevo) {
            return res.status(400).json({ error: 'Debe proporcionar cliente_id o datos de cliente_nuevo' });
        }

        if (!precios || !precios.total) {
            return res.status(400).json({ error: 'Precio total es requerido' });
        }

        // ========== PASO 1: BUSCAR O CREAR CLIENTE ==========
        let clienteFinalId: string;
        let clienteData: any = null;

        if (cliente_id) {
            // Usar cliente existente
            const { data: clienteExistente, error: clienteError } = await supabase
                .from('clientes')
                .select('*')
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
                    registrado_por: vendedor_id
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
                    cliente_id: nuevoCliente.id
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
            .eq('cliente_titular_id', clienteFinalId)
            .eq('es_cliente_registrado', true)
            .single();
        
        // Si NO existe pasajero titular, crearlo automáticamente con datos del cliente
        if (!pasajeroTitular && clienteData) {
            console.log('Creando pasajero titular automáticamente para cliente:', clienteFinalId);
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
                    notas: 'Creado automáticamente al generar cotización'
                })
                .select()
                .single();
            
            if (errorCreando) {
                console.error('Error creando pasajero titular:', errorCreando);
            } else {
                pasajeroTitular = nuevoTitular;
                console.log('Pasajero titular creado:', nuevoTitular?.id);
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
                        es_cliente_registrado: false
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
        let paqueteItinerario = itinerario || null;
        let paqueteIncluye = incluye || [];
        let paqueteNoIncluye = no_incluye || [];
        let paquetePoliticas = politicas_cancelacion || '';
        let paqueteDestino = '';
        let hotelSeleccionado: any = null;
        let precioCalculado = parseFloat(precios?.total) || 0;
        const habitacionTipo = tipo_habitacion || 'doble';
        const numViajeros = pasajerosVinculados.length || 1;
        
        if (paquete_id) {
            const { data: paquete } = await supabase
                .from('paquetes')
                .select('*')
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

        // ========== PASO 4: CREAR COTIZACIÓN ==========
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
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
            itinerario: paqueteItinerario,
            vuelos: paqueteData?.vuelos || [],
            // Desglose de precios
            precio_vuelos: precios?.vuelos || 0,
            precio_hospedajes: precios?.hospedajes || precioCalculado,
            precio_extras: precios?.extras || 0,
            precio_subtotal: precios?.subtotal || precioCalculado,
            precio_impuestos: precios?.impuestos || 0
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
                tipo_cotizacion: tipo_cotizacion || (paquete_id ? 'paquete' : 'manual'),
                origen_datos: origen_datos || 'manual',
                precio_total: precioCalculado,
                precio_moneda: precios?.moneda || 'USD',
                comision_vendedor: precioCalculado * 0.12,
                paquete_data: paqueteDataJson,
                itinerario: paqueteItinerario,
                notas: paquete_id 
                    ? `Cotización desde paquete: ${paqueteData?.titulo || ''}. Destino: ${destino_principal}`
                    : `Cotización manual creada desde cero. Destino: ${destino_principal}`,
                destino_principal,
                num_pasajeros: pasajerosVinculados.length
            })
            .select()
            .single();

        if (cotizacionError || !cotizacion) {
            console.error('Error creating cotizacion:', cotizacionError);
            return res.status(500).json({ error: 'Error al crear cotización', details: cotizacionError });
        }

        // ========== PASO 4: GUARDAR VUELOS ==========
        // Si hay vuelos explícitos, usarlos. Si no y hay paquete, usar vuelos del paquete
        const vuelosAGuardar = (vuelos && vuelos.length > 0) 
            ? vuelos 
            : (paqueteData?.vuelos || []);
        
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
                datos_completos: v
            }));

            const { error: vuelosError } = await supabase
                .from('vuelos')
                .insert(vuelosInsert);

            if (vuelosError) {
                console.error('Error creating vuelos:', vuelosError);
            }
        }

        // ========== PASO 5: GUARDAR HOSPEDAJES ==========
        if (hospedajes && hospedajes.length > 0) {
            const hospedajesInsert = hospedajes.map((h: any) => ({
                cotizacion_id: cotizacion.id,
                nombre_hotel: h.nombre_hotel,
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
                moneda: h.moneda || 'USD',
                notas: h.notas
            }));

            const { error: hospedajesError } = await supabase
                .from('hospedajes')
                .insert(hospedajesInsert);

            if (hospedajesError) {
                console.error('Error creating hospedajes:', hospedajesError);
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
                .insert(pasajerosInsert);

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
                realizado_por_nombre: user.nombre || user.email || 'Usuario'
            });

        // Actualizar fecha_ultima_interaccion del cliente
        await supabase
            .from('clientes')
            .update({ fecha_ultima_interaccion: new Date().toISOString() })
            .eq('id', clienteFinalId);

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
    const { id } = req.params;
    const vendedor_id = (req as any).user.userId;
    const userRole = (req as any).user.role;

    try {
        // Verificar que la cotización existe
        const { data: cotizacion, error: findError } = await supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado')
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
    const { id } = req.params;
    const user = (req as any).user;
    
    console.log('ENVIAR COTIZACION - ID recibido:', id);
    console.log('ENVIAR COTIZACION - User:', user.userId, 'Role:', user.role);
    
    try {
        // Primero verificar que exista la cotización
        const { data: cotizacionExistente, error: findError } = await supabase
            .from('cotizaciones')
            .select('id, vendedor_id, estado, codigo')
            .eq('id', id)
            .single();
        
        console.log('ENVIAR COTIZACION - Found:', cotizacionExistente, 'Error:', findError);
        
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
                    CHECK (estado IN ('nueva', 'enviada', 'vendida', 'perdida'));
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
