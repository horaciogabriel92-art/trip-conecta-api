# Feature Flags + Metodologías de Trabajo

## Resumen

El sistema ahora soporta configuración por tenant mediante feature flags y tres metodologías de trabajo.

## Modelo de datos

### `plans.features` (JSONB)

| Plan | `comisiones` | `vendedor_autoconfirma` | `dominio_propio` |
|------|--------------|------------------------|------------------|
| `free` | false | false | false |
| `freelance` | false | false | false |
| `pro-agencia` | true | true | true |
| `pro-ilimitado` | true | true | true |

### `tenants.configuracion` (JSONB)

```json
{
  "features": {
    "comisiones": { "enabled": true }
  },
  "workflow": {
    "mode": "admin_confirma"
  }
}
```

## Reglas de negocio

- `comisiones_visible = plan.features.comisiones AND tenant.configuracion.features.comisiones.enabled`
- `vendedor_puede_autoconfirmar = plan.features.vendedor_autoconfirma AND tenant.configuracion.workflow.mode === 'vendedor_autoconfirma'`
- `modo_simple = tenant.plan.slug IN ('free', 'freelance') OR tenant.configuracion.workflow.mode === 'simple'`

## Endpoints

- `GET /config/tenant` → devuelve plan + configuración del tenant.
- `PUT /config/tenant` → admin actualiza `configuracion` (validado contra plan).

## Metodologías

### `admin_confirma` (default)
- Solo admin convierte cotizaciones a ventas.
- Solo admin sube/elimina vouchers.
- Venta inicia en `pendiente`.

### `vendedor_autoconfirma`
- Vendedor dueño puede convertir su cotización a venta.
- Al convertir con `pago_realizado=true`, la venta pasa a `confirmada`.
- Vendedor dueño puede subir/eliminar vouchers y cambiar el estado de sus ventas.
- Admin sigue pudiendo hacer todo y fiscalizar.

### `simple`
- Forzado para planes `free`/`freelance`.
- Flujo acelerado para un único usuario admin.
- (Pendiente Fase 5) Envío de email de confirmación con PDF + vouchers adjuntos.

## Archivos clave

- `trip-conecta-api/src/utils/features.ts`
- `trip-conecta-api/src/controllers/config.controller.ts`
- `trip-conecta-api/src/controllers/cotizaciones.controller.ts`
- `trip-conecta-api/src/controllers/ventas.controller.ts`
- `trip-conecta-api/src/routes/upload.routes.ts`
- `trip-conecta-panel/src/hooks/useFeature.ts`
- `trip-conecta-panel/src/hooks/useWorkflowMode.ts`
- `trip-conecta-panel/src/app/(dashboard)/configuracion/_components/FeaturesTab.tsx`
- `trip-conecta-panel/src/app/(dashboard)/configuracion/_components/WorkflowTab.tsx`
