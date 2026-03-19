/**
 * PDF Queue Service - Pool de navegadores + cola de procesamiento
 * 
 * Mantiene un pool de 2-3 instancias de navegador reutilizables
 * y limita la concurrencia a 3 PDFs simultáneos máximo.
 */

import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../utils/logger';

// Configuración del pool
const MAX_CONCURRENT = 3;
const POOL_SIZE = 2;
const MAX_QUEUE_SIZE = 50;

interface PDFJob {
    id: string;
    data: any;
    resolve: (value: { filePath: string; publicUrl: string }) => void;
    reject: (reason: Error) => void;
    startTime?: number;
}

interface BrowserInstance {
    browser: Browser;
    isAvailable: boolean;
    id: number;
}

class PDFQueueService {
    private pool: BrowserInstance[] = [];
    private queue: PDFJob[] = [];
    private activeJobs = 0;
    private isInitialized = false;

    /**
     * Inicializa el pool de navegadores
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        logger.info(`[PDFQueue] Inicializando pool de ${POOL_SIZE} navegadores...`);

        for (let i = 0; i < POOL_SIZE; i++) {
            try {
                const browser = await this.createBrowser();
                this.pool.push({
                    browser,
                    isAvailable: true,
                    id: i + 1
                });
                logger.info(`[PDFQueue] Navegador ${i + 1} iniciado`);
            } catch (error) {
                logger.error(`[PDFQueue] Error iniciando navegador ${i + 1}:`, error);
            }
        }

        this.isInitialized = true;
        logger.info(`[PDFQueue] Pool inicializado con ${this.pool.length} navegadores`);
    }

    /**
     * Crea una nueva instancia de navegador
     */
    private async createBrowser(): Promise<Browser> {
        return puppeteer.launch({
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
    }

    /**
     * Agrega un job a la cola
     */
    async addToQueue(jobId: string, data: any): Promise<{ filePath: string; publicUrl: string }> {
        // Verificar límite de cola
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            throw new Error('La cola de PDFs está llena. Intente más tarde.');
        }

        // Inicializar si es necesario
        if (!this.isInitialized) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const job: PDFJob = {
                id: jobId,
                data,
                resolve,
                reject
            };

            this.queue.push(job);
            logger.info(`[PDFQueue] Job ${jobId} agregado a la cola. Posición: ${this.queue.length}, Activos: ${this.activeJobs}`);

            this.processQueue();
        });
    }

    /**
     * Procesa la cola
     */
    private async processQueue(): Promise<void> {
        // Si ya estamos al límite de concurrencia, esperar
        if (this.activeJobs >= MAX_CONCURRENT) {
            logger.info(`[PDFQueue] Límite de concurrencia alcanzado (${this.activeJobs}/${MAX_CONCURRENT})`);
            return;
        }

        // Si no hay jobs en cola, terminar
        if (this.queue.length === 0) return;

        // Buscar navegador disponible
        const browserInstance = this.pool.find(b => b.isAvailable);
        
        if (!browserInstance) {
            logger.info('[PDFQueue] Esperando navegador disponible...');
            return;
        }

        // Tomar el siguiente job
        const job = this.queue.shift();
        if (!job) return;

        // Marcar navegador como ocupado
        browserInstance.isAvailable = false;
        this.activeJobs++;
        job.startTime = Date.now();

        logger.info(`[PDFQueue] Procesando job ${job.id} en navegador ${browserInstance.id}. Cola restante: ${this.queue.length}`);

        // Procesar el job
        this.processJob(job, browserInstance);
    }

    /**
     * Procesa un job específico
     */
    private async processJob(job: PDFJob, browserInstance: BrowserInstance): Promise<void> {
        try {
            const { generarPDFCotizacionConBrowser } = await import('./pdf.service');
            
            const result = await generarPDFCotizacionConBrowser(
                browserInstance.browser,
                job.data,
                job.id
            );

            const duration = Date.now() - (job.startTime || 0);
            logger.info(`[PDFQueue] Job ${job.id} completado en ${duration}ms`);

            job.resolve(result);
        } catch (error: any) {
            logger.error(`[PDFQueue] Error procesando job ${job.id}:`, error);
            job.reject(error);
        } finally {
            // Liberar navegador
            browserInstance.isAvailable = true;
            this.activeJobs--;

            logger.info(`[PDFQueue] Navegador ${browserInstance.id} liberado. Activos: ${this.activeJobs}`);

            // Procesar siguiente job
            setImmediate(() => this.processQueue());
        }
    }

    /**
     * Obtiene el estado actual de la cola
     */
    getQueueStatus(): {
        queueLength: number;
        activeJobs: number;
        poolSize: number;
        availableBrowsers: number;
        maxConcurrent: number;
    } {
        return {
            queueLength: this.queue.length,
            activeJobs: this.activeJobs,
            poolSize: this.pool.length,
            availableBrowsers: this.pool.filter(b => b.isAvailable).length,
            maxConcurrent: MAX_CONCURRENT
        };
    }

    /**
     * Cierra todos los navegadores (para graceful shutdown)
     */
    async shutdown(): Promise<void> {
        logger.info('[PDFQueue] Cerrando pool de navegadores...');
        
        for (const instance of this.pool) {
            try {
                await instance.browser.close();
                logger.info(`[PDFQueue] Navegador ${instance.id} cerrado`);
            } catch (error) {
                logger.error(`[PDFQueue] Error cerrando navegador ${instance.id}:`, error);
            }
        }

        this.pool = [];
        this.isInitialized = false;
        logger.info('[PDFQueue] Pool cerrado');
    }
}

// Singleton
export const pdfQueue = new PDFQueueService();
