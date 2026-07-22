import { supabase } from '../config/supabase';

/**
 * Datos de ejemplo (mock data) para tenants nuevos.
 * Todo se marca con prefijo DEMO- en codigo/documento para poder
 * identificarlo y eliminarlo de forma segura con deleteDemoData().
 * Son 100% inventados: nombres, emails (@ejemplo.com) y documentos falsos.
 */

const IMG_PLAYA = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200';
const IMG_EUROPA = 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1200';
const IMG_CATARATAS = 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1200';

export const hasDemoData = async (tenantId: string): Promise<boolean> => {
    const { data } = await supabase
        .from('paquetes')
        .select('id')
        .eq('tenant_id', tenantId)
        .like('codigo', 'DEMO-%')
        .limit(1);
    return Boolean(data && data.length > 0);
};

export const seedDemoData = async (tenantId: string, userId: string): Promise<void> => {
    if (await hasDemoData(tenantId)) {
        throw new Error('Este tenant ya tiene datos de ejemplo cargados');
    }

    try {
        // ========== PAQUETES ==========
        const paquetesDemo = [
            {
                codigo: 'DEMO-PDE',
                titulo: 'Punta del Este Clásico (Ejemplo)',
                destino: 'Punta del Este, Uruguay',
                descripcion: 'Escapada de 4 días a Punta del Este con alojamiento frente al mar, city tour y traslados incluidos.',
                precio_base: 450,
                precio_doble: 450,
                precio_triple: 420,
                precio_cuadruple: 399,
                duracion_dias: 4,
                cupos_totales: 20,
                cupos_disponibles: 20,
                tipo: 'regional',
                estado: 'activo',
                comision_monto_usd: 50,
                imagen_principal: IMG_PLAYA,
                incluye: ['3 noches de alojamiento', 'Desayuno buffet', 'Traslados in/out', 'City tour'],
                no_incluye: ['Aéreos', 'Comidas no mencionadas', 'Gastos personales'],
                hoteles: [
                    { id: 'demo-hotel-bahia', nombre: 'Hotel Bahía (Ejemplo)', link: '', ciudad: 'Punta del Este', precios: { doble: 450, triple: 420, cuadruple: 399 } },
                    { id: 'demo-hotel-mirador', nombre: 'Hotel Mirador (Ejemplo)', link: '', ciudad: 'Punta del Este', precios: { doble: 520, triple: 490, cuadruple: 470 } }
                ]
            },
            {
                codigo: 'DEMO-EUR',
                titulo: 'Europa Mágica (Ejemplo)',
                destino: 'Madrid y París',
                descripcion: 'Circuito de 12 días por Madrid y París con hoteles céntricos, traslados y excursiones guiadas.',
                precio_base: 2890,
                precio_doble: 2890,
                precio_triple: 2790,
                precio_cuadruple: 2690,
                duracion_dias: 12,
                cupos_totales: 15,
                cupos_disponibles: 15,
                tipo: 'internacional',
                estado: 'activo',
                comision_monto_usd: 150,
                imagen_principal: IMG_EUROPA,
                incluye: ['11 noches de alojamiento', 'Desayuno', 'Traslados', 'Excursiones con guía en español'],
                no_incluye: ['Aéreos internacionales', 'Seguro de viaje', 'Propinas'],
                hoteles: [
                    { id: 'demo-hotel-europa', nombre: 'Hotel Europa Palace (Ejemplo)', link: '', ciudad: 'Madrid', precios: { doble: 2890, triple: 2790, cuadruple: 2690 } }
                ]
            },
            {
                codigo: 'DEMO-IGU',
                titulo: 'Cataratas del Iguazú (Ejemplo)',
                destino: 'Puerto Iguazú, Argentina',
                descripcion: '5 días en las Cataratas del Iguazú con excursiones a ambos lados de las falls y selva misionera.',
                precio_base: 890,
                precio_doble: 890,
                precio_triple: 850,
                precio_cuadruple: 820,
                duracion_dias: 5,
                cupos_totales: 12,
                cupos_disponibles: 12,
                tipo: 'regional',
                estado: 'activo',
                comision_monto_usd: 60,
                imagen_principal: IMG_CATARATAS,
                incluye: ['4 noches de alojamiento', 'Desayuno', 'Excursión lado argentino', 'Excursión lado brasileño'],
                no_incluye: ['Aéreos', 'Almuerzos y cenas'],
                hoteles: [
                    { id: 'demo-hotel-selva', nombre: 'Hotel Selva (Ejemplo)', link: '', ciudad: 'Puerto Iguazú', precios: { doble: 890, triple: 850, cuadruple: 820 } }
                ]
            }
        ];

        const { data: paquetes, error: paquetesError } = await supabase
            .from('paquetes')
            .insert(paquetesDemo.map(p => ({ ...p, creado_por: userId, tenant_id: tenantId })))
            .select('id, codigo, titulo, destino, precio_doble');

        if (paquetesError || !paquetes || paquetes.length !== paquetesDemo.length) {
            throw new Error(paquetesError?.message || 'Error creando paquetes demo');
        }

        const paqueteByCodigo: Record<string, any> = {};
        paquetes.forEach(p => { paqueteByCodigo[p.codigo] = p; });

        // ========== CLIENTES + PASAJEROS ==========
        const { data: maria, error: mariaError } = await supabase
            .from('clientes')
            .insert({
                documento: 'DEMO-CLI-001',
                nombre: 'María',
                apellido: 'González',
                email: 'maria.gonzalez@ejemplo.com',
                telefono: '+598 99 123 456',
                estado: 'activo',
                fuente_lead: 'WEB',
                tags: ['EJEMPLO'],
                registrado_por: userId,
                tenant_id: tenantId
            })
            .select('id')
            .single();

        const { data: carlos, error: carlosError } = await supabase
            .from('clientes')
            .insert({
                documento: 'DEMO-CLI-002',
                nombre: 'Carlos',
                apellido: 'Rodríguez',
                email: 'carlos.rodriguez@ejemplo.com',
                telefono: '+598 98 654 321',
                estado: 'activo',
                fuente_lead: 'INSTAGRAM',
                tags: ['EJEMPLO'],
                registrado_por: userId,
                tenant_id: tenantId
            })
            .select('id')
            .single();

        if (mariaError || carlosError || !maria || !carlos) {
            throw new Error(mariaError?.message || carlosError?.message || 'Error creando clientes demo');
        }

        const { data: pasajerosDemo, error: pasajerosError } = await supabase
            .from('pasajeros')
            .insert([
                { cliente_titular_id: maria.id, cliente_id: maria.id, documento: 'DEMO-PAS-001', nombre: 'María', apellido: 'González', es_cliente_registrado: true, tenant_id: tenantId },
                { cliente_titular_id: maria.id, documento: 'DEMO-PAS-002', nombre: 'Juan', apellido: 'Pérez', es_cliente_registrado: false, tenant_id: tenantId },
                { cliente_titular_id: carlos.id, cliente_id: carlos.id, documento: 'DEMO-PAS-003', nombre: 'Carlos', apellido: 'Rodríguez', es_cliente_registrado: true, tenant_id: tenantId }
            ])
            .select('id, documento, nombre, apellido');

        if (pasajerosError || !pasajerosDemo) {
            throw new Error(pasajerosError?.message || 'Error creando pasajeros demo');
        }

        const pasajeroByDoc: Record<string, any> = {};
        pasajerosDemo.forEach(p => { pasajeroByDoc[p.documento] = p; });

        // ========== COTIZACIONES (una por estado del embudo, sin ventas) ==========
        const ahora = Date.now();
        const dias = (n: number) => new Date(ahora + n * 24 * 60 * 60 * 1000).toISOString();

        const snapshotPaquete = (codigo: string, duracion: number) => {
            const p = paqueteByCodigo[codigo];
            return {
                titulo: p?.titulo || '',
                destino: p?.destino || '',
                duracion_dias: duracion,
                incluye: [],
                no_incluye: [],
                vuelos: []
            };
        };

        const cotizacionesDemo = [
            {
                codigo: 'DEMO-COT-001',
                cliente_id: maria.id,
                paquete_id: paqueteByCodigo['DEMO-PDE']?.id || null,
                estado: 'nueva',
                nombre_cotizacion: 'Viaje a Punta del Este - Punta del Este Clásico (Ejemplo)',
                destino_principal: 'Punta del Este, Uruguay',
                precio_total: 900,
                num_pasajeros: 2,
                paquete_data: snapshotPaquete('DEMO-PDE', 4),
                fecha_creacion: dias(-1),
                fecha_expiracion: dias(6)
            },
            {
                codigo: 'DEMO-COT-002',
                cliente_id: carlos.id,
                paquete_id: paqueteByCodigo['DEMO-EUR']?.id || null,
                estado: 'enviada',
                nombre_cotizacion: 'Viaje a Europa - Europa Mágica (Ejemplo)',
                destino_principal: 'Madrid y París',
                precio_total: 5780,
                num_pasajeros: 2,
                paquete_data: snapshotPaquete('DEMO-EUR', 12),
                fecha_creacion: dias(-3),
                fecha_expiracion: dias(4)
            },
            {
                codigo: 'DEMO-COT-003',
                cliente_id: maria.id,
                paquete_id: paqueteByCodigo['DEMO-IGU']?.id || null,
                estado: 'aprobada',
                nombre_cotizacion: 'Viaje a Cataratas - Cataratas del Iguazú (Ejemplo)',
                destino_principal: 'Puerto Iguazú, Argentina',
                precio_total: 1780,
                num_pasajeros: 2,
                paquete_data: snapshotPaquete('DEMO-IGU', 5),
                fecha_creacion: dias(-4),
                fecha_aprobacion: dias(-1),
                aprobada_por: userId,
                fecha_expiracion: dias(3)
            }
        ];

        const { data: cotizaciones, error: cotizacionesError } = await supabase
            .from('cotizaciones')
            .insert(cotizacionesDemo.map(c => ({
                ...c,
                vendedor_id: userId,
                tipo_cotizacion: 'paquete',
                origen_datos: 'manual',
                precio_moneda: 'USD',
                mostrar_desglose_pdf: true,
                tenant_id: tenantId
            })))
            .select('id, codigo');

        if (cotizacionesError || !cotizaciones) {
            throw new Error(cotizacionesError?.message || 'Error creando cotizaciones demo');
        }

        // Vincular pasajeros a cada cotización
        const vinculos: any[] = [];
        for (const cot of cotizaciones) {
            if (cot.codigo === 'DEMO-COT-002') {
                if (pasajeroByDoc['DEMO-PAS-003']) {
                    vinculos.push({ cotizacion_id: cot.id, pasajero_id: pasajeroByDoc['DEMO-PAS-003'].id, es_titular: true, nombre_snapshot: 'Carlos', apellido_snapshot: 'Rodríguez', documento_snapshot: 'DEMO-PAS-003', tenant_id: tenantId });
                }
            } else {
                if (pasajeroByDoc['DEMO-PAS-001']) {
                    vinculos.push({ cotizacion_id: cot.id, pasajero_id: pasajeroByDoc['DEMO-PAS-001'].id, es_titular: true, nombre_snapshot: 'María', apellido_snapshot: 'González', documento_snapshot: 'DEMO-PAS-001', tenant_id: tenantId });
                }
                if (pasajeroByDoc['DEMO-PAS-002']) {
                    vinculos.push({ cotizacion_id: cot.id, pasajero_id: pasajeroByDoc['DEMO-PAS-002'].id, es_titular: false, nombre_snapshot: 'Juan', apellido_snapshot: 'Pérez', documento_snapshot: 'DEMO-PAS-002', tenant_id: tenantId });
                }
            }
        }

        if (vinculos.length > 0) {
            const { error: vinculosError } = await supabase.from('cotizacion_pasajeros').insert(vinculos);
            if (vinculosError) {
                throw new Error(vinculosError.message || 'Error vinculando pasajeros a cotizaciones demo');
            }
        }
    } catch (err: any) {
        // Si algo falla, intentamos limpiar lo que se haya creado para evitar datos a medias.
        // Se hace en background: el error original es lo que se propaga.
        deleteDemoData(tenantId).catch(cleanupErr =>
            console.error('[seedDemoData] Error limpiando tras fallo:', cleanupErr)
        );
        throw err;
    }
};

