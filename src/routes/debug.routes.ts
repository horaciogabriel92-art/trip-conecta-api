import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// GET /api/debug/pdf-config - Verificar configuración de PDF
router.get('/pdf-config', async (req, res) => {
    try {
        const results: any = {
            environment: {
                PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || 'NO CONFIGURADO',
                PDF_STORAGE_PATH: process.env.PDF_STORAGE_PATH || './storage/cotizaciones-pdfs',
                NODE_ENV: process.env.NODE_ENV || 'development'
            },
            files: {
                templateExists: false,
                templatePath: '',
                chromiumExists: false,
                chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
            },
            directories: {
                storageWritable: false,
                storagePath: process.env.PDF_STORAGE_PATH || './storage/cotizaciones-pdfs'
            }
        };

        // Verificar template
        const templatePath = path.join(__dirname, '../templates/pdf/cotizacion.pug');
        results.files.templatePath = templatePath;
        try {
            await fs.access(templatePath);
            results.files.templateExists = true;
        } catch (e) {
            results.files.templateExists = false;
        }

        // Verificar CSS
        const cssPath = path.join(__dirname, '../templates/pdf/cotizacion.css');
        try {
            await fs.access(cssPath);
            results.files.cssExists = true;
        } catch (e) {
            results.files.cssExists = false;
        }

        // Verificar Chromium
        try {
            await fs.access(results.files.chromiumPath);
            results.files.chromiumExists = true;
        } catch (e) {
            results.files.chromiumExists = false;
        }

        // Verificar directorio de storage
        try {
            await fs.mkdir(results.directories.storagePath, { recursive: true });
            // Intentar escribir un archivo de prueba
            const testFile = path.join(results.directories.storagePath, '.test');
            await fs.writeFile(testFile, 'test');
            await fs.unlink(testFile);
            results.directories.storageWritable = true;
        } catch (e: any) {
            results.directories.storageWritable = false;
            results.directories.error = e.message;
        }

        // Listar archivos en templates
        try {
            const templatesDir = path.join(__dirname, '../templates');
            const files = await fs.readdir(templatesDir, { recursive: true });
            results.files.templatesList = files;
        } catch (e: any) {
            results.files.templatesList = ['Error: ' + e.message];
        }

        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
