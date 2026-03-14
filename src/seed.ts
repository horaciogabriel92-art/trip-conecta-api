import db from './config/database';
import bcrypt from 'bcrypt';

const seed = async () => {
    const saltRounds = 10;
    const adminPassword = await bcrypt.hash('admin123', saltRounds);
    const sellerPassword = await bcrypt.hash('vendedor123', saltRounds);

    try {
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
    } catch (error) {
        console.error('Error seeding data:', error);
    } finally {
        db.close();
    }
};

seed();
