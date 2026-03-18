# 🔧 PDF Feature - Guía de Troubleshooting

## Errores de Deploy (Docker/Coolify)

### 1. `npm ci` can only install packages when your package.json and package-lock.json are in sync

**Causa:** El `package-lock.json` no está actualizado con las nuevas dependencias.

**Solución:**
```bash
npm install  # Actualiza package-lock.json
git add package-lock.json
git commit -m "Update package-lock"
git push
```

---

### 2. `Could not find a declaration file for module 'pug'`

**Causa:** `@types/pug` está en `devDependencies` pero Docker no lo instala correctamente.

**Solución:** Mover `@types/pug` a `dependencies` (no `devDependencies`) en `package.json`.

---

### 3. Template not found: `../templates/pdf/cotizacion.pug`

**Causa:** Los templates se copian a la ruta incorrecta en el contenedor Docker.

**Solución en Dockerfile:**
```dockerfile
# El código compilado está en dist/, los templates deben estar en dist/templates/
COPY --from=builder /app/src/templates ./dist/templates
```

**Rutas importantes:**
- Código fuente: `/app/src/services/pdf.service.ts` → busca en `../templates/`
- Código compilado: `/app/dist/services/pdf.service.js` → debe buscar en `../templates/` = `/app/dist/templates/`

---

### 4. Chromium no encontrado / Puppeteer error: "Could not find Chrome"

**Causa:** Puppeteer no encuentra el ejecutable de Chromium en el contenedor.

**Verificación:**
- Verificar que el Dockerfile instala Chromium: `RUN apk add --no-cache chromium ...`
- Verificar que la variable de entorno está seteada: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`

**Solución:** Usar args correctos para Puppeteer:
```typescript
const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
    ]
});
```

---

## Errores de Funcionamiento

### 5. PDF se genera pero no se guarda / se pierde al reiniciar

**Causa:** El directorio de storage no persiste entre reinicios del contenedor.

**Solución:** Configurar volumen persistente en Coolify:
- Variable de entorno: `PDF_STORAGE_PATH=/data/cotizaciones-pdfs`
- Volumen montado: `/data` → directorio persistente en el VPS

---

### 6. Permisos denegados al generar PDF

**Causa:** El usuario de Docker no tiene permisos de escritura en el directorio de storage.

**Solución en Dockerfile:**
```dockerfile
RUN mkdir -p storage/cotizaciones-pdfs && chmod 777 storage/cotizaciones-pdfs
```

---

### 7. Error 403 al generar/descargar PDF

**Causa:** El usuario no tiene permisos sobre la cotización.

**Verificación:**
- El token JWT debe incluir `role` (no `rol`)
- El middleware verifica `user.role === 'admin'` o `cotizacion.vendedor_id === user.userId`

**Nota:** En el token JWT se guarda `role: user.rol` desde la BD.

---

### 8. CSS no aplica en el PDF generado

**Causa:** El archivo CSS no se copia al contenedor o la ruta es incorrecta.

**Solución:**
- Verificar que `cotizacion.css` está en `src/templates/pdf/`
- Verificar que se copia junto con los templates en el Dockerfile
- El template Pug usa `include cotizacion.css` con ruta relativa

---

### 9. Timeout al generar PDF (Puppeteer lento)

**Causa:** Puppeteer necesita más recursos o el VPS tiene poca RAM.

**Soluciones:**
1. Aumentar memoria del contenedor en Coolify (mínimo 1GB recomendado)
2. Agregar `--single-process` a los args de Puppeteer (modo menos seguro pero más liviano)
3. Usar `puppeteer-core` en lugar de `puppeteer` (sin Chromium bundled)

---

## Checklist Pre-Deploy

- [ ] `package.json` tiene `pug` y `@types/pug` en `dependencies`
- [ ] `package-lock.json` está actualizado y commiteado
- [ ] Dockerfile instala Chromium con `apk add chromium`
- [ ] Dockerfile copia templates a `./dist/templates`
- [ ] Dockerfile setea `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
- [ ] Variable de entorno `PDF_STORAGE_PATH` configurada en Coolify
- [ ] Volumen persistente configurado para el storage path
- [ ] Memory limit del contenedor ≥ 1GB

---

## Endpoints de la API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/pdf/cotizaciones/:id/pdf` | Genera nuevo PDF |
| GET | `/api/pdf/cotizaciones/:id/pdf` | Descarga PDF existente (blob) |
| PUT | `/api/pdf/cotizaciones/:id/pdf` | Regenera PDF (elimina anterior) |

---

## Estructura de Archivos

```
trip-conecta-api/
├── src/
│   ├── services/
│   │   └── pdf.service.ts      # Lógica de generación PDF
│   ├── controllers/
│   │   └── pdf.controller.ts   # Endpoints API
│   ├── routes/
│   │   └── pdf.routes.ts       # Definición rutas
│   └── templates/
│       └── pdf/
│           ├── cotizacion.pug  # Template
│           └── cotizacion.css  # Estilos
├── Dockerfile                   # Config Docker con Chromium
└── package.json                 # Deps: puppeteer, pug, @types/pug
```
