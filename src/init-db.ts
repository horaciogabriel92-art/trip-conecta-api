import db from './config/database';
import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(process.cwd(), '../database/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

try {
    db.exec(schema);
    console.log('Database schema created successfully.');
} catch (error) {
    console.error('Error creating database schema:', error);
} finally {
    db.close();
}
