import { Router } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
console.log('[UPLOAD ROUTES] Loading upload routes...');

// Configurar multer para memoria (imágenes de paquetes a Supabase)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo
  },
  fileFilter: (req, file, cb) => {
    // Solo permitir imágenes
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'));
    }
  }
});

// Configurar multer para disco (comprobantes de pago al VPS)
const storageComprobantes = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const comprobantesDir = path.join(uploadDir, 'comprobantes');
    
    // Crear directorio si no existe
    if (!fs.existsSync(comprobantesDir)) {
      fs.mkdirSync(comprobantesDir, { recursive: true });
    }
    
    cb(null, comprobantesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `comprobante-${uniqueSuffix}${ext}`);
  }
});

const uploadComprobante = multer({
  storage: storageComprobantes,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB máximo para comprobantes
  },
  fileFilter: (req, file, cb) => {
    // Permitir imágenes y PDFs
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP) o PDFs'));
    }
  }
});

// Subir imagen a Supabase Storage
router.post('/paquete-imagen', authenticateToken, upload.single('imagen'), async (req, res) => {
  try {
    console.log('Upload request received:', {
      headers: req.headers['content-type'],
      file: req.file,
      body: req.body
    });
    
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ninguna imagen', debug: { contentType: req.headers['content-type'] } });
    }

    const file = req.file;
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `paquetes/${fileName}`;

    // Subir a Supabase Storage
    const { data, error } = await supabase.storage
      .from('paquetes-imagenes')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Error uploading to Supabase:', error);
      return res.status(500).json({ error: 'Error al subir imagen', details: error.message });
    }

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('paquetes-imagenes')
      .getPublicUrl(filePath);

    res.json({ 
      url: publicUrl,
      path: filePath,
      message: 'Imagen subida exitosamente' 
    });

  } catch (error: any) {
    console.error('Error in upload:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Eliminar imagen de Supabase Storage
router.delete('/paquete-imagen', authenticateToken, async (req, res) => {
  try {
    const { path } = req.body;
    
    if (!path) {
      return res.status(400).json({ error: 'No se proporcionó la ruta de la imagen' });
    }

    const { error } = await supabase.storage
      .from('paquetes-imagenes')
      .remove([path]);

    if (error) {
      console.error('Error deleting from Supabase:', error);
      return res.status(500).json({ error: 'Error al eliminar imagen' });
    }

    res.json({ message: 'Imagen eliminada exitosamente' });

  } catch (error: any) {
    console.error('Error in delete:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ============================================
// COMPROBANTES DE PAGO (VPS Local Storage)
// ============================================

// Subir comprobante de pago para una cotización
router.post('/comprobante-pago/:cotizacionId', authenticateToken, uploadComprobante.single('comprobante'), async (req, res) => {
  try {
    const { cotizacionId } = req.params;
    const userId = (req as any).user.userId;
    const { descripcion } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    // Verificar que la cotización existe y pertenece al vendedor
    const { data: cotizacion, error: cotError } = await supabase
      .from('cotizaciones')
      .select('id, vendedor_id, codigo')
      .eq('id', cotizacionId)
      .single();

    if (cotError || !cotizacion) {
      // Eliminar archivo subido si la cotización no existe
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    // Verificar permisos (solo el vendedor dueño o admin)
    const userRole = (req as any).user.role;
    if (userRole !== 'admin' && cotizacion.vendedor_id !== userId) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Determinar tipo de archivo
    const tipoArchivo = req.file.mimetype === 'application/pdf' ? 'pdf' : 'imagen';
    
    // Guardar registro en la base de datos
    const { data: comprobante, error: insertError } = await supabase
      .from('comprobantes_pago')
      .insert({
        cotizacion_id: cotizacionId,
        vendedor_id: userId,
        nombre_archivo: req.file.originalname,
        ruta_archivo: req.file.filename,
        tipo_archivo: tipoArchivo,
        tamaño_bytes: req.file.size,
        descripcion: descripcion || null
      })
      .select()
      .single();

    if (insertError) {
      // Eliminar archivo si falla la base de datos
      fs.unlinkSync(req.file.path);
      console.error('Error saving comprobante:', insertError);
      return res.status(500).json({ error: 'Error al guardar el comprobante', details: insertError.message });
    }

    // Generar URL pública del archivo
    const fileUrl = `/uploads/comprobantes/${req.file.filename}`;

    res.json({
      message: 'Comprobante subido exitosamente',
      comprobante: {
        id: comprobante.id,
        nombre_archivo: req.file.originalname,
        url: fileUrl,
        tipo: tipoArchivo,
        tamaño: req.file.size,
        descripcion: descripcion || null
      }
    });

  } catch (error: any) {
    // Limpiar archivo en caso de error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading comprobante:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Obtener comprobantes de pago de una cotización
router.get('/comprobantes-pago/:cotizacionId', authenticateToken, async (req, res) => {
  try {
    const { cotizacionId } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;

    // Verificar que la cotización existe
    const { data: cotizacion, error: cotError } = await supabase
      .from('cotizaciones')
      .select('id, vendedor_id')
      .eq('id', cotizacionId)
      .single();

    if (cotError || !cotizacion) {
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    // Verificar permisos
    if (userRole !== 'admin' && cotizacion.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Obtener comprobantes
    const { data: comprobantes, error } = await supabase
      .from('comprobantes_pago')
      .select('*')
      .eq('cotizacion_id', cotizacionId)
      .order('fecha_subida', { ascending: false });

    if (error) {
      console.error('Error fetching comprobantes:', error);
      return res.status(500).json({ error: 'Error al obtener comprobantes' });
    }

    // Agregar URLs públicas
    const comprobantesConUrl = comprobantes.map((c: any) => ({
      ...c,
      url: `/uploads/comprobantes/${c.ruta_archivo}`
    }));

    res.json(comprobantesConUrl);

  } catch (error: any) {
    console.error('Error fetching comprobantes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Descargar comprobante de pago
router.get('/comprobante-pago/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;

    // Obtener comprobante
    const { data: comprobante, error } = await supabase
      .from('comprobantes_pago')
      .select('*, cotizaciones!inner(vendedor_id)')
      .eq('id', id)
      .single();

    if (error || !comprobante) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    // Verificar permisos
    if (userRole !== 'admin' && comprobante.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const filePath = path.join(uploadDir, 'comprobantes', comprobante.ruta_archivo);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Determinar content type
    const contentType = comprobante.tipo_archivo === 'pdf' 
      ? 'application/pdf' 
      : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${comprobante.nombre_archivo}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('Error downloading comprobante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Descargar comprobante por nombre de archivo (para comprobantes legacy del JSON)
router.get('/comprobante-pago/download-by-filename/:filename', authenticateToken, async (req, res) => {
  try {
    // El parámetro puede ser string o string[], asegurarnos de usar string
    const filenameParam = req.params.filename;
    let filename = Array.isArray(filenameParam) ? filenameParam[0] : filenameParam;
    
    console.log('[Download] Raw filename param:', filename);
    
    // Decodificar URL encoding si está presente (reemplazar %2F por /, etc.)
    try {
      filename = decodeURIComponent(filename);
    } catch (e) {
      console.log('[Download] No URL encoding detected');
    }
    
    // Extraer solo el nombre del archivo (eliminar cualquier path)
    const basename = path.basename(filename);
    
    console.log('[Download] Basename:', basename);
    
    if (!basename || basename === '.' || basename === '..') {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    // Intentar múltiples rutas posibles
    const possiblePaths = [
      path.join(process.env.STORAGE_PATH || '/app/storage/uploads', 'comprobantes', basename),
      path.join('./storage/uploads', 'comprobantes', basename),
      path.join('/data/trip-conecta/uploads', 'comprobantes', basename),
      path.join('/app/storage/uploads', 'comprobantes', basename),
    ];
    
    console.log('[Download] STORAGE_PATH env:', process.env.STORAGE_PATH);
    console.log('[Download] Checking paths:', possiblePaths);

    // Encontrar el primer archivo que existe
    let filePath: string | null = null;
    for (const tryPath of possiblePaths) {
      console.log('[Download] Checking:', tryPath, 'exists:', fs.existsSync(tryPath));
      if (fs.existsSync(tryPath)) {
        filePath = tryPath;
        break;
      }
    }
    
    if (!filePath) {
      console.error('[Download] Archivo no encontrado en ninguna ruta:', basename);
      // Listar archivos en el directorio para debug
      for (const tryPath of possiblePaths) {
        const dir = path.dirname(tryPath);
        try {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            console.log(`[Download] Archivos en ${dir}:`, files.slice(0, 20));
          } else {
            console.log(`[Download] Directorio no existe: ${dir}`);
          }
        } catch (e: any) {
          console.error(`[Download] Error leyendo ${dir}:`, e.message);
        }
      }
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    console.log('[Download] Archivo encontrado:', filePath);

    // Determinar content type
    const ext = path.extname(basename).toLowerCase();
    const contentType = ext === '.pdf' ? 'application/pdf' : 
                        ext === '.png' ? 'image/png' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${basename}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('Error downloading comprobante by filename:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar comprobante de pago
router.delete('/comprobante-pago/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;

    // Obtener comprobante
    const { data: comprobante, error } = await supabase
      .from('comprobantes_pago')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !comprobante) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    // Verificar permisos (solo el dueño o admin)
    if (userRole !== 'admin' && comprobante.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Eliminar archivo físico
    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const filePath = path.join(uploadDir, 'comprobantes', comprobante.ruta_archivo);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Eliminar registro de la base de datos
    const { error: deleteError } = await supabase
      .from('comprobantes_pago')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting comprobante:', deleteError);
      return res.status(500).json({ error: 'Error al eliminar comprobante' });
    }

    res.json({ message: 'Comprobante eliminado exitosamente' });

  } catch (error: any) {
    console.error('Error deleting comprobante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener comprobantes de pago de una VENTA (para admin)
router.get('/comprobantes-venta/:ventaId', authenticateToken, async (req, res) => {
  try {
    const { ventaId } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;

    // Obtener la venta para verificar permisos y cotizacion_id
    const { data: venta, error: ventaError } = await supabase
      .from('ventas')
      .select('id, vendedor_id, cotizacion_id')
      .eq('id', ventaId)
      .single();

    if (ventaError || !venta) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    // Verificar permisos (admin o el vendedor dueño)
    if (userRole !== 'admin' && venta.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Obtener comprobantes de la cotización asociada
    const { data: comprobantes, error } = await supabase
      .from('comprobantes_pago')
      .select('*')
      .eq('cotizacion_id', venta.cotizacion_id)
      .order('fecha_subida', { ascending: false });

    if (error) {
      console.error('Error fetching comprobantes:', error);
      return res.status(500).json({ error: 'Error al obtener comprobantes' });
    }

    // Agregar URLs públicas
    const comprobantesConUrl = comprobantes.map((c: any) => ({
      ...c,
      url: `/uploads/comprobantes/${c.ruta_archivo}`
    }));

    res.json(comprobantesConUrl);

  } catch (error: any) {
    console.error('Error fetching comprobantes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DEBUG: Endpoint para diagnosticar archivos de comprobantes (público temporalmente)
router.get('/debug/comprobantes-files', async (req, res) => {
  try {

    const results: any = {
      env: {
        STORAGE_PATH: process.env.STORAGE_PATH,
        NODE_ENV: process.env.NODE_ENV,
        cwd: process.cwd()
      },
      paths: [] as any[]
    };

    // Probar múltiples rutas posibles
    const pathsToCheck = [
      process.env.STORAGE_PATH || '/app/storage/uploads',
      './storage/uploads',
      '/data/trip-conecta/uploads',
      '/app/storage/uploads',
      path.join(process.cwd(), 'storage', 'uploads')
    ];

    for (const basePath of pathsToCheck) {
      const comprobantesPath = path.join(basePath, 'comprobantes');
      const pathInfo: any = {
        basePath,
        comprobantesPath,
        baseExists: fs.existsSync(basePath),
        comprobantesExists: fs.existsSync(comprobantesPath)
      };

      if (pathInfo.comprobantesExists) {
        try {
          const files = fs.readdirSync(comprobantesPath);
          pathInfo.fileCount = files.length;
          pathInfo.files = files.slice(0, 50); // Primeros 50 archivos
        } catch (e: any) {
          pathInfo.error = e.message;
        }
      }

      results.paths.push(pathInfo);
    }

    // Verificar directorio raíz también
    try {
      results.rootDir = fs.readdirSync(process.cwd());
    } catch (e: any) {
      results.rootDirError = e.message;
    }

    res.json(results);
  } catch (error: any) {
    console.error('[Debug] Error:', error);
    res.status(500).json({ error: 'Error interno', details: error.message });
  }
});

// ============================================
// VOUCHERS DE VIAJE (Documentos de viaje)
// ============================================

// Configurar multer para vouchers
const storageVouchers = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const vouchersDir = path.join(uploadDir, 'vouchers');
    
    if (!fs.existsSync(vouchersDir)) {
      fs.mkdirSync(vouchersDir, { recursive: true });
    }
    
    cb(null, vouchersDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `voucher-${uniqueSuffix}${ext}`);
  }
});

const uploadVoucher = multer({
  storage: storageVouchers,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP) o PDFs'));
    }
  }
});

// POST /api/upload/voucher/:ventaId - Subir voucher (admin only)
router.post('/voucher/:ventaId', authenticateToken, uploadVoucher.single('voucher'), async (req, res) => {
  try {
    const { ventaId } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;
    const { tipo_documento, descripcion } = req.body;
    
    // Solo admin puede subir vouchers
    if (userRole !== 'admin') {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'Solo administradores pueden subir vouchers' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }
    
    // Verificar que la venta existe
    const { data: venta, error: ventaError } = await supabase
      .from('ventas')
      .select('id, cotizacion_id')
      .eq('id', ventaId)
      .single();
    
    if (ventaError || !venta) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    // Guardar en BD
    const { data: documento, error: insertError } = await supabase
      .from('documentos_viaje')
      .insert({
        venta_id: ventaId,
        tipo: tipo_documento || 'otro',
        nombre_archivo: req.file.originalname,
        ruta_archivo: req.file.filename,
        descripcion: descripcion || null,
        subido_por: userId
      })
      .select()
      .single();
    
    if (insertError) {
      fs.unlinkSync(req.file.path);
      console.error('Error guardando voucher:', insertError);
      return res.status(500).json({ error: 'Error al guardar voucher', details: insertError.message });
    }
    
    // ACTUALIZAR ESTADO DE VENTA A 'emitida'
    await supabase
      .from('ventas')
      .update({ estado: 'emitida' })
      .eq('id', ventaId);
    
    res.json({
      message: 'Voucher subido exitosamente',
      documento: {
        id: documento.id,
        nombre_archivo: req.file.originalname,
        tipo: tipo_documento || 'otro',
        url: `/uploads/vouchers/${req.file.filename}`
      }
    });
    
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading voucher:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// GET /api/upload/vouchers/:ventaId - Listar vouchers
router.get('/vouchers/:ventaId', authenticateToken, async (req, res) => {
  try {
    const { ventaId } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;
    
    // Verificar que la venta existe
    const { data: venta, error: ventaError } = await supabase
      .from('ventas')
      .select('id, vendedor_id')
      .eq('id', ventaId)
      .single();
    
    if (ventaError || !venta) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    // Verificar permisos (admin o vendedor dueño)
    if (userRole !== 'admin' && venta.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    // Obtener vouchers
    const { data: vouchers, error } = await supabase
      .from('documentos_viaje')
      .select('*')
      .eq('venta_id', ventaId)
      .order('fecha_subida', { ascending: false });
    
    if (error) {
      console.error('Error fetching vouchers:', error);
      return res.status(500).json({ error: 'Error al obtener vouchers' });
    }
    
    // Agregar URLs
    const vouchersConUrl = vouchers?.map((v: any) => ({
      ...v,
      url: `/uploads/vouchers/${v.ruta_archivo}`
    })) || [];
    
    res.json(vouchersConUrl);
    
  } catch (error: any) {
    console.error('Error fetching vouchers:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/upload/voucher/:id/download - Descargar voucher
router.get('/voucher/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.userId;
    const userRole = (req as any).user.role;
    
    // Obtener voucher
    const { data: voucher, error } = await supabase
      .from('documentos_viaje')
      .select('*, ventas!inner(vendedor_id)')
      .eq('id', id)
      .single();
    
    if (error || !voucher) {
      return res.status(404).json({ error: 'Voucher no encontrado' });
    }
    
    // Verificar permisos
    if (userRole !== 'admin' && voucher.ventas.vendedor_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const filePath = path.join(uploadDir, 'vouchers', voucher.ruta_archivo);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    const ext = path.extname(voucher.ruta_archivo).toLowerCase();
    const contentType = ext === '.pdf' ? 'application/pdf' : 
                        ext === '.png' ? 'image/png' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${voucher.nombre_archivo}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error: any) {
    console.error('Error downloading voucher:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/upload/voucher/:id - Eliminar voucher (admin only)
router.delete('/voucher/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = (req as any).user.role;
    
    // Solo admin puede eliminar
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar vouchers' });
    }
    
    // Obtener voucher
    const { data: voucher, error } = await supabase
      .from('documentos_viaje')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !voucher) {
      return res.status(404).json({ error: 'Voucher no encontrado' });
    }
    
    // Eliminar archivo físico
    const uploadDir = process.env.STORAGE_PATH || './storage/uploads';
    const filePath = path.join(uploadDir, 'vouchers', voucher.ruta_archivo);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Eliminar de BD
    const { error: deleteError } = await supabase
      .from('documentos_viaje')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('Error deleting voucher:', deleteError);
      return res.status(500).json({ error: 'Error al eliminar voucher' });
    }
    
    // Verificar si quedan vouchers, si no, volver a estado 'pendiente'
    const { data: remainingVouchers } = await supabase
      .from('documentos_viaje')
      .select('id')
      .eq('venta_id', voucher.venta_id);
    
    if (!remainingVouchers || remainingVouchers.length === 0) {
      await supabase
        .from('ventas')
        .update({ estado: 'pendiente' })
        .eq('id', voucher.venta_id);
    }
    
    res.json({ message: 'Voucher eliminado exitosamente' });
    
  } catch (error: any) {
    console.error('Error deleting voucher:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

console.log('[UPLOAD ROUTES] Upload routes loaded successfully');
export default router;
