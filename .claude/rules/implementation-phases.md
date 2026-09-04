# Fases e implementación

## Estado del proyecto

| Fase | Estado |
|---|---|
| 0 · Fundaciones | **Completa** — `docs/changelog-fase0.md` |
| 1 · Núcleo de datos + carga masiva | **Completa** — `docs/changelog-fase1.md` |
| 2 · Motor de agendamiento | **Completa** — `docs/changelog-fase2.md` |
| 3 · Operación en sede | **Completa** — `docs/changelog-fase3.md`. Las vistas que su changelog daba por ausentes (carga masiva, auditoría navegable, programación mensual) están en `Administracion.tsx` y `Agendas.tsx` |
| 5 · Autoagendamiento web + kiosko apagado | **Completa** — `docs/changelog-fase5.md` |
| 4 · WhatsApp + IA + bandeja | **Completa** (incluye RN-09.8) — `docs/changelog-fase4.md` |
| 6 · Métricas, endurecimiento y piloto | **Completa** — `docs/changelog-fase6.md` |
| 7 · Base de conocimiento + seguimiento comercial | **Completa** salvo el golden set — `docs/changelog-fase7.md` |
| 8 · Envíos proactivos y ventana de Meta | **Completa** salvo las plantillas del cliente — `docs/changelog-fase8.md` |
| 9 · Sesión que no se corta mientras se trabaja | **Completa** — `docs/changelog-fase9.md` |
| 10 · Menú del prototipo y pantallas que faltaban | **Completa** — `docs/changelog-fase10.md` |
| 11 · Ajustes de retroalimentación del cliente | **Desplegada** — `docs/changelog-fase11.md` |
| 12 · Consentimiento de datos en WhatsApp (incluye RN-08.1, el adjunto visible) | **En verde, sin desplegar** — `docs/changelog-fase12.md` |
| 13 · Reabrir conversaciones, modificar citas y buscar en el mostrador | **En verde, sin desplegar** — `docs/changelog-fase13.md` |

**Las seis primeras fases están completas.** Lo que falta para producción son credenciales e insumos
del cliente, no código: ver `docs/checklist-piloto.md` y `despliegue/GUIA-DESPLIEGUE.md`.

**Fase 7** es trabajo posterior al alcance original: convierte `configuracion.documentacion_comercial`
—hoy un bloque de texto inyectado en cada conversación— en artículos versionados con recuperación
(RN-13), extiende el seguimiento de RN-09.8 a una secuencia comercial (RN-09.9) y completa el
gobierno del catálogo (RN-04.5).

**La Fase 5 se adelantó a la Fase 4** por decisión del cliente: el bot debe ofrecer el enlace
del portal (RN-09.8) y no puede apuntar a algo inexistente.

## Pendientes de confirmar con el cliente

1. RN-01.5 · qué cuenta como "control consecutivo" (`docs/changelog-fase2.md`).
2. RN-10.2 · el portal exige documento + últimos 4 del teléfono, no solo documento (`docs/changelog-fase5.md`).
3. RN-09.2 · usar botones interactivos de WhatsApp en vez de solo texto (`docs/rn-09-8-oferta-web.md`).

## Flujo de trabajo por fase

- Una fase = una rama (`fase-2-motor-citas`); dentro, commits atómicos.

## Definición de hecho (DoD) por tarea

Código + test (con ID de RN si aplica) + migración si cambia el esquema + entrada en
`docs/changelog-faseN.md`. Ninguna fase se cierra sin sus pruebas en verde y su demo
funcionando. No se avanza dejando deuda de la fase anterior.

## Pendientes del cliente que bloquean

P1 base de pacientes (bloquea carga masiva) · P2 duraciones · P3 ventanas de control (bloquea
RN-01) · P6 documentación comercial (bloquea RN-13 entera) · P9 CSV de contactos · P10 enlaces de
YouTube · P12 temas que el bot siempre escala (RN-13.4) · P13 información operativa para los
primeros artículos. Detalle en la Especificación §5 y en `docs/checklist-piloto.md`.
