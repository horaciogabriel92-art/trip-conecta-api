# Trip Conecta API

API RESTful para la plataforma B2B de Trip Conecta. Gestiona autenticación, paquetes turísticos, cotizaciones, ventas, documentos y comisiones.

## 🚀 Tecnologías

- **Runtime**: Node.js 20+
- **Framework**: Express.js 5.x
- **Lenguaje**: TypeScript 5.x
- **Base de Datos**: 
  - Desarrollo: SQLite (better-sqlite3)
  - Producción: PostgreSQL (Supabase)
- **Autenticación**: JWT (jsonwebtoken)
- **Logging**: Pino + pino-pretty
- **Validación**: Zod

## 📁 Estructura

```
trip-conecta-api/
├── src/
│   ├── config/
│   │   └── database.ts          # Conexión a base de datos
│   ├── controllers/
│   │   ├── auth.controller.ts   # Autenticación
│   │   ├── paquetes.controller.ts
│   │   ├── cotizaciones.controller.ts
│   │   ├── ventas.controller.ts
│   │   ├── documentos.controller.ts
│   │   └── comisiones.controller.ts
│   ├── middleware/
│   │   ├── auth.ts              # JWT + autorización por rol
│   │   └── upload.ts            # Manejo de archivos
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── paquetes.routes.ts
│   │   ├── cotizaciones.routes.ts
│   │   ├── ventas.routes.ts
│   │   ├── documentos.routes.ts
│   │   └── comisiones.routes.ts
│   ├── setup-db.ts              # Script de inicialización
│   └── index.ts                 # Entry point
├── .env                         # Variables de entorno (no commitear)
├── package.json
└── tsconfig.json
```

## 🛠️ Instalación Local

```bash
# 1. Navegar al directorio
cd trip-conecta-api

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 4. Inicializar base de datos
npm run setup-db

# 5. Iniciar servidor de desarrollo
npm run dev
```

El servidor estará disponible en: `http://localhost:3001`

## 🔧 Variables de Entorno

```env
PORT=3001
NODE_ENV=development
JWT_SECRET=tu-secreto-super-seguro-cambiar-en-produccion
DB_PATH=./database/trip_conecta.db
STORAGE_PATH=./storage/uploads
LOG_LEVEL=info
```

### Para Producción (Supabase)

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
JWT_SECRET=[GENERAR-UNO-SEGURO]
STORAGE_PATH=/var/www/trip-conecta-api/storage
```

## 📚 API Endpoints

### Autenticación
- `POST /api/auth/login` - Login con email y password

### Paquetes
- `GET /api/paquetes` - Listar paquetes (autenticado)
- `GET /api/paquetes/:id` - Obtener paquete por ID
- `POST /api/paquetes` - Crear paquete (admin)
- `PUT /api/paquetes/:id` - Actualizar paquete (admin)
- `DELETE /api/paquetes/:id` - Soft delete (admin)

### Cotizaciones
- `GET /api/cotizaciones` - Listar cotizaciones
- `POST /api/cotizaciones` - Crear cotización
- `GET /api/cotizaciones/:id` - Obtener cotización
- `PUT /api/cotizaciones/:id/convertir` - Convertir a venta

### Ventas
- `GET /api/ventas` - Listar ventas
- `GET /api/ventas/:id` - Obtener venta
- `PUT /api/ventas/:id/estado` - Actualizar estado

### Documentos
- `GET /api/documentos/venta/:ventaId` - Listar documentos
- `POST /api/documentos` - Subir documento (admin)
- `GET /api/documentos/:id/download` - Descargar documento

### Comisiones
- `GET /api/comisiones` - Listar comisiones del vendedor
- `GET /api/comisiones/pendientes` - Comisiones pendientes

## 👥 Usuarios de Prueba

| Rol | Email | Password |
|-----|-------|----------|
| Admin | admin@tripconecta.com | admin123 |
| Vendedor | vendedor1@gmail.com | vendedor123 |
| Vendedor | vendedor2@gmail.com | vendedor123 |

## 📝 Scripts Disponibles

```bash
npm run dev          # Desarrollo con hot reload
npm run setup-db     # Inicializar DB + seed data
```

## 🚀 Deployment

Ver guía completa en: `/docs/deployment.md`

Resumen rápido:
1. Configurar servidor Ubuntu 22.04 en Hetzner
2. Instalar Node.js 20, PM2, Nginx
3. Clonar repo y configurar .env
4. `npm install` y `npm run setup-db`
5. PM2 start
6. Configurar Nginx + SSL

---

**Última actualización**: Marzo 2026
**Versión**: 1.0.0
