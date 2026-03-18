# 📄 Diagrama de Implementación: PDF de Cotización

## 🎯 Objetivo
Generar PDFs de cotización con diseño profesional, datos dinámicos del cliente/paquete, e itinerario.

## 📊 Arquitectura Completa

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FLUJO DE GENERACIÓN PDF                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│   VENDEDOR       │     │   FRONTEND       │     │   BACKEND API           │
│   (Panel)        │────▶│   (Next.js)      │────▶│   (Express)             │
│                  │     │                  │     │                         │
│ Click "Generar  │     │ GET /cotizaciones│     │ 1. Obtener cotización   │
│ PDF"            │     │ /:id/pdf         │     │ 2. Obtener paquete      │
│                  │     │                  │     │ 3. Procesar datos       │
└──────────────────┘     └──────────────────┘     └─────────────────────────┘
                                                            │
                                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PDF GENERATOR SERVICE                             │
│                    (Nueva ruta: /api/cotizaciones/:id/pdf)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────┐    ┌──────────┐    ┌──────────┐
            │  Datos   │    │ Template │    │  PDFKit  │
            │  Merge   │───▶│  Engine  │───▶│  /       │
            │          │    │(pug-pdf) │    │ Puppeteer│
            └──────────┘    └──────────┘    └──────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PDF OUTPUT                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📄 Estructura del PDF (2 Páginas)

### PÁGINA 1: RESUMEN DE COTIZACIÓN

```
┌─────────────────────────────────────────────────────────────┐
│ TRIP CONECTA - B2B SYSTEM                                   │
│                                                             │
│ Cotización: [COT-2026-04052]                    Fecha: [ ]  │
│                                                             │
│ Vendedor: [Nombre Apellido]                                 │
│ Email: [vendedor@tripconecta.com]                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DATOS DEL CLIENTE                                           │
│                                                             │
│ Nombre: [Horacio Gabriel Morales]                           │
│ Documento: [12345678]                                       │
│ Email: [cliente@email.com]                                  │
│ Teléfono: [098133523]                                       │
│ Nacionalidad: [Uruguay]                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PAQUETE: [EUROPA COMPLETA]                                  │
│                                                             │
│ Destino: [Madrid, España]                                   │
│ Duración: [7 días / 6 noches]                               │
│ Fecha de Salida: [19/06/2026]                               │
│ Tipo de Habitación: [Doble]                                 │
│ Pasajeros: [2]                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DETALLE DE PASAJEROS                                        │
│                                                             │
│ Pasajero 1: [Horacio Gabriel Morales]                       │
│   - Documento: [12345678]                                   │
│   - Fecha Nac.: [15/03/1985]                                │
│   - Nacionalidad: [Uruguay]                                 │
│                                                             │
│ Pasajero 2: [María López]                                   │
│   - Documento: [87654321]                                   │
│   - Fecha Nac.: [20/07/1990]                                │
│   - Nacionalidad: [Argentina]                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ RESUMEN DE PRECIOS                                          │
│                                                             │
│ Precio por persona (base doble):        $3,300              │
│ Cantidad de pasajeros:                  x 2                 │
│                                                             │
│ SUBTOTAL:                               $6,600              │
│ Impuestos (incluidos):                  $0                  │
│                                                             │
│ TOTAL:                                  $6,600              │
└─────────────────────────────────────────────────────────────┘
```

### PÁGINA 2: ITINERARIO DETALLADO

```
DÍA 1 - [Fecha]
┌─────────────────────────────────────────────────────────────┐
│ [Título del día]                                            │
│                                                             │
│ [Descripción detallada...]                                  │
│                                                             │
│ 🏨 Hotel: [Nombre del hotel]                                │
│ 🍽️  Comidas: [Desayuno incluido]                            │
└─────────────────────────────────────────────────────────────┘

DÍA 2 - [Fecha + 1]
┌─────────────────────────────────────────────────────────────┐
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ Tecnología Recomendada

### Opción: Puppeteer + Pug (Recomendado)
```javascript
// Genera PDF desde HTML/CSS con diseño profesional
const puppeteer = require('puppeteer');
const pug = require('pug');

// Pros: Diseño flexible con CSS, imágenes, fuentes
// Cons: Requiere Chromium (~150MB)
```

## 📦 Datos Requeridos

```typescript
interface PDFCotizacionData {
  cotizacion: {
    codigo: string;
    fecha_creacion: string;
    precio_total: number;
    num_pasajeros: number;
    tipo_habitacion: string;
    datos_completos: {
      cliente: { nombre, apellido, documento, email, telefono, fecha_nacimiento, nacionalidad };
      pasajeros: Array<{ nombre, apellido, documento, fecha_nacimiento, nacionalidad }>;
      config: { num_pasajeros, tipo_habitacion, fecha_salida };
    };
  };
  paquete: {
    nombre, titulo, destino, duracion, fecha_salida,
    descripcion, incluye, no_incluye, precio_doble
  };
  itinerario: Array<{ dia, titulo, descripcion, hotel, comidas }>;
  vendedor: { nombre, apellido, email, telefono };
}
```

## 🔌 Endpoint Nuevo

```
GET /api/cotizaciones/:id/pdf
- Genera PDF on-the-fly
- Autenticación: vendedor dueño o admin
- Response: application/pdf
```

## 📁 Archivos a Crear

### Backend
```
trip-conecta-api/
├── src/
│   ├── services/pdf.service.ts      # Lógica de generación
│   ├── templates/cotizacion.pug     # Template HTML
│   └── routes/cotizaciones.routes.ts # + endpoint /:id/pdf
├── assets/logo-tripconecta.png
└── package.json (+ puppeteer, pug)
```

### Frontend
```
trip-conecta-panel/
├── src/components/BotonGenerarPDF.tsx
└── src/app/(dashboard)/cotizaciones/[id]/page.tsx
```

## ✅ Plan de Implementación

| Paso | Tarea | Tiempo Est. |
|------|-------|-------------|
| 1 | Instalar dependencias (puppeteer, pug) | 5 min |
| 2 | Crear template Pug con diseño profesional | 30 min |
| 3 | Crear servicio PDF (pdf.service.ts) | 20 min |
| 4 | Agregar endpoint /:id/pdf | 15 min |
| 5 | Crear botón en frontend con loader | 15 min |
| 6 | Testing y ajustes | 15 min |
| **Total** | | **~2 horas** |

---

**¿Aprobado?** Si sí, comienzo la implementación completa.
