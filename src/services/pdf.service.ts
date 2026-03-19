/**
 * PDF Service - Generación de documentos PDF con Puppeteer + Pug
 * 
 * Versión simplificada: cada request abre su propio navegador
 * pero con configuración optimizada para Docker.
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
    let browser;
    
    try {
        logger.info(`[PDF] Iniciando generación para: ${data.cotizacion.codigo}`);
        
        // Asegurar que existe el directorio
        await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });

        // Generar nombre de archivo
        const pdfFilename = filename || `COT-${data.cotizacion.codigo}-${Date.now()}.pdf`;
        const filePath = path.join(PDF_STORAGE_PATH, pdfFilename);

        // Compilar template Pug
        const templatePath = path.join(__dirname, '../templates/pdf/cotizacion.pug');
        const compiledTemplate = pug.compileFile(templatePath);
        const html = compiledTemplate(data);

        // Lanzar Puppeteer con flags optimizados para Docker
        logger.info(`[PDF] Lanzando Chromium...`);
        
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ],
            dumpio: false
        });

        logger.info(`[PDF] Chromium iniciado`);

        const page = await browser.newPage();
        
        // Cargar HTML
        await page.setContent(html, {
            waitUntil: 'networkidle0'
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
        browser = null as any;

        const publicUrl = `/uploads/cotizaciones/${pdfFilename}`;

        logger.info(`[PDF] Generado exitosamente: ${filePath}`);

        return { filePath, publicUrl };

    } catch (error: any) {
        logger.error('[PDF] Error:', error);
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
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
        logger.info(`[PDF] Eliminado: ${filePath}`);
    } catch (error) {
        // No lanzar error si no existe
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