/**
 * Elimina TODOS los datos de ejemplo del tenant (marcados con prefijo DEMO-).
 * No toca datos reales aunque hayan sido creados a partir de paquetes demo.
 */
export const deleteDemoData = async (tenantId: string): Promise<{ eliminados: Record<string, number> }> => {
    const eliminados: Record<string, number> = {};

    // 1. Cotizaciones demo y sus vínculos/servicios
    const { data: cotizacionesDemo } = await supabase
        .from('cotizaciones')
        .select('id')
        .eq('tenant_id', tenantId)
        .like('codigo', 'DEMO-%');

    const cotIds = (cotizacionesDemo || []).map(c => c.id);
    if (cotIds.length > 0) {
        await supabase.from('cotizacion_pasajeros').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);
        await supabase.from('vuelos').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);
        await supabase.from('hospedajes').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);
        await supabase.from('traslados').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);
        await supabase.from('seguros').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);
        await supabase.from('extras').delete().eq('tenant_id', tenantId).in('cotizacion_id', cotIds);

        const { data: borradas } = await supabase
            .from('cotizaciones')
            .delete()
            .eq('tenant_id', tenantId)
            .in('id', cotIds)
            .select('id');
        eliminados.cotizaciones = borradas?.length || 0;
    } else {
        eliminados.cotizaciones = 0;
    }

    // 2. Clientes demo y sus pasajeros
    const { data: clientesDemo } = await supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', tenantId)
        .like('documento', 'DEMO-%');

    const clienteIds = (clientesDemo || []).map(c => c.id);
    if (clienteIds.length > 0) {
        await supabase.from('pasajeros').delete().eq('tenant_id', tenantId).in('cliente_titular_id', clienteIds);

        const { data: borrados } = await supabase
            .from('clientes')
            .delete()
            .eq('tenant_id', tenantId)
            .in('id', clienteIds)
            .select('id');
        eliminados.clientes = borrados?.length || 0;
    } else {
        eliminados.clientes = 0;
    }

    // 3. Paquetes demo
    const { data: paquetesBorrados } = await supabase
        .from('paquetes')
        .delete()
        .eq('tenant_id', tenantId)
        .like('codigo', 'DEMO-%')
        .select('id');
    eliminados.paquetes = paquetesBorrados?.length || 0;

    return { eliminados };
};
