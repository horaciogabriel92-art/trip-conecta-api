import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const createCotizacion = async (req: Request, res: Response) => {
    const { 
        paquete_id, 
        cliente_nombre, 
        cliente_email, 
        cliente_telefono,
        tipo_habitacion,
        num_pasajeros,
        fecha_salida,
        precio_total: precio_enviado,
        notas,
        datos_completos
    } = req.body;
    const vendedor_id = (req as any).user.userId;

    console.log('Creating cotizacion with data:', req.body);

    try {
        // Obtener paquete para verificar
        const { data: paquete, error: paqueteError } = await supabase
            .from('paquetes')
            .select('*')
            .eq('id', paquete_id)
            .single();

        if (paqueteError || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        // Usar precio enviado desde frontend o calcular
        const precio_total = precio_enviado || paquete.precio_base * num_pasajeros;
        
        // Generar código único
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const codigo = `COT-${year}-${random}`;

        // Calcular fecha de expiración (7 días)
        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

        // Preparar datos del paquete como objeto para guardar en notas
        // Nota: el campo 'descripcion' contiene el itinerario (la pestaña cambió de nombre)
        const paqueteData: any = {
            titulo: paquete.titulo,
            destino: paquete.destino,
            descripcion: '', // No mostrar descripción si es el itinerario
            duracion_dias: paquete.duracion_dias,
            imagen_principal: paquete.imagen_principal,
            politicas_cancelacion: paquete.politicas_cancelacion
        };
        
        // El itinerario está en el campo 'descripcion' (la pestaña se llamaba así antes)
        // o en el campo 'itinerario' si existe
        if (paquete.descripcion && paquete.descripcion.trim()) {
            paqueteData.itinerario = paquete.descripcion;
        } else if (paquete.itinerario) {
            try {
                paqueteData.itinerario = typeof paquete.itinerario === 'string' 
                    ? JSON.parse(paquete.itinerario) 
                    : paquete.itinerario;
            } catch (e) {
                paqueteData.itinerario = paquete.itinerario;
            }
        }
        
        // Parsear y guardar incluye
        if (paquete.incluye) {
            try {
                paqueteData.incluye = typeof paquete.incluye === 'string' 
                    ? JSON.parse(paquete.incluye) 
                    : paquete.incluye;
            } catch (e) {
                paqueteData.incluye = [];
            }
        }
        
        // Parsear y guardar no_incluye
        if (paquete.no_incluye) {
            try {
                paqueteData.no_incluye = typeof paquete.no_incluye === 'string' 
                    ? JSON.parse(paquete.no_incluye) 
                    : paquete.no_incluye;
            } catch (e) {
                paqueteData.no_incluye = [];
            }
        }
        
        // Preparar notas extendidas
        let notasExtendidas = notas || '';
        notasExtendidas += '\n\n--- PAQUETE JSON ---\n' + JSON.stringify(paqueteData, null, 2);
        
        // También guardar datos completos del cliente
        if (datos_completos) {
            notasExtendidas += '\n\n--- DATOS COMPLETOS ---\n' + JSON.stringify(datos_completos, null, 2);
        }

        const insertData: any = {
            codigo,
            vendedor_id,
            paquete_id,
            cliente_nombre,
            cliente_email,
            cliente_telefono,
            tipo_habitacion,
            num_pasajeros,
            fecha_salida: fecha_salida || null,
            precio_total,
            comision_vendedor: precio_total * 0.12, // 12% comisión
            notas: notasExtendidas,
            fecha_expiracion: fecha_expiracion.toISOString(),
            estado: 'pendiente'
        };

        console.log('Inserting cotizacion:', insertData);

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(400).json({ 
                error: 'Error al crear cotización', 
                details: error.message,
                code: error.code 
            });
        }

        res.status(201).json(cotizacion);
    } catch (error: any) {
        console.error('Error creating quote:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

export const getCotizaciones = async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        let query = supabase.from('cotizaciones').select('*');
        
        // Si no es admin, solo ver las suyas
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizaciones, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;
        res.json(cotizaciones);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCotizacionById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        let query = supabase
            .from('cotizaciones')
            .select('*')
            .eq('id', id);
        
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizacion, error } = await query.single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        res.json(cotizacion);
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

        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
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
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .insert({
                codigo: codigo_venta,
                cotizacion_id: id,
                vendedor_id: cotizacion.vendedor_id,
                cliente_nombre: cotizacion.cliente_nombre,
                cliente_email: cotizacion.cliente_email,
                cliente_telefono: cotizacion.cliente_telefono,
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

        if (ventaError) throw ventaError;

        // Actualizar cotización con datos de pago
        await supabase
            .from('cotizaciones')
            .update({ 
                estado: 'convertida',
                fecha_conversion: new Date().toISOString(),
                pago_realizado: pago_realizado || false,
                monto_pagado: pago_realizado ? monto_pagado : null,
                tipo_pago: tipo_pago || 'pendiente',
                medio_pago: medio_pago || null,
                observaciones_pago: observaciones_pago || null,
                fecha_pago: pago_realizado ? new Date().toISOString() : null
            })
            .eq('id', id);

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
        console.error('Error converting quote:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const updateCotizacion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    const user = (req as any).user;
    
    try {
        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin') {
            const { data: cot } = await supabase
                .from('cotizaciones')
                .select('vendedor_id')
                .eq('id', id)
                .single();
            
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

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
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
                estado: 'cancelada',
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
// NUEVA COTIZACIÓN MANUAL (DESDE CERO)
// ============================================

// Endpoint: POST /api/cotizaciones/manual
export const createCotizacionManual = async (req: Request, res: Response) => {
    const { 
        cliente,
        pasajeros,
        vuelos,
        hospedaje,
        traslados,
        itinerario_manual,
        incluye,
        no_incluye,
        politicas_cancelacion,
        precios,
        origen_datos,
        amadeus_pnr_raw
    } = req.body;

    const vendedor_id = (req as any).user.userId;

    console.log('Creating manual cotizacion:', { cliente, vuelos: vuelos?.length, hospedaje: hospedaje?.length });

    try {
        // Generar código único
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const codigo = `COT-${year}-${random}`;

        // Calcular fecha de expiración (7 días)
        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

        // Preparar datos_completos unificado
        const datosCompletos = {
            cliente,
            pasajeros: pasajeros || [],
            num_pasajeros: 1 + (pasajeros?.length || 0)
        };

        // Determinar destino principal (primera ciudad de hospedaje o destino de primer vuelo)
        let destino_principal = '';
        if (hospedaje && hospedaje.length > 0) {
            destino_principal = hospedaje[0].ciudad;
        } else if (vuelos && vuelos.length > 0) {
            destino_principal = vuelos[vuelos.length - 1].destino_ciudad;
        }

        // Construir nombre del cliente
        const cliente_nombre = `${cliente.nombre} ${cliente.apellido}`;

        // Insertar cotización
        const insertData = {
            codigo,
            vendedor_id,
            paquete_id: null, // No tiene paquete asociado
            cliente_nombre,
            cliente_email: cliente.email,
            cliente_telefono: cliente.telefono,
            tipo_habitacion: hospedaje?.[0]?.tipo_habitacion || 'doble',
            num_pasajeros: datosCompletos.num_pasajeros,
            fecha_salida: vuelos?.[0]?.fecha_salida || null,
            precio_total: parseFloat(precios?.total) || 0,
            comision_vendedor: (parseFloat(precios?.total) || 0) * 0.12,
            notas: `Cotización manual creada desde cero. Destino: ${destino_principal}`,
            tipo_cotizacion: 'manual',
            vuelos: vuelos || [],
            hospedaje: hospedaje || [],
            traslados: traslados || [],
            datos_completos: datosCompletos,
            incluye: incluye || [],
            no_incluye: no_incluye || [],
            itinerario_manual: itinerario_manual || '',
            fecha_expiracion: fecha_expiracion.toISOString(),
            estado: 'pendiente',
            origen_datos: origen_datos || 'manual',
            amadeus_pnr_raw: amadeus_pnr_raw || null
        };

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Error creating manual cotizacion:', error);
            return res.status(500).json({ error: 'Error al crear cotización', details: error.message });
        }

        res.status(201).json({
            message: 'Cotización manual creada exitosamente',
            cotizacion
        });

    } catch (error: any) {
        console.error('Error creating manual quote:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};
