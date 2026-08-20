# Changelog · FASE 3 — Operación en sede

**Estado:** backend completo y verificado end-to-end. Frontend funcional (ver alcance abajo).

## Backend
- `turnos`: registro de llegada desde mostrador (RN-07.1), cola ordenada por prioridad y llegada (RN-05.2),
  llamado **automático al siguiente** (RN-07.3), priorización con **nota obligatoria** validada en el DTO
  y auditada (RN-07.4), finalización de atención.
- `pantallas`: configuración por sala/servicio (RN-11.1) y estado público que consume la TV sin login
  —es un dispositivo de sala, no una persona— con la configuración del frame de YouTube (RN-11.2).
- `metricas`: KPIs por rango y panel de balanceo con **los dos indicadores de RN-02 separados**:
  `consultasGenerales` (comparativo, excluye controles) y `ocupacionPorcentaje` (incluye controles porque
  ocupan tiempo). El kiosko aparece marcado como módulo apagado (D3).
- `TurnosGateway` (Socket.IO): llamados en vivo a las pantallas suscritas y refresco del backoffice.
  La burbuja de bandeja se emite **sin sonido** (decisión explícita del cliente).

## Frontend
- **Backoffice**: login por rol, dashboard con fecha larga + selector de rango + buscador + panel de
  balanceo, agenda consolidada día/semana/mes con selector de prestador, modal de crear cita que consume
  los cupos del motor con **crear paciente embebido**, mostrador con ticket de texto formateado,
  y vista del prestador (móvil primero) con tipo de servicio visible y modal de priorización con nota.
- **Pantalla de sala** (`/tv?pantalla=<id>`): turno en atención en grande, siguientes en lista,
  llamados en vivo por WebSocket con refresco periódico como red de seguridad, y frame de YouTube
  que alterna canal en vivo e institucional usando la IFrame Player API (el evento `ENDED` es la
  única forma de detectar el fin del video para volver al canal — RN-11.2).

## Bug de zona horaria encontrado en la verificación manual
"Hoy" se calculaba con la hora del **servidor**. La clínica opera en Cali (UTC−5) y el servidor puede
estar en cualquier zona: con el servidor en Europa, las citas de la mañana caían en la fecha equivocada
y el mostrador no encontraba la cita recién creada. Se añadió `ZONA_SEDE`/`fechaEnZona`/`hoyEnSede`
en `@provivir/shared`, aplicado en turnos, agendas, métricas y el frontend.

## Verificación end-to-end (manual, contra la API real)
crear cita → llegada en mostrador (Ana Torres entra con prioridad `media` por su marca "Adulto mayor")
→ llamado automático → aparece en la pantalla de sala sin login → el balanceo refleja la carga.

## Alcance del frontend — lo que NO está
El prototipo `index_v2.html` tiene más vistas de las construidas. Faltan, y quedan para después:
- Bandeja de la asistente (depende de WhatsApp, Fase 4).
- Gestión de agendas en UI (el backend está completo; falta la pantalla de programación mensual masiva).
- Pacientes/prestadores/servicios como pantallas de administración (API completa).
- Carga masiva en UI (API completa, incluido el reporte de errores descargable).
- Auditoría navegable (API completa).
- Pruebas e2e de navegador (Playwright): la guía las pide al cerrar la fase. **No se ejecutaron**:
  el entorno no tiene navegador instalado y descargarlo requiere permisos que no hay. Los flujos
  se verificaron contra la API en su lugar.

## Deuda conocida
- `npm run test:e2e` usa `--forceExit`: el servidor de Socket.IO deja temporizadores que jest no
  reporta como handles abiertos y el proceso no termina. El apagado por señal en producción sí
  funciona (verificado con SIGTERM sobre `dist/main.js`).
- La rotación del frame de YouTube está implementada pero **no validada en un TV real** — es el
  riesgo que ambas partes registraron en la reunión (RN-11.3). Requiere P10 (enlaces del cliente).
