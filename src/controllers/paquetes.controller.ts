import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getAllPaquetes = async (req: Request, res: Response) => {
    try {
        const { data: paquetes, error } = await supabase
            .from('paquetes')
            .select('*')
            .neq('estado', 'eliminado')
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;
        res.json(paquetes);
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ error: 'Internal server error' });
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
    } catch (error) {
        console.error('Error fetching package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createPaquete = async (req: Request, res: Response) => {
    const data = req.body;
    try {
        // Generar código si no viene
        if (!data.codigo) {
            const year = new Date().getFullYear();
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            data.codigo = `PKG-${year}-${random}`;
        }

        const { data: paquete, error } = await supabase
            .from('paquetes')
            .insert(data)
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(paquete);
    } catch (error) {
        console.error('Error creating package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updatePaquete = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    try {
        const { data: paquete, error } = await supabase
            .from('paquetes')
            .update(data)
            .eq('id', id)
            .select()
            .single();

        if (error || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }
        
        res.json({ message: 'Paquete actualizado correctamente', paquete });
    } catch (error) {
        console.error('Error updating package:', error);
        res.status(500).json({ error: 'Internal server error' });
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
    } catch (error) {
        console.error('Error deleting package:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
