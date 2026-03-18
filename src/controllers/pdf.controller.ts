import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generarPDFCotizacion, existePDF } from '../services/pdf.service';
import path from 'path';
import fs from 'fs/promises';

const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || './storage/cotizaciones-pdfs';

/**
 * Genera un nuevo PDF para una cotización
 * POST /cotizaciones/:id/pdf
 */
export const generarPDF = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;

        // 1. Obtener cotización con datos relacionados
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select(`
                *,
                paquete:paquete_id (*),
                vendedor:vendedor_id (*)
            `)
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // 2. Verificar permisos (solo el vendedor dueño o admin)
        // El token JWT tiene: userId (no id), role, email
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No tienes permiso para generar el PDF de esta cotización' });
        }

        // 3. Parsear datos_completos (viene como string JSON en notas)
        let datosCompletos: any = {};
        if (cotizacion.notas && cotizacion.notas.includes('--- DATOS COMPLETOS ---')) {
            try {
                const jsonMatch = cotizacion.notas.match(/--- DATOS COMPLETOS ---\n([\s\S]+?)(?:\n--- FIN DATOS ---|$)/);
                if (jsonMatch) {
                    datosCompletos = JSON.parse(jsonMatch[1]);
                }
            } catch (e) {
                console.error('Error parseando datos_completos:', e);
            }
        }

        // 4. Preparar datos para el template
        const clienteData = datosCompletos.cliente || {};
        const pasajerosData = datosCompletos.pasajeros || [];
        const paqueteData = cotizacion.paquete || {};
        const vendedorData = cotizacion.vendedor || {};

        // Calcular precios
        const total = cotizacion.precio_total || 0;
        const anticipo = total * 0.3;
        const saldo = total - anticipo;

        // Parsear itinerario si existe
        let itinerarioData: any[] = [];
        try {
            if (paqueteData.itinerario) {
                itinerarioData = typeof paqueteData.itinerario === 'string' 
                    ? JSON.parse(paqueteData.itinerario)
                    : paqueteData.itinerario;
            }
        } catch (e) {
            itinerarioData = [];
        }

        // Parsear incluye/no_incluye
        let incluyeData: string[] = [];
        let noIncluyeData: string[] = [];
        try {
            incluyeData = paqueteData.incluye 
                ? (typeof paqueteData.incluye === 'string' ? JSON.parse(paqueteData.incluye) : paqueteData.incluye)
                : [];
            noIncluyeData = paqueteData.no_incluye
                ? (typeof paqueteData.no_incluye === 'string' ? JSON.parse(paqueteData.no_incluye) : paqueteData.no_incluye)
                : [];
        } catch (e) {
            // ignorar
        }

        // 5. Generar PDF
        const pdfData = {
            cotizacion: {
                id: cotizacion.id,
                codigo: cotizacion.codigo,
                fecha_creacion: new Date(cotizacion.fecha_creacion).toLocaleDateString('es-AR'),
                fecha_expiracion: cotizacion.fecha_expiracion 
                    ? new Date(cotizacion.fecha_expiracion).toLocaleDateString('es-AR')
                    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('es-AR'),
                num_pasajeros: cotizacion.num_pasajeros,
                tipo_habitacion: cotizacion.tipo_habitacion,
                fecha_salida: cotizacion.fecha_salida 
                    ? new Date(cotizacion.fecha_salida).toLocaleDateString('es-AR')
                    : undefined,
                dias_validez: 7
            },
            cliente: {
                nombre: clienteData.nombre || cotizacion.cliente_nombre || 'No especificado',
                apellido: clienteData.apellido || '',
                documento: clienteData.documento || '',
                email: clienteData.email || cotizacion.cliente_email || '',
                telefono: clienteData.telefono || cotizacion.cliente_telefono || ''
            },
            paquete: {
                titulo: paqueteData.titulo || 'Paquete no disponible',
                destino: paqueteData.destino || '',
                descripcion: paqueteData.descripcion || '',
                duracion_dias: paqueteData.duracion_dias || 0,
                imagen_principal: paqueteData.imagen_principal,
                politicas_cancelacion: paqueteData.politicas_cancelacion
            },
            pasajeros: pasajerosData.map((p: any) => ({
                nombre: p.nombre || '',
                apellido: p.apellido || '',
                documento: p.documento || '',
                fecha_nacimiento: p.fecha_nacimiento 
                    ? new Date(p.fecha_nacimiento).toLocaleDateString('es-AR')
                    : '',
                nacionalidad: p.nacionalidad || ''
            })),
            precios: {
                moneda: 'ARS',
                precio_unitario: (total / cotizacion.num_pasajeros).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                subtotal: total.toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                impuestos: '0.00',
                extras: '0.00',
                total: total.toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                anticipo: anticipo.toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                saldo: saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })
            },
            vendedor: {
                nombre: vendedorData.nombre || 'Vendedor',
                apellido: vendedorData.apellido || '',
                email: vendedorData.email || '',
                telefono: vendedorData.telefono || '',
                iniciales: `${(vendedorData.nombre || '')[0] || ''}${(vendedorData.apellido || '')[0] || ''}`.toUpperCase()
            },
            itinerario: itinerarioData.map((item: any, index: number) => ({
                dia: item.dia || index + 1,
                titulo: item.titulo || `Día ${index + 1}`,
                descripcion: item.descripcion || '',
                actividades: item.actividades || []
            })),
            incluye: Array.isArray(incluyeData) ? incluyeData : [],
            no_incluye: Array.isArray(noIncluyeData) ? noIncluyeData : []
        };

        const { filePath, publicUrl } = await generarPDFCotizacion(pdfData, `COT-${cotizacion.codigo}.pdf`);

        // 6. Guardar referencia en la base de datos (opcional)
        const { error: updateError } = await supabase
            .from('cotizaciones')
            .update({
                pdf_url: publicUrl,
                pdf_generado_en: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) {
            console.error('Error guardando referencia del PDF:', updateError);
        }

        res.json({
            success: true,
            message: 'PDF generado exitosamente',
            data: {
                url: publicUrl,
                filename: path.basename(filePath),
                cotizacion_id: id,
                cotizacion_codigo: cotizacion.codigo
            }
        });

    } catch (error) {
        console.error('Error generando PDF:', error);
        res.status(500).json({
            error: 'Error al generar el PDF',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

/**
 * Descarga un PDF existente
 * GET /cotizaciones/:id/pdf
 */
export const descargarPDF = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;

        // 1. Obtener cotización
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select('id, codigo, pdf_url, vendedor_id')
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // 2. Verificar permisos
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No tienes permiso para descargar este PDF' });
        }

        // 3. Verificar si existe PDF
        if (!cotizacion.pdf_url) {
            return res.status(404).json({ 
                error: 'PDF no generado',
                message: 'Use POST para generar el PDF primero'
            });
        }

        const filename = path.basename(cotizacion.pdf_url);
        const filePath = path.join(PDF_STORAGE_PATH, filename);

        // 4. Verificar que el archivo exista físicamente
        const existe = await existePDF(filename);
        if (!existe) {
            return res.status(404).json({ 
                error: 'Archivo PDF no encontrado',
                message: 'El PDF fue registrado pero el archivo no existe. Regenerelo con POST.'
            });
        }

        // 5. Enviar archivo
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        const fileBuffer = await fs.readFile(filePath);
        res.send(fileBuffer);

    } catch (error) {
        console.error('Error descargando PDF:', error);
        res.status(500).json({
            error: 'Error al descargar el PDF',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

/**
 * Regenera un PDF (elimina el anterior y crea uno nuevo)
 * PUT /cotizaciones/:id/pdf
 */
export const regenerarPDF = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        // 1. Obtener cotización para verificar permisos y obtener nombre del archivo actual
        const { data: cotizacion } = await supabase
            .from('cotizaciones')
            .select('pdf_url')
            .eq('id', id)
            .single();

        // 2. Eliminar PDF anterior si existe
        if (cotizacion?.pdf_url) {
            const oldFilename = path.basename(cotizacion.pdf_url);
            try {
                const oldPath = path.join(PDF_STORAGE_PATH, oldFilename);
                await fs.unlink(oldPath);
            } catch (e) {
                // Ignorar error si no existe
            }
        }

        // 3. Generar nuevo PDF (llamando a la función de generar)
        await generarPDF(req, res);

    } catch (error) {
        console.error('Error regenerando PDF:', error);
        res.status(500).json({
            error: 'Error al regenerar el PDF',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};
