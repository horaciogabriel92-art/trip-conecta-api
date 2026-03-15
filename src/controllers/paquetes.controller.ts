import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

// Interfaz para los datos que vienen del frontend
interface PaqueteFrontend {
  id?: string;
  nombre?: string;
  titulo?: string;
  destino?: string;
  tipo?: string;
  descripcion?: string;
  precio_base?: number;
  precio_doble?: number;
  precio_triple?: number;
  precio_cuadruple?: number;
  duracion?: number;
  duracion_dias?: number;
  cupos_totales?: number;
  cupos_disponibles?: number;
  fecha_salida?: string;
  estado?: string;
  status?: string;
  imagen_url?: string;
  imagen_principal?: string;
  incluye?: string[];
  no_incluye?: string[];
  itinerario?: any[];
  galeria?: any[];
  recursos_vendedores?: any[];
  politicas_cancelacion?: string;
  codigo?: string;
  creado_por?: string;
}

// Función para mapear datos del frontend al schema de la BD
function mapearPaqueteBD(data: PaqueteFrontend): any {
  const paqueteBD: any = {};

  // Campos directos
  if (data.id) paqueteBD.id = data.id;
  if (data.codigo) paqueteBD.codigo = data.codigo;
  if (data.destino) paqueteBD.destino = data.destino;
  if (data.descripcion) paqueteBD.descripcion = data.descripcion;
  if (data.fecha_salida) paqueteBD.fecha_salida = data.fecha_salida;
  if (data.cupos_totales !== undefined) paqueteBD.cupos_totales = data.cupos_totales;
  if (data.cupos_disponibles !== undefined) paqueteBD.cupos_disponibles = data.cupos_disponibles;
  if (data.creado_por) paqueteBD.creado_por = data.creado_por;

  // Mapeo de campos con nombres diferentes
  // titulo (BD) = nombre (frontend)
  paqueteBD.titulo = data.titulo || data.nombre || 'Paquete sin título';

  // duracion_dias (BD) = duracion (frontend)
  paqueteBD.duracion_dias = data.duracion_dias || data.duracion || 7;

  // estado (BD) = status (frontend)
  paqueteBD.estado = data.estado || data.status || 'activo';

  // imagen_principal (BD) = imagen_url (frontend)
  if (data.imagen_url || data.imagen_principal) {
    paqueteBD.imagen_principal = data.imagen_url || data.imagen_principal;
  }

  // precio_base (BD) - usamos precio_doble como base si no viene precio_base
  paqueteBD.precio_base = data.precio_base || data.precio_doble || 0;

  // Campos JSON
  if (data.incluye) {
    paqueteBD.incluye = Array.isArray(data.incluye) ? data.incluye : [data.incluye];
  }
  if (data.no_incluye) {
    paqueteBD.no_incluye = Array.isArray(data.no_incluye) ? data.no_incluye : [data.no_incluye];
  }
  if (data.itinerario) {
    paqueteBD.itinerario = Array.isArray(data.itinerario) ? data.itinerario : [];
  }
  if (data.galeria) {
    paqueteBD.galeria = Array.isArray(data.galeria) ? data.galeria : [];
  }
  if (data.recursos_vendedores) {
    paqueteBD.recursos_vendedores = Array.isArray(data.recursos_vendedores) ? data.recursos_vendedores : [];
  }

  return paqueteBD;
}

// Función para mapear datos de la BD al frontend
function mapearPaqueteFrontend(data: any): PaqueteFrontend {
  return {
    id: data.id,
    codigo: data.codigo,
    nombre: data.titulo,
    titulo: data.titulo,
    destino: data.destino,
    descripcion: data.descripcion,
    duracion: data.duracion_dias,
    duracion_dias: data.duracion_dias,
    precio_base: data.precio_base,
    precio_doble: data.precio_base,
    status: data.estado,
    estado: data.estado,
    imagen_url: data.imagen_principal,
    imagen_principal: data.imagen_principal,
    fecha_salida: data.fecha_salida,
    cupos_totales: data.cupos_totales,
    cupos_disponibles: data.cupos_disponibles,
    incluye: data.incluye || [],
    no_incluye: data.no_incluye || [],
    itinerario: data.itinerario || [],
    galeria: data.galeria || [],
    recursos_vendedores: data.recursos_vendedores || [],
    fecha_creacion: data.fecha_creacion,
    fecha_actualizacion: data.fecha_actualizacion
  };
}

