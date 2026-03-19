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

        // 1. Obtener cotización
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select(`*, paquete:paquete_id (*), vendedor:vendedor_id (*)`)
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // 2. Verificar permisos
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No tienes permiso' });
        }

        // 3. Parsear datos
        let datosCompletos: any = {};
        if (cotizacion.notas?.includes('--- DATOS COMPLETOS ---')) {
            try {
                const match = cotizacion.notas.match(/--- DATOS COMPLETOS ---\n([\s\S]+?)(?:\n--- FIN DATOS ---|$)/);
                if (match) datosCompletos = JSON.parse(match[1]);
            } catch (e) {}
        }

        const clienteData = datosCompletos.cliente || {};
        const pasajerosData = datosCompletos.pasajeros || [];
        const paqueteData = cotizacion.paquete || {};
        const vendedorData = cotizacion.vendedor || {};
        const total = cotizacion.precio_total || 0;

        // 4. Generar PDF
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
                precio_unitario: (total / (cotizacion.num_pasajeros || 1)).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                subtotal: total.toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                impuestos: '0.00',
                extras: '0.00',
                total: total.toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                anticipo: (total * 0.3).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
                saldo: (total * 0.7).toLocaleString('es-AR', { minimumFractionDigits: 2 })
            },
            vendedor: {
                nombre: vendedorData.nombre || 'Vendedor',
                apellido: vendedorData.apellido || '',
                email: vendedorData.email || '',
                telefono: vendedorData.telefono || '',
                iniciales: `${(vendedorData.nombre || '')[0] || ''}${(vendedorData.apellido || '')[0] || ''}`.toUpperCase()
            },
            itinerario: (paqueteData.itinerario || []).map((item: any, idx: number) => ({
                dia: item.dia || idx + 1,
                titulo: item.titulo || `Día ${idx + 1}`,
                descripcion: item.descripcion || '',
                actividades: item.actividades || []
            })),
            incluye: Array.isArray(paqueteData.incluye) ? paqueteData.incluye : [],
            no_incluye: Array.isArray(paqueteData.no_incluye) ? paqueteData.no_incluye : []
        };

        const { filePath, publicUrl } = await generarPDFCotizacion(pdfData, `COT-${cotizacion.codigo}.pdf`);

        // Guardar referencia
        await supabase.from('cotizaciones').update({
            pdf_url: publicUrl,
            pdf_generado_en: new Date().toISOString()
        }).eq('id', id);

        res.json({
            success: true,
            message: 'PDF generado',
            data: { url: publicUrl, filename: path.basename(filePath) }
        });

    } catch (error: any) {
        console.error('[PDF] Error:', error);
        res.status(500).json({
            error: 'Error al generar PDF',
            details: error.message
        });
    }
};

/**
 * Descargar PDF existente
 */
export const descargarPDF = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;

        const { data: cotizacion } = await supabase
            .from('cotizaciones')
            .select('pdf_url, vendedor_id')
            .eq('id', id)
            .single();

        if (!cotizacion) return res.status(404).json({ error: 'No encontrada' });
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'Sin permiso' });
        }
        if (!cotizacion.pdf_url) return res.status(404).json({ error: 'PDF no generado' });

        const filename = path.basename(cotizacion.pdf_url);
        const filePath = path.join(PDF_STORAGE_PATH, filename);

        if (!await existePDF(filename)) {
            return res.status(404).json({ error: 'Archivo no encontrado' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(await fs.readFile(filePath));

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Regenerar PDF
 */
export const regenerarPDF = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { data: cotizacion } = await supabase.from('cotizaciones').select('pdf_url').eq('id', id).single();
    
    if (cotizacion?.pdf_url) {
        try {
            await fs.unlink(path.join(PDF_STORAGE_PATH, path.basename(cotizacion.pdf_url)));
        } catch {}
    }
    
    await generarPDF(req, res);
};
