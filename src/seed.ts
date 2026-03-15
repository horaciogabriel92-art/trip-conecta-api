// Datos iniciales para Supabase
// Ejecutar esto después de crear las tablas

import { supabase } from './config/supabase';
import bcrypt from 'bcrypt';

async function seed() {
    console.log('🌱 Seeding database...');

    // Crear admin
    const adminPassword = await bcrypt.hash('admin123', 10);
    const { error: adminError } = await supabase.from('users').insert({
        email: 'admin@tripconecta.com',
        password: adminPassword,
        nombre: 'Administrador',
        apellido: 'Sistema',
        rol: 'admin',
        comision_porcentaje: 0
    });

    if (adminError && !adminError.message.includes('duplicate')) {
        console.error('Error creating admin:', adminError);
    } else {
        console.log('✅ Admin user created');
    }

    // Crear vendedor de prueba
    const vendedorPassword = await bcrypt.hash('vendedor123', 10);
    const { error: vendedorError } = await supabase.from('users').insert({
        email: 'vendedor@tripconecta.com',
        password: vendedorPassword,
        nombre: 'Vendedor',
        apellido: 'Test',
        rol: 'vendedor',
        comision_porcentaje: 12
    });

    if (vendedorError && !vendedorError.message.includes('duplicate')) {
        console.error('Error creating vendedor:', vendedorError);
    } else {
        console.log('✅ Vendedor user created');
    }

    console.log('✅ Seeding completed');
}

seed();
