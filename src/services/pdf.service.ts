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
 * Genera un PDF de cotización
 */
export async function generarPDFCotizacion(
    data: CotizacionPDFData,
    filename?: string
): Promise<{ filePath: string; publicUrl: string }> {
    try {
        logger.info(`Iniciando generación de PDF para cotización: ${data.cotizacion.codigo}`);
        
        // Asegurar que existe el directorio
        await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });
        logger.info(`Directorio de PDFs verificado: ${PDF_STORAGE_PATH}`);

        // Generar nombre de archivo si no se proporciona
        const pdfFilename = filename || `COT-${data.cotizacion.codigo}-${Date.now()}.pdf`;
        const filePath = path.join(PDF_STORAGE_PATH, pdfFilename);

        // Compilar template Pug
        const templatePath = path.join(__dirname, '../templates/pdf/cotizacion.pug');
        logger.info(`Buscando template en: ${templatePath}`);
        
        // Verificar que el template existe
        try {
            await fs.access(templatePath);
            logger.info('Template encontrado');
        } catch (e) {
            logger.error(`Template NO encontrado en: ${templatePath}`);
            throw new Error(`Template no encontrado: ${templatePath}`);
        }
        
        const compiledTemplate = pug.compileFile(templatePath);
        logger.info('Template compilado exitosamente');

        // Renderizar HTML
        const html = compiledTemplate(data);
        logger.info('HTML renderizado exitosamente');

        // Lanzar Puppeteer (usa Chromium del sistema si está disponible)
        logger.info(`Iniciando Puppeteer. Chromium path: ${process.env.PUPPETEER_EXECUTABLE_PATH || 'default'}`);
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
            ],
            dumpio: true // Log para debug
        });
        logger.info('Puppeteer iniciado exitosamente');

        const page = await browser.newPage();
        
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

        await browser.close();

        // Generar URL pública
        const publicUrl = `/uploads/cotizaciones/${pdfFilename}`;

        logger.info(`PDF generado exitosamente: ${filePath}`);

        return {
            filePath,
            publicUrl
        };

    } catch (error: any) {
        logger.error('Error generando PDF:', error);
        logger.error('Stack trace:', error.stack);
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
        logger.info(`PDF eliminado: ${filePath}`);
    } catch (error) {
        logger.error('Error eliminando PDF:', error);
        // No lanzamos error si el archivo no existe
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
