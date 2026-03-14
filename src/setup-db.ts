import db from './config/database';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';

const setup = async () => {
    const schemaPath = path.resolve(process.cwd(), '../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
        console.log('Creating schema...');
        db.exec(schema);
        console.log('Schema created successfully.');

        console.log('Seeding data...');
        const saltRounds = 10;
        const adminPassword = await bcrypt.hash('admin123', saltRounds);
        const sellerPassword = await bcrypt.hash('vendedor123', saltRounds);

        // Check if admin exists to avoid double seeding
        const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@tripconecta.com');
        
        if (!existingAdmin) {
            db.prepare('INSERT INTO users (email, password, nombre, apellido, role) VALUES (?, ?, ?, ?, ?)').run(
                'admin@tripconecta.com',
                adminPassword,
                'Carlos',
                'Méndez',
                'admin'
            );

            db.prepare('INSERT INTO users (email, password, nombre, apellido, role, comision_porcentaje) VALUES (?, ?, ?, ?, ?, ?)').run(
                'vendedor1@gmail.com',
                sellerPassword,
                'María',
                'López',
                'vendedor',
                12.00
            );

            db.prepare('INSERT INTO users (email, password, nombre, apellido, role, comision_porcentaje) VALUES (?, ?, ?, ?, ?, ?)').run(
                'vendedor2@gmail.com',
                sellerPassword,
                'Juan',
                'Rodríguez',
                'vendedor',
                10.00
            );
            console.log('Seed data inserted successfully.');
        } else {
            console.log('Admin already exists, skipping seed.');
        }

    } catch (error) {
        console.error('Error during setup:', error);
    } finally {
        db.close();
    }
};

setup();
