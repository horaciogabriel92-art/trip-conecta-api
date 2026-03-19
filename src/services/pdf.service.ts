/**
 * PDF Service - Generación de documentos PDF con Puppeteer + Pug
 */

import puppeteer from 'puppeteer';
import pug from 'pug';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';

// Ruta donde se guardarán los PDFs
const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || './storage/cotizaciones-pdfs';

interface CotizacionPDFData {
    cotizacion: {
        id: string;
        codigo: string;
        fecha_creacion: string;
        fecha_expiracion: string;
        num_pasajeros: number;
        tipo_habitacion?: string;
        fecha_salida?: string;
        dias_validez: number;
    };
    cliente: {
        nombre: string;
        apellido?: string;
        documento?: string;
        email?: string;
        telefono?: string;
    };
    paquete: {
        titulo: string;
        destino: string;
        descripcion?: string;
        duracion_dias: number;
        imagen_principal?: string;
        politicas_cancelacion?: string;
    };
    pasajeros: Array<{
        nombre: string;
        apellido: string;
        documento?: string;
        fecha_nacimiento?: string;
        nacionalidad?: string;
    }>;
    precios: {
        moneda: string;
        precio_unitario: string;
        subtotal: string;
        impuestos: string;
        extras: string;
        total: string;
        anticipo: string;
        saldo: string;
    };
    vendedor: {
        nombre: string;
        apellido: string;
        email: string;
        telefono?: string;
        iniciales: string;
    };
    itinerario?: Array<{
        dia: number;
        titulo: string;
        descripcion: string;
        actividades?: string[];
    }>;
    incluye?: string[];
    no_incluye?: string[];
}

/**
 * Genera un PDF usando un navegador existente (para el pool)
 */
export async function generarPDFCotizacionConBrowser(
    browser: puppeteer.Browser,
    data: CotizacionPDFData,
    filename?: string
): Promise<{ filePath: string; publicUrl: string }> {
    // Asegurar que existe el directorio
    await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });

    // Generar nombre de archivo
    const pdfFilename = filename || `COT-${data.cotizacion.codigo}-${Date.now()}.pdf`;
    const filePath = path.join(PDF_STORAGE_PATH, pdfFilename);

    // Compilar template Pug
    const templatePath = path.join(__dirname, '../templates/pdf/cotizacion.pug');
    const compiledTemplate = pug.compileFile(templatePath);

    // Renderizar HTML
    const html = compiledTemplate(data);

    // Crear nueva página en el navegador existente (no nuevo navegador)
    const page = await browser.newPage();
    
    try {
        // Bloquear recursos innecesarios para mejorar rendimiento
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Bloquear scripts, analytics, etc. que no necesitamos para PDFs
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                req.continue();
            } else {
                req.continue();
            }
        });

        // Cargar HTML
        await page.setContent(html, {
            waitUntil: ['networkidle0', 'domcontentloaded']
        });

        // Generar PDF
        await page.pdf({
            path: filePath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '15mm',
                right: '15mm',
                bottom: '15mm',
                left: '15mm'
            }
        });

    } finally {
        // Cerrar la página (no el navegador)
        await page.close();
    }

    // Generar URL pública
    const publicUrl = `/uploads/cotizaciones/${pdfFilename}`;

    return {
        filePath,
        publicUrl
    };
}

/**
 * Genera un PDF de cotización (legacy - para compatibilidad)
 * @deprecated Usar pdfQueue.addToQueue() en su lugar
 */
export async function generarPDFCotizacion(
    data: CotizacionPDFData,
    filename?: string
): Promise<{ filePath: string; publicUrl: string }> {
    logger.warn('[PDFService] Usando generarPDFCotizacion legacy. Considerar migrar a pdfQueue.');
    
    try {
        // Asegurar que existe el directorio
        await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });

        // Generar nombre de archivo si no se proporciona
        const pdfFilename = filename || `COT-${data.cotizacion.codigo}-${Date.now()}.pdf`;
        const filePath = path.join(PDF_STORAGE_PATH, pdfFilename);

        // Compilar template Pug
        const templatePath = path.join(__dirname, '../templates/pdf/cotizacion.pug');
        logger.info(`[PDFService] Buscando template en: ${templatePath}`);
        
        // Verificar que el template existe
        try {
            await fs.access(templatePath);
            logger.info('[PDFService] Template encontrado');
        } catch (e) {
            logger.error(`[PDFService] Template NO encontrado en: ${templatePath}`);
            throw new Error(`Template no encontrado: ${templatePath}`);
        }
        
        const compiledTemplate = pug.compileFile(templatePath);
        logger.info('[PDFService] Template compilado exitosamente');

        // Renderizar HTML
        const html = compiledTemplate(data);
        logger.info('[PDFService] HTML renderizado exitosamente');

        // Lanzar Puppeteer (usa Chromium del sistema si está disponible)
        logger.info(`[PDFService] Iniciando Puppeteer. Chromium path: ${process.env.PUPPETEER_EXECUTABLE_PATH || 'default'}`);
        const browser = await puppeteer.launch({
            headless: 'shell',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--single-process',
                '--no-zygote'
            ]
        });
        logger.info('[PDFService] Puppeteer iniciado exitosamente');

        const page = await browser.newPage();
        
        try {
            // Cargar HTML
            await page.setContent(html, {
                waitUntil: ['networkidle0', 'domcontentloaded']
            });

            // Generar PDF
            await page.pdf({
                path: filePath,
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '15mm',
                    right: '15mm',
                    bottom: '15mm',
                    left: '15mm'
                }
            });
        } finally {
            await browser.close();
        }

        // Generar URL pública
        const publicUrl = `/uploads/cotizaciones/${pdfFilename}`;

        logger.info(`[PDFService] PDF generado exitosamente: ${filePath}`);

        return {
            filePath,
            publicUrl
        };

    } catch (error: any) {
        logger.error('[PDFService] Error generando PDF:', error);
        logger.error('[PDFService] Stack trace:', error.stack);
        throw new Error(`Error generando PDF: ${error.message}`);
    }
}

/**
 * Elimina un PDF existente
 */
export async function eliminarPDF(filename: string): Promise<void> {
    try {
        const filePath = path.join(PDF_STORAGE_PATH, filename);
        await fs.unlink(filePath);
        logger.info(`[PDFService] PDF eliminado: ${filePath}`);
    } catch (error) {
        logger.error('[PDFService] Error eliminando PDF:', error);
    }
}

/**
 * Verifica si existe un PDF
 */
export async function existePDF(filename: string): Promise<boolean> {
    try {
        const filePath = path.join(PDF_STORAGE_PATH, filename);
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
