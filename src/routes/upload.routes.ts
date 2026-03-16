import { Router } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken } from '../middleware/auth';
import multer from 'multer';

const router = Router();

// Configurar multer para memoria (no guardar en disco)
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

export default router;
