/**
 * Script para crear el primer superadmin del panel ernestosplace.
 * Uso: SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... SUPERADMIN_NOMBRE=... node scripts/create-superadmin.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.SUPERADMIN_EMAIL;
const password = process.env.SUPERADMIN_PASSWORD;
const nombre = process.env.SUPERADMIN_NOMBRE || 'Administrador';
const rol = process.env.SUPERADMIN_ROL || 'superadmin';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Se requieren SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!email || !password || password.length < 8) {
  console.error('❌ Se requieren SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (mínimo 8 caracteres)');
  process.exit(1);
}

if (!['superadmin', 'support'].includes(rol)) {
  console.error('❌ SUPERADMIN_ROL debe ser superadmin o support');
  process.exit(1);
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: existing } = await supabase
    .from('superadmins')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    console.log('⚠️ Ya existe un superadmin con ese email');
    process.exit(0);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { error } = await supabase.from('superadmins').insert({
    email,
    password: hashedPassword,
    nombre,
    rol,
    activo: true,
  });

  if (error) {
    console.error('❌ Error creando superadmin:', error.message);
    process.exit(1);
  }

  console.log(`✅ Superadmin creado: ${email} (${rol})`);
}

main();
