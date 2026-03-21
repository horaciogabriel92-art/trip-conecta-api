# Arquitectura Trip Conecta B2B - Documento de Referencia

## ⚠️ ESTADO ACTUAL (Marzo 2026)

### Infraestructura Real
| Componente | Tecnología | Ubicación | Notas |
|------------|-----------|-----------|-------|
| **Frontend (Panel)** | Next.js 16 | Coolify (Docker) | panel.tripconecta.com |
| **Frontend (Landing)** | Next.js 16 | Vercel | tripconecta.com |
| **API Backend** | Express.js | Coolify (Docker) | api.tripconecta.com |
| **Base de Datos** | PostgreSQL | Supabase Cloud | fcaglzfkqqgoqoayrrzc.supabase.co |
| **Archivos/Documentos** | Filesystem Local | VPS Hetzner | /data/trip-conecta/uploads |
| **Imágenes Paquetes** | Supabase Storage | Supabase Cloud | Bucket 'paquetes' |

---

## 📄 Arquitectura de Cotizaciones - "Datos, no Archivos"

### Filosofía
Las cotizaciones **NO almacenan PDFs**. Solo se guarda el JSON con los datos, y el PDF se regenera on-demand en el cliente usando React-PDF.

**Ventajas:**
- ✅ Sin costo de storage para PDFs
- ✅ Datos siempre frescos (no hay PDFs desactualizados)
- ✅ Sin dependencia de Puppeteer/Chromium en el servidor
- ✅ Generación instantánea client-side

### Flujo de Cotización

```
[Usuario Vendedor]
    ↓ (completa formulario)
[Guarda en DB: cotizaciones.notas (JSON)]
    ↓
[Panel muestra botón "Generar PDF"]
    ↓ (clic)
[React-PDF genera PDF en el navegador]
    ↓
[Usuario descarga PDF ephemeral]
```

### Estructura de Datos Guardada

La tabla `cotizaciones` guarda los datos en formato JSON en el campo `notas`:

```typescript
// Datos guardados en cotizaciones.notas (JSON)
{
  "cliente": {
    "nombre": "string",
    "apellido": "string",
    "documento": "string",
    "email": "string",
    "telefono": "string"
  },
  "pasajeros": [
    {
      "nombre": "string",
      "apellido": "string",
      "documento": "string",
      "fecha_nacimiento": "string",
      "nacionalidad": "string"
    }
  ],
  "precios": {
    "moneda": "USD",
    "precio_unitario": "string",
    "subtotal": "string",
    "impuestos": "string",
    "extras": "string",
    "total": "string",
    "anticipo": "string",
    "saldo": "string"
  }
}
```

**Campos importantes en `cotizaciones`:**
- `codigo`: Código único de cotización (ej: COT-2026-36817)
- `estado`: pendiente | respondida | convertida | vencida | cancelada
- `notas`: JSON con datos completos del cliente y pasajeros
- `precio_total`: Monto total en USD
- `fecha_expiracion`: Fecha límite de validez
- `pago_realizado`: boolean (si ya fue pagada)
- `monto_pagado`, `tipo_pago`, `medio_pago`: Datos de pago

### Política de Validez

| Estado | Validez |
|--------|---------|
| **No pagada** | 24 horas desde emisión |
| **Pagada** | Definido por el vendedor (fecha_expiracion) |

### Generación de PDF

**Tecnología:** `@react-pdf/renderer` (client-side)

**Componentes:**
- `CotizacionPDF.tsx`: Layout del PDF con estilos de marca
- `PDFDownloadButton.tsx`: Botón de descarga + preview modal

**NO hay endpoints de backend** para PDF. Todo es client-side.

---

## 🗄️ Estructura de Base de Datos