export const getAllPaquetes = async (req: Request, res: Response) => {
    try {
        const { data: paquetes, error } = await supabase
            .from('paquetes')
            .select('*')
            .neq('estado', 'eliminado')
            .order('fecha_creacion', { ascending: false });

        if (error) {
            console.error('Supabase error fetching packages:', error);
            return res.status(500).json({ error: 'Error al obtener paquetes', details: error.message });
        }
        
        // Mapear al formato del frontend
        const paquetesFrontend = paquetes?.map(mapearPaqueteFrontend) || [];
        res.json(paquetesFrontend);
    } catch (error: any) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const getPaqueteById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const { data: paquete, error } = await supabase
            .from('paquetes')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        // Mapear al formato del frontend
        res.json(mapearPaqueteFrontend(paquete));
    } catch (error: any) {
        console.error('Error fetching package:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const createPaquete = async (req: Request, res: Response) => {
    const dataFrontend: PaqueteFrontend = req.body;
    
    console.log('Creating paquete with frontend data:', JSON.stringify(dataFrontend, null, 2));
    
    try {
        // Generar código si no viene
        if (!dataFrontend.codigo) {
            const year = new Date().getFullYear();
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            dataFrontend.codigo = `PKG-${year}-${random}`;
        }

        // Mapear al formato de la BD
        const dataBD = mapearPaqueteBD(dataFrontend);
        
        // Asegurar campos requeridos
        if (!dataBD.titulo) dataBD.titulo = 'Paquete sin título';
        if (!dataBD.precio_base) dataBD.precio_base = 0;
        if (!dataBD.duracion_dias) dataBD.duracion_dias = 7;

        console.log('Mapped data for Supabase:', JSON.stringify(dataBD, null, 2));

        const { data: paquete, error } = await supabase
            .from('paquetes')
            .insert(dataBD)
            .select()
            .single();

        if (error) {
            console.error('Supabase error creating package:', error);
            return res.status(400).json({ 
                error: 'Error al crear paquete en base de datos', 
                details: error.message,
                code: error.code,
                hint: error.hint || null
            });
        }
        
        // Devolver en formato del frontend
        res.status(201).json(mapearPaqueteFrontend(paquete));
    } catch (error: any) {
        console.error('Error creating package:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

export const updatePaquete = async (req: Request, res: Response) => {
    const { id } = req.params;
    const dataFrontend: PaqueteFrontend = req.body;
    
    console.log('Updating paquete:', id, 'with data:', dataFrontend);
    
    try {
        // Mapear al formato de la BD
        const dataBD = mapearPaqueteBD(dataFrontend);
        
        // Remover campos que no se deben actualizar
        delete dataBD.id;
        delete dataBD.codigo;
        delete dataBD.fecha_creacion;

        const { data: paquete, error } = await supabase
            .from('paquetes')
            .update(dataBD)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Supabase error updating package:', error);
            return res.status(400).json({ 
                error: 'Error al actualizar paquete', 
                details: error.message 
            });
        }
        
        if (!paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        res.json({ 
            message: 'Paquete actualizado correctamente', 
            paquete: mapearPaqueteFrontend(paquete) 
        });
    } catch (error: any) {
        console.error('Error updating package:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const deletePaquete = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Soft delete
        const { data: paquete, error } = await supabase
            .from('paquetes')
            .update({ estado: 'eliminado' })
            .eq('id', id)
            .select()
            .single();

        if (error || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        res.json({ message: 'Paquete eliminado correctamente' });
    } catch (error: any) {
        console.error('Error deleting package:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};
