# Changelog · FASE 1 — Núcleo de datos + carga masiva

**Estado:** completa. Pruebas en verde.

## Entregado

### CRUD y búsquedas
- `pacientes`: búsqueda única que elige criterio por la forma del texto (documento, teléfono o nombre)
  en lugar de hacer OR sobre los tres — con 400.000 registros un OR no usaría índice.
  Paginación obligatoria; sin borrado físico (se desactiva, porque hay citas e historial asociados).
- `prestadores`: duraciones por prestador y tipo (RN-01.4), ventana de control propia (RN-01.3),
  grupo de balanceo (RN-02.1), endpoint `/prestadores/grupo-balanceo` para el panel del dashboard.
- `servicios`: catálogo con tipo, cupos múltiples (RN-04.4) y política de costo (RN-01.2).
- `agendas`: modos semanal y calendario, **programación mensual masiva** en una transacción
  (o quedan todos los días o ninguno — administración no debería reconstruir a mano un mes a medias),
  y bloqueo con **simulación previa**: sin `confirmar` devuelve las citas afectadas para ver el impacto
  antes de aplicarlo (RN-06.3).
- `configuracion`: parámetros de reglas cacheados en memoria, porque el motor los consulta en cada cálculo.
- `auditoria`: escritura tolerante a fallos — perder una cita es peor que perder una línea de auditoría.

### Carga masiva (RN-12)
- Streaming por lotes de 1.000 con `csv-parse`: el archivo nunca se carga entero en memoria.
- Cola BullMQ con concurrencia 1 — la carga es intensiva en BD y compite con la operación en sede.
- Mapeo de encabezados **tolerante** a tildes, mayúsculas y variantes: RN-12.2 dice que no se le exige
  al cliente reacomodar su exportación.
- Filtro de servicio en el último año (RN-12.3), deduplicación por documento dentro del archivo
  y contra la base (RN-12.5), historial de servicios poblado (RN-12.4).
- Reporte de errores descargable en CSV con **documentos enmascarados**.
- El archivo se elimina del disco al terminar, aunque el proceso falle (`finally`).

## Pruebas
- **23 unitarias**: mapeo de encabezados, normalización de teléfono/documento/fecha, filtro del último año
  con sus bordes exactos, enmascarado de PII.
- **8 de integración** contra base real: rechazo de archivo sin columnas obligatorias, borrado del archivo,
  filtro del año, recarga que rechaza duplicados y actualiza contacto, duplicados dentro del mismo archivo,
  historial poblado, reporte de errores sin PII.
- **100.000 registros en 67 s** — el objetivo de la guía eran 5 minutos.

## Decisiones
| # | Decisión | Motivo |
|---|---|---|
| F1-1 | "Rechazar duplicado" = no crear otro registro, pero sí refrescar contacto | La recarga suele traer teléfonos más nuevos que la base. |
| F1-2 | Sin fecha de servicio → fuera del filtro del último año | No se puede afirmar que cumpla el criterio; RN-12.3 dice que esos se registran al llegar. |
| F1-3 | Un solo reintento en la cola de carga | Reintentar una carga a medias duplicaría trabajo; se relanza manualmente. |