### Tabla `users` (Vendedores y Admins)
```sql
id: uuid PRIMARY KEY
email: varchar UNIQUE NOT NULL
password: varchar NOT NULL (bcrypt hash)
nombre: varchar NOT NULL
apellido: varchar NOT NULL
telefono: varchar
rol: varchar CHECK ('admin' | 'vendedor') DEFAULT 'vendedor'
comision_porcentaje: numeric DEFAULT 12.00
activo: boolean DEFAULT true
fecha_registro: timestamptz DEFAULT now()
ultimo_acceso: timestamptz
```

### Tabla `paquetes` (Productos Turísticos)
```sql
id: uuid PRIMARY KEY
codigo: varchar UNIQUE NOT NULL
titulo: varchar NOT NULL
destino: varchar NOT NULL
descripcion: text
precio_base: numeric NOT NULL
duracion_dias: integer NOT NULL
imagen_principal: varchar (URL Supabase Storage)
galeria: jsonb DEFAULT '[]'
itinerario: jsonb DEFAULT '[]'  -- Array de días
incluye: jsonb DEFAULT '[]'     -- Array de strings
no_incluye: jsonb DEFAULT '[]'  -- Array de strings
politicas_cancelacion: text
fecha_salida: date
cupos_disponibles: integer DEFAULT 0
cupos_totales: integer DEFAULT 0
estado: varchar CHECK ('activo' | 'completo' | 'cancelado' | 'eliminado') DEFAULT 'activo'
creado_por: uuid FK → users(id)
fecha_creacion: timestamptz DEFAULT now()
fecha_actualizacion: timestamptz DEFAULT now()
recursos_vendedores: jsonb DEFAULT '[]'
precio_doble: numeric
precio_triple: numeric
precio_cuadruple: numeric
```

### Tabla `cotizaciones` (Cotizaciones de Clientes)
```sql
id: uuid PRIMARY KEY
codigo: varchar UNIQUE NOT NULL
vendedor_id: uuid FK → users(id) NOT NULL
cliente_nombre: varchar NOT NULL
cliente_email: varchar
cliente_telefono: varchar
paquete_id: uuid FK → paquetes(id)
fecha_salida: date
num_pasajeros: integer DEFAULT 1
tipo_habitacion: varchar
precio_total: numeric
comision_vendedor: numeric
notas: text  -- JSON con datos completos
estado: varchar CHECK ('pendiente' | 'respondida' | 'convertida' | 'vencida' | 'cancelada') DEFAULT 'pendiente'
fecha_creacion: timestamptz DEFAULT now()
fecha_expiracion: timestamptz
fecha_conversion: timestamptz
pago_realizado: boolean DEFAULT false
monto_pagado: numeric
tipo_pago: varchar
medio_pago: varchar
observaciones_pago: text
comprobante_pago_url: text
fecha_pago: timestamp
```

### Tabla `ventas` (Conversiones de Cotizaciones)
```sql
id: uuid PRIMARY KEY
codigo: varchar UNIQUE NOT NULL
cotizacion_id: uuid FK → cotizaciones(id)
vendedor_id: uuid FK → users(id) NOT NULL
cliente_nombre: varchar NOT NULL
cliente_email: varchar
cliente_telefono: varchar
paquete_id: uuid FK → paquetes(id)
paquete_nombre: varchar
fecha_salida: date
num_pasajeros: integer NOT NULL
precio_total: numeric NOT NULL
comision_porcentaje: numeric NOT NULL
comision_monto: numeric NOT NULL
comision_estado: varchar CHECK ('pendiente' | 'pagada') DEFAULT 'pendiente'
fecha_pago_comision: timestamptz
metodo_pago: varchar
estado: varchar CHECK ('confirmada' | 'en_proceso' | 'emitida' | 'cancelada' | 'reembolsada') DEFAULT 'confirmada'
notas: text
fecha_creacion: timestamptz DEFAULT now()
fecha_actualizacion: timestamptz DEFAULT now()
```

