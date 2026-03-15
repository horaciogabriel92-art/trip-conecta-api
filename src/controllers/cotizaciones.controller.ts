import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const createCotizacion = async (req: Request, res: Response) => {
    const { 
        paquete_id, 
        cliente_nombre, 
        cliente_email, 
        cliente_telefono,
        tipo_habitacion,
        num_pasajeros,
        fecha_salida,
        precio_total: precio_enviado,
        notas,
        datos_completos
    } = req.body;
    const vendedor_id = (req as any).user.userId;

    console.log('Creating cotizacion with data:', req.body);

    try {
        // Obtener paquete para verificar
        const { data: paquete, error: paqueteError } = await supabase
            .from('paquetes')
            .select('*')
            .eq('id', paquete_id)
            .single();

        if (paqueteError || !paquete) {
            return res.status(404).json({ error: 'Paquete no encontrado' });
        }

        // Usar precio enviado desde frontend o calcular
        const precio_total = precio_enviado || paquete.precio_base * num_pasajeros;
        
        // Generar código único
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const codigo = `COT-${year}-${random}`;

        // Calcular fecha de expiración (7 días)
        const fecha_expiracion = new Date();
        fecha_expiracion.setDate(fecha_expiracion.getDate() + 7);

        // Preparar notas extendidas con datos completos
        let notasExtendidas = notas || '';
        if (datos_completos) {
            notasExtendidas += '\n\n--- DATOS COMPLETOS ---\n' + JSON.stringify(datos_completos, null, 2);
        }

        const insertData: any = {
            codigo,
            vendedor_id,
            paquete_id,
            cliente_nombre,
            cliente_email,
            cliente_telefono,
            tipo_habitacion,
            num_pasajeros,
            fecha_salida: fecha_salida || null,
            precio_total,
            comision_vendedor: precio_total * 0.12, // 12% comisión
            notas: notasExtendidas,
            fecha_expiracion: fecha_expiracion.toISOString(),
            estado: 'pendiente'
        };

        console.log('Inserting cotizacion:', insertData);

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(400).json({ 
                error: 'Error al crear cotización', 
                details: error.message,
                code: error.code 
            });
        }

        res.status(201).json(cotizacion);
    } catch (error: any) {
        console.error('Error creating quote:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

export const getCotizaciones = async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
        let query = supabase.from('cotizaciones').select('*');
        
        // Si no es admin, solo ver las suyas
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizaciones, error } = await query
            .order('fecha_creacion', { ascending: false });

        if (error) throw error;
        res.json(cotizaciones);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCotizacionById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        let query = supabase
            .from('cotizaciones')
            .select('*')
            .eq('id', id);
        
        if (user.role !== 'admin') {
            query = query.eq('vendedor_id', user.userId);
        }

        const { data: cotizacion, error } = await query.single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        res.json(cotizacion);
    } catch (error) {
        console.error('Error fetching quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const convertirAVenta = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    
    try {
        // Obtener cotización
        const { data: cotizacion, error: cotError } = await supabase
            .from('cotizaciones')
            .select('*')
            .eq('id', id)
            .single();

        if (cotError || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin' && cotizacion.vendedor_id !== user.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        // Generar código de venta
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const codigo_venta = `VEN-${year}-${random}`;

        // Obtener info del paquete
        const { data: paquete } = await supabase
            .from('paquetes')
            .select('titulo')
            .eq('id', cotizacion.paquete_id)
            .single();

        // Crear venta
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .insert({
                codigo: codigo_venta,
                cotizacion_id: id,
                vendedor_id: cotizacion.vendedor_id,
                cliente_nombre: cotizacion.cliente_nombre,
                cliente_email: cotizacion.cliente_email,
                cliente_telefono: cotizacion.cliente_telefono,
                paquete_id: cotizacion.paquete_id,
                paquete_nombre: paquete?.titulo || 'Paquete',
                fecha_salida: cotizacion.fecha_salida,
                num_pasajeros: cotizacion.num_pasajeros,
                precio_total: cotizacion.precio_total,
                comision_porcentaje: 12,
                comision_monto: cotizacion.comision_vendedor || (cotizacion.precio_total * 0.12),
                estado: 'confirmada'
            })
            .select()
            .single();

        if (ventaError) throw ventaError;

        // Actualizar cotización
        await supabase
            .from('cotizaciones')
            .update({ 
                estado: 'convertida',
                fecha_conversion: new Date().toISOString()
            })
            .eq('id', id);

        res.status(201).json({ message: 'Cotización convertida a venta', venta });
    } catch (error) {
        console.error('Error converting quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateCotizacion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = req.body;
    const user = (req as any).user;
    
    try {
        // Verificar que sea del vendedor o admin
        if (user.role !== 'admin') {
            const { data: cot } = await supabase
                .from('cotizaciones')
                .select('vendedor_id')
                .eq('id', id)
                .single();
            
            if (!cot || cot.vendedor_id !== user.userId) {
                return res.status(403).json({ error: 'No autorizado' });
            }
        }

        const { data: cotizacion, error } = await supabase
            .from('cotizaciones')
            .update(data)
            .eq('id', id)
            .select()
            .single();

        if (error || !cotizacion) {
            return res.status(404).json({ error: 'Cotización no encontrada' });
        }

        res.json({ message: 'Cotización actualizada', cotizacion });
    } catch (error) {
        console.error('Error updating quote:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
