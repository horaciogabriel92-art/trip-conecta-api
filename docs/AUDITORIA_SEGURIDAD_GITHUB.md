# 🔒 AUDITORÍA DE SEGURIDAD - REPOSITORIOS GITHUB

**Fecha:** 16/03/2026  
**Repositorios Auditados:**
- `horaciogabriel92-art/trip-conecta-api` (master)
- `horaciogabriel92-art/panel-trip-conecta` (main)

---

## 🚨 PROBLEMAS CRÍTICOS DE SEGURIDAD

### 1. JWT_SECRET con Fallback Débil ⚠️ CRÍTICO

**Archivos Afectados:**
- `trip-conecta-api/src/middleware/auth.ts` (línea 4)
- `trip-conecta-api/src/controllers/auth.controller.ts` (línea 7)

**Problema:**
```typescript
// middleware/auth.ts
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// auth.controller.ts
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this-in-prod';
```

**Riesgo:** Si `JWT_SECRET` no está configurado en el entorno, el sistema usará valores predecibles ('secret' o 'super-secret-key-change-this-in-prod'). Cualquier atacante puede generar tokens JWT válidos y acceder a TODO el sistema.

**Solución:**
```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

---

### 2. Passwords Hardcodeadas en seed.ts ⚠️ MEDIO

**Archivo:** `trip-conecta-api/src/seed.ts` (líneas 11, 28)

**Problema:**
```typescript
const adminPassword = await bcrypt.hash('admin123', 10);
const vendedorPassword = await bcrypt.hash('vendedor123', 10);
```

**Riesgo:** Aunque el seed debería usarse solo en desarrollo, si se ejecuta accidentalmente en producción, crea usuarios con passwords débiles y conocidas.

**Solución:** Generar passwords aleatorios o leer de variables de entorno:
```typescript
const adminPassword = await bcrypt.hash(
  process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex'), 
  10
);
```

---

### 3. Archivos de Log/Debug en Repositorio ⚠️ MEDIO

**Posibles archivos que podrían filtrar información:**
- `*.log` files
- Archivos de debug

**Recomendación:** Asegurar que `.gitignore` cubra todos los logs.

---

## 📁 ARCHIVOS INNECESARIOS EN REPOSITORIO

### trip-conecta-panel (Frontend)

**Archivos a Eliminar:**
```
public/file.svg      # Logo de ejemplo de Next.js
public/globe.svg     # Logo de ejemplo de Next.js
public/next.svg      # Logo de Next.js (ya tienes favicon.ico propio)
public/vercel.svg    # Logo de Vercel (no usas Vercel, usas Coolify)
public/window.svg    # Logo de ejemplo de Next.js
```

**Archivos SOP (Sistema Operativo Procedimientos):**
La carpeta `docs/onboarding/` contiene 10+ documentos SOP que son documentación interna de operaciones (CARMEN B2B). Considerar si deben estar en el repo de código o en un repo/documentación separada.

**Archivos de Documentación Excesiva:**
- `docs/07-RAG-MULTI-TENANT-EXPLAINED.md` - Parece ser documentación de arquitectura CARMEN, no específica de Trip Conecta

### trip-conecta-api (Backend)

**Archivos de Setup que podrían consolidarse:**
- `src/init-db.ts` - Ya no se usa (migrado a Supabase)
- `src/setup-db.ts` - Ya no se usa (migrado a Supabase)
- `src/seed.ts` - Solo para desarrollo inicial

**Archivos de Base de Datos:**
- `supabase/schema.sql` - ✅ DEBE quedarse (esquema necesario)
- `migrations/*.sql` - ✅ DEBEN quedarse (historial de migraciones)

---

## ⚠️ MALAS PRÁCTICAS IDENTIFICADAS

### 1. Inconsistencia en Default Branches

- **API:** usa `master`
- **Panel:** usa `main`

**Recomendación:** Estandarizar a `main` en ambos repos.

### 2. URLs Hardcodeadas con Fallback

**Archivos:**
- `trip-conecta-panel/src/lib/api.ts:3`
- `trip-conecta-panel/src/context/AuthContext.tsx:25`

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
```

**Problema:** Si `NEXT_PUBLIC_API_URL` no está seteada en producción, las peticiones irán a localhost y fallarán silenciosamente.

**Solución:**
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL;
if (!API_URL && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_API_URL is required in production');
}
```

### 3. Falta de Rate Limiting en Auth

El rate limiter existe (`src/middleware/rateLimiter.ts`) pero no se aplica a las rutas de autenticación, haciendo el login vulnerable a ataques de fuerza bruta.

### 4. CORS muy permisivo potencialmente

En `trip-conecta-api/src/index.ts`:
```typescript
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
```

Si `CORS_ORIGIN` no está seteado, permite cualquier origen (`*`) con credenciales, lo cual es un riesgo de seguridad.

---

## 🧹 LIMPIEZA RECOMENDADA

### Acciones Prioritarias

```bash
# 1. Eliminar archivos SVG innecesarios del panel
cd trip-conecta-panel
git rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg

# 2. Eliminar archivos de setup obsoletos del API
cd trip-conecta-api
git rm src/init-db.ts src/setup-db.ts

# 3. Mover seed.ts a carpeta scripts/ y protegerlo
git mv src/seed.ts scripts/seed-dev.ts
```

### Estructura Recomendada API

```
trip-conecta-api/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   └── index.ts
├── scripts/           # Nuevo: scripts de utilidad
│   └── seed-dev.ts    # Mover desde src/
├── docs/              # Documentación
├── migrations/        # SQL migrations
├── supabase/          # Schema
└── tests/             # Nuevo: tests (faltan!)
```

### Estructura Recomendada Panel

```
trip-conecta-panel/
├── src/
│   ├── app/
│   ├── components/
│   ├── context/
│   └── lib/
├── public/            # Solo archivos necesarios
│   └── (sin logos de Next.js/Vercel)
├── docs/              # Considerar: mover SOPs a repo separado
└── tests/             # Nuevo: tests (faltan!)
```

---

## ✅ CHECKLIST DE SEGURIDAD PRE-DESPLIEGUE

- [ ] **CRÍTICO:** Eliminar todos los fallback de JWT_SECRET
- [ ] **CRÍTICO:** Configurar JWT_SECRET en Coolify (.env de producción)
- [ ] **CRÍTICO:** Re-generar JWT_SECRET en producción: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] **CRÍTICO:** Aplicar rate limiting a rutas de auth
- [ ] **MEDIO:** Eliminar passwords hardcodeadas de seed.ts
- [ ] **MEDIO:** Eliminar archivos SVG de ejemplo
- [ ] **MEDIO:** Validar que CORS_ORIGIN esté seteado en producción
- [ ] **BAJO:** Estandarizar default branch a `main`
- [ ] **BAJO:** Crear carpeta `tests/` con tests básicos
- [ ] **BAJO:** Agregar GitHub Actions para CI/CD básico

---

## 🔐 CONFIGURACIÓN RECOMENDADA PARA COOLIFY (Producción)

### Variables de Entorno OBLIGATORIAS

```bash
# API (.env en Coolify)
NODE_ENV=production
JWT_SECRET=<64-char-hex-string>  # REQUERIDO - Sin fallback
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
CORS_ORIGIN=https://panel.tripconecta.com  # REQUERIDO - Sin wildcard
PORT=3001

# Panel (.env en Coolify / Vercel)
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.tripconecta.com/api
```

---

## 📊 RESUMEN DE RIESGOS

| Nivel | Cantidad | Issues |
|-------|----------|--------|
| 🔴 CRÍTICO | 2 | JWT_SECRET fallback, CORS wildcard |
| 🟡 MEDIO | 3 | Passwords hardcodeadas, logs potenciales, rate limiting auth |
| 🟢 BAJO | 4 | Archivos innecesarios, inconsistencia branches, falta tests |

---

## 🎯 PLAN DE ACCIÓN RECOMENDADO

### Fase 1: Seguridad CRÍTICA (Hoy)
1. Fix JWT_SECRET - eliminar fallback
2. Configurar variables en Coolify
3. Re-generar secret en producción

### Fase 2: Limpieza (Mañana)
1. Eliminar archivos innecesarios
2. Reorganizar estructura
3. Actualizar .gitignore si es necesario

### Fase 3: Mejores Prácticas (Esta semana)
1. Agregar tests básicos
2. Implementar rate limiting en auth
3. Estandarizar branches

---

**Auditado por:** Kimi Code CLI  
**Checkpoint:** 5d6bd3b (API) / 0cdab96 (Panel)