### Tabla `comprobantes_pago` (Comprobantes de Pago)
```sql
id: uuid PRIMARY KEY
cotizacion_id: uuid FK → cotizaciones(id) NOT NULL
vendedor_id: uuid FK → users(id) NOT NULL
nombre_archivo: varchar NOT NULL
ruta_archivo: varchar NOT NULL (path en VPS)
tipo_archivo: varchar NOT NULL
tamaño_bytes: integer
descripcion: text
fecha_subida: timestamp DEFAULT CURRENT_TIMESTAMP
```

### Tabla `documentos_viaje` (Documentos de Ventas Confirmadas)
```sql
id: uuid PRIMARY KEY
venta_id: uuid FK → ventas(id) NOT NULL
tipo: varchar CHECK ('boleto_aereo' | 'voucher_hotel' | 'voucher_actividad' | 'seguro' | 'itinerario_final' | 'e_ticket' | 'boarding_pass' | 'otro')
nombre_archivo: varchar NOT NULL
ruta_archivo: varchar NOT NULL (path en VPS)
descripcion: text
subido_por: uuid FK → users(id)
fecha_subida: timestamptz DEFAULT now()
```

### Tabla `pagos_comisiones` (Pagos de Comisiones a Vendedores)
```sql
id: uuid PRIMARY KEY
vendedor_id: uuid FK → users(id) NOT NULL
venta_id: uuid FK → ventas(id) NOT NULL
monto: numeric NOT NULL
metodo_pago: varchar
referencia_pago: varchar
pagado_por: uuid FK → users(id)
notas: text
fecha_pago: timestamptz DEFAULT now()
```

---

## 📁 Flujo de Documentos (Actual)

```
[Usuario Admin] 
    ↓ (sube archivo)
[API Express] 
    ↓ (multer guarda en)
[/data/trip-conecta/uploads] (volumen persistente Docker)
    ↓ (guarda referencia en)
[Supabase - documentos_viaje.ruta_archivo]
```

### Endpoints de Documentos

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/documentos/venta/:ventaId` | Listar documentos de venta | JWT |
| GET | `/api/documentos/:id/download` | Descargar archivo (serve file) | JWT |
| POST | `/api/documentos` | Subir documento | JWT + Admin |
| DELETE | `/api/documentos/:id` | Eliminar documento | JWT + Admin |

---

## ⚙️ Configuración API (Environment)

```env
PORT=3001
SUPABASE_URL=https://fcaglzfkqqgoqoayrrzc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
JWT_SECRET=trip-conecta-secret-key-2024
STORAGE_PATH=/app/storage/uploads
```

### Volumen Docker (Crítico)

El contenedor de la API tiene montado:
```
/data/trip-conecta/uploads (host) → /app/storage/uploads (container)
```

**Sin este volumen**, los archivos se pierden al reiniciar el contenedor.

---

## ⚠️ Limitaciones Conocidas

1. **No usar Supabase Storage para documentos**: Actualmente los documentos de viaje (boletos, vouchers) se guardan en filesystem local, NO en Supabase Storage.

2. **Backup manual requerido**: Los archivos en `/data/trip-conecta/uploads` deben respaldarse manualmente (no están en Supabase).

3. **Un solo servidor**: La API y los archivos están en el mismo VPS. Si se migra la API a otro servidor, hay que migrar también los archivos.

4. **Cotizaciones no persisten PDFs**: Los PDFs de cotizaciones se regeneran on-demand. No hay historial de versiones de PDFs.

---

## Pendientes de Decisión

- [ ] ¿Mover documentos a Supabase Storage para tener todo en la nube?
- [ ] ¿Implementar backup automático de `/data/trip-conecta/uploads`?
- [ ] ¿Usar S3/R2 en el futuro para archivos pesados?
- [ ] ¿Guardar PDFs de cotizaciones en storage para historial?

---

## Verificación Antes de Cambios

Antes de modificar código de documentos o cotizaciones:
1. ¿Está el volumen Docker montado correctamente?
2. ¿La variable `STORAGE_PATH` apunta al path correcto dentro del contenedor?
3. ¿El endpoint de download tiene acceso al filesystem?
4. ¿Los campos JSON en `notas` mantienen compatibilidad hacia atrás?
