#!/bin/bash
# ============================================
# 🔒 SCRIPT DE LIMPIEZA DE SEGURIDAD
# Ejecutar desde la raíz del proyecto
# ============================================

echo "🔒 Iniciando limpieza de seguridad..."

# ============================================
# FASE 1: API - Eliminar archivos obsoletos
# ============================================
echo "📁 Limpiando API..."
cd trip-conecta-api 2>/dev/null || { echo "❌ No se encuentra trip-conecta-api"; exit 1; }

# Verificar si los archivos existen antes de eliminar
if [ -f "src/init-db.ts" ]; then
    echo "  🗑️  Eliminando src/init-db.ts (obsoleto)"
    git rm src/init-db.ts
fi

if [ -f "src/setup-db.ts" ]; then
    echo "  🗑️  Eliminando src/setup-db.ts (obsoleto)"
    git rm src/setup-db.ts
fi

# Mover seed.ts a scripts/ (crear directorio si no existe)
if [ -f "src/seed.ts" ]; then
    echo "  📦 Moviendo src/seed.ts a scripts/seed-dev.ts"
    mkdir -p scripts
    git mv src/seed.ts scripts/seed-dev.ts
fi

cd ..

# ============================================
# FASE 2: Panel - Eliminar archivos SVG de ejemplo
# ============================================
echo "📁 Limpiando Panel..."
cd trip-conecta-panel 2>/dev/null || { echo "❌ No se encuentra trip-conecta-panel"; exit 1; }

# Eliminar SVGs de ejemplo de Next.js
for file in public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg; do
    if [ -f "$file" ]; then
        echo "  🗑️  Eliminando $file"
        git rm "$file"
    fi
done

cd ..

# ============================================
# FASE 3: Verificar .gitignore
# ============================================
echo "🔍 Verificando .gitignore..."

for dir in trip-conecta-api trip-conecta-panel; do
    if [ -f "$dir/.gitignore" ]; then
        if ! grep -q "\.env" "$dir/.gitignore"; then
            echo "  ⚠️  $dir/.gitignore no ignora archivos .env"
        else
            echo "  ✅ $dir/.gitignore correcto"
        fi
    fi
done

# ============================================
# FASE 4: Resumen
# ============================================
echo ""
echo "✅ Limpieza completada"
echo ""
echo "⚠️  ACCIONES MANUALES PENDIENTES:"
echo "   1. Revisar y aplicar los fixes de seguridad en:"
echo "      - trip-conecta-api/src/middleware/auth.ts"
echo "      - trip-conecta-api/src/controllers/auth.controller.ts"
echo "   2. Configurar variables de entorno en Coolify"
echo "   3. Re-generar JWT_SECRET para producción"
echo ""
echo "📝 Para commitear los cambios:"
echo "   git commit -m '🔒 cleanup: Remove obsolete files and security fixes'"
