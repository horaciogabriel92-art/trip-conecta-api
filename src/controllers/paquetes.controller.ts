import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

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
        res.json(paquetes);
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
        res.json(paquete);
    } catch (error: any) {
        console.error('Error fetching package:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const createPaquete = async (req: Request, res: Response) => {
    const data = req.body;
    
    console.log('Creating paquete with data:', data);
    
    try {
        // Generar código si no viene
        if (!data.codigo) {
            const year = new Date().getFullYear();
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            data.codigo = `PKG-${year}-${random}`;
        }

        // Asegurar que campos JSON sean válidos
        if (data.incluye && typeof data.incluye === 'string') {
            data.incluye = [data.incluye];
        }
        if (data.no_incluye && typeof data.no_incluye === 'string') {
            data.no_incluye = [data.no_incluye];
        }
        if (data.itinerario && typeof data.itinerario === 'string') {
            data.itinerario = JSON.parse(data.itinerario);
        }
        if (data.recursos_vendedores && typeof data.recursos_vendedores === 'string') {
            data.recursos_vendedores = JSON.parse(data.recursos_vendedores);
        }

        const { data: paquete, error } = await supabase
            .from('paquetes')
            .insert(data)
            .select()
            .single();

        if (error) {
            console.error('Supabase error creating package:', error);
            return res.status(400).json({ 
                error: 'Error al crear paquete', 
                details: error.message,
                code: error.code
            });
        }
        
        res.status(201).json(paquete);
    } catch (error: any) {
        console.error('Error creating package:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

export const updatePaquete = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    
    console.log('Updating paquete:', id, 'with data:', data);
    
    try {
        // Asegurar que campos JSON sean válidos
        if (data.incluye && typeof data.incluye === 'string') {
            data.incluye = [data.incluye];
        }
        if (data.no_incluye && typeof data.no_incluye === 'string') {
            data.no_incluye = [data.no_incluye];
        }

        const { data: paquete, error } = await supabase
            .from('paquetes')
            .update(data)
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
        
        res.json({ message: 'Paquete actualizado correctamente', paquete });
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
