import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getTenantId } from '../utils/tenant';

// Helper para truncar strings y evitar error 22001 (value too long)
function truncar(str: string | undefined, maxLength: number): string | undefined {
  if (!str) return str;
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}

// Interfaz para Hotel en paquetes
interface Hotel {
  id: string;
  nombre: string;
  link?: string;
  ciudad?: string;
  precios: {
    doble: number;
    triple?: number;
    cuadruple?: number;
  };
}

// Interfaz para los datos que vienen del frontend
interface PaqueteFrontend {
  id?: string;
  nombre?: string;
  titulo?: string;
  destino?: string;
  tipo?: string;
  descripcion?: string;
  precio_base?: number | null;
  precio_doble?: number | null;
  precio_triple?: number | null;
  precio_cuadruple?: number | null;
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
  fecha_creacion?: string;
  fecha_actualizacion?: string;
  vuelos?: any[];
  hoteles?: Hotel[];
  comision_monto_usd?: number | null;
}

// Función para mapear datos del frontend al schema de la BD
function mapearPaqueteBD(data: PaqueteFrontend): any {
  const paqueteBD: any = {};

  // Campos directos (con truncamiento para evitar error 22001)
  if (data.id) paqueteBD.id = data.id;
  if (data.codigo) paqueteBD.codigo = truncar(data.codigo, 50);
  if (data.destino) paqueteBD.destino = truncar(data.destino, 100);
  if (data.descripcion) paqueteBD.descripcion = data.descripcion; // TEXT, no necesita truncar
  if (data.fecha_salida) paqueteBD.fecha_salida = data.fecha_salida;
  if (data.cupos_totales !== undefined) paqueteBD.cupos_totales = data.cupos_totales;
  if (data.cupos_disponibles !== undefined) paqueteBD.cupos_disponibles = data.cupos_disponibles;
  if (data.creado_por) paqueteBD.creado_por = data.creado_por;

  // Mapeo de campos con nombres diferentes
  // titulo (BD) = nombre (frontend)
  paqueteBD.titulo = truncar(data.titulo || data.nombre || 'Paquete sin título', 255);

  // duracion_dias (BD) = duracion (frontend)
  paqueteBD.duracion_dias = data.duracion_dias || data.duracion || 7;

  // estado (BD) = status (frontend)
  paqueteBD.estado = truncar(data.estado || data.status || 'activo', 20);

  // imagen_principal (BD) = imagen_url (frontend)
  if (data.imagen_url || data.imagen_principal) {
    paqueteBD.imagen_principal = truncar(data.imagen_url || data.imagen_principal, 500);
  }

  // Precios por tipo de habitación (todos opcionales)
  if (data.precio_base !== undefined && data.precio_base !== null) {
    paqueteBD.precio_base = data.precio_base;
  }
  if (data.precio_doble !== undefined && data.precio_doble !== null) {
    paqueteBD.precio_doble = data.precio_doble;
  }
  if (data.precio_triple !== undefined && data.precio_triple !== null) {
    paqueteBD.precio_triple = data.precio_triple;
  }
  if (data.precio_cuadruple !== undefined && data.precio_cuadruple !== null) {
    paqueteBD.precio_cuadruple = data.precio_cuadruple;
  }

  // Campos JSON
  if (data.incluye) {
    paqueteBD.incluye = Array.isArray(data.incluye) ? data.incluye : [data.incluye];
  }
  if (data.no_incluye) {
    paqueteBD.no_incluye = Array.isArray(data.no_incluye) ? data.no_incluye : [data.no_incluye];
  }
  // Itinerario puede ser objeto {texto, dias} o array legacy
  if (data.itinerario) {
    if (typeof data.itinerario === 'object' && !Array.isArray(data.itinerario) && (data.itinerario as { texto?: string }).texto !== undefined) {
      // Nuevo formato: { texto: string, dias: array }
      paqueteBD.itinerario = data.itinerario;
    } else if (Array.isArray(data.itinerario)) {
      // Formato legacy: array -> convertir a nuevo formato
      paqueteBD.itinerario = { texto: '', dias: data.itinerario };
    } else if (typeof data.itinerario === 'string') {
      // String simple -> convertir a nuevo formato
      paqueteBD.itinerario = { texto: data.itinerario, dias: [] };
    }
  }
  // Si viene descripcion pero no itinerario, usar descripcion como itinerario
  if (data.descripcion && !data.itinerario) {
    paqueteBD.itinerario = { texto: data.descripcion, dias: [] };
    paqueteBD.descripcion = data.descripcion; // Mantener por compatibilidad
  }
  if (data.galeria) {
    paqueteBD.galeria = Array.isArray(data.galeria) ? data.galeria : [];
  }
  if (data.recursos_vendedores) {
    paqueteBD.recursos_vendedores = Array.isArray(data.recursos_vendedores) ? data.recursos_vendedores : [];
  }
  if (data.vuelos) {
    paqueteBD.vuelos = Array.isArray(data.vuelos) ? data.vuelos : [];
  }
  if (data.hoteles) {
    paqueteBD.hoteles = Array.isArray(data.hoteles) ? data.hoteles : [];
  }
  if (data.comision_monto_usd !== undefined && data.comision_monto_usd !== null) {
    paqueteBD.comision_monto_usd = data.comision_monto_usd;
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
    precio_doble: data.precio_doble || data.precio_base,
    precio_triple: data.precio_triple,
    precio_cuadruple: data.precio_cuadruple,
    status: data.estado,
    estado: data.estado,
    imagen_url: data.imagen_principal,
    imagen_principal: data.imagen_principal,
    fecha_salida: data.fecha_salida,
    cupos_totales: data.cupos_totales,
    cupos_disponibles: data.cupos_disponibles,
    incluye: data.incluye || [],
    no_incluye: data.no_incluye || [],
    itinerario: data.itinerario || { texto: data.descripcion || '', dias: [] },
    galeria: data.galeria || [],
    recursos_vendedores: data.recursos_vendedores || [],
    vuelos: data.vuelos || [],
    hoteles: data.hoteles || [],
    comision_monto_usd: data.comision_monto_usd,
    fecha_creacion: data.fecha_creacion,
    fecha_actualizacion: data.fecha_actualizacion
  };
}

export const getAllPaquetes = async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
        const { data: paquetes, error } = await supabase
            .from('paquetes')
            .select('*')
            .eq('tenant_id', tenantId)
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
    const tenantId = getTenantId(req);
    const { id } = req.params;
    try {
        const { data: paquete, error } = await supabase
            .from('paquetes')
            .select('*')
            .eq('tenant_id', tenantId)
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
    const tenantId = getTenantId(req);
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
            .insert({ ...dataBD, tenant_id: tenantId })
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
    const tenantId = getTenantId(req);
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
            .eq('tenant_id', tenantId)
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
    const tenantId = getTenantId(req);
    const { id } = req.params;
    try {
        // Soft delete
        const { data: paquete, error } = await supabase
            .from('paquetes')
            .update({ estado: 'eliminado' })
            .eq('tenant_id', tenantId)
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
